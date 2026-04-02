const fs = require("fs");
const path = require("path");

describe("viewscan template contract", () => {
  const templatePath = path.join(__dirname, "../templates/pages/library/viewscan.html");
  const html = fs.readFileSync(templatePath, "utf8");

  test("bootstraps canonical image id marker", () => {
    expect(html).toMatch(/id="viewscan-bootstrap"/);
    expect(html).toMatch(/data-image-id="\{\{ initial_image_id or '' \}\}"/);
  });

  test("embeds optional server-composed page model bootstrap", () => {
    expect(html).toMatch(/id="viewscan-page-model"/);
    expect(html).toMatch(/\{\{ initial_viewscan_page_model\|default\(None\)\|tojson \}\}/);
  });

  test("loads split viewscan scripts in dependency order", () => {
    expect(html).toMatch(/<script src="\{\{ asset_url\('js\/pages\/library\/viewscan\/model\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/pages\/library\/viewscan\/comments\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/pages\/library\/viewscan\/actions\.js'\) \}\}"><\/script>\s*<script src="\{\{ asset_url\('js\/pages\/library\/viewscan\/index\.js'\) \}\}"><\/script>/);
  });
});
