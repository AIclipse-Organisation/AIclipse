const fs = require("fs");
const path = require("path");

describe("detection flow template contract", () => {
  const uploadHtml = fs.readFileSync(path.join(__dirname, "../templates/pages/detection/upload.html"), "utf8");
  const resultsHtml = fs.readFileSync(path.join(__dirname, "../templates/pages/detection/results.html"), "utf8");

  test("upload page loads shared detection flow scripts before upload bootstrap", () => {
    expect(uploadHtml).toMatch(/<script src="\{\{ asset_url\('js\/core\/http\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/core\/status\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/flows\/detection\/store\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/flows\/detection\/shared\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/flows\/detection\/upload-page\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/pages\/detection\/upload\.js'\) \}\}"><\/script>/);
  });

  test("results page loads results-specific detection flow scripts without upload runtime", () => {
    expect(resultsHtml).toMatch(/<script src="\{\{ asset_url\('js\/core\/http\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/core\/status\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/flows\/detection\/store\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/flows\/detection\/shared\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/flows\/detection\/results-page\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/pages\/detection\/results\.js'\) \}\}"><\/script>/);
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
});
