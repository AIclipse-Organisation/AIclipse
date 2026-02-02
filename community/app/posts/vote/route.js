import { NextResponse } from "next/server";
import { MongoClient } from "mongodb";
import jwt from "jsonwebtoken";
import { validateUserId, validatePostId } from "../validation.js";
import { getRedis } from "../../../redis/redis.js";

export const runtime = "nodejs";

const MONGO_URI = process.env.MONGO_URI || "";
const MONGO_DB = process.env.MONGO_DB || "aiclipse";

const POSTS_COLLECTION = "community.posts";
const VOTES_COLLECTION = "community.votes";
const USERS_COLLECTION = "auth.users";

const FLUSH_ZSET = "votes:flush_at";
const FLUSH_DEBOUNCE_MS = 5_000; // 30 seconds
const FLUSH_MAX_WAIT_SEC = 60; // max wait: 1 minute
const DELTA_TTL_SECONDS = 60 * 60; // safety TTL 1 hour

function getAuthenticatedUserId(req) {
  let token = null;

  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
      token = parts[1];
    }
  }

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

  if (!token) throw new Error("Missing authentication token");

  const decoded = jwt.decode(token);
  if (!decoded || !decoded.sub) throw new Error("Invalid token payload");
  return decoded.sub;
}

export async function POST(req) {
  let client = null;

  try {
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
    const vote = body?.vote || null;

    if (!post_id || !user_id || (vote !== "up" && vote !== "down")) {
      return NextResponse.json(
        {
          error: "Missing/invalid fields: post_id, user_id, vote('up'|'down')",
        },
        { status: 400 },
      );
    }

    const userIdValidation = validateUserId(user_id);
    if (!userIdValidation.valid) {
      return NextResponse.json(
        { error: userIdValidation.error },
        { status: 400 },
      );
    }
    const safeUserId = userIdValidation.value;

    const postIdValidation = validatePostId(post_id);
    if (!postIdValidation.valid) {
      return NextResponse.json(
        { error: postIdValidation.error },
        { status: 400 },
      );
    }
    const safePostId = postIdValidation.value;

    if (safeUserId !== authenticatedUserId) {
      return NextResponse.json(
        { error: "Forbidden: Cannot vote on behalf of other users" },
        { status: 403 },
      );
    }

    if (!MONGO_URI) throw new Error("MONGO_URI is not set");

    client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const posts = db.collection(POSTS_COLLECTION);
    const votes = db.collection(VOTES_COLLECTION);
    const users = db.collection(USERS_COLLECTION);

    // Ensure post exists
    const postDoc = await posts.findOne(
      { post_id: safePostId },
      {
        projection: {
          _id: 0,
          post_id: 1,
          up_vote_count: 1,
          down_vote_count: 1,
        },
      },
    );
    if (!postDoc) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const now = new Date();

    const existing = await votes.findOne(
      { post_id: safePostId, user_id: safeUserId },
      { projection: { _id: 1, vote: 1 } },
    );

    const oldVote = existing?.vote; // undefined | "up" | "down"
    let newUserVote = null; // null | "up" | "down"

    // Compute deltas based on Reddit rules:
    // - none -> up/down  : +1
    // - up -> up         : remove => -1
    // - down -> down     : remove => -1
    // - up -> down       : up -1, down +1
    // - down -> up       : down -1, up +1
    let deltaUp = 0;
    let deltaDown = 0;

    if (!existing) {
      // create vote
      await votes.insertOne({
        post_id: safePostId,
        user_id: safeUserId,
        vote,
        created_at: now,
        updated_at: now,
      });
      newUserVote = vote;
      if (vote === "up") deltaUp = 1;
      else deltaDown = 1;
    } else if (oldVote === vote) {
      // toggle off -> delete vote doc
      await votes.deleteOne({ _id: existing._id });
      newUserVote = null;
      if (oldVote === "up") deltaUp = -1;
      else deltaDown = -1;
    } else {
      // switch vote
      await votes.updateOne(
        { _id: existing._id },
        { $set: { vote, updated_at: now } },
      );
      newUserVote = vote;

      if (oldVote === "up") deltaUp -= 1;
      if (oldVote === "down") deltaDown -= 1;
      if (vote === "up") deltaUp += 1;
      if (vote === "down") deltaDown += 1;
    }

    // Update user's total_guesses based on whether a vote was added or removed
    const shouldIncrementGuesses = !existing; // First time voting
    const shouldDecrementGuesses = existing && oldVote === vote; // Toggle off

    if (shouldIncrementGuesses) {
      await users.updateOne(
        { user_id: safeUserId },
        { $inc: { total_guesses: 1 } },
      );
    } else if (shouldDecrementGuesses) {
      await users.updateOne(
        { user_id: safeUserId },
        { $inc: { total_guesses: -1 } },
      );
    }

    // Buffer deltas in Redis and debounce flush
    // Buffer deltas in Redis with debounce + hard max-wait
    const redis = getRedis();
    const deltaKey = `post:${safePostId}:vote_deltas`;
    const firstKey = `post:${safePostId}:vote_first_at`;

    if (deltaUp !== 0 || deltaDown !== 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      const debounceAtSec = Math.floor((Date.now() + FLUSH_DEBOUNCE_MS) / 1000);

      // 1) set burst start once (first pending delta time)
      await redis.set(firstKey, String(nowSec), "EX", DELTA_TTL_SECONDS, "NX");

      // 2) read burst start
      const firstAtSec = Number((await redis.get(firstKey)) || nowSec);

      // 3) schedule flush = min(debounce, hard deadline)
      const hardDeadlineSec = firstAtSec + FLUSH_MAX_WAIT_SEC;
      const flushAtSec = Math.min(debounceAtSec, hardDeadlineSec);

      const pipe = redis.pipeline();
      if (deltaUp !== 0) pipe.hincrby(deltaKey, "up", deltaUp);
      if (deltaDown !== 0) pipe.hincrby(deltaKey, "down", deltaDown);

      pipe.zadd(FLUSH_ZSET, flushAtSec, safePostId);
      pipe.expire(deltaKey, DELTA_TTL_SECONDS);
      // optional but nice: keep firstKey alive if delta burst is long-lived
      pipe.expire(firstKey, DELTA_TTL_SECONDS);

      await pipe.exec();
    }

    // Return "current" counts fast: base counts from posts + pending redis deltas
    const pending = await redis.hgetall(deltaKey);
    const pendingUp = Number(pending?.up || 0);
    const pendingDown = Number(pending?.down || 0);

    const baseUp = Number(postDoc?.up_vote_count || 0);
    const baseDown = Number(postDoc?.down_vote_count || 0);

    return NextResponse.json(
      {
        post_id: safePostId,
        up_vote_count: baseUp + pendingUp,
        down_vote_count: baseDown + pendingDown,
        user_vote: newUserVote,
      },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to vote", detail: String(err) },
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
