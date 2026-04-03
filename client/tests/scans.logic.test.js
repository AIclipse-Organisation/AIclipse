const {
  buildViewscanUrl,
  getVisibility,
} = require("../static/js/pages/library/scans.js");

describe("client scans JavaScript logic", () => {
  test("getVisibility returns public/private and defaults to private", () => {
    expect(getVisibility({ is_public: true })).toBe("public");
    expect(getVisibility({ is_public: false })).toBe("private");
    expect(getVisibility({})).toBe("private");
    expect(getVisibility(null)).toBe("private");
  });

  test("buildViewscanUrl uses image id as the canonical routing key", () => {
    expect(
      buildViewscanUrl({ image_id: "img_123" }, "http://aiclipse.local")
    ).toBe("http://aiclipse.local/viewscan/img_123");
  });

  test("buildViewscanUrl preserves mark_post_id only when a post exists", () => {
    expect(
      buildViewscanUrl(
        { image_id: "img_123", post_id: "post_9" },
        "http://aiclipse.local"
      )
    ).toBe("http://aiclipse.local/viewscan/img_123?from=scans&mark_post_id=post_9");
  });

  test("buildViewscanUrl returns null for missing image id", () => {
    expect(buildViewscanUrl({}, "http://aiclipse.local")).toBeNull();
  });
});
