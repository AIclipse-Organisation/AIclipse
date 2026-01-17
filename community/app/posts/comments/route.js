import { NextResponse } from "next/server";
import { MongoClient } from "mongodb";

export const runtime = "nodejs";

const MONGO_URI = process.env.MONGO_URI || "";
const MONGO_DB = process.env.MONGO_DB || "aiclipse";

const POSTS_COLLECTION = "community.posts";
const COMMENTS_COLLECTION = "community.comments";

// Generates a unique comment ID. Timestamp + random suffix
function makeCommentId() {
  return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// Escape HTML so stored comments cannot inject markup if rendered unsafely later
function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Normalizes and validates a comment string
function normalizeComment(raw) {
  // must be a plain string (prevents object/operator style payloads)
  if (typeof raw !== "string") return { ok: false, error: "Comment must be text." };

  // normalize newlines and whitespace
  let text = raw.replace(/\r\n/g, "\n").trim();

  // collapse huge whitespace runs (prevents giant blank spam)
  text = text.replace(/[ \t]{3,}/g, "  ");
  text = text.replace(/\n{4,}/g, "\n\n\n");

  if (!text) return { ok: false, error: "Comment cannot be empty." };

  // length limit (after normalization)
  const MAX = 2000;
  if (text.length > MAX) {
    return { ok: false, error: `Comment too long (max ${MAX} characters).` };
  }

  // store escaped text so it stays safe even outside React rendering
  const safeText = escapeHtml(text);

  return { ok: true, text: safeText };
}

// GET /community/posts/comments?post_id=...
// Returns latest comments for a given post_id.
export async function GET(req) {
  let client = null;

  try {
    const { searchParams } = new URL(req.url);
    const post_id = searchParams.get("post_id");

    // validate input
    if (!post_id) {
      return NextResponse.json({ error: "Missing post_id" }, { status: 400 });
    }

    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not set");
    }

    // connect to Mongo (local-dev: open/close per request)
    client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const commentsCol = db.collection(COMMENTS_COLLECTION);

    // indexes help query performance
    await commentsCol.createIndex({ post_id: 1, created_at: -1 }, { name: "by_post_created" });
    await commentsCol.createIndex({ user_id: 1, created_at: -1 }, { name: "by_user_created" });

    // load newest comments first, filter by the requested post_id
    console.log("[COMMENTS GET] Searching for post_id:", post_id);
    
    const items = await commentsCol
      .find({ post_id: post_id }, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .limit(100) // safety cap
      .toArray();

    console.log("[COMMENTS GET] Found", items.length, "comments for post_id:", post_id);
    if (items.length > 0) {
      console.log("[COMMENTS GET] First comment post_id:", items[0].post_id);
    }

    return NextResponse.json({ items }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to list comments", detail: String(err) },
      { status: 500 }
    );
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {}
    }
  }
}

// POST /community/posts/comments
// body: { post_id, user_id, user_name, text }
// Creates a new comment on a post.
// Stores user_name so the UI can display it without extra lookups.
export async function POST(req) {
  let client = null;

  try {
    const body = await req.json().catch(() => null);

    const post_id = body?.post_id || null;
    const user_id = body?.user_id || null;
    const user_name = (body?.user_name || "").trim();

    console.log("[COMMENTS POST] Received:", { post_id, user_id, user_name, text: body?.text?.substring(0, 20) });

    // validate + normalize comment text (also escapes HTML)
    const normalized = normalizeComment(body?.text);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    const text = normalized.text; 

    // validate required fields
    if (!post_id || !user_id || !user_name || !text) {
      return NextResponse.json(
        { error: "Missing required fields: post_id, user_id, user_name, text" },
        { status: 400 }
      );
    }

    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not set");
    }

    
    client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const postsCol = db.collection(POSTS_COLLECTION);
    const commentsCol = db.collection(COMMENTS_COLLECTION);

    // indexes help query performance
    await commentsCol.createIndex({ post_id: 1, created_at: -1 }, { name: "by_post_created" });
    await commentsCol.createIndex({ user_id: 1, created_at: -1 }, { name: "by_user_created" });

    // ensure the post exists 
    const postExists = await postsCol.findOne(
      { post_id },
      { projection: { _id: 0, post_id: 1 } }
    );
    if (!postExists) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const now = new Date();

    // build the comment document
    const doc = {
      comment_id: makeCommentId(),
      post_id,
      user_id, 
      user_name, 
      text, 
      created_at: now,
      updated_at: now,
    };

    console.log("[COMMENTS POST] Saving comment:", { comment_id: doc.comment_id, post_id: doc.post_id });

    await commentsCol.insertOne(doc);

    // counter on the post to show number of comments
    await postsCol.updateOne({ post_id }, { $inc: { comment_count: 1 } });

    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create comment", detail: String(err) },
      { status: 500 }
    );
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {}
    }
  }
}
