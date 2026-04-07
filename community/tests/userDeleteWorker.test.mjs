import test from "node:test";
import assert from "node:assert/strict";

import { runUserDeleteWorker } from "../userDeleteWorker.js";

test("userDeleteWorker retries startup when consumer group creation fails initially", async () => {
  let stop = false;
  let xgroupCalls = 0;
  let xreadgroupCalls = 0;
  let disconnectCalls = 0;
  let sleepCalls = 0;

  const redis = {
    async xgroup() {
      xgroupCalls += 1;
      if (xgroupCalls === 1) {
        throw new Error("Redis unavailable");
      }
    },
    async xreadgroup() {
      xreadgroupCalls += 1;
      stop = true;
      return null;
    },
    disconnect() {
      disconnectCalls += 1;
    },
  };

  const db = {
    collection(name) {
      assert.equal(name, "community.posts");
      return {
        updateMany: async () => ({ modifiedCount: 0 }),
      };
    },
  };

  const logger = {
    log() {},
    warn() {},
    error() {},
  };

  await runUserDeleteWorker({
    redisFactory: () => redis,
    dbFactory: async () => db,
    sleepFn: async () => {
      sleepCalls += 1;
    },
    logger,
    stopWhen: () => stop,
  });

  assert.equal(xgroupCalls, 2);
  assert.equal(xreadgroupCalls, 1);
  assert.equal(disconnectCalls, 1);
  assert.equal(sleepCalls, 1);
});
