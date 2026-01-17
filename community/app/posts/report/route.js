import { NextResponse } from "next/server";
import { MongoClient } from "mongodb";

export const runtime = "nodejs";

const MONGO_URI = process.env.MONGO_URI || "";
const MONGO_DB = process.env.MONGO_DB || "aiclipse";
const POSTS_COLLECTION = "community.posts";

//  POST /community/posts/report
//  body: { post_id }
//  Marks a post as reported.
//  reporting twice does nothing extra.

export async function POST(req) {
  let client = null;

  try {
    const body = await req.json().catch(() => null);
    const post_id = body?.post_id || null;

    if (!post_id) {
      return NextResponse.json({ error: "Missing post_id" }, { status: 400 });
    }

    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not set");
    }

   
    client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const postsCol = db.collection(POSTS_COLLECTION);

    // mark as reported 
    const result = await postsCol.findOneAndUpdate(
      { post_id },
      {
        $set: {
          is_reported: true,
          reported_at: new Date(), 
        },
      },
      {
        returnDocument: "after",
        projection: { _id: 0, post_id: 1, is_reported: 1 },
      }
    );

    if (!result.value) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        post_id,
        is_reported: true,
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to report post", detail: String(err) },
      { status: 500 }
    );
  } finally {
    if (client) {
      try { await client.close(); } catch {}
    }
  }
}
