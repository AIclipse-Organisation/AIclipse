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
    const post = await col.findOne({ post_id });

    if (!post) {
      return NextResponse.json(
        { error: "Post not found" },
        { status: 404 }
      );
    }

    // Security check ensure the authenticated user owns this post
    if (post.user_id !== authenticatedUserId) {
      return NextResponse.json(
        { error: "Forbidden: You can only edit your own posts" },
        { status: 403 }
      );
    }

    // Update the description
    const updateResult = await col.updateOne(
      { post_id },
      { $set: { description, updated_at: new Date() } }
    );

    if (updateResult.modifiedCount === 0) {
      return NextResponse.json(
        { error: "Failed to update post" },
        { status: 500 }
      );
    }

    // Return the updated post
    const updatedPost = await col.findOne({ post_id }, { projection: { _id: 0 } });

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

    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not set");
    }

    client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const col = db.collection(POSTS_COLLECTION);

    // First, find the post to verify ownership
    const post = await col.findOne({ post_id });

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
    const deleteResult = await col.deleteOne({ post_id });

    if (deleteResult.deletedCount === 0) {
      return NextResponse.json(
        { error: "Failed to delete post" },
        { status: 500 }
      );
    }

    // Delete associated comments and votes
    const COMMENTS_COLLECTION = "community.comments";
    const VOTES_COLLECTION = "community.votes";
    
    const commentsResult = await db.collection(COMMENTS_COLLECTION).deleteMany({ post_id });
    const votesResult = await db.collection(VOTES_COLLECTION).deleteMany({ post_id });
    
    console.log(`Deleted ${commentsResult.deletedCount} comments and ${votesResult.deletedCount} votes for post ${post_id}`);

    // Delete the associated image via gateway
    const image_id = post.image_id;
    if (image_id) {
      try {
        // Extract JWT token from request to pass to gateway
        const authHeader = req.headers.get("authorization");
        const cookieHeader = req.headers.get("cookie");
        
        let token = null;
        if (authHeader) {
          const parts = authHeader.split(" ");
          if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
            token = parts[1];
          }
        }
        if (!token && cookieHeader) {
          const cookies = Object.fromEntries(
            cookieHeader.split("; ").map(c => {
              const [key, ...v] = c.split("=");
              return [key, v.join("=")];
            })
          );
          token = cookies.access_token;
        }

        if (token) {
          // Call gateway which will authenticate and forward to media service
          const GATEWAY_URI = process.env.GATEWAY_URI || "http://gateway-srv:8080";
          const gatewayUrl = `${GATEWAY_URI}/image/${image_id}`;
          const gatewayResponse = await fetch(gatewayUrl, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (gatewayResponse.ok) {
            console.log(`Successfully deleted image ${image_id} via gateway`);
          } else {
            const errorText = await gatewayResponse.text().catch(() => 'Unknown error');
            console.warn(`Failed to delete image ${image_id} from gateway: ${gatewayResponse.status} - ${errorText}`);
            // Continue with post deletion even if image deletion fails
          }
        } else {
          console.warn('No authentication token available to delete image');
        }
      } catch (gatewayError) {
        console.error(`Error calling gateway to delete image ${image_id}:`, gatewayError);
        
      }
    }

    return NextResponse.json(
      { message: "Post deleted successfully (including comments, votes, and image)", post_id },
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
    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not set");
    }

    // open Mongo connection
    client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const col = db.collection(POSTS_COLLECTION);
    const IMAGES_COLLECTION = "images";
    const imagesCol = db.collection(IMAGES_COLLECTION);

    // First, get all public image IDs
    const publicImages = await imagesCol
      .find({ is_public: true }, { projection: { image_id: 1 } })
      .toArray();
    
    const publicImageIds = publicImages.map(img => img.image_id);

    // Get posts sorted by newest first, but only for public images
    const posts = await col
      .find(
        { image_id: { $in: publicImageIds } }, // Only posts with public images
        { projection: { _id: 0 } }  // hide Mongo internal _id
      )
      .sort({ created_at: -1 })     // newest first
      .limit(100)                   // safety cap to avoid huge responses
      .toArray();

    // Fetch actual vote counts from the votes collection
    const VOTES_COLLECTION = "community.votes";
    const votesCol = db.collection(VOTES_COLLECTION);
    
    // Get all post IDs to query votes
    const postIds = posts.map(p => p.post_id);
    
    // Aggregate vote counts for all posts
    const voteCountsAgg = await votesCol.aggregate([
      { $match: { post_id: { $in: postIds } } },
      {
        $group: {
          _id: "$post_id",
          up_vote_count: {
            $sum: { $cond: [{ $eq: ["$vote", "up"] }, 1, 0] }
          },
          down_vote_count: {
            $sum: { $cond: [{ $eq: ["$vote", "down"] }, 1, 0] }
          }
        }
      }
    ]).toArray();
    
    // Create a map of post_id to vote counts
    const voteCountsMap = {};
    for (const vc of voteCountsAgg) {
      voteCountsMap[vc._id] = {
        up_vote_count: vc.up_vote_count,
        down_vote_count: vc.down_vote_count
      };
    }
    
    // Merge actual vote counts into posts
    const items = posts.map(post => ({
      ...post,
      up_vote_count: voteCountsMap[post.post_id]?.up_vote_count || 0,
      down_vote_count: voteCountsMap[post.post_id]?.down_vote_count || 0
    }));

    return NextResponse.json({ items }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to list posts", detail: String(err) },
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
