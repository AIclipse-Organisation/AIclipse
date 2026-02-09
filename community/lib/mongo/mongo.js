import { MongoClient } from "mongodb";

const MONGO_DB = process.env.MONGO_DB || "aiclipse";

const options = {
  maxPoolSize: 10,
  minPoolSize: 1,
  maxIdleTimeMS: 30000,
};

let client;
let clientPromise;

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

  const connectedClient = await clientPromise;
  return connectedClient.db(MONGO_DB);
}

export default clientPromise;