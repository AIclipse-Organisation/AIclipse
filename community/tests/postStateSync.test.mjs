import test from "node:test";
import assert from "node:assert/strict";
import {
  createPostWithImageSyncOrRollback,
  updatePostStateWithImageSyncOrRollback,
} from "../app/lib/postStateSync.js";

test("createPostWithImageSyncOrRollback deletes the post when image sync fails", async () => {
  const calls = [];
  const postsCol = {
    async insertOne(doc) {
      calls.push(["insertOne", doc.post_id]);
    },
    async deleteOne(query) {
      calls.push(["deleteOne", query.post_id]);
    },
  };

  await assert.rejects(
    createPostWithImageSyncOrRollback({
      postsCol,
      postDoc: { post_id: "post_1" },
      syncImage: async () => {
        throw new Error("Media service unreachable");
      },
    }),
    /Media service unreachable/,
  );

  assert.deepEqual(calls, [
    ["insertOne", "post_1"],
    ["deleteOne", "post_1"],
  ]);
});

test("updatePostStateWithImageSyncOrRollback restores previous fields on sync failure", async () => {
  const calls = [];
  const postsCol = {
    async updateOne(query, update) {
      calls.push([query, update]);
    },
  };

  await assert.rejects(
    updatePostStateWithImageSyncOrRollback({
      postsCol,
      previousPost: {
        post_id: "post_1",
        is_removed: false,
        moderation_status: "cleared",
      },
      nextState: {
        is_removed: true,
        moderation_status: "removed",
      },
      rollbackFields: ["is_removed", "moderation_status", "last_moderated_at"],
      syncImage: async () => {
        throw new Error("Media service unreachable");
      },
    }),
    /Media service unreachable/,
  );

  assert.deepEqual(calls, [
    [
      { post_id: "post_1" },
      { $set: { is_removed: true, moderation_status: "removed" } },
    ],
    [
      { post_id: "post_1" },
      {
        $set: { is_removed: false, moderation_status: "cleared" },
        $unset: { last_moderated_at: "" },
      },
    ],
  ]);
});
