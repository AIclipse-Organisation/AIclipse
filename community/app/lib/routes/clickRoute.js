import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo/mongo.js";
import { getRedis } from "@/lib/redis/redis";
import { validatePostId } from "@/app/posts/validation.js";

const POSTS_COLLECTION = "community.posts";

const FLUSH_ZSET = "clicks:flush_at";
const FLUSH_DEBOUNCE_MS = 30_000;
const FLUSH_MAX_WAIT_SEC = 60;
const DELTA_TTL_SECONDS = 60 * 60;
const CLICK_COOLDOWN_SECONDS = 60;

function unauthorized(error) {
  return NextResponse.json(
    { error: "Unauthorized", detail: String(error) },
    { status: 401 },
  );
}

export function createClickRouteHandler({ requireUser }) {
  return async function handleClickPost(req) {
    let currentUser;
    try {
      currentUser = await requireUser(req);
    } catch (authErr) {
      return unauthorized(authErr);
    }

    try {
      const body = await req.json().catch(() => null);
      const post_id = body?.post_id || null;

      if (!post_id) {
        return NextResponse.json({ error: "Missing post_id" }, { status: 400 });
      }

      const postIdValidation = validatePostId(post_id);
      if (!postIdValidation.valid) {
        return NextResponse.json({ error: postIdValidation.error }, { status: 400 });
      }
      const safePostId = postIdValidation.value;
      const authenticatedUserId = String(currentUser.user_id || "").trim();

      if (!authenticatedUserId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const db = await getDb();
      const posts = db.collection(POSTS_COLLECTION);
      const postDoc = await posts.findOne(
        { post_id: safePostId },
        { projection: { _id: 0, post_id: 1, clicks_count: 1 } },
      );
      if (!postDoc) {
        return NextResponse.json({ error: "Post not found" }, { status: 404 });
      }

      const redis = getRedis();
      const deltaKey = `post:${safePostId}:click_deltas`;
      const firstKey = `post:${safePostId}:click_first_at`;
      const rlKey = `click:cooldown:${safePostId}:${authenticatedUserId}`;

      const counted = Boolean(
        await redis.set(rlKey, "1", "NX", "EX", CLICK_COOLDOWN_SECONDS),
      );

      if (counted) {
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
      }

      const pending = await redis.hget(deltaKey, "count");
      const pendingCount = Number(pending || 0);
      const base = Number(postDoc.clicks_count || 0);

      return NextResponse.json(
        {
          post_id: safePostId,
          clicks_count: base + pendingCount,
          counted,
        },
        { status: 200 },
      );
    } catch (err) {
      return NextResponse.json(
        { error: "Failed to increment clicks", detail: String(err) },
        { status: 500 },
      );
    }
  };
}
