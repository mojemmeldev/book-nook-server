import express from 'express';
import 'dotenv/config';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
import {createRemoteJWKSet, jwtVerify} from "jose";

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

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.FRONTEND_URI}/api/auth/jwks`)
);

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).send({
        message: "Unauthorized: Token missing",
      });
    }

    const token = authHeader.split(" ")[1];

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: process.env.FRONTEND_URI,
      audience: process.env.FRONTEND_URI,
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
app.post("/books/borrows", verifyToken, async (req, res) => {
  try {
    const borrowsData = req.body;
    const result = await borrowsCollections.insertOne(borrowsData);
    res.send(result);
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


// Return a book — deletes the borrow document so it disappears from My Borrows.
app.delete("/books/borrows/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await borrowsCollections.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (err) {
    console.error("Error deleting borrow:", err);
    res.status(500).send({ error: "Borrow failed" });
  }
});



//book all method//


app.get("/books", async (req, res) => {
  try {
    const result = await bookCollections.find().toArray();
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch books" });
  }
});

app.post("/books", async (req, res) => {
  try {
    const books = req.body;
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


app.patch("/books/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updateData= req.body;
    const result = await bookCollections.updateOne({ _id: new ObjectId(id) },{$set:updateData});
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Book not found" });
  }
});


app.delete("/books/:id", async (req, res) => {
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
