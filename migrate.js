/**
 * One-off backfill for documents created before the current requirements:
 *   - createdAt     (used to sort "New Arrivals" newest-first)
 *   - totalCopies / availableCopies   (Available Copies challenge)
 *
 * Run once:  node migrate.js
 */
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";

const client = new MongoClient(process.env.MONGO_URI);

try {
  await client.connect();
  const db = client.db("book-nook");
  const books = db.collection("books");

  const docs = await books.find({}).toArray();
  let updated = 0;

  for (const doc of docs) {
    const $set = {};

    if (!doc.createdAt) {
      // ObjectIds embed their creation timestamp — use it as the added date.
      const timestamp = ObjectId.isValid(doc._id)
        ? new ObjectId(doc._id).getTimestamp()
        : new Date();
      $set.createdAt = timestamp.toISOString();
    }

    if (doc.totalCopies === undefined || doc.totalCopies === null) {
      $set.totalCopies = 1;
    }
    if (doc.availableCopies === undefined || doc.availableCopies === null) {
      $set.availableCopies = doc.totalCopies ?? 1;
    }

    if (Object.keys($set).length > 0) {
      await books.updateOne({ _id: doc._id }, { $set });
      updated++;
    }
  }

  console.log(`Backfilled ${updated} of ${docs.length} books.`);
} finally {
  await client.close();
}
