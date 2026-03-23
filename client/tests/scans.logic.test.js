const {
  getVisibility,
  clamp01,
  cleanLabelText,
  computeRealPct,
} = require("../static/js/scans.js");

// These tests validate the core scan-page helper logic.
describe("client scans JavaScript logic", () => {
  // We show private/public badges based on this value so we need to test a safe default matters.
  test("getVisibility returns public/private and defaults to private", () => {
    expect(getVisibility({ is_public: true })).toBe("public");
    expect(getVisibility({ is_public: false })).toBe("private");
    expect(getVisibility({})).toBe("private");
    expect(getVisibility(null)).toBe("private");
  });

  // Confidence values should always stay in the valid probability range.
  test("clamp01 keeps values in 0..1", () => {
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01("bad")).toBe(0);
  });

  // Labels sometimes arrive with a leading percentage (e.g., "87% AI").
  // This helper removes that prefix so UI text is cleaner.
  test("cleanLabelText strips leading percent prefix", () => {
    expect(cleanLabelText("87.74% AI Generated")).toBe("AI Generated");
    expect(cleanLabelText("  12%   REAL")).toBe("REAL");
    expect(cleanLabelText("Unknown")).toBe("Unknown");
  });

  // Null/empty input should not throw and should produce empty text.
  test("cleanLabelText handles empty-like values safely", () => {
    expect(cleanLabelText("")).toBe("");
    expect(cleanLabelText(null)).toBe("");
    expect(cleanLabelText(undefined)).toBe("");
  });

  // For AI-like verdicts, "real %" is the inverse of model confidence.
  test("computeRealPct computes real percentage for AI-like verdicts", () => {
    const out = computeRealPct({ label: "AI Generated", confidence: 0.8 });
    expect(out.label).toBe("AI Generated");
    expect(out.realPct).toBe("20.00");
  });

  // For a Real verdict, real % follows the confidence directly.
  test("computeRealPct computes real percentage for real verdicts", () => {
    const out = computeRealPct({ label: "Real", confidence: 0.91 });
    expect(out.label).toBe("Real");
    expect(out.realPct).toBe("91.00");
  });

  // Some responses send score instead of confidence.
  // This checks the fallback path still computes correct output.
  test("computeRealPct falls back to score when confidence is missing", () => {
    const out = computeRealPct({ result: "Deepfake", score: 0.33 });
    expect(out.label).toBe("Deepfake");
    expect(out.realPct).toBe("67.00");
  });

  // Unknown labels are treated as AI-like by current product logic.
  test("computeRealPct treats unknown verdict as inverse confidence", () => {
    const out = computeRealPct({ label: "Maybe", confidence: 0.4 });
    expect(out.label).toBe("Maybe");
    expect(out.realPct).toBe("60.00");
  });

  // Inputs outside [0,1] are clamped before computing percentages.
  test("computeRealPct clamps out-of-range confidence values", () => {
    const tooHigh = computeRealPct({ label: "Real", confidence: 2 });
    const tooLow = computeRealPct({ label: "AI", confidence: -1 });

    expect(tooHigh.realPct).toBe("100.00");
    expect(tooLow.realPct).toBe("100.00");
  });

  // Leading percent text should be removed before label classification.
  test("computeRealPct classifies using cleaned label text", () => {
    const out = computeRealPct({ label: "75% REAL", confidence: 0.25 });
    expect(out.label).toBe("REAL");
    expect(out.realPct).toBe("25.00");
  });

  // With no label/result and no confidence/score, function should stay stable.
  test("computeRealPct defaults to Unknown and safe numeric output", () => {
    const out = computeRealPct({});
    expect(out.label).toBe("Unknown");
    expect(out.realPct).toBe("100.00");
  });
});
