const fs = require("fs");
const path = require("path");

describe("docs template contract", () => {
  const html = fs.readFileSync(path.join(__dirname, "../templates/pages/support/docs.html"), "utf8");

  test("keeps docs shell and toc in the initial template", () => {
    expect(html).toMatch(/class="docs-shell"/);
    expect(html).toMatch(/class="docs-toc card"/);
    expect(html).toMatch(/href="#quickstart"/);
    expect(html).toMatch(/href="#limits"/);
  });

  test("loads docs content through the support docs script instead of embedding all sections inline", () => {
    expect(html).toMatch(/id="docs-content-status"/);
    expect(html).not.toMatch(/id="code-example-python"/);
    expect(html).toMatch(/<script src="\{\{ asset_url\('js\/pages\/support\/docs\.js'\) \}\}"><\/script>/);
  });
});
