import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adminModuleUrl = pathToFileURL(path.join(repoRoot, "app/admin/admin.js")).href;
const { adminService } = await import(adminModuleUrl);

test("adminService.uploadModel creates a session, uploads parts through the BFF, and finalizes", async () => {
  const calls = [];
  const file = new File(["ABCDEFGHI"], "v2.0.1.pt", { type: "application/octet-stream" });

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (String(url) === "/community/adminBFF/models/uploads") {
      return Response.json({
        uploadId: "upload-token",
        uploadMethod: "PUT",
        partSizeBytes: 4,
        totalParts: 3,
        expiresAt: "2026-04-16T12:00:00Z",
      });
    }

    if (String(url) === "/community/adminBFF/models/uploads/parts/1") {
      assert.equal(options.method, "PUT");
      assert.equal(options.headers["X-Upload-Id"], "upload-token");
      assert.equal(await options.body.text(), "ABCD");
      return Response.json({ partNumber: 1 });
    }

    if (String(url) === "/community/adminBFF/models/uploads/parts/2") {
      assert.equal(await options.body.text(), "EFGH");
      return Response.json({ partNumber: 2 });
    }

    if (String(url) === "/community/adminBFF/models/uploads/parts/3") {
      assert.equal(await options.body.text(), "I");
      return Response.json({ partNumber: 3 });
    }

    if (String(url) === "/community/adminBFF/models/uploads/finalize") {
      return Response.json({ id: "mid", version: "v2.0.1", imagesLinked: 0 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const result = await adminService.uploadModel({
    file,
    version: "v2.0.1",
    newImagesCount: 0,
    replayBufferCount: 0,
  });

  assert.equal(result.version, "v2.0.1");
  assert.equal(calls.length, 5);
  assert.equal(calls[0].url, "/community/adminBFF/models/uploads");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[1].url, "/community/adminBFF/models/uploads/parts/1");
  assert.equal(calls[1].options.credentials, "include");
  assert.equal(calls[1].options.method, "PUT");
  assert.equal(calls[2].url, "/community/adminBFF/models/uploads/parts/2");
  assert.equal(calls[2].options.credentials, "include");
  assert.equal(calls[3].url, "/community/adminBFF/models/uploads/parts/3");
  assert.equal(calls[3].options.credentials, "include");
  assert.equal(calls[4].url, "/community/adminBFF/models/uploads/finalize");
  assert.equal(calls[4].options.credentials, "include");

  const finalizePayload = JSON.parse(calls[4].options.body);
  assert.equal(finalizePayload.uploadId, "upload-token");
  assert.equal(finalizePayload.version, "v2.0.1");
  assert.equal(finalizePayload.newImagesCount, 0);
});

test("adminService.uploadModel surfaces part upload failures", async () => {
  const file = new File(["ABCDE"], "v2.0.1.pt", { type: "application/octet-stream" });

  globalThis.fetch = async (url) => {
    if (String(url) === "/community/adminBFF/models/uploads") {
      return Response.json({
        uploadId: "upload-token",
        uploadMethod: "PUT",
        partSizeBytes: 4,
        totalParts: 2,
        expiresAt: "2026-04-16T12:00:00Z",
      });
    }

    if (String(url) === "/community/adminBFF/models/uploads/parts/1") {
      return new Response("too large", { status: 413 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await assert.rejects(
    () => adminService.uploadModel({ file, version: "v2.0.1" }),
    /too large/,
  );
});
