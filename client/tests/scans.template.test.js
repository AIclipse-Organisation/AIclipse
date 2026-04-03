const fs = require("fs");
const path = require("path");

// If key ids/classes disappear, the page JS can break at runtime.
describe("scans HTML template contract", () => {
  const templatePath = path.join(__dirname, "../templates/pages/library/scans.html");
  const html = fs.readFileSync(templatePath, "utf8");
  const profileHtml = fs.readFileSync(path.join(__dirname, "../templates/pages/profile/profile.html"), "utf8");

  // scans.js writes status messages and renders cards into these elements.
  test("contains scans status and container elements", () => {
    expect(html).toMatch(/id=\"scans-status\"/);
    expect(html).toMatch(/id=\"scans-container\"/);
    expect(html).toMatch(/class=\"scans-grid\"/);
  });

  // Ensures the scans page actually loads the script that renders data.
  test("loads scans page script", () => {
    expect(html).toMatch(/<script src="\{\{ asset_url\('js\/pages\/library\/scans\.js'\) \}\}"><\/script>/);
  });

  test("profile page keeps scans rendering client-driven instead of inlining a scans bootstrap model", () => {
    expect(profileHtml).not.toMatch(/id="scans-page-model"/);
    expect(profileHtml).toMatch(/id="scans-container"/);
    expect(profileHtml).toMatch(/asset_url\('js\/pages\/library\/scans\.js'\)/);
  });
});
