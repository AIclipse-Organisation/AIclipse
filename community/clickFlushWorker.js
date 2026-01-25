import { MongoClient } from "mongodb";
import { getRedis } from "./redis/redis.js"

const MONGO_URI = process.env.MONGO_URI || "";
const MONGO_DB = process.env.MONGO_DB || "aiclipse";
const POSTS_COLLECTION = "community.posts";

const FLUSH_ZSET = "clicks:flush_at";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function flushOnce({ redis, posts }) {
  const nowSec = Math.floor(Date.now() / 1000);

  // Pull due post IDs
  const duePostIds = await redis.zrangebyscore(
    FLUSH_ZSET,
    "-inf",
    nowSec,
    "LIMIT",
    0,
    400
  );
  if (!duePostIds.length) return 0;

  for (const postId of duePostIds) {
    const deltaKey = `post:${postId}:click_deltas`;

    // Only one worker flushes a post at a time
    const lockKey = `lock:flush:clicks:${postId}`;
    const gotLock = await redis.set(lockKey, "1", "NX", "EX", 30);
    if (!gotLock) continue;

    try {
      // Re-check still due
      const score = await redis.zscore(FLUSH_ZSET, postId);
      if (!score || Number(score) > nowSec) continue;

      // We store a single integer field "count"
      const raw = await redis.hget(deltaKey, "count");
      const delta = Number(raw || 0);

      if (delta !== 0) {
        await posts.updateOne(
          { post_id: postId },
          {
            $inc: { clicks_count: delta },
            $set: { updated_at: new Date() },
          }
        );
      }

      // Clear redis state after successful flush
      const pipe = redis.pipeline();
      pipe.del(deltaKey);
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

  console.log("[clickFlushWorker] started");

  while (true) {
    try {
      const n = await flushOnce({ redis, posts });
      await sleep(n ? 250 : 1000);
    } catch (e) {
      console.error("[clickFlushWorker] error:", e?.message || e);
      await sleep(1000);
    }
  }
}

main().catch((e) => {
  console.error("[clickFlushWorker] fatal:", e);
  process.exit(1);
});
