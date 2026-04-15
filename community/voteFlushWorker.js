import { runFlushWorker } from "./lib/workers/flushWorker.js";

const POSTS_COLLECTION = "community.posts";

const FLUSH_ZSET = "votes:flush_at";
const MODEL_STREAM_KEY = "events:model_cycle";

async function flushOnce({ redis, collection: posts }) {
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

runFlushWorker({
  name: "voteFlushWorker",
  collectionName: POSTS_COLLECTION,
  flushOnce,
}).catch((e) => {
  console.error("[voteFlushWorker] fatal:", e);
  process.exit(1);
});
