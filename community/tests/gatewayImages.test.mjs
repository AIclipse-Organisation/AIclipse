import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteImageOrThrow,
  setImageVisibilityOrThrow,
} from "../app/lib/gatewayImages.js";

const ORIGINAL_ENV = {
  GATEWAY_URI: process.env.GATEWAY_URI,
};

function restoreEnv() {
  if (ORIGINAL_ENV.GATEWAY_URI === undefined) {
    delete process.env.GATEWAY_URI;
  } else {
    process.env.GATEWAY_URI = ORIGINAL_ENV.GATEWAY_URI;
  }
}

test("setImageVisibilityOrThrow sends canonical gateway PATCH request", async () => {
  process.env.GATEWAY_URI = "http://gateway.test";

  const fetchCalls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return new Response(null, { status: 200 });
  };

  try {
    await setImageVisibilityOrThrow({
      imageId: "img_123",
      isPublic: false,
      user: { user_id: "u_1" },
      buildGatewayIdentityHeaders: () => ({
        "Content-Type": "application/json",
        "X-Internal-Token": "secret",
      }),
    });
  } finally {
    global.fetch = originalFetch;
    restoreEnv();
  }

  assert.deepEqual(fetchCalls, [
    {
      url: "http://gateway.test/image/img_123",
      init: {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": "secret",
        },
        body: JSON.stringify({ is_public: false }),
        cache: "no-store",
      },
    },
  ]);
});

test("deleteImageOrThrow surfaces gateway failures instead of swallowing them", async () => {
  process.env.GATEWAY_URI = "http://gateway.test";

  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(JSON.stringify({ detail: "Media service unreachable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });

  try {
    await assert.rejects(
      deleteImageOrThrow({
        imageId: "img_123",
        user: { user_id: "u_1" },
        buildGatewayIdentityHeaders: () => ({
          "Content-Type": "application/json",
          "X-Internal-Token": "secret",
        }),
      }),
      /Media service unreachable/,
    );
  } finally {
    global.fetch = originalFetch;
    restoreEnv();
  }
});
