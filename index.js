import express from 'express';
import 'dotenv/config'

import { MongoClient } from 'mongodb';
const app = express();
const PORT = 8000;
app.use(express.json());


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

const mongoclient = connectToMongoDB();


app.get('/', (req,res)=>{
    res.send("Hlw World")
})



app.listen(PORT, ()=>{
    console.log(`server is running on port ${PORT}`);
})