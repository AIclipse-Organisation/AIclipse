import test from "node:test";
import assert from "node:assert/strict";
import { submitCommentAPI, voteOnPost } from "../app/components/post/postBoxActions.js";

test("voteOnPost sends only canonical vote fields", async () => {
  const originalFetch = global.fetch;
  let requestBody = null;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { up_vote_count: 1, down_vote_count: 0, user_vote: "up", points_awarded: 1 };
      },
    };
  };

  try {
    const result = await voteOnPost("post_1", "up");

    assert.deepEqual(requestBody, { post_id: "post_1", vote: "up" });
    assert.equal(result.user_vote, "up");
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitCommentAPI sends only canonical comment fields", async () => {
  const originalFetch = global.fetch;
  let requestBody = null;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { comment_id: "c_1", text: "Hi" };
      },
    };
  };

  try {
    const result = await submitCommentAPI("post_1", "Hi");

    assert.deepEqual(requestBody, { post_id: "post_1", text: "Hi" });
    assert.equal(result.comment_id, "c_1");
  } finally {
    global.fetch = originalFetch;
  }
});
