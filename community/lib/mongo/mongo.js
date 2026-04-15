import { MongoClient } from "mongodb";
import { ensureCommunityIndexes } from "./indexes.js";

const MONGO_DB = process.env.MONGO_DB || "aiclipse";

const options = {
  maxPoolSize: 10,
  minPoolSize: 1,
  maxIdleTimeMS: 30000,
};

let client;
let clientPromise;

function resetClientState() {
  clientPromise = null;
  client = null;
  if (process.env.APP_ENV === "dev") {
    delete global._mongoClientPromise;
  }
}

export async function getDb() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    throw new Error('Invalid/Missing environment variable: "MONGO_URI"');
  }

  if (!clientPromise) {
    if (process.env.APP_ENV === "dev") {
      if (!global._mongoClientPromise) {
        client = new MongoClient(MONGO_URI, options);
        global._mongoClientPromise = client.connect();
      }
      clientPromise = global._mongoClientPromise;
    } else {
      client = new MongoClient(MONGO_URI, options);
      clientPromise = client.connect();
    }
  }

  try {
    const connectedClient = await clientPromise;
    const db = connectedClient.db(MONGO_DB);
    await ensureCommunityIndexes(db);
    return db;
  } catch (error) {
    resetClientState();
    throw error;
  }
}

export default clientPromise;
