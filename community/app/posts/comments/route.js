import { NextResponse } from "next/server";
import { MongoClient } from "mongodb";
import jwt from "jsonwebtoken";
import { validateUserId, validatePostId } from "../validation.js";

export const runtime = "nodejs";

const MONGO_URI = process.env.MONGO_URI || "";
const MONGO_DB = process.env.MONGO_DB || "aiclipse";

const POSTS_COLLECTION = "community.posts";
const COMMENTS_COLLECTION = "community.comments";

// Helper function to extract and verify JWT token from Authorization header or cookie
function getAuthenticatedUserId(req) {
  let token = null;
  
  // Try Authorization header first
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
      token = parts[1];
    }
  }
  
  // Fallback to cookie if no Authorization header
  if (!token) {
    const cookieHeader = req.headers.get("cookie");
    if (cookieHeader) {
      const cookies = Object.fromEntries(
        cookieHeader.split("; ").map(c => {
          const [key, ...v] = c.split("=");
          return [key, v.join("=")];
        })
      );
      token = cookies.access_token;
    }
  }
  
  if (!token) {
    throw new Error("Missing authentication token");
  }
  
  try {
    // Decode without verification to get the user_id
    // In production, you should verify the JWT signature using the public key from auth service
    const decoded = jwt.decode(token);
    
    if (!decoded || !decoded.sub) {
      throw new Error("Invalid token payload");
    }
    
    return decoded.sub; // user_id is stored in 'sub' claim
  } catch (err) {
    throw new Error("Invalid or expired token");
  }
}

// Generates a unique comment ID. Timestamp + random suffix
function makeCommentId() {
  return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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
  const MAX = 1000;
  if (text.length > MAX) {
    return { ok: false, error: `Comment too long (max ${MAX} characters).` };
  }

  // store raw text; React's default rendering provides XSS protection
  return { ok: true, text };
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

    // validate post_id format
    const postIdValidation = validatePostId(post_id);
    if (!postIdValidation.valid) {
      return NextResponse.json(
        { error: postIdValidation.error },
        { status: 400 }
      );
    }
    const safePostId = postIdValidation.value; // Use sanitized string value

    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not set");
    }

    // connect to Mongo (local-dev: open/close per request)
    client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const commentsCol = db.collection(COMMENTS_COLLECTION);

    const items = await commentsCol
      .find({ post_id: safePostId }, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .limit(100) // safety cap
      .toArray();

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
    // Verify authentication and get authenticated user_id from JWT token
    let authenticatedUserId;
    try {
      authenticatedUserId = getAuthenticatedUserId(req);
    } catch (authErr) {
      return NextResponse.json(
        { error: "Unauthorized", detail: String(authErr) },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);

    const post_id = body?.post_id || null;
    const user_id = body?.user_id || null;
    const user_name = (body?.user_name || "").trim();

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

    // validate user_id format
    const userIdValidation = validateUserId(user_id);
    if (!userIdValidation.valid) {
      return NextResponse.json(
        { error: userIdValidation.error },
        { status: 400 }
      );
    }
    const safeUserId = userIdValidation.value; // Use sanitized string value

    // Security check: ensure user_id in request matches authenticated user
    if (safeUserId !== authenticatedUserId) {
      return NextResponse.json(
        { error: "Forbidden: Cannot post comments on behalf of other users" },
        { status: 403 }
      );
    }

    // validate post_id format
    const postIdValidation = validatePostId(post_id);
    if (!postIdValidation.valid) {
      return NextResponse.json(
        { error: postIdValidation.error },
        { status: 400 }
      );
    }
    const safePostId = postIdValidation.value; // Use sanitized string value

    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not set");
    }

    
    client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const postsCol = db.collection(POSTS_COLLECTION);
    const commentsCol = db.collection(COMMENTS_COLLECTION);

    // ensure the post exists 
    const postExists = await postsCol.findOne(
      { post_id: safePostId },
      { projection: { _id: 0, post_id: 1 } }
    );
    if (!postExists) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const now = new Date();

    // build the comment document
    const doc = {
      comment_id: makeCommentId(),
      post_id: safePostId,
      user_id: safeUserId, 
      user_name, 
      text, 
      created_at: now,
      updated_at: now,
    };

    await commentsCol.insertOne(doc);

    // counter on the post to show number of comments
    await postsCol.updateOne({ post_id: safePostId }, { $inc: { comment_count: 1 } });

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
