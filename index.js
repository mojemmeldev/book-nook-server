import express from 'express';
import 'dotenv/config';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';

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
const bookBorrowsCollections = db.collection("booksBorrows");

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

app.get("/my-books/:email", async (req, res) => {
  try {
    const email = req.params.email;
    console.log("email",email);
    const result = await bookCollections.find({creatorEmail:email}).toArray();
    res.send(result);
  } catch (err) {
    console.error("Error find book:", err);
    res.status(500).send({ error: "Failed to find book" });
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

app.get("/books/borrows", async (req, res) => {
  try {
    const borrowsData = req.body;
    const result = await bookBorrowsCollections.insertOne(borrowsData);
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Borrow failed" });
  }
});


app.delete("/books/borrows/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await bookBorrowsCollections.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Borrow failed" });
  }
});

app.get("/books", async (req, res) => {
  try {
    const result = await bookCollections.find().toArray();
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch books" });
  }
});

app.get('/', (req, res) => {
  res.send("Hlw World");
});

app.listen(PORT, () => {
  console.log(`server is running on port ${PORT}`);
});
