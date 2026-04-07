import { MongoClient } from "mongodb";
import { ensureCommunityIndexes } from "../lib/mongo/indexes.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const MONGO_DB = process.env.MONGO_DB || "aiclipse";

async function main() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    const db = client.db(MONGO_DB);
    await ensureCommunityIndexes(db);
    console.log("Community indexes ensured.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
