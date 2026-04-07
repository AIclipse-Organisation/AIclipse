import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchPublicImagesByIds,
  resolveRenderableItemsWithPublicImages,
} from "../app/lib/publicImages.js";

test("resolveRenderableItemsWithPublicImages preserves ranked order and reports missing image payloads", () => {
  const items = [
    { post_id: "post_1", image_id: "img_missing", description: "first" },
    { post_id: "post_2", image_id: "img_ok", description: "second" },
    { post_id: "post_3", image_id: "img_other", description: "third" },
  ];

  const imageItems = [
    { image_id: "img_other", url: "https://cdn.test/img_other.png", verdict: "ok" },
    { image_id: "img_ok", url: "https://cdn.test/img_ok.png", verdict: "ok" },
  ];

  assert.deepEqual(resolveRenderableItemsWithPublicImages(items, imageItems), {
    items: [
      {
        post_id: "post_2",
        image_id: "img_ok",
        description: "second",
        url: "https://cdn.test/img_ok.png",
        verdict: "ok",
      },
      {
        post_id: "post_3",
        image_id: "img_other",
        description: "third",
        url: "https://cdn.test/img_other.png",
        verdict: "ok",
      },
    ],
    missingImageIds: ["img_missing"],
  });
});

test("resolveRenderableItemsWithPublicImages merges all resolved items in order", () => {
  const items = [
    { post_id: "post_2", image_id: "img_ok", description: "second" },
    { post_id: "post_3", image_id: "img_other", description: "third" },
  ];
  const imageItems = [
    { image_id: "img_other", url: "https://cdn.test/img_other.png", verdict: "ok" },
    { image_id: "img_ok", url: "https://cdn.test/img_ok.png", verdict: "ok" },
  ];

  assert.deepEqual(resolveRenderableItemsWithPublicImages(items, imageItems), {
    items: [
      {
        post_id: "post_2",
        image_id: "img_ok",
        description: "second",
        url: "https://cdn.test/img_ok.png",
        verdict: "ok",
      },
      {
        post_id: "post_3",
        image_id: "img_other",
        description: "third",
        url: "https://cdn.test/img_other.png",
        verdict: "ok",
      },
    ],
    missingImageIds: [],
  });
});

test("fetchPublicImagesByIds maps gateway timeouts to bounded lookup errors", async () => {
  process.env.GATEWAY_URI = "http://gateway.test";
  process.env.INTERNAL_AUTH_TOKEN = "secret";

  const originalFetch = global.fetch;
  global.fetch = async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  };

  try {
    await assert.rejects(
      fetchPublicImagesByIds(["img_1"]),
      (error) => {
        assert.equal(error.status, 504);
        assert.match(error.message, /timed out/i);
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
    delete process.env.GATEWAY_URI;
    delete process.env.INTERNAL_AUTH_TOKEN;
  }
});
