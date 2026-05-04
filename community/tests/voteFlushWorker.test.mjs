import test from "node:test";
import assert from "node:assert/strict";

import { flushVotesOnce } from "../voteFlushWorker.js";

test("flushVotesOnce evaluates votes through gateway and persists absolute counts", async () => {
  process.env.GATEWAY_URI = "http://gateway.test";
  process.env.INTERNAL_AUTH_TOKEN = "secret";

  const pipelineCalls = [];
  const updateCalls = [];
  const fetchCalls = [];
  const originalFetch = global.fetch;

  global.fetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });

    if (String(url) === "http://gateway.test/internal/images/lookup") {
      return Response.json({
        items: [
          {
            image_id: "img_1",
            s3_key: "images/img_1.png",
            label: "real",
            confidence: 0.82,
            model_version: "v1.2.3",
          },
        ],
      });
    }

    if (String(url) === "http://gateway.test/internal/model-cycle/imageconfidence/evaluate") {
      return Response.json({ isReady: false, label: "real" });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const redis = {
    async zrangebyscore() {
      return ["post_1"];
    },
    async set() {
      return "OK";
    },
    async zscore() {
      return "1";
    },
    pipeline() {
      return {
        del(key) {
          pipelineCalls.push(["del", key]);
        },
        zrem(key, value) {
          pipelineCalls.push(["zrem", key, value]);
        },
        async exec() {
          return [];
        },
      };
    },
    async del(key) {
      pipelineCalls.push(["unlock", key]);
    },
  };

  const posts = {
    async findOne() {
      return { post_id: "post_1", image_id: "img_1" };
    },
    async updateOne(filter, update) {
      updateCalls.push({ filter, update });
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };

  const votes = {
    find() {
      return {
        async toArray() {
          return [
            { user_id: "u_1", vote: "up" },
            { user_id: "u_2", vote: "down" },
            { user_id: "u_3", vote: "down" },
          ];
        },
      };
    },
  };

  const db = {
    collection(name) {
      assert.equal(name, "community.votes");
      return votes;
    },
  };

  try {
    const processed = await flushVotesOnce({ redis, db, collection: posts });

    assert.equal(processed, 1);
    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[0].url, "http://gateway.test/internal/images/lookup");
    assert.equal(fetchCalls[1].url, "http://gateway.test/internal/model-cycle/imageconfidence/evaluate");
    assert.equal(fetchCalls[0].init.headers["X-Internal-Token"], "secret");
    assert.equal(fetchCalls[1].init.headers["X-Internal-Token"], "secret");

    const evaluatePayload = JSON.parse(fetchCalls[1].init.body);
    assert.deepEqual(evaluatePayload, {
      postId: "post_1",
      mediaImageId: "img_1",
      s3Key: "images/img_1.png",
      label: "real",
      modelConfidence: 0.82,
      modelVersion: "v1.2.3",
      votes: [
        { userId: "u_1", isAiVote: false },
        { userId: "u_2", isAiVote: true },
        { userId: "u_3", isAiVote: true },
      ],
    });

    assert.equal(updateCalls.length, 1);
    assert.deepEqual(updateCalls[0].filter, { post_id: "post_1" });
    assert.equal(updateCalls[0].update.$set.up_vote_count, 1);
    assert.equal(updateCalls[0].update.$set.down_vote_count, 2);
    assert.ok(updateCalls[0].update.$set.updated_at instanceof Date);
    assert.deepEqual(
      pipelineCalls.filter((call) => call[0] !== "unlock"),
      [
        ["del", "post:post_1:vote_deltas"],
        ["del", "post:post_1:vote_first_at"],
        ["del", "post:post_1:voter_choices"],
        ["zrem", "votes:flush_at", "post_1"],
      ],
    );
  } finally {
    global.fetch = originalFetch;
    delete process.env.GATEWAY_URI;
    delete process.env.INTERNAL_AUTH_TOKEN;
  }
});
