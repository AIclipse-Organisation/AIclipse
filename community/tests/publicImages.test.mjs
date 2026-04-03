import test from "node:test";
import assert from "node:assert/strict";
import { mergeItemsWithPublicImages } from "../app/lib/publicImages.js";

test("mergeItemsWithPublicImages preserves ranked order and filters items without resolved image", () => {
  const items = [
    { post_id: "post_1", image_id: "img_missing", description: "first" },
    { post_id: "post_2", image_id: "img_ok", description: "second" },
    { post_id: "post_3", image_id: "img_other", description: "third" },
  ];

  const imageItems = [
    { image_id: "img_other", url: "https://cdn.test/img_other.png", verdict: "ok" },
    { image_id: "img_ok", url: "https://cdn.test/img_ok.png", verdict: "ok" },
  ];

  assert.deepEqual(
    mergeItemsWithPublicImages(items, imageItems),
    [
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
  );
});
