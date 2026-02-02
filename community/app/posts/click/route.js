import { NextResponse } from "next/server";
import { MongoClient } from "mongodb";
import { validateUserId, validatePostId } from "../validation.js";
import { getRedis } from "../../../redis/redis.js";

export const runtime = "nodejs";

const MONGO_URI = process.env.MONGO_URI || "";
const MONGO_DB = process.env.MONGO_DB || "aiclipse";
const POSTS_COLLECTION = "community.posts";

const FLUSH_ZSET = "clicks:flush_at";
const FLUSH_DEBOUNCE_MS = 30_000;
const FLUSH_MAX_WAIT_SEC = 60;

const DELTA_TTL_SECONDS = 60 * 60; // safety TTL 1 hour

// Rate limit: only count one click per user per post within this window
const CLICK_COOLDOWN_SECONDS = 60;

export async function POST(req) {
  let client = null;

  try {
    const body = await req.json().catch(() => null);
    const post_id = body?.post_id || null;
    const user_id = body?.user_id || null;

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

    let safeUserId = null;
    if (user_id) {
      const userIdValidation = validateUserId(user_id);
      if (!userIdValidation.valid) {
        return NextResponse.json(
          { error: userIdValidation.error },
          { status: 400 },
        );
      }
      safeUserId = userIdValidation.value;
    }

    if (!MONGO_URI) throw new Error("MONGO_URI is not set");

    // Ensure post exists (Mongo source of truth)
    client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(MONGO_DB);
    const posts = db.collection(POSTS_COLLECTION);

    const postDoc = await posts.findOne(
      { post_id: safePostId },
      { projection: { _id: 0, post_id: 1, clicks_count: 1 } },
    );
    if (!postDoc) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const redis = getRedis();

    // Rate limit in Redis (only if user_id provided)
    let counted = true;
    if (safeUserId) {
      const rlKey = `click:cooldown:${safePostId}:${safeUserId}`;
      // SET key 1 NX EX 60 => only first click in window counts
      const ok = await redis.set(
        rlKey,
        "1",
        "NX",
        "EX",
        CLICK_COOLDOWN_SECONDS,
      );
      if (!ok) counted = false;
    }

    const deltaKey = `post:${safePostId}:click_deltas`;
    const firstKey = `post:${safePostId}:click_first_at`;

    if (counted) {
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
    }

    // Return current count fast: base + pending delta
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
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {}
    }
  }
}
