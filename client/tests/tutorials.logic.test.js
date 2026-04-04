const fs = require("fs");
const path = require("path");

const {
  shouldAutoLoadTutorials,
} = require("../static/js/tutorials/loader.js");
const {
  shouldShowTutorialWelcome,
  shouldHandleTutorialEmit,
  isRenderableTutorialRect,
} = require("../static/js/tutorials/core.js");
const {
  QUICK_START_SELECTORS,
} = require("../static/js/tutorials/modules/quick-start.js");

describe("tutorial runtime contract", () => {
  test("auto-loads tutorials on tutorial-capable pages without waiting for existing runtime", () => {
    expect(shouldAutoLoadTutorials({ pathname: "/upload" })).toBe(true);
    expect(shouldAutoLoadTutorials({ pathname: "/results" })).toBe(true);
    expect(shouldAutoLoadTutorials({ pathname: "/profile" })).toBe(true);
  });

  test("does not auto-load tutorials on unrelated pages without runtime or explicit params", () => {
    expect(shouldAutoLoadTutorials({ pathname: "/contact" })).toBe(false);
  });

  test("welcome card stays hidden when quick start is server-suppressed", () => {
    expect(
      shouldShowTutorialWelcome({
        pageId: "upload",
        welcomeSeenVersion: 0,
        version: 1,
        activeModuleId: null,
        quickStartDismissed: true,
      }),
    ).toBe(false);
  });

  test("paused tutorials do not resume themselves from emitted page events", () => {
    expect(
      shouldHandleTutorialEmit({
        runtime: { moduleId: "quick_start", paused: true },
        step: { completeEvent: "upload-file-selected" },
        eventName: "upload-file-selected",
      }),
    ).toBe(false);
  });

  test("offscreen targets are not treated as renderable tutorial anchors", () => {
    expect(
      isRenderableTutorialRect(
        { left: -280, top: 0, right: 0, bottom: 400, width: 280, height: 400 },
        1280,
        720,
      ),
    ).toBe(false);
  });
});

describe("quick start selector contract", () => {
  const resultsHtml = fs.readFileSync(
    path.join(__dirname, "../templates/pages/detection/results.html"),
    "utf8",
  );
  const profileHtml = fs.readFileSync(
    path.join(__dirname, "../templates/pages/profile/profile.html"),
    "utf8",
  );
  const tutorialCss = fs.readFileSync(
    path.join(__dirname, "../static/css/tutorials/tutorial.css"),
    "utf8",
  );
  const topbarHtml = fs.readFileSync(
    path.join(__dirname, "../templates/partials/navigation/topbar.html"),
    "utf8",
  );

  test("quick start module targets the redesigned results DOM", () => {
    expect(QUICK_START_SELECTORS.resultsConfidenceBar).toBe(".comm_progressPanel");
    expect(QUICK_START_SELECTORS.resultsVisibilityToggle).toBe(".res-toggle");
    expect(resultsHtml).toContain('class="comm_progressPanel"');
    expect(resultsHtml).toContain('class="res-toggle"');
  });

  test("quick start no longer includes the removed results overview step", () => {
    expect(QUICK_START_SELECTORS.resultsOverview).toBeUndefined();
  });

  test("profile page loads the tutorial runtime so cross-page tutorials can resume", () => {
    expect(profileHtml).toMatch(/asset_url\('js\/tutorials\/loader\.js'\)/);
  });

  test("final quick start step cleans up the opened drawer after the tutorial ends", () => {
    const quickStartSource = fs.readFileSync(
      path.join(__dirname, "../static/js/tutorials/modules/quick-start.js"),
      "utf8",
    );

    expect(quickStartSource).toMatch(/function closeDrawer\(/);
    expect(quickStartSource).toMatch(/cleanup: closeDrawer/);
  });

  test("tutorial elevated state does not override fixed positioning for the nav drawer", () => {
    expect(tutorialCss).toMatch(/\.aiclipse-tutorial-elevated\s*\{/);
    expect(tutorialCss).not.toMatch(/\.aiclipse-tutorial-elevated\s*\{[^}]*position:\s*relative/i);
  });

  test("topbar bootstraps the server-owned quick start suppression flag", () => {
    expect(topbarHtml).toMatch(/data-quick-start-suppressed="/);
  });
});
