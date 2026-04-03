import { runFlushWorker } from "./lib/workers/flushWorker.js";

const POSTS_COLLECTION = "community.posts";

const FLUSH_ZSET = "clicks:flush_at";

async function flushOnce({ redis, collection: posts }) {
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
    const firstKey = `post:${postId}:click_first_at`;
    const lockKey = `lock:flush:clicks:${postId}`;

    // Acquire lock to prevent race conditions if multiple workers run
    const gotLock = await redis.set(lockKey, "1", "NX", "EX", 30);
    if (!gotLock) continue;

    try {
      // Double-check score inside lock
      const score = await redis.zscore(FLUSH_ZSET, postId);
      if (!score || Number(score) > nowSec) continue;

      const raw = await redis.hget(deltaKey, "count");
      const delta = Number(raw || 0);

      // Only hit Mongo if there is an actual change
      if (delta !== 0) {
        await posts.updateOne(
          { post_id: postId },
          {
            $inc: { clicks_count: delta },
            $set: { updated_at: new Date() },
          }
        );
      }

      const pipe = redis.pipeline();
      pipe.del(deltaKey);
      pipe.del(firstKey);
      pipe.zrem(FLUSH_ZSET, postId);
      await pipe.exec();
    } finally {
      await redis.del(lockKey);
    }
  }

  return duePostIds.length;
}

runFlushWorker({
  name: "clickFlushWorker",
  collectionName: POSTS_COLLECTION,
  flushOnce,
}).catch((e) => {
  console.error("[clickFlushWorker] fatal:", e);
  process.exit(1);
});
