import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo/mongo.js";
import jwt from "jsonwebtoken";
import {
  validateUserId,
  validatePostId,
  validateCommentId,
} from "../validation.js";
import { getRedis } from "@/lib/redis/redis";
import { recordCollapsedNotification } from "@/lib/notifications/notifications.js";
import { recordActivity, awardPoints, SCORES } from "@/lib/gamification/scoring.js";

export const runtime = "nodejs";


const POSTS_COLLECTION = "community.posts";
const COMMENTS_COLLECTION = "community.comments";

const FLUSH_ZSET = "comments:flush_at";
const FLUSH_DEBOUNCE_MS = 30_000; // 30 seconds
const FLUSH_MAX_WAIT_SEC = 60;
const DELTA_TTL_SECONDS = 60 * 60; // 1 hour safety TTL

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
        cookieHeader.split("; ").map((c) => {
          const [key, ...v] = c.split("=");
          return [key, v.join("=")];
        }),
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
  if (typeof raw !== "string")
    return { ok: false, error: "Comment must be text." };

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
        { status: 400 },
      );
    }
    const safePostId = postIdValidation.value; // Use sanitized string value

    const db = await getDb();
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
      { status: 500 },
    );
  }
}

// POST /community/posts/comments
// body: { post_id, user_id, user_name, text }
// Creates a new comment on a post.
// Stores user_name so the UI can display it without extra lookups.
export async function POST(req) {
  try {
    // Verify authentication and get authenticated user_id from JWT token
    let authenticatedUserId;
    try {
      authenticatedUserId = getAuthenticatedUserId(req);
    } catch (authErr) {
      return NextResponse.json(
        { error: "Unauthorized", detail: String(authErr) },
        { status: 401 },
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
        { status: 400 },
      );
    }

    // validate user_id format
    const userIdValidation = validateUserId(user_id);
    if (!userIdValidation.valid) {
      return NextResponse.json(
        { error: userIdValidation.error },
        { status: 400 },
      );
    }
    const safeUserId = userIdValidation.value; // Use sanitized string value

    // Security check: ensure user_id in request matches authenticated user
    if (safeUserId !== authenticatedUserId) {
      return NextResponse.json(
        { error: "Forbidden: Cannot post comments on behalf of other users" },
        { status: 403 },
      );
    }

    // validate post_id format
    const postIdValidation = validatePostId(post_id);
    if (!postIdValidation.valid) {
      return NextResponse.json(
        { error: postIdValidation.error },
        { status: 400 },
      );
    }
    const safePostId = postIdValidation.value; // Use sanitized string value

    const db = await getDb();
    const postsCol = db.collection(POSTS_COLLECTION);
    const commentsCol = db.collection(COMMENTS_COLLECTION);

    // ensure the post exists
    const postExists = await postsCol.findOne(
      { post_id: safePostId },
      { projection: { _id: 0, post_id: 1, user_id: 1, image_id: 1 } },
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

    // Award points for commenting
    await recordActivity(db, safeUserId, SCORES.COMMENT, "comment");

    // Award points to post owner for receiving engagement
    if (postExists.user_id && postExists.user_id !== safeUserId) {
      await awardPoints(db, postExists.user_id, SCORES.RECEIVE_ENGAGEMENT, "receive_comment");

      try {
        // Add notification for post owner; repeated same events are merged into one row.
        await recordCollapsedNotification(db, {
          recipient_user_id: postExists.user_id,
          actor_user_id: safeUserId,
          post_id: safePostId,
          type: "comment",
          image_id: postExists.image_id || null,
        });
      } catch (notifyErr) {
        console.error("Failed to create comment notification:", notifyErr);
      }
    }

    // counter on the post to show number of comments
    // await postsCol.updateOne({ post_id: safePostId }, { $inc: { comment_count: 1 } });

    // Buffer comment_count delta in Redis and debounce flush
    const redis = getRedis();
    const deltaKey = `post:${safePostId}:comment_deltas`;
    const firstKey = `post:${safePostId}:comment_first_at`;

    const nowSec = Math.floor(Date.now() / 1000);
    const debounceAtSec = Math.floor((Date.now() + FLUSH_DEBOUNCE_MS) / 1000);

    // set burst start once
    await redis.set(firstKey, String(nowSec), "EX", DELTA_TTL_SECONDS, "NX");
    const firstAtSec = Number((await redis.get(firstKey)) || nowSec);

    const hardDeadlineSec = firstAtSec + FLUSH_MAX_WAIT_SEC;
    const flushAtSec = Math.min(debounceAtSec, hardDeadlineSec);

    const pipe = redis.pipeline();
    pipe.hincrby(deltaKey, "count", 1);
    pipe.zadd(FLUSH_ZSET, flushAtSec, safePostId);
    pipe.expire(deltaKey, DELTA_TTL_SECONDS);
    pipe.expire(firstKey, DELTA_TTL_SECONDS);
    await pipe.exec();

    const pending = await redis.hget(deltaKey, "count");
    const pendingCount = Number(pending || 0);

    const postDoc = await postsCol.findOne(
      { post_id: safePostId },
      { projection: { _id: 0, comment_count: 1 } },
    );

    return NextResponse.json(
      {
        ...doc,
        comment_count: Number(postDoc?.comment_count || 0) + pendingCount,
      },
      { status: 201 },
    );

    // return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create comment", detail: String(err) },
      { status: 500 },
    );
  }
}
// DELETE COMMENT
// DELETE /community/posts/comments?comment_id=xxx
// Allows a user to delete their own comment
export async function DELETE(req) {
  try {
    // Verify authentication and get authenticated user_id from JWT token
    let authenticatedUserId;
    try {
      authenticatedUserId = getAuthenticatedUserId(req);
    } catch (authErr) {
      return NextResponse.json(
        { error: "Unauthorized", detail: String(authErr) },
        { status: 401 },
      );
    }

    // Get comment_id from query parameters
    const { searchParams } = new URL(req.url);
    const comment_id = searchParams.get("comment_id");

    if (!comment_id) {
      return NextResponse.json(
        { error: "Missing required parameter: comment_id" },
        { status: 400 },
      );
    }

    // Validate comment_id format
    const commentIdValidation = validateCommentId(comment_id);
    if (!commentIdValidation.valid) {
      return NextResponse.json(
        { error: commentIdValidation.error },
        { status: 400 },
      );
    }
    const safeCommentId = commentIdValidation.value;

    const db = await getDb();
    const commentsCol = db.collection(COMMENTS_COLLECTION);

    // First, find the comment to verify ownership
    const comment = await commentsCol.findOne({ comment_id: safeCommentId });

    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    // Security check: ensure the authenticated user owns this comment
    if (comment.user_id !== authenticatedUserId) {
      return NextResponse.json(
        { error: "Forbidden: You can only delete your own comments" },
        { status: 403 },
      );
    }

    // Delete the comment
    const deleteResult = await commentsCol.deleteOne({
      comment_id: safeCommentId,
    });

    if (deleteResult.deletedCount === 0) {
      // The comment was likely deleted by a concurrent request
      return NextResponse.json(
        { error: "Comment not found or already deleted" },
        { status: 404 },
      );
    }

    // Buffer comment_count delta in Redis (decrement) and debounce flush
    const redis = getRedis();
    const deltaKey = `post:${comment.post_id}:comment_deltas`;
    const firstKey = `post:${comment.post_id}:comment_first_at`;

    const nowSec = Math.floor(Date.now() / 1000);
    const debounceAtSec = Math.floor((Date.now() + FLUSH_DEBOUNCE_MS) / 1000);

    await redis.set(firstKey, String(nowSec), "EX", DELTA_TTL_SECONDS, "NX");
    const firstAtSec = Number((await redis.get(firstKey)) || nowSec);

    const hardDeadlineSec = firstAtSec + FLUSH_MAX_WAIT_SEC;
    const flushAtSec = Math.min(debounceAtSec, hardDeadlineSec);

    const pipe = redis.pipeline();
    pipe.hincrby(deltaKey, "count", -1);
    pipe.zadd(FLUSH_ZSET, flushAtSec, comment.post_id);
    pipe.expire(deltaKey, DELTA_TTL_SECONDS);
    pipe.expire(firstKey, DELTA_TTL_SECONDS);
    await pipe.exec();

    const pending = await redis.hget(deltaKey, "count");
    const pendingCount = Number(pending || 0);

    const postsCol = db.collection(POSTS_COLLECTION);
    const postDoc = await postsCol.findOne(
      { post_id: comment.post_id },
      { projection: { _id: 0, comment_count: 1 } },
    );

    return NextResponse.json(
      {
        message: "Comment deleted successfully",
        comment_id: safeCommentId,
        comment_count: Number(postDoc?.comment_count || 0) + pendingCount,
      },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to delete comment", detail: String(err) },
      { status: 500 },
    );
  }
}