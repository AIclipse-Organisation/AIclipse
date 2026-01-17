import { NextResponse } from "next/server";
import { MongoClient } from "mongodb";

export const runtime = "nodejs"; // required for MongoDB driver

const MONGO_URI = process.env.MONGO_URI || "";
const MONGO_DB = process.env.MONGO_DB || "aiclipse";
const POSTS_COLLECTION = "community.posts";


export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const post_id = body?.post_id || null;

    // basic validation
    if (!post_id) {
      return NextResponse.json({ error: "Missing post_id" }, { status: 400 });
    }

    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not set");
    }

    // create a new Mongo client 
    const client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const posts = db.collection(POSTS_COLLECTION);

    // atomic increment of clicks_count
    const result = await posts.findOneAndUpdate(
      { post_id },
      { $inc: { clicks_count: 1 } },
      {
        returnDocument: "after",
        projection: { _id: 0, clicks_count: 1 },
      }
    );

    await client.close();

    if (!result.value) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        post_id,
        clicks_count: result.value.clicks_count,
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to increment clicks",
        detail: String(err),
      },
      { status: 500 }
    );
  }
}
