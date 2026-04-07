import path from "node:path";
import { fileURLToPath } from "node:url";

import { getDb } from "./lib/mongo/mongo.js";
import { disposeRedis, getRedis } from "./lib/redis/redis.js";

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

export async function ensureConsumerGroup(redis, { logger = console } = {}) {
  try {
    await redis.xgroup("CREATE", STREAM, GROUP, "0", "MKSTREAM");
    logger.log(`[userDeleteWorker] consumer group '${GROUP}' created`);
  } catch (err) {
    if (err.message && err.message.includes("BUSYGROUP")) {
      // Group already exists — expected on restart
    } else {
      throw err;
    }
  }
}

export async function processMessages(redis, posts, messages, { logger = console } = {}) {
  for (const [msgId, rawFields] of messages) {
    // ioredis returns fields as a flat array: ['key', 'val', 'key2', 'val2', ...]
    const fields = {};
    for (let i = 0; i < rawFields.length; i += 2) {
      fields[rawFields[i]] = rawFields[i + 1];
    }

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
      logger.error("[userDeleteWorker] failed to parse event data for msg", msgId);
      await redis.xack(STREAM, GROUP, msgId);
      continue;
    }

    if (!deletedUserId) {
      logger.warn("[userDeleteWorker] missing deleted_user_id in msg", msgId);
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

      logger.log(
        `[userDeleteWorker] tombstoned ${result.modifiedCount} post(s) for user ${deletedUserId}`,
      );

      await redis.xack(STREAM, GROUP, msgId);
    } catch (err) {
      logger.error(
        `[userDeleteWorker] failed to tombstone posts for user ${deletedUserId}:`,
        err?.message || err,
      );
      // Don't ack — message will be redelivered
    }
  }
}

export async function runUserDeleteWorker({
  redisFactory = getRedis,
  dbFactory = getDb,
  sleepFn = sleep,
  logger = console,
  stopWhen = () => false,
} = {}) {
  let redis = null;
  let posts = null;
  let consumerGroupReady = false;
  let started = false;

  while (!stopWhen()) {
    try {
      if (!redis) {
        redis = redisFactory();
        consumerGroupReady = false;
      }

      if (!posts) {
        const db = await dbFactory();
        posts = db.collection(POSTS_COLLECTION);
      }

      if (!consumerGroupReady) {
        await ensureConsumerGroup(redis, { logger });
        consumerGroupReady = true;
      }

      if (!started) {
        logger.log("[userDeleteWorker] started");
        started = true;
      }

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
        await processMessages(redis, posts, messages, { logger });
      }
    } catch (err) {
      logger.error("[userDeleteWorker] error:", err?.message || err);
      disposeRedis(redis);
      redis = null;
      posts = null;
      consumerGroupReady = false;
      await sleepFn(2000);
    }
  }
}

const ENTRY_FILE = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === ENTRY_FILE;

if (isDirectRun) {
  runUserDeleteWorker().catch((err) => {
    console.error("[userDeleteWorker] fatal:", err);
    process.exit(1);
  });
}
