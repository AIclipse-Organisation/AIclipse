import { getDb } from "./lib/mongo/mongo.js";
import { getRedis } from "./lib/redis/redis.js";

const MONGO_DB = process.env.MONGO_DB || "aiclipse";
const POSTS_COLLECTION = "community.posts";

const STREAM = "auth-events";
const GROUP = "community-workers";
const CONSUMER = "community-user-delete-worker";

const BLOCK_MS = 5000;
const BATCH = 10;

const USER_DELETED_EVENTS = new Set([
  "auth.user.deleted.admin",
  "auth.user.deleted.self",
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureConsumerGroup(redis) {
  try {
    await redis.xgroup("CREATE", STREAM, GROUP, "0", "MKSTREAM");
    console.log(`[userDeleteWorker] consumer group '${GROUP}' created`);
  } catch (err) {
    if (err.message && err.message.includes("BUSYGROUP")) {
      // Group already exists — expected on restart
    } else {
      throw err;
    }
  }
}

async function processMessages(redis, posts, messages) {
  for (const [msgId, fields] of messages) {
    const type = fields.type;
    const dataRaw = fields.data;

    if (!USER_DELETED_EVENTS.has(type)) {
      await redis.xack(STREAM, GROUP, msgId);
      continue;
    }

    let deletedUserId = null;
    try {
      const payload = JSON.parse(dataRaw || "{}");
      deletedUserId = payload.deleted_user_id || null;
    } catch {
      console.error("[userDeleteWorker] failed to parse event data for msg", msgId);
      await redis.xack(STREAM, GROUP, msgId);
      continue;
    }

    if (!deletedUserId) {
      console.warn("[userDeleteWorker] missing deleted_user_id in msg", msgId);
      await redis.xack(STREAM, GROUP, msgId);
      continue;
    }

    try {
      const result = await posts.updateMany(
        { user_id: deletedUserId, is_deleted: { $ne: true } },
        {
          $set: {
            is_deleted: true,
            deleted_at: new Date(),
            deleted_by: "account_deleted",
          },
        },
      );

      console.log(
        `[userDeleteWorker] tombstoned ${result.modifiedCount} post(s) for user ${deletedUserId}`,
      );

      await redis.xack(STREAM, GROUP, msgId);
    } catch (err) {
      console.error(
        `[userDeleteWorker] failed to tombstone posts for user ${deletedUserId}:`,
        err?.message || err,
      );
      // Don't ack — message will be redelivered
    }
  }
}

async function main() {
  const redis = getRedis();
  const db = await getDb();
  const posts = db.collection(POSTS_COLLECTION);

  await ensureConsumerGroup(redis);
  console.log("[userDeleteWorker] started");

  while (true) {
    try {
      const response = await redis.xreadgroup(
        "GROUP", GROUP, CONSUMER,
        "BLOCK", BLOCK_MS,
        "COUNT", BATCH,
        "STREAMS", STREAM, ">",
      );

      if (!response) {
        // Block timeout — no new messages
        continue;
      }

      for (const [, messages] of response) {
        await processMessages(redis, posts, messages);
      }
    } catch (err) {
      console.error("[userDeleteWorker] error:", err?.message || err);
      await sleep(2000);
    }
  }
}

main().catch((err) => {
  console.error("[userDeleteWorker] fatal:", err);
  process.exit(1);
});
