import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo/mongo.js";
import { validateUserId, validatePostId } from "@/app/posts/validation.js";
import { getRedis } from "@/lib/redis/redis";
import { recordCollapsedNotification } from "@/lib/notifications/notifications.js";
import { recordActivity, awardPoints, SCORES } from "@/lib/gamification/scoring.js";

const POSTS_COLLECTION = "community.posts";
const VOTES_COLLECTION = "community.votes";
const USERS_COLLECTION = "auth.users";

const FLUSH_ZSET = "votes:flush_at";
const FLUSH_DEBOUNCE_MS = 5_000;
const FLUSH_MAX_WAIT_SEC = 60;
const DELTA_TTL_SECONDS = 60 * 60;

function unauthorized(error) {
  return NextResponse.json(
    { error: "Unauthorized", detail: String(error) },
    { status: 401 },
  );
}

export function createVoteHandler({ requireUser }) {
  return async function POST(req) {
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
      const vote = body?.vote || null;

      if (!post_id || !user_id || (vote !== "up" && vote !== "down")) {
        return NextResponse.json(
          { error: "Missing/invalid fields: post_id, user_id, vote('up'|'down')" },
          { status: 400 },
        );
      }

      const userIdValidation = validateUserId(user_id);
      if (!userIdValidation.valid) {
        return NextResponse.json({ error: userIdValidation.error }, { status: 400 });
      }
      const safeUserId = userIdValidation.value;

      const postIdValidation = validatePostId(post_id);
      if (!postIdValidation.valid) {
        return NextResponse.json({ error: postIdValidation.error }, { status: 400 });
      }
      const safePostId = postIdValidation.value;

      if (safeUserId !== authenticatedUserId) {
        return NextResponse.json(
          { error: "Forbidden: Cannot vote on behalf of other users" },
          { status: 403 },
        );
      }

      const db = await getDb();
      const posts = db.collection(POSTS_COLLECTION);
      const votes = db.collection(VOTES_COLLECTION);
      const users = db.collection(USERS_COLLECTION);

      const postDoc = await posts.findOne(
        { post_id: safePostId },
        {
          projection: {
            _id: 0,
            post_id: 1,
            user_id: 1,
            image_id: 1,
            up_vote_count: 1,
            down_vote_count: 1,
            is_admin_post: 1,
            ground_truth: 1,
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
      if (existing) {
        return NextResponse.json(
          { error: "You have already voted on this post. Votes are final." },
          { status: 403 },
        );
      }

      await votes.insertOne({
        post_id: safePostId,
        user_id: safeUserId,
        vote,
        created_at: now,
        updated_at: now,
      });

      const deltaUp = vote === "up" ? 1 : 0;
      const deltaDown = vote === "down" ? 1 : 0;
      const incQuery = { total_guesses: 1 };
      const isAdmin = Boolean(postDoc.is_admin_post);
      let wasCorrectAdminVote = false;

      if (isAdmin && postDoc.ground_truth) {
        const truth = String(postDoc.ground_truth).toLowerCase();
        const isRealGT = truth === "real";
        const isFakeGT = truth === "ai";

        incQuery.admin_guesses_total = 1;
        if (isRealGT) {
          incQuery.admin_real_total = 1;
          if (vote === "up") {
            incQuery.admin_guesses_correct = 1;
            incQuery.admin_real_correct = 1;
            wasCorrectAdminVote = true;
          }
        } else if (isFakeGT) {
          incQuery.admin_fake_total = 1;
          if (vote === "down") {
            incQuery.admin_guesses_correct = 1;
            incQuery.admin_fake_correct = 1;
            wasCorrectAdminVote = true;
          }
        }
      }

      await users.updateOne({ user_id: safeUserId }, { $inc: incQuery });

      const votePoints = wasCorrectAdminVote ? SCORES.CORRECT_ADMIN_VOTE : SCORES.VOTE;
      await recordActivity(
        db,
        safeUserId,
        votePoints,
        wasCorrectAdminVote ? "correct_admin_vote" : "vote",
      );

      if (postDoc.user_id && postDoc.user_id !== safeUserId) {
        await awardPoints(db, postDoc.user_id, SCORES.RECEIVE_ENGAGEMENT, "receive_vote");
        try {
          await recordCollapsedNotification(db, {
            recipient_user_id: postDoc.user_id,
            actor_user_id: safeUserId,
            post_id: safePostId,
            type: "vote",
            vote_value: vote === "up" ? "real" : "ai",
            image_id: postDoc.image_id || null,
          });
        } catch (notifyErr) {
          console.error("Failed to create vote notification:", notifyErr);
        }
      }

      const redis = getRedis();
      const deltaKey = `post:${safePostId}:vote_deltas`;
      const choicesKey = `post:${safePostId}:voter_choices`;
      const firstKey = `post:${safePostId}:vote_first_at`;

      const nowSec = Math.floor(Date.now() / 1000);
      const debounceAtSec = Math.floor((Date.now() + FLUSH_DEBOUNCE_MS) / 1000);

      await redis.set(firstKey, String(nowSec), "EX", DELTA_TTL_SECONDS, "NX");
      const firstAtSec = Number((await redis.get(firstKey)) || nowSec);
      const hardDeadlineSec = firstAtSec + FLUSH_MAX_WAIT_SEC;
      const flushAtSec = Math.min(debounceAtSec, hardDeadlineSec);

      const pipe = redis.pipeline();
      if (deltaUp !== 0) pipe.hincrby(deltaKey, "up", deltaUp);
      if (deltaDown !== 0) pipe.hincrby(deltaKey, "down", deltaDown);
      pipe.hset(choicesKey, safeUserId, vote === "up" ? "1" : "0");
      pipe.zadd(FLUSH_ZSET, flushAtSec, safePostId);
      pipe.expire(deltaKey, DELTA_TTL_SECONDS);
      pipe.expire(choicesKey, DELTA_TTL_SECONDS);
      pipe.expire(firstKey, DELTA_TTL_SECONDS);
      await pipe.exec();

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
          user_vote: vote,
          points_awarded: votePoints,
        },
        { status: 200 },
      );
    } catch (err) {
      return NextResponse.json(
        { error: "Failed to vote", detail: String(err) },
        { status: 500 },
      );
    }
  };
}
