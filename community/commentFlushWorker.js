import { runFlushWorker } from "./lib/workers/flushWorker.js";

const POSTS_COLLECTION = "community.posts";

const FLUSH_ZSET = "comments:flush_at";

async function flushOnce({ redis, collection: posts }) {
  const nowSec = Math.floor(Date.now() / 1000);

  const duePostIds = await redis.zrangebyscore(
    FLUSH_ZSET,
    "-inf",
    nowSec,
    "LIMIT",
    0,
    300,
  );
  if (!duePostIds.length) return 0;

  for (const postId of duePostIds) {
    const deltaKey = `post:${postId}:comment_deltas`;
    const firstKey = `post:${postId}:comment_first_at`;

    const lockKey = `lock:flush:comments:${postId}`;
    const gotLock = await redis.set(lockKey, "1", "NX", "EX", 30);
    if (!gotLock) continue;

    try {
      const score = await redis.zscore(FLUSH_ZSET, postId);
      if (!score || Number(score) > nowSec) continue;

      const raw = await redis.hget(deltaKey, "count");
      const delta = Number(raw || 0);

      if (delta !== 0) {
        if (delta > 0) {
          await posts.updateOne(
            { post_id: postId },
            {
              $inc: { comment_count: delta },
              $set: { updated_at: new Date() },
            },
          );
        } else {
          await posts.updateOne({ post_id: postId }, [
            {
              $set: {
                comment_count: {
                  $max: [0, { $add: ["$comment_count", delta] }],
                },
                updated_at: new Date(),
              },
            },
          ]);
        }
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
  name: "commentFlushWorker",
  collectionName: POSTS_COLLECTION,
  flushOnce,
}).catch((e) => {
  console.error("[commentFlushWorker] fatal:", e);
  process.exit(1);
});
