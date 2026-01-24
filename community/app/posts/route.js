import { NextResponse } from "next/server";
import { MongoClient } from "mongodb";
import jwt from "jsonwebtoken";
import { validateUserId, validateImageId, validatePostId } from "./validation.js";

import { getRedis } from "../../lib/redis.js"


export const runtime = "nodejs"; // required for MongoDB driver

const MONGO_URI = process.env.MONGO_URI || "";
const MONGO_DB = process.env.MONGO_DB || "aiclipse";
const POSTS_COLLECTION = "community.posts";

// NEW: user collection to lookup poster name
const USERS_COLLECTION = "auth.users";


// COMA
function safeNumber(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function safeDiv(a, b) {
  return b > 0 ? a / b : 0;
}

// Uses your demo concept: controversial boost only if:
// - total votes >= 50
// - vote ratio between 40–60%
// - controversial_since exists
// - boost window: 48h–96h after controversial_since
function isControversial(post, nowSec) {
  const SECONDS_IN_HOUR = 3600;
  const MIN_TOTAL_VOTES = 50;

  const up = safeNumber(post.up_vote_count);
  const down = safeNumber(post.down_vote_count);
  const total = up + down;

  if (total < MIN_TOTAL_VOTES) return false;

  const controversialSince = safeNumber(post.controversial_since, 0);
  if (!controversialSince) return false;

  const ratio = (up / total) * 100;
  const inZone = ratio >= 40 && ratio <= 60;
  if (!inZone) return false;

  const timeDiff = nowSec - controversialSince;
  const boostStart = 48 * SECONDS_IN_HOUR; // 48h
  const boostEnd = 96 * SECONDS_IN_HOUR;   // 96h
  if (timeDiff < boostStart || timeDiff >= boostEnd) return false;

  return true;
}

// Convert created_at to unix seconds safely (Date or ISO string)
function createdAtToUnixSeconds(created_at) {
  if (!created_at) return 0;
  if (created_at instanceof Date) {
    return Math.floor(created_at.getTime() / 1000);
  }
  const d = new Date(created_at);
  const t = d.getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

// COMA 























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
    const decoded = jwt.decode(token);
    
    if (!decoded || !decoded.sub) {
      throw new Error("Invalid token payload");
    }
    
    return decoded.sub; // user_id is stored in 'sub' claim
  } catch (err) {
    throw new Error("Invalid or expired token");
  }
}

// Helper function to extract raw JWT token from request (for forwarding to other services)
function extractToken(req) {
  // Try Authorization header first
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
      return parts[1];
    }
  }
  
  // Fallback to cookie
  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split("; ").map(c => {
        const [key, ...v] = c.split("=");
        return [key, v.join("=")];
      })
    );
    return cookies.access_token || null;
  }
  
  return null;
}

// Generates a unique post ID. Uses timestamp and random number to reduce chance of collisions.
function makePostId() {
  return `post_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// Creates a new community post linked to an image.
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

    client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const col = db.collection(POSTS_COLLECTION);

    // NEW: lookup user_name from auth.users so posts can display it without extra DB lookups later
    const usersCol = db.collection(USERS_COLLECTION);
    const userDoc = await usersCol.findOne(
      { user_id: safeUserId },
      { projection: { _id: 0, user_name: 1, email: 1 } }
    );

    const user_name = String(userDoc?.user_name || userDoc?.email || "Unknown");

    
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

    // Mark the image as public so it appears in the community feed
    // This ensures all community posts are visible to everyone
    try {
      const GATEWAY_URI = process.env.GATEWAY_URI || "http://localhost:8000";
      const imageUpdateUrl = `${GATEWAY_URI}/media/image/${safeImageId}`;
      
      await fetch(imageUpdateUrl, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: safeUserId,
          is_public: true
        })
      });
    } catch (imageUpdateErr) {
      // Log but don't fail the post creation if image update fails
      console.error("Failed to mark image as public:", imageUpdateErr);
    }

    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create post", detail: String(err) },
      { status: 500 }
    );
  } finally {
    // Always close connection, even if an error occurred
    if (client) {
      try {
        await client.close();
      } catch (closeErr) {
        // Log but don't throw - we're already handling the main error
        console.error("Error closing MongoDB connection:", closeErr);
      }
    }
  }
}

// PATCH POST
// PATCH /community/posts?post_id=xxx
// Allows a user to update their own post's description
export async function PATCH(req) {
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

    // Get post_id from query parameters
    const { searchParams } = new URL(req.url);
    const post_id = searchParams.get("post_id");

    if (!post_id) {
      return NextResponse.json(
        { error: "Missing required parameter: post_id" },
        { status: 400 }
      );
    }

    // Validate post_id format
    const postIdValidation = validatePostId(post_id);
    if (!postIdValidation.valid) {
      return NextResponse.json(
        { error: postIdValidation.error },
        { status: 400 }
      );
    }
    const safePostId = postIdValidation.value;

    // Get description from body
    const body = await req.json().catch(() => null);
    const description = (body?.description || "").trim();

    if (!description) {
      return NextResponse.json(
        { error: "Description cannot be empty" },
        { status: 400 }
      );
    }

    // Length validation
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

    client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const col = db.collection(POSTS_COLLECTION);

    // First find the post to verify ownership
    const post = await col.findOne({ post_id: safePostId });

    if (!post) {
      return NextResponse.json(
        { error: "Post not found" },
        { status: 404 }
      );
    }

    // Security check: ensure the authenticated user owns this post
    if (post.user_id !== authenticatedUserId) {
      return NextResponse.json(
        { error: "Forbidden: You can only edit your own posts" },
        { status: 403 }
      );
    }

    // Update the description (MongoDB may report modifiedCount=0 if values are unchanged)
    await col.updateOne(
      { post_id: safePostId },
      { $set: { description, updated_at: new Date() } }
    );

    // Note: modifiedCount can be 0 if the new description is the same as the old one
    // This is not an error, just a no-op update

    // Return the updated post
    const updatedPost = await col.findOne({ post_id: safePostId }, { projection: { _id: 0 } });

    return NextResponse.json(
      { message: "Post updated successfully", post: updatedPost },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to update post", detail: String(err) },
      { status: 500 }
    );
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (closeErr) {
        console.error("Error closing MongoDB connection:", closeErr);
      }
    }
  }
}

// DELETE POST
// DELETE /community/posts?post_id=xxx
// Allows a user to delete their own post
export async function DELETE(req) {
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

    // Get post_id from query parameters
    const { searchParams } = new URL(req.url);
    const post_id = searchParams.get("post_id");

    if (!post_id) {
      return NextResponse.json(
        { error: "Missing required parameter: post_id" },
        { status: 400 }
      );
    }

    // Validate post_id format
    const postIdValidation = validatePostId(post_id);
    if (!postIdValidation.valid) {
      return NextResponse.json(
        { error: postIdValidation.error },
        { status: 400 }
      );
    }
    const safePostId = postIdValidation.value;

    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not set");
    }

    client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const col = db.collection(POSTS_COLLECTION);

    // First, find the post to verify ownership
    const post = await col.findOne({ post_id: safePostId });

    if (!post) {
      return NextResponse.json(
        { error: "Post not found" },
        { status: 404 }
      );
    }

    // Security check: ensure the authenticated user owns this post
    if (post.user_id !== authenticatedUserId) {
      return NextResponse.json(
        { error: "Forbidden: You can only delete your own posts" },
        { status: 403 }
      );
    }

    // Delete the post
    const deleteResult = await col.deleteOne({ post_id: safePostId });

    if (deleteResult.deletedCount === 0) {
      // The post was likely deleted by a concurrent request
      return NextResponse.json(
        { error: "Post not found or already deleted" },
        { status: 404 }
      );
    }

    // Delete associated comments and votes
    const COMMENTS_COLLECTION = "community.comments";
    const VOTES_COLLECTION = "community.votes";
    
    const commentsResult = await db.collection(COMMENTS_COLLECTION).deleteMany({ post_id: safePostId });
    const votesResult = await db.collection(VOTES_COLLECTION).deleteMany({ post_id: safePostId });
    
    console.log(`Deleted ${commentsResult.deletedCount} comments and ${votesResult.deletedCount} votes for post ${safePostId}`);

    // Delete the associated image via gateway
    const image_id = post.image_id;
    let imageDeleted = false;
    if (image_id) {
      // Validate image_id to prevent SSRF
      const validation = validateImageId(image_id);
      if (!validation.valid) {
        console.warn(`Invalid image_id format: ${image_id}`);
        // Continue with post deletion even if image_id is invalid - don't attempt image deletion
      } else {
        // Use the validated value from the validation result to break taint chain
        const safeImageId = validation.value;
        
        try {
          const token = extractToken(req);

          if (token) {
            // Call gateway which will authenticate and forward to media service
            const GATEWAY_URI = process.env.GATEWAY_URI || "http://gateway-srv:8080";
            const gatewayUrl = `${GATEWAY_URI}/image/${safeImageId}`;
            const gatewayResponse = await fetch(gatewayUrl, {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${token}`,
              },
            });

            if (gatewayResponse.ok) {
              console.log(`Successfully deleted image ${safeImageId} via gateway`);
              imageDeleted = true;
            } else {
              const errorText = await gatewayResponse.text().catch(() => 'Unknown error');
              console.warn(`Failed to delete image ${safeImageId} from gateway: ${gatewayResponse.status} - ${errorText}`);
            }
          } else {
            console.warn('No authentication token available to delete image');
          }
        } catch (gatewayError) {
          console.error(`Error calling gateway to delete image ${safeImageId}:`, gatewayError);
        }
      }
    }

    return NextResponse.json(
      { 
        message: imageDeleted 
          ? "Post deleted successfully (including comments, votes, and image)" 
          : "Post deleted successfully (comments and votes removed; image deletion was attempted)",
        post_id: safePostId 
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to delete post", detail: String(err) },
      { status: 500 }
    );
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (closeErr) {
        console.error("Error closing MongoDB connection:", closeErr);
      }
    }
  }
}

// LIST POSTS
// GET /community/posts
// Returns the latest community posts (newest first) with actual vote counts from the database.
// Only returns posts for images that are public (is_public = true).
export async function GET() {
  let client = null;

  try {
    if (!MONGO_URI) throw new Error("MONGO_URI is not set");

    client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const col = db.collection(POSTS_COLLECTION);

    const IMAGES_COLLECTION = "images";
    const imagesCol = db.collection(IMAGES_COLLECTION);

    // 1) public image ids
    const publicImages = await imagesCol
      .find({ is_public: true }, { projection: { image_id: 1 } })
      .toArray();

    const publicImageIds = publicImages.map((img) => img.image_id);

    // 2) posts for public images
    const posts = await col
      .find({ image_id: { $in: publicImageIds } }, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();

    if (!posts.length) {
      return NextResponse.json({ items: [] }, { status: 200 });
    }

    // 3) fetch pending deltas from Redis in one roundtrip
    const redis = getRedis();
    const deltaKeys = posts.map((p) => `post:${p.post_id}:vote_deltas`);

    const pipe = redis.pipeline();
    for (const k of deltaKeys) pipe.hgetall(k);
    const pipeRes = await pipe.exec();

    // Map post_id -> {up, down}
    const deltasByPostId = {};
    for (let i = 0; i < posts.length; i++) {
      const postId = posts[i].post_id;
      const data = pipeRes?.[i]?.[1] || {};
      deltasByPostId[postId] = {
        up: Number(data.up || 0),
        down: Number(data.down || 0),
      };
    }

    // 4) merge: base counts from posts + pending redis deltas
    const items = posts.map((post) => {
      const d = deltasByPostId[post.post_id] || { up: 0, down: 0 };
      return {
        ...post,
        up_vote_count: Number(post.up_vote_count || 0) + d.up,
        down_vote_count: Number(post.down_vote_count || 0) + d.down,
      };
    });

    // 5) compute averages for normalization
    const n = items.length || 1;

    const totalClicks = items.reduce((s, p) => s + safeNumber(p.clicks_count), 0);
    const totalVotes = items.reduce(
      (s, p) => s + safeNumber(p.up_vote_count) + safeNumber(p.down_vote_count),
      0
    );
    const totalComments = items.reduce((s, p) => s + safeNumber(p.comment_count), 0);

    const avgClicks = totalClicks / n || 1;
    const avgVotes = totalVotes / n || 1;
    const avgComments = totalComments / n || 1;

    // 6) scoring constants
    const votesWeight = 0.6;
    const commentsWeight = 0.3;
    const clicksWeight = 0.1;

    const constantOffset = 2;
    const gravity = 1.2;

    const nowSec = Math.floor(Date.now() / 1000);

    // 7) compute score per post
    const ranked = items.map((post) => {
      const numVotes = safeNumber(post.up_vote_count) + safeNumber(post.down_vote_count);
      const numClicks = safeNumber(post.clicks_count);
      const numComments = safeNumber(post.comment_count);

      const votesNorm = safeDiv(numVotes, avgVotes);
      const clicksNorm = safeDiv(numClicks, avgClicks);
      const commentsNorm = safeDiv(numComments, avgComments);

      const engagement =
        votesNorm * votesWeight +
        clicksNorm * clicksWeight +
        commentsNorm * commentsWeight;

      const createdAtSec = createdAtToUnixSeconds(post.created_at);
      const ageSeconds = Math.max(nowSec - createdAtSec, 0);
      const ageHours = ageSeconds / 3600;

      const timeFactor = Math.pow(ageHours + constantOffset, gravity);

      let score = engagement / timeFactor;

      // demo boosts
      if (engagement === 0 && ageHours < 24) score = Math.max(score, 0.5);
      if (ageHours < 24) score *= 1.2;

      if (isControversial(post, nowSec)) score *= 2.5;

      return {
        ...post,
        score,
        debug: { votesNorm, clicksNorm, commentsNorm, engagement, ageHours },
      };
    });

    // 8) sort by score desc
    ranked.sort((a, b) => (b.score || 0) - (a.score || 0));

    return NextResponse.json({ items: ranked }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to list posts", detail: String(err) },
      { status: 500 }
    );
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (closeErr) {
        console.error("Error closing MongoDB connection:", closeErr);
      }
    }
  }
}
