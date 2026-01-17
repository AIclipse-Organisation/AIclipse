import { NextResponse } from "next/server";
import { MongoClient } from "mongodb";

export const runtime = "nodejs"; // required for MongoDB driver

const MONGO_URI = process.env.MONGO_URI || "";
const MONGO_DB = process.env.MONGO_DB || "aiclipse";
const POSTS_COLLECTION = "community.posts";

// NEW: user collection to lookup poster name
const USERS_COLLECTION = "auth.users";


  //Generates a unique post ID.Uses timestamp and random number to reduce chance of collisions.

function makePostId() {
  return `post_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}


 //Creates a new community post linked to an image.
 
export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);

    const user_id = body?.user_id || null;
    const image_id = body?.image_id || null;
    const description = (body?.description || "").trim();
    const result = body?.result ?? null;

    // basic validation
    if (!user_id || !image_id || !description) {
      return NextResponse.json(
        { error: "Missing required fields: user_id, image_id, description" },
        { status: 400 }
      );
    }

    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not set");
    }

    const client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const col = db.collection(POSTS_COLLECTION);

    // NEW: lookup user_name from auth.users so posts can display it without extra DB lookups later
    const usersCol = db.collection(USERS_COLLECTION);
    const userDoc = await usersCol.findOne(
      { user_id },
      { projection: { _id: 0, user_name: 1, email: 1 } }
    );

    const user_name = (userDoc?.user_name || userDoc?.email || "Unknown").toString();

    
    const doc = {
      post_id: makePostId(),
      user_id,
      user_name,          // NEW: stored on post, like comments store user_name
      image_id,
      description,
      result,
      clicks_count: 0,
      up_vote_count: 0,
      down_vote_count: 0,
      comment_count: 0,
      controversial_since: null,
      created_at: new Date(),
      is_reported: false,
    };


    await col.insertOne(doc);

    // close connection immediately after the data has been sent
    await client.close();

    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create post", detail: String(err) },
      { status: 500 }
    );
  }
}

// 
//  LIST POSTS
//  GET /community/posts
//  Returns the latest community posts (newest first).
//  
export async function GET() {
  try {
    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not set");
    }

    // open Mongo connection
    const client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const col = db.collection(POSTS_COLLECTION);

    const items = await col
      .find({}, { projection: { _id: 0 } }) // hide Mongo internal _id
      .sort({ created_at: -1 })              // newest first
      .limit(100)                            // safety cap to avoid huge responses
      .toArray();

    await client.close();

    return NextResponse.json({ items }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to list posts", detail: String(err) },
      { status: 500 }
    );
  }
}
