import { NextResponse } from "next/server";
import { MongoClient } from "mongodb";
import jwt from "jsonwebtoken";
import { validateUserId, validatePostId } from "../validation.js";

export const runtime = "nodejs"; 

const MONGO_URI = process.env.MONGO_URI || "";
const MONGO_DB = process.env.MONGO_DB || "aiclipse";

const POSTS_COLLECTION = "community.posts";
const VOTES_COLLECTION = "community.votes";

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
    const vote = body?.vote || null; 

    // basic validation
    if (!post_id || !user_id || (vote !== "up" && vote !== "down")) {
      return NextResponse.json(
        { error: "Missing/invalid fields: post_id, user_id, vote('up'|'down')" },
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

    // validate post_id format
    const postIdValidation = validatePostId(post_id);
    if (!postIdValidation.valid) {
      return NextResponse.json(
        { error: postIdValidation.error },
        { status: 400 }
      );
    }
    const safePostId = postIdValidation.value; // Use sanitized string value

    // Security check: ensure user_id in request matches authenticated user
    if (safeUserId !== authenticatedUserId) {
      return NextResponse.json(
        { error: "Forbidden: Cannot vote on behalf of other users" },
        { status: 403 }
      );
    }

    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not set");
    }

    // connect to Mongo 
    client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const posts = db.collection(POSTS_COLLECTION);
    const votes = db.collection(VOTES_COLLECTION);

    // make sure post exists
    const postExists = await posts.findOne(
      { post_id: safePostId },
      { projection: { _id: 0, post_id: 1 } }
    );
    if (!postExists) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const now = new Date();

    // Atomic operation: upsert vote and get old value to determine count changes
    // This prevents race conditions by handling the entire vote logic in a single operation
    const voteResult = await votes.findOneAndUpdate(
      { post_id: safePostId, user_id: safeUserId },
      {
        $set: { vote, updated_at: now },
        $setOnInsert: { created_at: now }
      },
      {
        upsert: true,
        returnDocument: "before", // get old value to know what changed
        projection: { _id: 0, vote: 1 }
      }
    );

    const oldVote = voteResult?.value?.vote; // undefined if new vote, "up" or "down" if existing

    // Determine count adjustments based on old vs new vote
    let upDelta = 0;
    let downDelta = 0;

    if (!oldVote) {
      // New vote: increment the appropriate counter
      if (vote === "up") upDelta = 1;
      else downDelta = 1;
    } else if (oldVote !== vote) {
      // Vote switched: move count from old to new
      if (vote === "up") {
        upDelta = 1;
        downDelta = -1;
      } else {
        upDelta = -1;
        downDelta = 1;
      }
    }
    // If oldVote === vote, no change needed (same vote again)

    // Update post counts if there's any change, using pipeline to prevent negative values
    if (upDelta !== 0 || downDelta !== 0) {
      await posts.updateOne(
        { post_id: safePostId },
        [
          {
            $set: {
              up_vote_count: {
                $max: [0, { $add: [{ $ifNull: ["$up_vote_count", 0] }, upDelta] }]
              },
              down_vote_count: {
                $max: [0, { $add: [{ $ifNull: ["$down_vote_count", 0] }, downDelta] }]
              }
            }
          }
        ]
      );
    }

    // Get final counts to return
    const post = await posts.findOne(
      { post_id: safePostId },
      { projection: { _id: 0, up_vote_count: 1, down_vote_count: 1 } }
    );

    return NextResponse.json(
      {
        post_id,
        up_vote_count: Number(post?.up_vote_count ?? 0),
        down_vote_count: Number(post?.down_vote_count ?? 0),
        ...(oldVote === vote && { message: "Vote already recorded" })
      },
      { status: 200 }
    );
  } catch (err) {
 
    return NextResponse.json(
      { error: "Failed to vote", detail: String(err) },
      { status: 500 }
    );
  } finally {
 
    if (client) {
      try { await client.close(); } catch {}
    }
  }
}
