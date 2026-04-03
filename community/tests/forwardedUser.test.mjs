import test from "node:test";
import assert from "node:assert/strict";

import { readForwardedTrustedUser } from "../app/lib/forwardedUser.js";

function makeHeaders(values) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    get(name) {
      return normalized.get(String(name).toLowerCase()) ?? null;
    },
  };
}

test("reads trusted forwarded user when internal token matches", () => {
  const user = readForwardedTrustedUser(
    makeHeaders({
      "x-internal-token": "internal-secret",
      "x-user-id": "u_123",
      "x-user-email": "user@example.com",
      "x-user-name": "Roma",
      "x-user-is-admin": "true",
    }),
    "internal-secret",
  );

  assert.deepEqual(user, {
    user_id: "u_123",
    email: "user@example.com",
    user_name: "Roma",
    is_admin: true,
  });
});

test("rejects forwarded identity when token mismatches or user id is missing", () => {
  assert.equal(
    readForwardedTrustedUser(
      makeHeaders({
        "x-internal-token": "wrong",
        "x-user-id": "u_123",
      }),
      "internal-secret",
    ),
    null,
  );

  assert.equal(
    readForwardedTrustedUser(
      makeHeaders({
        "x-internal-token": "internal-secret",
      }),
      "internal-secret",
    ),
    null,
  );
});
