import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchPublicImagesByIds } from "./app/lib/publicImages.js";
import { evaluateCommunityVotes } from "./app/lib/modelCycle.js";
import { runFlushWorker } from "./lib/workers/flushWorker.js";

const POSTS_COLLECTION = "community.posts";
const VOTES_COLLECTION = "community.votes";

const FLUSH_ZSET = "votes:flush_at";

async function buildEvaluationPayload({ posts, votes, postId }) {
  const post = await posts.findOne(
    { post_id: postId },
    {
      projection: {
        _id: 0,
        post_id: 1,
        image_id: 1,
      },
    },
  );
  if (!post?.image_id) {
    return null;
  }

  const voteDocs = await votes.find(
    { post_id: postId },
    { projection: { _id: 0, user_id: 1, vote: 1 } },
  ).toArray();

  const [image] = await fetchPublicImagesByIds([post.image_id]);
  if (!image?.image_id || !image?.s3_key || !image?.model_version) {
    return null;
  }

  return {
    postId: post.post_id,
    mediaImageId: image.image_id,
    s3Key: image.s3_key,
    label: image.label,
    modelConfidence: image.confidence,
    modelVersion: image.model_version,
    votes: voteDocs,
    upVoteCount: voteDocs.filter((vote) => vote.vote === "up").length,
    downVoteCount: voteDocs.filter((vote) => vote.vote === "down").length,
  };
}

export async function flushVotesOnce({ redis, db, collection: posts }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const duePostIds = await redis.zrangebyscore(
    FLUSH_ZSET,
    "-inf",
    nowSec,
    "LIMIT",
    0,
    200,
  );
  if (!duePostIds.length) {
    return 0;
  }

  const votes = db.collection(VOTES_COLLECTION);

  for (const postId of duePostIds) {
    const postKey = `post:${postId}:vote_deltas`;
    const firstKey = `post:${postId}:vote_first_at`;
    const choicesKey = `post:${postId}:voter_choices`;
    const lockKey = `lock:flush:${postId}`;
    const gotLock = await redis.set(lockKey, "1", "NX", "EX", 30);
    if (!gotLock) {
      continue;
    }

    try {
      const score = await redis.zscore(FLUSH_ZSET, postId);
      if (!score || Number(score) > nowSec) {
        continue;
      }

      const evaluationPayload = await buildEvaluationPayload({ posts, votes, postId });
      if (!evaluationPayload) {
        const pipe = redis.pipeline();
        pipe.del(postKey);
        pipe.del(firstKey);
        pipe.del(choicesKey);
        pipe.zrem(FLUSH_ZSET, postId);
        await pipe.exec();
        continue;
      }

      await evaluateCommunityVotes(evaluationPayload);
      await posts.updateOne(
        { post_id: postId },
        {
          $set: {
            up_vote_count: evaluationPayload.upVoteCount,
            down_vote_count: evaluationPayload.downVoteCount,
            updated_at: new Date(),
          },
        },
      );

      const pipe = redis.pipeline();
      pipe.del(postKey);
      pipe.del(firstKey);
      pipe.del(choicesKey);
      pipe.zrem(FLUSH_ZSET, postId);
      await pipe.exec();
    } finally {
      await redis.del(lockKey);
    }
  }

  return duePostIds.length;
}

export function runVoteFlushWorker(options = {}) {
  return runFlushWorker({
    name: "voteFlushWorker",
    collectionName: POSTS_COLLECTION,
    flushOnce: flushVotesOnce,
    isFatalError(error) {
      const message = String(error?.message || "");
      return message === "Missing INTERNAL_AUTH_TOKEN" || message === "Missing GATEWAY_URI";
    },
    ...options,
  });
}

const ENTRY_FILE = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === ENTRY_FILE;

if (isDirectRun) {
  runVoteFlushWorker().catch((error) => {
    console.error("[voteFlushWorker] fatal:", error);
    process.exit(1);
  });
}
