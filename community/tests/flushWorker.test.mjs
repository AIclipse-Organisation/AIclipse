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
    flushOnce: async ({ redis, db, collection }) => {
      flushCalls += 1;
      assert.equal(redis, redisClient);
      assert.equal(typeof db.collection, "function");
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

test("runFlushWorker stops retrying and rethrows fatal configuration errors", async () => {
  const events = [];
  let attempts = 0;

  await assert.rejects(
    runFlushWorker({
      name: "fatalFlushWorker",
      collectionName: "community.posts",
      redisFactory: () => ({ id: "redis-client" }),
      dbFactory: async () => {
        attempts += 1;
        return {
          collection() {
            return { name: "community.posts" };
          },
        };
      },
      sleepFn: async () => {
        events.push("sleep");
      },
      logger: {
        log: (...args) => events.push(args.join(" ")),
        error: (...args) => events.push(args.join(" ")),
      },
      flushOnce: async () => {
        throw new Error("Missing INTERNAL_AUTH_TOKEN");
      },
      isFatalError: (error) => String(error?.message || "") === "Missing INTERNAL_AUTH_TOKEN",
    }),
    /Missing INTERNAL_AUTH_TOKEN/,
  );

  assert.equal(attempts, 1);
  assert.ok(events.some((entry) => entry.includes("[fatalFlushWorker] error: Missing INTERNAL_AUTH_TOKEN")));
  assert.ok(!events.includes("sleep"));
});
