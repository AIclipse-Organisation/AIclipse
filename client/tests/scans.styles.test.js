const fs = require("fs");
const path = require("path");


describe("scans CSS contract", () => {
  const cssPath = path.join(__dirname, "../static/css/pages/library/scans.css");
  const css = fs.readFileSync(cssPath, "utf8");

  // Core layout and hover behavior should always be present.
  test("has scan card interactions and grid layout selectors", () => {
    expect(css).toContain(".scans-grid");
    expect(css).toContain(".scan-card:hover");
    expect(css).toContain(".scan-row");
  });

  // These selectors support loading skeletons and visibility/moderation badges.
  test("has loading and badge selectors used by the scans script", () => {
    expect(css).toContain("@keyframes shimmer");
    expect(css).toContain(".skeleton-card");
    expect(css).toContain(".scan-visibility-badge");
    expect(css).toContain(".scan-moderation-badge");
  });
});
