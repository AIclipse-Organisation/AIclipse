import { MongoClient } from "mongodb";
import { getRedis } from "./redis/redis.js";

const MONGO_URI = process.env.MONGO_URI || "";
const MONGO_DB = process.env.MONGO_DB || "aiclipse";
const POSTS_COLLECTION = "community.posts";

const FLUSH_ZSET = "votes:flush_at";
const MODEL_STREAM_KEY = "events:model_cycle";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function flushOnce({ redis, posts }) {
  const nowSec = Math.floor(Date.now() / 1000);

  const duePostIds = await redis.zrangebyscore(
    FLUSH_ZSET,
    "-inf",
    nowSec,
    "LIMIT",
    0,
    200,
  );
  if (!duePostIds.length) return 0;

  for (const postId of duePostIds) {
    const postKey = `post:${postId}:vote_deltas`;
    const firstKey = `post:${postId}:vote_first_at`;

    const lockKey = `lock:flush:${postId}`;
    const gotLock = await redis.set(lockKey, "1", "NX", "EX", 30);
    if (!gotLock) continue;

    try {
      const score = await redis.zscore(FLUSH_ZSET, postId);
      if (!score || Number(score) > nowSec) continue;

      const deltas = await redis.hgetall(postKey);
      const deltaUp = Number(deltas?.up || 0);
      const deltaDown = Number(deltas?.down || 0);

      if (deltaUp !== 0 || deltaDown !== 0) {
        await posts.updateOne(
          { post_id: postId },
          {
            $inc: {
              ...(deltaUp ? { up_vote_count: deltaUp } : {}),
              ...(deltaDown ? { down_vote_count: deltaDown } : {}),
            },
            $set: { updated_at: new Date() },
          },
        );
        await redis.xadd(
          MODEL_STREAM_KEY,
          "*",
          "post_id",
          postId,
          "trigger",
          "vote_flush",
        );
      }

      const pipe = redis.pipeline();
      pipe.del(postKey);
      pipe.del(firstKey); 
      pipe.zrem(FLUSH_ZSET, postId);
      await pipe.exec();
    } finally {
      await redis.del(lockKey);
    }
  }

  return duePostIds.length;
}

async function main() {
  if (!MONGO_URI) throw new Error("MONGO_URI is not set");

  const redis = getRedis();
  const mongo = new MongoClient(MONGO_URI);

  await mongo.connect();
  const db = mongo.db(MONGO_DB);
  const posts = db.collection(POSTS_COLLECTION);

  console.log("[voteFlushWorker] started");

  while (true) {
    try {
      const n = await flushOnce({ redis, posts });
      await sleep(n ? 250 : 1000);
    } catch (e) {
      console.error("[voteFlushWorker] error:", e?.message || e);
      await sleep(1000);
    }
  }
}

main().catch((e) => {
  console.error("[voteFlushWorker] fatal:", e);
  process.exit(1);
});
