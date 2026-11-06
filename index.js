import express from 'express';
import 'dotenv/config';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
import {createRemoteJWKSet, decodeProtectedHeader, importJWK, jwtVerify} from "jose";

const app = express();
const PORT = 8000;

app.use(
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const client = new MongoClient(process.env.MONGO_URI);
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectClient = await connectToMongoDB();
const db = connectClient.db('book-nook');
const bookCollections = db.collection("books");
const borrowsCollections = db.collection("borrows");

//middleware

// Origins that are allowed to mint tokens: FRONTEND_URI (comma separated, so
// it can list both the deployed and the local frontend) plus the local dev
// origins — the same ones the CORS config above already trusts.
const ALLOWED_ORIGINS = [
  ...String(process.env.FRONTEND_URI || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean),
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

// Remote JWKS endpoint — only reachable while the frontend is deployed.
// Kept as a fallback for keys that are not in MongoDB yet.
const remoteJWKS = ALLOWED_ORIGINS[0]
  ? createRemoteJWKSet(new URL(`${ALLOWED_ORIGINS[0]}/api/auth/jwks`))
  : null;

// better-auth keeps its signing keys in the shared `book-nook-user` database
// (same Atlas cluster this server already connects to). Reading the public key
// from there lets the deployed backend verify tokens issued by a frontend
// running on localhost — a remote fetch of http://localhost:3000/api/auth/jwks
// from Vercel can never succeed, which is what made every request 401.
const jwksCollections = client.db("book-nook-user").collection("jwks");

const resolveSigningKey = async (header) => {
  if (header.kid) {
    // better-auth stores `_id` as an ObjectId while the JWT `kid` is a string.
    const storedKey = await jwksCollections.findOne(
      ObjectId.isValid(header.kid)
        ? { _id: new ObjectId(header.kid) }
        : { _id: header.kid },
    );
    if (storedKey) {
      return importJWK(
        JSON.parse(storedKey.publicKey),
        storedKey.alg || header.alg || "EdDSA",
      );
    }
  }
  if (!remoteJWKS) {
    throw new Error("No signing key available for this token");
  }
  return remoteJWKS.getKey(header);
};

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).send({
        message: "Unauthorized: Token missing",
      });
    }

    const token = authHeader.split(" ")[1];
    const key = await resolveSigningKey(decodeProtectedHeader(token));

    const { payload } = await jwtVerify(token, key, {
      issuer: ALLOWED_ORIGINS,
      audience: ALLOWED_ORIGINS,
    });

    req.user = payload;

    next();
  } catch (error) {
    console.error("JWT Verification Error:", error.message);

    return res.status(401).send({
      message: "Unauthorized: Invalid or expired token",
    });
  }
};



app.get("/my-books/:email", verifyToken, async (req, res) => {
  try {
    const email = req.params.email;

     if (email!=req.user.email){
      return res.status(401).send({ message: "Unauthorized: Invalid or expired token", });
    }
    console.log("email",email);
    const result = await bookCollections.find({creatorEmail:email}).toArray();
    res.send(result);
  } catch (err) {
    console.error("Error find book:", err);
    res.status(500).send({ error: "Failed to find book" });
  }
});

// borrows method//


// Create a new borrow — called by the "Confirm Borrow" form on the Book Details page.
// Body: { bookId, bookTitle, bookImage, userName, email, borrowDate, returnDate, status }
// Rules enforced here:
//   * the request must carry a valid Better Auth JWT (verifyToken)
//   * a user cannot borrow the same book twice at the same time (409)
//   * borrowing decreases the book's available copies with $inc
app.post("/books/borrows", verifyToken, async (req, res) => {
  try {
    const borrowsData = req.body;

    // The email always comes from the verified token, never from the body.
    borrowsData.email = req.user.email;
    if (!borrowsData.bookId || !ObjectId.isValid(borrowsData.bookId)) {
      return res.status(400).send({ message: "Invalid book id" });
    }

    const bookId = new ObjectId(borrowsData.bookId);

    // --- No double borrow -------------------------------------------------
    const alreadyBorrowed = await borrowsCollections.findOne({
      bookId: borrowsData.bookId,
      email: borrowsData.email,
      status: "borrowed",
    });
    if (alreadyBorrowed) {
      return res.status(409).send({
        message: "You have already borrowed this book. Return it first.",
      });
    }

    // --- Available copies -------------------------------------------------
    const book = await bookCollections.findOne({ _id: bookId });
    if (!book) {
      return res.status(404).send({ message: "Book not found" });
    }

    // Books saved before the "Total Copies" challenge get their defaults.
    if (book.totalCopies === undefined || book.availableCopies === undefined) {
      const totalCopies = book.totalCopies ?? 1;
      await bookCollections.updateOne(
        { _id: bookId },
        {
          $set: {
            totalCopies,
            availableCopies: book.availableCopies ?? totalCopies,
          },
        },
      );
    }

    const availableBefore = book.availableCopies ?? book.totalCopies ?? 1;
    if (availableBefore <= 0) {
      return res
        .status(403)
        .send({ message: "No copies available — this book is not available." });
    }

    // Decrease by 1 — only if a copy is still free (atomic check + $inc).
    const decreased = await bookCollections.updateOne(
      { _id: bookId, availableCopies: { $gt: 0 } },
      { $inc: { availableCopies: -1 } },
    );
    if (decreased.matchedCount === 0) {
      return res
        .status(403)
        .send({ message: "No copies available — this book is not available." });
    }

    try {
      const result = await borrowsCollections.insertOne(borrowsData);
      return res.send(result);
    } catch (insertErr) {
      // Roll the copy back if the borrow record could not be saved.
      await bookCollections.updateOne(
        { _id: bookId },
        { $inc: { availableCopies: 1 } },
      );
      throw insertErr;
    }
  } catch (err) {
    console.error("Error inserting borrow:", err);
    res.status(500).send({ error: "Borrow failed" });
  }
});




// All borrows of one user — matches on the `email` field the borrow form stores.
app.get("/books/borrows/:email", verifyToken, async (req, res) => {
  try {
    const email = req.params.email;
    if (email!=req.user.email){
      return res.status(401).send({ message: "Unauthorized: Invalid or expired token", });
    }
    const result = await borrowsCollections.find({ email: email }).toArray();
    res.send(result);
  } catch (err) {
    console.error("Error finding borrows:", err);
    res.status(500).send({ error: "Failed to find borrows" });
  }
});


// Return a book — deletes the borrow document so it disappears from My Borrows,
// and gives the copy back to the book with $inc.
app.delete("/books/borrows/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid borrow id" });
    }

    const borrow = await borrowsCollections.findOne({ _id: new ObjectId(id) });
    if (!borrow) {
      return res.status(404).send({ message: "Borrow not found" });
    }
    // Only the borrower (from the verified token) can return the book.
    if (borrow.email && borrow.email !== req.user.email) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const result = await borrowsCollections.deleteOne({ _id: new ObjectId(id) });

    // Give the copy back: availableCopies + 1.
    if (borrow.bookId && ObjectId.isValid(borrow.bookId)) {
      const bookId = new ObjectId(borrow.bookId);
      const book = await bookCollections.findOne({ _id: bookId });
      if (book) {
        if (book.totalCopies === undefined || book.availableCopies === undefined) {
          const totalCopies = book.totalCopies ?? 1;
          await bookCollections.updateOne(
            { _id: bookId },
            { $set: { totalCopies, availableCopies: book.availableCopies ?? totalCopies } },
          );
        }
        await bookCollections.updateOne(
          { _id: bookId },
          { $inc: { availableCopies: 1 } },
        );
      }
    }

    res.send(result);
  } catch (err) {
    console.error("Error deleting borrow:", err);
    res.status(500).send({ error: "Borrow failed" });
  }
});



//book all method//


app.get("/books", async (req, res) => {
  try {
    // Newest books first — optional ?limit=6 for the New Arrivals section.
    const limit = Number(req.query.limit);
    let cursor = bookCollections.find().sort({ createdAt: -1 });
    if (Number.isFinite(limit) && limit > 0) cursor = cursor.limit(limit);
    const result = await cursor.toArray();
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch books" });
  }
});

app.post("/books", verifyToken, async (req, res) => {
  try {
    const books = req.body;

    // Defaults for documents that predate the "Total Copies" requirement.
    if (books.totalCopies === undefined || books.totalCopies === null) {
      books.totalCopies = 1;
    }
    if (books.availableCopies === undefined || books.availableCopies === null) {
      books.availableCopies = books.totalCopies;
    }
    // Date the book was added (used to sort newest-first).
    if (!books.createdAt) {
      books.createdAt = new Date().toISOString();
    }

    const result = await bookCollections.insertOne(books);
    res.send(result);
  } catch (err) {
    console.error("Error inserting book:", err);
    res.status(500).send({ error: "Failed to insert book" });
  }
});

 

app.get("/books/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await bookCollections.findOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Book not found" });
  }
});


app.patch("/books/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const updateData= req.body;
    const result = await bookCollections.updateOne({ _id: new ObjectId(id) },{$set:updateData});
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Book not found" });
  }
});


app.delete("/books/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await bookCollections.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Book not found" });
  }
});










app.get('/', (req, res) => {
  res.send("Hlw World");
});

app.listen(PORT, () => {
  console.log(`server is running on port ${PORT}`);
});

export default app