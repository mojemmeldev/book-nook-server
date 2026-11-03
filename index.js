import express from 'express';
import 'dotenv/config'
import cors from 'cors';

import { MongoClient } from 'mongodb';
const app = express();
const PORT = 8000;
app.use(express.json());
app.use(cors());



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
const bookCollections =db.collection("books")



app.post("/books", async (req,res)=>{
    const books= req.body;
    const result = await bookCollections.insertOne(books);
    res.send(result)
})


app.get("/books", async (req,res)=>{
    const result = await bookCollections.find().toArray();
    res.send(result)
})


app.get('/', (req,res)=>{
    res.send("Hlw World")
})



app.listen(PORT, ()=>{
    console.log(`server is running on port ${PORT}`);
})