import test from "node:test";
import assert from "node:assert/strict";

import { buildFeedCandidateWindow, mergeFeedItems } from "../app/lib/feedPagination.js";

test("buildFeedCandidateWindow uses a cumulative ranked window instead of overlapping page skips", () => {
  const pageOne = buildFeedCandidateWindow(1, 12);
  const pageTwo = buildFeedCandidateWindow(2, 12);
  const pageNine = buildFeedCandidateWindow(9, 12);

  assert.equal(pageOne.pageOffset, 0);
  assert.equal(pageTwo.pageOffset, 12);
  assert.ok(pageTwo.candidateLimit > pageOne.candidateLimit);
  assert.ok(pageNine.candidateLimit > 96);
  assert.equal(pageOne.fetchLimit, pageOne.candidateLimit + 1);
  assert.equal(pageTwo.fetchLimit, pageTwo.candidateLimit + 1);
});

test("mergeFeedItems preserves order while replacing duplicate post ids in place", () => {
  const existing = [
    { post_id: "post_a", value: "old-a" },
    { post_id: "post_b", value: "old-b" },
  ];
  const incoming = [
    { post_id: "post_b", value: "new-b" },
    { post_id: "post_c", value: "new-c" },
    { post_id: "post_c", value: "newest-c" },
  ];

  assert.deepEqual(mergeFeedItems(existing, incoming), [
    { post_id: "post_a", value: "old-a" },
    { post_id: "post_b", value: "new-b" },
    { post_id: "post_c", value: "newest-c" },
  ]);
});
