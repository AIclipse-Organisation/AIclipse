import { getDb } from "../mongo/mongo.js";
import { disposeRedis, getRedis } from "../redis/redis.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runFlushWorker({
  name,
  collectionName,
  flushOnce,
  busySleepMs = 250,
  idleSleepMs = 1000,
  errorSleepMs = 1000,
  redisFactory = getRedis,
  dbFactory = getDb,
  sleepFn = sleep,
  logger = console,
  stopWhen = () => false,
  isFatalError = () => false,
} = {}) {
  let redis = null;
  let db = null;
  let collection = null;
  let started = false;

  while (!stopWhen()) {
    try {
      if (!redis) {
        redis = redisFactory();
      }

      if (!collection) {
        db = await dbFactory();
        collection = db.collection(collectionName);
      }

      if (!started) {
        logger.log(`[${name}] started`);
        started = true;
      }

      const processedCount = await flushOnce({ redis, db, collection });
      await sleepFn(processedCount ? busySleepMs : idleSleepMs);
    } catch (error) {
      logger.error(`[${name}] error:`, error?.message || error);
      disposeRedis(redis);
      redis = null;
      db = null;
      collection = null;
      if (isFatalError(error)) {
        throw error;
      }
      await sleepFn(errorSleepMs);
    }
  }

  disposeRedis(redis);
}
