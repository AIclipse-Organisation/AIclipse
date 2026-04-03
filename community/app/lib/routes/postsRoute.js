import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo/mongo.js";
import { validateImageId, validatePostId } from "@/app/posts/validation.js";
import { recordCollapsedNotification } from "@/lib/notifications/notifications.js";
import { recordActivity, SCORES } from "@/lib/gamification/scoring.js";
import { getRedis } from "@/lib/redis/redis";

const POSTS_COLLECTION = "community.posts";
const VOTES_COLLECTION = "community.votes";
const USERS_COLLECTION = "auth.users";

function safeNumber(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function safeDiv(a, b) {
  return b > 0 ? a / b : 0;
}

function isControversial(post, nowSec) {
  const secondsInHour = 3600;
  const minTotalVotes = 50;

  const up = safeNumber(post.up_vote_count);
  const down = safeNumber(post.down_vote_count);
  const total = up + down;
  if (total < minTotalVotes) return false;

  const controversialSince = safeNumber(post.controversial_since, 0);
  if (!controversialSince) return false;

  const ratio = (up / total) * 100;
  const inZone = ratio >= 40 && ratio <= 60;
  if (!inZone) return false;

  const timeDiff = nowSec - controversialSince;
  const boostStart = 48 * secondsInHour;
  const boostEnd = 96 * secondsInHour;
  return !(timeDiff < boostStart || timeDiff >= boostEnd);
}

function createdAtToUnixSeconds(created_at) {
  if (!created_at) return 0;
  if (created_at instanceof Date) {
    return Math.floor(created_at.getTime() / 1000);
  }
  const date = new Date(created_at);
  const millis = date.getTime();
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : 0;
}

function makePostId() {
  return `post_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function unauthorized(error) {
  return NextResponse.json(
    { error: "Unauthorized", detail: String(error) },
    { status: 401 },
  );
}

export function createPostsRouteHandlers({
  requireUser,
  optionalUser,
  buildGatewayIdentityHeaders,
}) {
  return {
    async POST(req) {
      let currentUser;
      try {
        currentUser = await requireUser(req);
      } catch (authErr) {
        return unauthorized(authErr);
      }

      try {
        const body = await req.json().catch(() => null);
        const authenticatedUserId = currentUser.user_id;
        const image_id = body?.image_id || null;
        const description = (body?.description || "").trim();
        const result = body?.result ?? null;
        const ground_truth = body?.ground_truth || null;
        const is_admin_post = body?.is_admin_post || false;

        if (!image_id || !description) {
          return NextResponse.json(
            { error: "Missing required fields: image_id or description" },
            { status: 400 },
          );
        }

        const imageIdValidation = validateImageId(image_id);
        if (!imageIdValidation.valid) {
          return NextResponse.json({ error: imageIdValidation.error }, { status: 400 });
        }
        const safeImageId = imageIdValidation.value;

        const maxDescriptionLength = 1000;
        if (description.length > maxDescriptionLength) {
          return NextResponse.json(
            { error: `Description too long (max ${maxDescriptionLength} characters)` },
            { status: 400 },
          );
        }

        const db = await getDb();
        const usersCol = db.collection(USERS_COLLECTION);
        const userDoc = await usersCol.findOne(
          { user_id: authenticatedUserId },
          { projection: { _id: 0, user_name: 1, email: 1 } },
        );
        const user_name = String(userDoc?.user_name || userDoc?.email || "Unknown");

        const doc = {
          post_id: makePostId(),
          user_id: authenticatedUserId,
          user_name,
          image_id: safeImageId,
          description,
          result,
          ground_truth,
          is_admin_post,
          clicks_count: 0,
          up_vote_count: 0,
          down_vote_count: 0,
          comment_count: 0,
          controversial_since: null,
          created_at: new Date(),
          is_reported: false,
          report_count: 0,
          reporter_ids: [],
          report_history: [],
        };

        const col = db.collection(POSTS_COLLECTION);
        await col.insertOne(doc);
        await recordActivity(db, authenticatedUserId, SCORES.CREATE_POST, "create_post");

        try {
          const gatewayUri = process.env.GATEWAY_URI;
          await fetch(`${gatewayUri}/image/${safeImageId}`, {
            method: "PATCH",
            headers: buildGatewayIdentityHeaders(currentUser),
            body: JSON.stringify({ is_public: true }),
          });
        } catch (imageUpdateErr) {
          console.error("Failed to mark image as public:", imageUpdateErr);
        }

        return NextResponse.json(doc, { status: 201 });
      } catch (err) {
        console.error("ERROR IN POST ROUTE:", err);
        return NextResponse.json(
          { error: "Failed to create post", detail: String(err) },
          { status: 500 },
        );
      }
    },

    async PATCH(req) {
      let currentUser;
      try {
        currentUser = await requireUser(req);
      } catch (authErr) {
        return unauthorized(authErr);
      }
      const authenticatedUserId = currentUser.user_id;

      try {
        const { searchParams } = new URL(req.url);
        const post_id = searchParams.get("post_id");
        if (!post_id) {
          return NextResponse.json(
            { error: "Missing required parameter: post_id" },
            { status: 400 },
          );
        }

        const postIdValidation = validatePostId(post_id);
        if (!postIdValidation.valid) {
          return NextResponse.json({ error: postIdValidation.error }, { status: 400 });
        }
        const safePostId = postIdValidation.value;

        const body = await req.json().catch(() => null);
        const description = (body?.description || "").trim();
        if (!description) {
          return NextResponse.json({ error: "Description cannot be empty" }, { status: 400 });
        }

        const maxDescriptionLength = 1000;
        if (description.length > maxDescriptionLength) {
          return NextResponse.json(
            { error: `Description too long (max ${maxDescriptionLength} characters)` },
            { status: 400 },
          );
        }

        const db = await getDb();
        const col = db.collection(POSTS_COLLECTION);
        const post = await col.findOne({ post_id: safePostId });
        if (!post) {
          return NextResponse.json({ error: "Post not found" }, { status: 404 });
        }

        if (post.user_id !== authenticatedUserId) {
          return NextResponse.json(
            { error: "Forbidden: You can only edit your own posts" },
            { status: 403 },
          );
        }

        await col.updateOne(
          { post_id: safePostId },
          { $set: { description, updated_at: new Date() } },
        );

        const updatedPost = await col.findOne(
          { post_id: safePostId },
          { projection: { _id: 0 } },
        );

        return NextResponse.json(
          { message: "Post updated successfully", post: updatedPost },
          { status: 200 },
        );
      } catch (err) {
        return NextResponse.json(
          { error: "Failed to update post", detail: String(err) },
          { status: 500 },
        );
      }
    },

    async DELETE(req) {
      let currentUser;
      try {
        currentUser = await requireUser(req);
      } catch (authErr) {
        return unauthorized(authErr);
      }
      const authenticatedUserId = currentUser.user_id;
      const isAdmin = currentUser.is_admin === true;

      try {
        const { searchParams } = new URL(req.url);
        const post_id = searchParams.get("post_id");
        if (!post_id) {
          return NextResponse.json({ error: "Missing post_id" }, { status: 400 });
        }

        const postIdValidation = validatePostId(post_id);
        if (!postIdValidation.valid) {
          return NextResponse.json({ error: postIdValidation.error }, { status: 400 });
        }
        const safePostId = postIdValidation.value;

        const db = await getDb();
        const col = db.collection(POSTS_COLLECTION);
        const post = await col.findOne({ post_id: safePostId });
        if (!post) {
          return NextResponse.json({ error: "Post not found" }, { status: 404 });
        }

        const isOwner = post.user_id === authenticatedUserId;
        if (!isOwner && !isAdmin) {
          return NextResponse.json(
            { error: "Forbidden: Elevated permissions required" },
            { status: 403 },
          );
        }

        await col.updateOne(
          { post_id: safePostId },
          {
            $set: {
              is_deleted: true,
              image_id: null,
              deleted_at: new Date(),
              moderation_status: "deleted",
              deleted_by: isAdmin ? "admin" : "owner",
            },
          },
        );

        if (isAdmin && !isOwner && post.user_id) {
          try {
            await recordCollapsedNotification(db, {
              recipient_user_id: post.user_id,
              actor_user_id: authenticatedUserId,
              post_id: post.post_id,
              type: "moderation",
              moderation_action: "deleted",
              moderation_reason: "Content permanently deleted by moderation team",
              image_id: post.image_id || null,
            });
          } catch (notifyErr) {
            console.error("Failed to create deletion notification:", notifyErr);
          }
        }

        await db.collection("community.comments").deleteMany({ post_id: safePostId });
        await db.collection("community.votes").deleteMany({ post_id: safePostId });

        if (post.image_id) {
          try {
            const gatewayUri = process.env.GATEWAY_URI;
            await fetch(`${gatewayUri}/image/${post.image_id}`, {
              method: "DELETE",
              headers: buildGatewayIdentityHeaders(currentUser),
            });
          } catch (err) {
            console.error("Gateway cleanup failed", err);
          }
        }

        return NextResponse.json({
          message: isAdmin ? "Admin override successful." : "Post deleted.",
          post_id: safePostId,
        });
      } catch (err) {
        console.error("DELETE ERROR:", err);
        return NextResponse.json(
          { error: "Server error", detail: String(err) },
          { status: 500 },
        );
      }
    },

    async GET(req) {
      const currentUserId = (await optionalUser(req))?.user_id || null;

      try {
        const db = await getDb();
        const col = db.collection(POSTS_COLLECTION);
        const imagesCol = db.collection("images");

        const { searchParams } = new URL(req.url);
        const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
        const limit = Math.max(1, parseInt(searchParams.get("limit") || "10", 10));
        const skip = (page - 1) * limit;
        const filterUserId = searchParams.get("user_id") || null;
        const filterImageId = searchParams.get("image_id") || null;
        const filterPostId = searchParams.get("post_id") || null;

        const publicImages = await imagesCol
          .find({ is_public: true }, { projection: { image_id: 1 } })
          .toArray();
        const publicImageIds = publicImages.map((img) => img.image_id);

        let posts;
        const query = {
          image_id: { $in: publicImageIds },
          is_deleted: { $ne: true },
          is_removed: { $ne: true },
          ...(filterUserId ? { user_id: filterUserId } : {}),
          ...(filterImageId ? { image_id: filterImageId } : {}),
          ...(filterPostId ? { post_id: filterPostId } : {}),
        };

        if (currentUserId && !filterPostId && !filterImageId && !filterUserId) {
          posts = await col
            .aggregate([
              { $match: query },
              {
                $lookup: {
                  from: VOTES_COLLECTION,
                  let: { pid: "$post_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $and: [
                            { $eq: ["$post_id", "$$pid"] },
                            { $eq: ["$user_id", currentUserId] },
                          ],
                        },
                      },
                    },
                    { $project: { _id: 1, vote: 1 } },
                  ],
                  as: "user_vote_data",
                },
              },
              {
                $addFields: {
                  is_voted: { $gt: [{ $size: "$user_vote_data" }, 0] },
                  user_vote_stored: { $arrayElemAt: ["$user_vote_data.vote", 0] },
                },
              },
              { $sort: { is_voted: 1, created_at: -1 } },
              { $limit: 600 },
              { $project: { _id: 0, user_vote_data: 0 } },
            ])
            .toArray();
        } else {
          posts = await col
            .find(query, { projection: { _id: 0 } })
            .sort({ created_at: -1 })
            .limit(300)
            .toArray();
        }

        if (!posts.length) {
          return NextResponse.json({ items: [] }, { status: 200 });
        }

        const userVotesMap = {};
        if (currentUserId && posts.length > 0) {
          posts.forEach((post) => {
            if (post.user_vote_stored) {
              userVotesMap[post.post_id] = post.user_vote_stored;
            }
          });

          const missingVotes = posts.filter((post) => post.is_voted === undefined);
          if (missingVotes.length > 0) {
            const votesCol = db.collection(VOTES_COLLECTION);
            const userVotes = await votesCol
              .find({
                user_id: currentUserId,
                post_id: { $in: missingVotes.map((post) => post.post_id) },
              })
              .toArray();

            userVotes.forEach((vote) => {
              userVotesMap[vote.post_id] = vote.vote;
            });
          }
        }

        const redis = getRedis();
        const voteDeltaKeys = posts.map((post) => `post:${post.post_id}:vote_deltas`);
        const commentDeltaKeys = posts.map((post) => `post:${post.post_id}:comment_deltas`);

        const pipe = redis.pipeline();
        for (const key of voteDeltaKeys) pipe.hgetall(key);
        for (const key of commentDeltaKeys) pipe.hgetall(key);
        const pipeRes = await pipe.exec();

        const deltasByPostId = {};
        for (let i = 0; i < posts.length; i += 1) {
          const postId = posts[i].post_id;
          const voteData = pipeRes?.[i]?.[1] || {};
          const commentData = pipeRes?.[i + posts.length]?.[1] || {};
          deltasByPostId[postId] = {
            up: Number(voteData.up || 0),
            down: Number(voteData.down || 0),
            comments: Number(commentData.count || 0),
          };
        }

        const items = posts.map((post) => {
          const delta = deltasByPostId[post.post_id] || { up: 0, down: 0, comments: 0 };
          return {
            ...post,
            up_vote_count: Number(post.up_vote_count || 0) + delta.up,
            down_vote_count: Number(post.down_vote_count || 0) + delta.down,
            comment_count: Number(post.comment_count || 0) + delta.comments,
            user_vote: userVotesMap[post.post_id] || null,
          };
        });

        const n = items.length || 1;
        const totalClicks = items.reduce((sum, post) => sum + safeNumber(post.clicks_count), 0);
        const totalVotes = items.reduce(
          (sum, post) => sum + safeNumber(post.up_vote_count) + safeNumber(post.down_vote_count),
          0,
        );
        const totalComments = items.reduce((sum, post) => sum + safeNumber(post.comment_count), 0);

        const avgClicks = totalClicks / n || 1;
        const avgVotes = totalVotes / n || 1;
        const avgComments = totalComments / n || 1;

        const votesWeight = 0.6;
        const commentsWeight = 0.3;
        const clicksWeight = 0.1;
        const constantOffset = 2;
        const gravity = 1.2;
        const nowSec = Math.floor(Date.now() / 1000);

        const ranked = items.map((post) => {
          const numVotes = safeNumber(post.up_vote_count) + safeNumber(post.down_vote_count);
          const numClicks = safeNumber(post.clicks_count);
          const numComments = safeNumber(post.comment_count);

          const votesNorm = safeDiv(numVotes, avgVotes);
          const clicksNorm = safeDiv(numClicks, avgClicks);
          const commentsNorm = safeDiv(numComments, avgComments);
          const engagement = votesNorm * votesWeight + clicksNorm * clicksWeight + commentsNorm * commentsWeight;

          const createdAtSec = createdAtToUnixSeconds(post.created_at);
          const ageSeconds = Math.max(nowSec - createdAtSec, 0);
          const ageHours = ageSeconds / 3600;
          const timeFactor = Math.pow(ageHours + constantOffset, gravity);

          let baseScore = 0;
          if (ageHours < 24) {
            baseScore = 0.5;
          }

          let score = baseScore + engagement / timeFactor;
          if (ageHours < 24) score *= 1.2;
          if (isControversial(post, nowSec)) score *= 2.5;
          if (post.user_vote) score -= 10000;

          return {
            ...post,
            score,
            debug: { votesNorm, clicksNorm, commentsNorm, engagement, ageHours },
          };
        });

        ranked.sort((a, b) => {
          if (b.score !== a.score) {
            return (b.score || 0) - (a.score || 0);
          }
          return new Date(b.created_at) - new Date(a.created_at);
        });

        const paginatedItems = ranked.slice(skip, skip + limit);
        const paginatedImageIds = paginatedItems.map((post) => post.image_id);
        const imagesForPage = await imagesCol
          .find({ image_id: { $in: paginatedImageIds } })
          .toArray();

        const imageMap = new Map(imagesForPage.map((img) => [img.image_id, img]));
        const finalItems = paginatedItems.map((post) => {
          const imgData = imageMap.get(post.image_id) || {};
          return { ...imgData, ...post };
        });

        return NextResponse.json(
          {
            items: finalItems,
            hasMore: ranked.length > skip + limit,
          },
          { status: 200 },
        );
      } catch (err) {
        return NextResponse.json(
          { error: "Failed to list posts", detail: String(err) },
          { status: 500 },
        );
      }
    },
  };
}
