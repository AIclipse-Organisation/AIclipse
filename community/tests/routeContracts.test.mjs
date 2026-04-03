import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("public and internal posts routes use distinct auth helpers", () => {
  const publicPostsRoute = readRepoFile("app/posts/route.js");
  const internalPostsRoute = readRepoFile("app/internal/posts/route.js");

  assert.match(publicPostsRoute, /getBrowserUser/);
  assert.match(publicPostsRoute, /getOptionalBrowserUser/);
  assert.doesNotMatch(publicPostsRoute, /getForwardedUser/);

  assert.match(internalPostsRoute, /getForwardedUser/);
  assert.match(internalPostsRoute, /getOptionalForwardedUser/);
  assert.doesNotMatch(internalPostsRoute, /getBrowserUser/);
});

test("community UI does not use the legacy standalone images feed", () => {
  const feedPage = readRepoFile("app/page.jsx");
  const profileGrid = readRepoFile("app/profile/[userId]/ProfilePostsGrid.jsx");
  const reportedPostsList = readRepoFile("app/admin/components/ReportedPostsList.jsx");

  assert.doesNotMatch(feedPage, /\/community\/images/);
  assert.doesNotMatch(profileGrid, /\/community\/images/);
  assert.doesNotMatch(reportedPostsList, /\/community\/images/);
});

test("legacy public images proxy route is removed", () => {
  assert.equal(
    fs.existsSync(path.join(repoRoot, "app/images/route.js")),
    false,
  );
});

test("community routes do not read raw images collection directly", () => {
  const postsRoute = readRepoFile("app/lib/routes/postsRoute.js");
  const reportRoute = readRepoFile("app/lib/routes/reportRoute.js");

  assert.doesNotMatch(postsRoute, /collection\("images"\)/);
  assert.doesNotMatch(reportRoute, /collection\("images"\)/);
  assert.match(postsRoute, /fetchPublicImagesByIds/);
  assert.match(reportRoute, /fetchPublicImagesByIds/);
});
