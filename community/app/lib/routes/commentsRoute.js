import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo/mongo.js";
import {
  validateUserId,
  validatePostId,
  validateCommentId,
} from "@/app/posts/validation.js";
import { getRedis } from "@/lib/redis/redis";
import { recordCollapsedNotification } from "@/lib/notifications/notifications.js";
import { recordActivity, awardPoints, SCORES } from "@/lib/gamification/scoring.js";

const POSTS_COLLECTION = "community.posts";
const COMMENTS_COLLECTION = "community.comments";

const FLUSH_ZSET = "comments:flush_at";
const FLUSH_DEBOUNCE_MS = 30_000;
const FLUSH_MAX_WAIT_SEC = 60;
const DELTA_TTL_SECONDS = 60 * 60;

function makeCommentId() {
  return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeComment(raw) {
  if (typeof raw !== "string") {
    return { ok: false, error: "Comment must be text." };
  }

  let text = raw.replace(/\r\n/g, "\n").trim();
  text = text.replace(/[ \t]{3,}/g, "  ");
  text = text.replace(/\n{4,}/g, "\n\n\n");

  if (!text) {
    return { ok: false, error: "Comment cannot be empty." };
  }

  const maxLength = 1000;
  if (text.length > maxLength) {
    return { ok: false, error: `Comment too long (max ${maxLength} characters).` };
  }

  return { ok: true, text };
}

function unauthorized(error) {
  return NextResponse.json(
    { error: "Unauthorized", detail: String(error) },
    { status: 401 },
  );
}

export function createCommentsRouteHandlers({ requireUser }) {
  return {
    async GET(req) {
      try {
        const { searchParams } = new URL(req.url);
        const post_id = searchParams.get("post_id");

        if (!post_id) {
          return NextResponse.json({ error: "Missing post_id" }, { status: 400 });
        }

        const postIdValidation = validatePostId(post_id);
        if (!postIdValidation.valid) {
          return NextResponse.json({ error: postIdValidation.error }, { status: 400 });
        }
        const safePostId = postIdValidation.value;

        const db = await getDb();
        const commentsCol = db.collection(COMMENTS_COLLECTION);
        const items = await commentsCol
          .find({ post_id: safePostId }, { projection: { _id: 0 } })
          .sort({ created_at: -1 })
          .limit(100)
          .toArray();

        return NextResponse.json({ items }, { status: 200 });
      } catch (err) {
        return NextResponse.json(
          { error: "Failed to list comments", detail: String(err) },
          { status: 500 },
        );
      }
    },

    async POST(req) {
      let currentUser;
      try {
        currentUser = await requireUser(req);
      } catch (authErr) {
        return unauthorized(authErr);
      }
      const authenticatedUserId = currentUser.user_id;

      try {
        const body = await req.json().catch(() => null);
        const post_id = body?.post_id || null;
        const user_id = body?.user_id || null;
        const user_name = (body?.user_name || "").trim();

        const normalized = normalizeComment(body?.text);
        if (!normalized.ok) {
          return NextResponse.json({ error: normalized.error }, { status: 400 });
        }
        const text = normalized.text;

        if (!post_id || !user_id || !user_name || !text) {
          return NextResponse.json(
            { error: "Missing required fields: post_id, user_id, user_name, text" },
            { status: 400 },
          );
        }

        const userIdValidation = validateUserId(user_id);
        if (!userIdValidation.valid) {
          return NextResponse.json({ error: userIdValidation.error }, { status: 400 });
        }
        const safeUserId = userIdValidation.value;

        if (safeUserId !== authenticatedUserId) {
          return NextResponse.json(
            { error: "Forbidden: Cannot post comments on behalf of other users" },
            { status: 403 },
          );
        }

        const postIdValidation = validatePostId(post_id);
        if (!postIdValidation.valid) {
          return NextResponse.json({ error: postIdValidation.error }, { status: 400 });
        }
        const safePostId = postIdValidation.value;

        const db = await getDb();
        const postsCol = db.collection(POSTS_COLLECTION);
        const commentsCol = db.collection(COMMENTS_COLLECTION);

        const postExists = await postsCol.findOne(
          { post_id: safePostId },
          { projection: { _id: 0, post_id: 1, user_id: 1, image_id: 1 } },
        );
        if (!postExists) {
          return NextResponse.json({ error: "Post not found" }, { status: 404 });
        }

        const now = new Date();
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
        await recordActivity(db, safeUserId, SCORES.COMMENT, "comment");

        if (postExists.user_id && postExists.user_id !== safeUserId) {
          await awardPoints(db, postExists.user_id, SCORES.RECEIVE_ENGAGEMENT, "receive_comment");

          try {
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

        const redis = getRedis();
        const deltaKey = `post:${safePostId}:comment_deltas`;
        const firstKey = `post:${safePostId}:comment_first_at`;

        const nowSec = Math.floor(Date.now() / 1000);
        const debounceAtSec = Math.floor((Date.now() + FLUSH_DEBOUNCE_MS) / 1000);

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
      } catch (err) {
        return NextResponse.json(
          { error: "Failed to create comment", detail: String(err) },
          { status: 500 },
        );
      }
    },

    async DELETE(req) {
      let currentUser;
      try {
        currentUser = await requireUser(req);
      } catch (authErr) {
        return unauthorized(authErr);
      }
      const authenticatedUserId = currentUser.user_id;

      try {
        const { searchParams } = new URL(req.url);
        const comment_id = searchParams.get("comment_id");

        if (!comment_id) {
          return NextResponse.json(
            { error: "Missing required parameter: comment_id" },
            { status: 400 },
          );
        }

        const commentIdValidation = validateCommentId(comment_id);
        if (!commentIdValidation.valid) {
          return NextResponse.json({ error: commentIdValidation.error }, { status: 400 });
        }
        const safeCommentId = commentIdValidation.value;

        const db = await getDb();
        const commentsCol = db.collection(COMMENTS_COLLECTION);
        const comment = await commentsCol.findOne({ comment_id: safeCommentId });

        if (!comment) {
          return NextResponse.json({ error: "Comment not found" }, { status: 404 });
        }

        if (comment.user_id !== authenticatedUserId) {
          return NextResponse.json(
            { error: "Forbidden: You can only delete your own comments" },
            { status: 403 },
          );
        }

        const deleteResult = await commentsCol.deleteOne({ comment_id: safeCommentId });
        if (deleteResult.deletedCount === 0) {
          return NextResponse.json(
            { error: "Comment not found or already deleted" },
            { status: 404 },
          );
        }

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
    },
  };
}
