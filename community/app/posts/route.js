import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo/mongo.js";
import {
  validateImageId,
  validatePostId,
} from "./validation.js";
import { recordCollapsedNotification } from "@/lib/notifications/notifications.js";
import { recordActivity, SCORES } from "@/lib/gamification/scoring.js";
import {
  buildGatewayIdentityHeaders,
  getOptionalTrustedUser,
  getTrustedUser,
} from "@/app/lib/trustedUser";

import { getRedis } from "@/lib/redis/redis";

export const runtime = "nodejs"; // required for MongoDB driver

const POSTS_COLLECTION = "community.posts";
const VOTES_COLLECTION = "community.votes";

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
  const boostEnd = 96 * SECONDS_IN_HOUR; // 96h
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

// Generates a unique post ID. Uses timestamp and random number to reduce chance of collisions.
function makePostId() {
  return `post_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function POST(req) {
  try {
    let currentUser;
    try {
      currentUser = getTrustedUser(req);
    } catch (authErr) {
      return NextResponse.json(
        { error: "Unauthorized", detail: String(authErr) },
        { status: 401 },
      );
    }

    const body = await req.json().catch(() => null);
    const authenticatedUserId = currentUser.user_id;

    // 2. Extract content from body
    const image_id = body?.image_id || null;
    const description = (body?.description || "").trim();
    const result = body?.result ?? null;

    // Admin specific fields
    const ground_truth = body?.ground_truth || null;
    const is_admin_post = body?.is_admin_post || false;

    // 3. Basic validation
    if (!image_id || !description) {
      return NextResponse.json(
        { error: "Missing required fields: image_id or description" },
        { status: 400 },
      );
    }

    // 4. Validate image_id format
    const imageIdValidation = validateImageId(image_id);
    if (!imageIdValidation.valid) {
      return NextResponse.json(
        { error: imageIdValidation.error },
        { status: 400 },
      );
    }
    const safeImageId = imageIdValidation.value;

    // 5. Length validation for description
    const MAX_DESCRIPTION_LENGTH = 1000;
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return NextResponse.json(
        {
          error: `Description too long (max ${MAX_DESCRIPTION_LENGTH} characters)`,
        },
        { status: 400 },
      );
    }

    const db = await getDb();
    const usersCol = db.collection(USERS_COLLECTION);

    // 6. Lookup user_name using the secure authenticatedUserId
    const userDoc = await usersCol.findOne(
      { user_id: authenticatedUserId },
      { projection: { _id: 0, user_name: 1, email: 1 } },
    );

    const user_name = String(userDoc?.user_name || userDoc?.email || "Unknown");

    // 7. Construct the final document
    const doc = {
      post_id: makePostId(),
      user_id: authenticatedUserId, // Use the secure ID from the token
      user_name,
      image_id: safeImageId,
      description,
      result,
      ground_truth, // Stored for user accuracy auditing
      is_admin_post, // Identifies this as an Admin benchmark
      clicks_count: 0,
      up_vote_count: 0,
      down_vote_count: 0,
      comment_count: 0,
      controversial_since: null,
      created_at: new Date(),
      is_reported: false,
      report_count: 0,
      reporter_ids: [], // Array of unique user_ids who reported
      report_history: [],
    };

    const col = db.collection(POSTS_COLLECTION);
    await col.insertOne(doc);

    // Award points for creating a post
    await recordActivity(
      db,
      authenticatedUserId,
      SCORES.CREATE_POST,
      "create_post",
    );

    // 8. Mark the image as public via Gateway
    try {
      const GATEWAY_URI = process.env.GATEWAY_URI;
      const imageUpdateUrl = `${GATEWAY_URI}/image/${safeImageId}`;

      await fetch(imageUpdateUrl, {
        method: "PATCH",
        headers: buildGatewayIdentityHeaders(currentUser),
        body: JSON.stringify({
          is_public: true,
        }),
      });
    } catch (imageUpdateErr) {
      console.error("Failed to mark image as public:", imageUpdateErr);
    }

    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    console.error("ERROR IN POST ROUTE:", err);
    return NextResponse.json(
      { error: "Failed to create post", detail: String(err) },
      { status: 500 },
    );
  }
}

// PATCH POST
// PATCH /community/posts?post_id=xxx
// Allows a user to update their own post's description
export async function PATCH(req) {
  try {
    let currentUser;
    try {
      currentUser = getTrustedUser(req);
    } catch (authErr) {
      return NextResponse.json(
        { error: "Unauthorized", detail: String(authErr) },
        { status: 401 },
      );
    }
    const authenticatedUserId = currentUser.user_id;

    // Get post_id from query parameters
    const { searchParams } = new URL(req.url);
    const post_id = searchParams.get("post_id");

    if (!post_id) {
      return NextResponse.json(
        { error: "Missing required parameter: post_id" },
        { status: 400 },
      );
    }

    // Validate post_id format
    const postIdValidation = validatePostId(post_id);
    if (!postIdValidation.valid) {
      return NextResponse.json(
        { error: postIdValidation.error },
        { status: 400 },
      );
    }
    const safePostId = postIdValidation.value;

    // Get description from body
    const body = await req.json().catch(() => null);
    const description = (body?.description || "").trim();

    if (!description) {
      return NextResponse.json(
        { error: "Description cannot be empty" },
        { status: 400 },
      );
    }

    // Length validation
    const MAX_DESCRIPTION_LENGTH = 1000;
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return NextResponse.json(
        {
          error: `Description too long (max ${MAX_DESCRIPTION_LENGTH} characters)`,
        },
        { status: 400 },
      );
    }

    const db = await getDb();
    const col = db.collection(POSTS_COLLECTION);

    // First find the post to verify ownership
    const post = await col.findOne({ post_id: safePostId });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    // Security check: ensure the authenticated user owns this post
    if (post.user_id !== authenticatedUserId) {
      return NextResponse.json(
        { error: "Forbidden: You can only edit your own posts" },
        { status: 403 },
      );
    }

    // Update the description (MongoDB may report modifiedCount=0 if values are unchanged)
    await col.updateOne(
      { post_id: safePostId },
      { $set: { description, updated_at: new Date() } },
    );

    // Note: modifiedCount can be 0 if the new description is the same as the old one
    // This is not an error, just a no-op update

    // Return the updated post
    const updatedPost = await col.findOne(
      { post_id: safePostId },
      { projection: { _id: 0 } },
    );

    return NextResponse.json(
      { message: "Post updated successfully", post: updatedPost },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to update post", detail: String(err) },
      { status: 500 },
    );
  }
}

// DELETE POST
// DELETE /community/posts?post_id=xxx
// Allows a user to delete their own post
export async function DELETE(req) {
  try {
    const currentUser = getTrustedUser(req);
    const authenticatedUserId = currentUser.user_id;
    const isAdmin = currentUser.is_admin === true;

    // Extract and validate post_id
    const { searchParams } = new URL(req.url);
    const post_id = searchParams.get("post_id");
    if (!post_id) {
      return NextResponse.json({ error: "Missing post_id" }, { status: 400 });
    }

    const postIdValidation = validatePostId(post_id);
    if (!postIdValidation.valid) {
      return NextResponse.json(
        { error: postIdValidation.error },
        { status: 400 },
      );
    }
    const safePostId = postIdValidation.value;

    const db = await getDb();
    const col = db.collection(POSTS_COLLECTION);
    const post = await col.findOne({ post_id: safePostId });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    // Check if Owner OR Admin
    const isOwner = post.user_id === authenticatedUserId;

    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { error: "Forbidden: Elevated permissions required" },
        { status: 403 },
      );
    }

    // Proceed with deletion/tombstone
    await col.updateOne(
      { post_id: safePostId },
      {
        $set: {
          is_deleted: true,
          image_id: null,
          deleted_at: new Date(),
          moderation_status: "deleted",
          deleted_by: isAdmin ? "admin" : "owner",
        },
      },
    );

    // Notify post owner if admin deleted their post
    if (isAdmin && !isOwner && post.user_id) {
      try {
        await recordCollapsedNotification(db, {
          recipient_user_id: post.user_id,
          actor_user_id: authenticatedUserId,
          post_id: post.post_id,
          type: "moderation",
          moderation_action: "deleted",
          moderation_reason: "Content permanently deleted by moderation team",
          image_id: post.image_id || null,
        });
      } catch (notifyErr) {
        console.error("Failed to create deletion notification:", notifyErr);
      }
    }

    // Cleanup Comments/Votes
    await db
      .collection("community.comments")
      .deleteMany({ post_id: safePostId });
    await db.collection("community.votes").deleteMany({ post_id: safePostId });

    // Delete from S3/Gateway if image_id exists
    if (post.image_id) {
      try {
        const GATEWAY_URI = process.env.GATEWAY_URI;
        await fetch(`${GATEWAY_URI}/image/${post.image_id}`, {
          method: "DELETE",
          headers: buildGatewayIdentityHeaders(currentUser),
        });
      } catch (e) {
        console.error("Gateway cleanup failed", e);
      }
    }

    return NextResponse.json({
      message: isAdmin ? "Admin override successful." : "Post deleted.",
      post_id: safePostId,
    });
  } catch (err) {
    console.error("DELETE ERROR:", err);
    return NextResponse.json(
      { error: "Server error", detail: String(err) },
      { status: 500 },
    );
  }
}

// LIST POSTS
// GET /community/posts
// Returns the latest community posts (newest first) with actual vote counts from the database.
// Only returns posts for images that are public (is_public = true).
export async function GET(req) {
  try {
    const db = await getDb();
    const col = db.collection(POSTS_COLLECTION);

    const IMAGES_COLLECTION = "images";
    const imagesCol = db.collection(IMAGES_COLLECTION);

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.max(1, parseInt(searchParams.get("limit") || "10"));
    const skip = (page - 1) * limit;
    const filterUserId = searchParams.get("user_id") || null;
    const filterImageId = searchParams.get("image_id") || null;
    const filterPostId = searchParams.get("post_id") || null;

    const currentUserId = getOptionalTrustedUser(req)?.user_id || null;

    // 1) public image ids
    const publicImages = await imagesCol
      .find({ is_public: true }, { projection: { image_id: 1 } })
      .toArray();

    const publicImageIds = publicImages.map((img) => img.image_id);

    // 2) posts for public images - prioritizing unvoted posts if user is logged in
    let posts;
    const query = {
      image_id: { $in: publicImageIds },
      is_deleted: { $ne: true }, // Filter out tombstoned posts
      is_removed: { $ne: true }, // Filter out posts hidden by admins
      ...(filterUserId ? { user_id: filterUserId } : {}),
      ...(filterImageId ? { image_id: filterImageId } : {}),
      ...(filterPostId ? { post_id: filterPostId } : {}),
    };

    if (currentUserId && !filterPostId && !filterImageId && !filterUserId) {
      // Use aggregation to prioritize unvoted posts for the logged in user
      posts = await col
        .aggregate([
          { $match: query },
          {
            $lookup: {
              from: VOTES_COLLECTION,
              let: { pid: "$post_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$post_id", "$$pid"] },
                        { $eq: ["$user_id", currentUserId] },
                      ],
                    },
                  },
                },
                { $project: { _id: 1, vote: 1 } },
              ],
              as: "user_vote_data",
            },
          },
          {
            $addFields: {
              is_voted: { $gt: [{ $size: "$user_vote_data" }, 0] },
              user_vote_stored: { $arrayElemAt: ["$user_vote_data.vote", 0] },
            },
          },
          {
            $sort: {
              is_voted: 1, // false (0) before true (1) -> unvoted first
              created_at: -1, // newest first within groups
            },
          },
          { $limit: 600 },
          { $project: { _id: 0, user_vote_data: 0 } },
        ])
        .toArray();
    } else {
      // Simple fetch for non-logged in or filtered views
      posts = await col
        .find(query, { projection: { _id: 0 } })
        .sort({ created_at: -1 })
        .limit(300)
        .toArray();
    }

    if (!posts.length) {
      return NextResponse.json({ items: [] }, { status: 200 });
    }

    let userVotesMap = {};
    if (currentUserId && posts.length > 0) {
      // If we used the aggregation, we already have the vote data in user_vote_stored
      posts.forEach((p) => {
        if (p.user_vote_stored) {
          userVotesMap[p.post_id] = p.user_vote_stored;
        }
      });

      // If we didn't use aggregation (e.g. filtered view or not logged in initially), 
      // or if some posts are missing vote data, fetch it
      const missingVotes = posts.filter(p => p.is_voted === undefined);
      if (missingVotes.length > 0) {
        const votesCol = db.collection(VOTES_COLLECTION);
        const userVotes = await votesCol
          .find({
            user_id: currentUserId,
            post_id: { $in: missingVotes.map((p) => p.post_id) },
          })
          .toArray();

        userVotes.forEach((v) => {
          userVotesMap[v.post_id] = v.vote;
        });
      }
    }

    // 3) fetch pending deltas from Redis in one roundtrip
    const redis = getRedis();
    const voteDeltaKeys = posts.map((p) => `post:${p.post_id}:vote_deltas`);
    const commentDeltaKeys = posts.map((p) => `post:${p.post_id}:comment_deltas`);

    const pipe = redis.pipeline();
    for (const k of voteDeltaKeys) pipe.hgetall(k);
    for (const k of commentDeltaKeys) pipe.hgetall(k);
    const pipeRes = await pipe.exec();

    // Map post_id -> {up, down, comments}
    const deltasByPostId = {};
    for (let i = 0; i < posts.length; i++) {
      const postId = posts[i].post_id;
      const voteData = pipeRes?.[i]?.[1] || {};
      const commentData = pipeRes?.[i + posts.length]?.[1] || {};
      
      deltasByPostId[postId] = {
        up: Number(voteData.up || 0),
        down: Number(voteData.down || 0),
        comments: Number(commentData.count || 0),
      };
    }

    // 4) merge: base counts from posts + pending redis deltas
    const items = posts.map((post) => {
      const d = deltasByPostId[post.post_id] || { up: 0, down: 0, comments: 0 };
      return {
        ...post,
        up_vote_count: Number(post.up_vote_count || 0) + d.up,
        down_vote_count: Number(post.down_vote_count || 0) + d.down,
        comment_count: Number(post.comment_count || 0) + d.comments,
        user_vote: userVotesMap[post.post_id] || null,
      };
    });

    // 5) compute averages for normalization
    const n = items.length || 1;

    const totalClicks = items.reduce(
      (s, p) => s + safeNumber(p.clicks_count),
      0,
    );
    const totalVotes = items.reduce(
      (s, p) => s + safeNumber(p.up_vote_count) + safeNumber(p.down_vote_count),
      0,
    );
    const totalComments = items.reduce(
      (s, p) => s + safeNumber(p.comment_count),
      0,
    );

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
      const numVotes =
        safeNumber(post.up_vote_count) + safeNumber(post.down_vote_count);
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

      // --- THE FIX IS HERE ---

      // 1. Give ALL new posts a baseline score so they start on equal footing
      let baseScore = 0;
      if (ageHours < 24) {
        baseScore = 0.5;
      }

      // 2. Add the organic engagement ON TOP of the base score
      let score = baseScore + engagement / timeFactor;

      // 3. Apply the newness multiplier
      if (ageHours < 24) score *= 1.2;

      if (isControversial(post, nowSec)) score *= 2.5;

      // Vote penalty last — deprioritize posts the user has already voted on
      // We use a massive additive penalty to ensure unvoted posts always rank higher
      if (post.user_vote) {
        score -= 10000; 
      }

      return {
        ...post,
        score,
        debug: { votesNorm, clicksNorm, commentsNorm, engagement, ageHours },
      };
    });

    // 8) sort by score desc, use creation time to break ties
    ranked.sort((a, b) => {
      if (b.score !== a.score) {
        return (b.score || 0) - (a.score || 0);
      }
      // If scores are exactly the same, newest wins
      return new Date(b.created_at) - new Date(a.created_at);
    });

    const paginatedItems = ranked.slice(skip, skip + limit);

    const paginatedImageIds = paginatedItems.map((p) => p.image_id);

    // Fetch the full image documents just for these posts
    const imagesForPage = await imagesCol
      .find({ image_id: { $in: paginatedImageIds } })
      .toArray();

    // Create a quick lookup map
    const imageMap = new Map(imagesForPage.map((img) => [img.image_id, img]));

    // Merge the image data directly into the post payload
    const finalItems = paginatedItems.map((post) => {
      const imgData = imageMap.get(post.image_id) || {};
      // We spread imgData first so the post data (like created_at) takes precedence
      return { ...imgData, ...post };
    });

    return NextResponse.json(
      {
        items: finalItems,
        hasMore: ranked.length > skip + limit,
      },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to list posts", detail: String(err) },
      { status: 500 },
    );
  }
}
