const fs = require("fs");
const path = require("path");

describe("detection flow template contract", () => {
  const uploadHtml = fs.readFileSync(path.join(__dirname, "../templates/pages/detection/upload.html"), "utf8");
  const resultsHtml = fs.readFileSync(path.join(__dirname, "../templates/pages/detection/results.html"), "utf8");

  function expectScriptOrder(html, paths) {
    let lastIndex = -1;
    for (const scriptPath of paths) {
      const marker = `asset_url('${scriptPath}')`;
      const index = html.indexOf(marker);
      expect(index).toBeGreaterThan(lastIndex);
      lastIndex = index;
    }
  }

  test("upload page loads shared detection flow scripts before upload bootstrap", () => {
    expectScriptOrder(uploadHtml, [
      "js/core/http.js",
      "js/core/status.js",
      "js/flows/detection/store.js",
      "js/flows/detection/shared.js",
      "js/flows/detection/upload-page.js",
      "js/pages/detection/upload.js",
    ]);
  });

  test("results page loads results-specific detection flow scripts without upload runtime", () => {
    expectScriptOrder(resultsHtml, [
      "js/core/http.js",
      "js/core/status.js",
      "js/flows/detection/store.js",
      "js/flows/detection/shared.js",
      "js/flows/detection/results-page.js",
      "js/pages/detection/results.js",
    ]);
    expect(resultsHtml).not.toMatch(/<script src="\{\{ asset_url\('js\/pages\/detection\/upload\.js'\) \}\}"><\/script>/);
  });

  test("results page bootstraps viewer context from the server", () => {
    expect(resultsHtml).toMatch(/id="results-bootstrap"/);
    expect(resultsHtml).toMatch(/data-user-id="\{\{ initial_results_viewer\.get\('user_id', ''\) if initial_results_viewer else '' \}\}"/);
  });

  test("results page uses its own stylesheet instead of upload or viewscan bundles", () => {
    expect(resultsHtml).toMatch(/<link rel="stylesheet" href="\{\{ asset_url\('css\/pages\/detection\/results\.css'\) \}\}" \/>/);
    expect(resultsHtml).not.toMatch(/asset_url\('css\/pages\/detection\/upload\.css'\)/);
    expect(resultsHtml).not.toMatch(/asset_url\('css\/pages\/library\/viewscan\/page\.css'\)/);
  });

  test("results template does not rely on inline style attributes", () => {
    expect(resultsHtml).not.toMatch(/style="/);
  });
});
