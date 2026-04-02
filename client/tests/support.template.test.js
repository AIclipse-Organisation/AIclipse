const fs = require("fs");
const path = require("path");

describe("support page template contract", () => {
  const contactHtml = fs.readFileSync(path.join(__dirname, "../templates/pages/support/contact.html"), "utf8");
  const devHtml = fs.readFileSync(path.join(__dirname, "../templates/pages/support/dev.html"), "utf8");
  const loginHtml = fs.readFileSync(path.join(__dirname, "../templates/pages/public/login.html"), "utf8");

  test("contact page does not load an empty page-specific script", () => {
    expect(contactHtml).not.toMatch(/asset_url\('js\/pages\/support\/contact\.js'\)/);
    expect(contactHtml).toMatch(/asset_url\('js\/core\/app\.js'\)/);
  });

  test("dev page relies on shared auth ui rather than a dedicated chip script", () => {
    expect(devHtml).not.toMatch(/asset_url\('js\/core\/current-user-chip\.js'\)/);
    expect(devHtml).toMatch(/asset_url\('js\/pages\/support\/dev\.js'\)/);
    expect(devHtml).toMatch(/asset_url\('js\/core\/status\.js'\)/);
  });

  test("login page loads http runtime before auth screen helpers", () => {
    expect(loginHtml).toMatch(/<script src="\{\{ asset_url\('js\/core\/app\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/core\/http\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/core\/status\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/core\/auth-screen-helpers\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/core\/auth-screen\.js'\) \}\}"><\/script>/);
  });

  test("docs page loads shared status runtime before support scripts", () => {
    expect(fs.readFileSync(path.join(__dirname, "../templates/pages/support/docs.html"), "utf8")).toMatch(/<script src="\{\{ asset_url\('js\/core\/status\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/pages\/support\/shared\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/pages\/support\/docs\.js'\) \}\}"><\/script>/);
  });
});
