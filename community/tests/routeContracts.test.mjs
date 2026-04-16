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

test("public and internal click routes use distinct auth helpers", () => {
  const publicClickRoute = readRepoFile("app/posts/click/route.js");
  const internalClickRoute = readRepoFile("app/internal/posts/click/route.js");
  const clickRoute = readRepoFile("app/lib/routes/clickRoute.js");

  assert.match(publicClickRoute, /getBrowserUser/);
  assert.doesNotMatch(publicClickRoute, /getForwardedUser/);

  assert.match(internalClickRoute, /getForwardedUser/);
  assert.doesNotMatch(internalClickRoute, /getBrowserUser/);

  assert.doesNotMatch(clickRoute, /body\?\.user_id/);
  assert.match(clickRoute, /authenticatedUserId/);
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

test("community post and moderation routes use canonical gateway image sync helpers", () => {
  const postsRoute = readRepoFile("app/lib/routes/postsRoute.js");
  const reportRoute = readRepoFile("app/lib/routes/reportRoute.js");

  assert.match(postsRoute, /setImageVisibilityOrThrow/);
  assert.match(postsRoute, /deleteImageOrThrow/);
  assert.match(postsRoute, /createPostWithImageSyncOrRollback/);
  assert.match(postsRoute, /updatePostStateWithImageSyncOrRollback/);
  assert.match(reportRoute, /setImageVisibilityOrThrow/);
  assert.match(reportRoute, /updatePostStateWithImageSyncOrRollback/);

  assert.doesNotMatch(postsRoute, /Failed to mark image as public:/);
  assert.doesNotMatch(postsRoute, /Gateway cleanup failed/);
  assert.doesNotMatch(reportRoute, /Gateway Sync Failed/);
});

test("comment and vote routes derive identity from authenticated user instead of request body", () => {
  const commentsRoute = readRepoFile("app/lib/routes/commentsRoute.js");
  const voteRoute = readRepoFile("app/lib/routes/voteRoute.js");
  const postBoxActions = readRepoFile("app/components/post/postBoxActions.js");

  assert.doesNotMatch(commentsRoute, /body\?\.user_id/);
  assert.doesNotMatch(commentsRoute, /body\?\.user_name/);
  assert.match(commentsRoute, /authenticatedUserId/);
  assert.match(commentsRoute, /authenticatedUserName/);

  assert.doesNotMatch(voteRoute, /body\?\.user_id/);
  assert.match(voteRoute, /authenticatedUserId/);

  assert.doesNotMatch(postBoxActions, /user_id:/);
  assert.doesNotMatch(postBoxActions, /user_name:/);
});

test("notification read routes do not perform index or retention maintenance work", () => {
  const notificationsRoute = readRepoFile("app/lib/routes/notificationsRoute.js");

  assert.doesNotMatch(notificationsRoute, /ensureNotificationIndexes/);
  assert.doesNotMatch(notificationsRoute, /trimNotificationRetention/);
  assert.doesNotMatch(notificationsRoute, /capNotificationsForUser/);
});

test("feed route does not use fixed 600/300 candidate limits", () => {
  const postsRoute = readRepoFile("app/lib/routes/postsRoute.js");

  assert.match(postsRoute, /buildFeedCandidateWindow/);
  assert.doesNotMatch(postsRoute, /\.limit\(600\)/);
  assert.doesNotMatch(postsRoute, /\.limit\(300\)/);
});

test("community shell does not reference missing legacy tutorial assets", () => {
  const layout = readRepoFile("app/layout.jsx");

  assert.doesNotMatch(layout, /\/static\/css\/tutorial\.css/);
  assert.doesNotMatch(layout, /\/static\/js\/tutorial-core\.js/);
});

test("community tutorial entry routes to the shared tutorials page", () => {
  const topbar = readRepoFile("app/components/Topbar.jsx");

  assert.match(topbar, /window\.location\.href = "\/tutorials"/);
  assert.doesNotMatch(topbar, /openCenter/);
});

test("admin model uploads use presigned storage flow instead of the legacy multipart proxy", () => {
  const adminService = readRepoFile("app/admin/admin.js");
  const modelsRoute = readRepoFile("app/adminBFF/models/route.js");
  const uploadRoute = readRepoFile("app/adminBFF/models/uploads/route.js");
  const finalizeRoute = readRepoFile("app/adminBFF/models/uploads/finalize/route.js");

  assert.match(adminService, /\/models\/uploads/);
  assert.match(adminService, /\/models\/uploads\/finalize/);
  assert.doesNotMatch(adminService, /fetch\(`\/community\/adminBFF\/models`/);
  assert.doesNotMatch(modelsRoute, /http\.request/);
  assert.match(uploadRoute, /proxyAdminJson/);
  assert.match(finalizeRoute, /proxyAdminJson/);
});
