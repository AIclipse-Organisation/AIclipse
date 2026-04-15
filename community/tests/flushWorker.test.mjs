import test from "node:test";
import assert from "node:assert/strict";

import { runFlushWorker } from "../lib/workers/flushWorker.js";

test("runFlushWorker retries startup after an initial db/index failure", async () => {
  const events = [];
  let setupAttempts = 0;

  const sleepFn = async () => {
    events.push("sleep");
  };

  const redisClient = { id: "redis-client" };
  const dbFactory = async () => {
    setupAttempts += 1;
    if (setupAttempts === 1) {
      throw new Error("legacy index conflict");
    }

    return {
      collection(name) {
        return { name };
      },
    };
  };

  let flushCalls = 0;
  await runFlushWorker({
    name: "testFlushWorker",
    collectionName: "community.posts",
    redisFactory: () => redisClient,
    dbFactory,
    sleepFn,
    logger: {
      log: (...args) => events.push(args.join(" ")),
      error: (...args) => events.push(args.join(" ")),
    },
    flushOnce: async ({ redis, collection }) => {
      flushCalls += 1;
      assert.equal(redis, redisClient);
      assert.equal(collection.name, "community.posts");
      return 1;
    },
    stopWhen: () => flushCalls >= 1,
  });

  assert.equal(setupAttempts, 2);
  assert.equal(flushCalls, 1);
  assert.ok(events.some((entry) => entry.includes("legacy index conflict")));
  assert.ok(events.includes("sleep"));
  assert.ok(events.some((entry) => entry.includes("[testFlushWorker] started")));
});
