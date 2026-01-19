import { NextResponse } from "next/server";
import { MongoClient } from "mongodb";
import jwt from "jsonwebtoken";
import { validateUserId, validateImageId } from "./validation.js";

export const runtime = "nodejs"; // required for MongoDB driver

const MONGO_URI = process.env.MONGO_URI || "";
const MONGO_DB = process.env.MONGO_DB || "aiclipse";
const POSTS_COLLECTION = "community.posts";

// NEW: user collection to lookup poster name
const USERS_COLLECTION = "auth.users";

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

// Generates a unique post ID. Uses timestamp and random number to reduce chance of collisions.
function makePostId() {
  return `post_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// Creates a new community post linked to an image.
export async function POST(req) {
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
        { error: "Forbidden: Cannot create posts on behalf of other users" },
        { status: 403 }
      );
    }

    // validate image_id format
    const imageIdValidation = validateImageId(image_id);
    if (!imageIdValidation.valid) {
      return NextResponse.json(
        { error: imageIdValidation.error },
        { status: 400 }
      );
    }
    const safeImageId = imageIdValidation.value; // Use sanitized string value

    // length validation to prevent storage/performance issues
    const MAX_DESCRIPTION_LENGTH = 1000;
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return NextResponse.json(
        { error: `Description too long (max ${MAX_DESCRIPTION_LENGTH} characters)` },
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
      { user_id: safeUserId },
      { projection: { _id: 0, user_name: 1, email: 1 } }
    );

    const user_name = (userDoc?.user_name || userDoc?.email || "Unknown").toString();

    
    const doc = {
      post_id: makePostId(),
      user_id: safeUserId,
      user_name,          // NEW: stored on post, like comments store user_name
      image_id: safeImageId,
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

// LIST POSTS
// GET /community/posts
// Returns the latest community posts (newest first).
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
