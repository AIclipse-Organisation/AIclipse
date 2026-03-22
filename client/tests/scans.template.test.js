const fs = require("fs");
const path = require("path");

// If key ids/classes disappear, the page JS can break at runtime.
describe("scans HTML template contract", () => {
  const templatePath = path.join(__dirname, "../templates/scans.html");
  const html = fs.readFileSync(templatePath, "utf8");

  // scans.js writes status messages and renders cards into these elements.
  test("contains scans status and container elements", () => {
    expect(html).toMatch(/id=\"scans-status\"/);
    expect(html).toMatch(/id=\"scans-container\"/);
    expect(html).toMatch(/class=\"scans-grid\"/);
  });

  // Ensures the scans page actually loads the script that renders data.
  test("loads scans page script", () => {
    expect(html).toMatch(/<script src=\"\/static\/js\/scans\.js\"><\/script>/);
  });
});
