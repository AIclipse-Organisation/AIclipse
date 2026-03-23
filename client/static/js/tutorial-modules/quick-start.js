(function registerQuickStartTutorial() {
  const registry = window.AIclipseTutorialRegistry;
  if (!registry || typeof registry.registerModule !== "function") return;

  registry.registerModule({
    id: "quick_start",
    title: "Quick start",
    description:
      "Learn the full private scan flow: choose an image, understand the result, and save it privately.",
    steps: [
      {
        id: "quick-start-upload-intro",
        pageId: "upload",
        selector: ".upload-content",
        title: "This is where every scan starts",
        body: [
          "You begin by choosing one image, checking the crop, and then sending that cropped view for analysis.",
          "Use this first walkthrough to learn the flow, not to prove a final truth. AIclipse gives you a probability signal, so the habit to build is review first, then decide whether to save or share.",
        ],
        nextLabel: "Next",
        allowTargetClick: false,
      },
      {
        id: "quick-start-choose-image",
        pageId: "upload",
        selector: "label.file-upload",
        title: "Choose one image to inspect",
        body: [
          "Open your file picker and select a clear image. A strong first test is one where the face or edited area is easy to see.",
          "Why this matters: the detector can only judge what you give it. If the important area is tiny, blurry, or cropped out, the result becomes less useful.",
        ],
        completeEvent: "upload-choose-image-clicked",
        allowTargetClick: true,
      },
      {
        id: "quick-start-disclaimer",
        pageId: "upload",
        selector: "#disclaimer-agree",
        title: "Read why consent appears before processing",
        body: [
          "Before AIclipse processes an image, it explains how the file is handled. This is here so you understand what is analyzed, when data is stored, and what changes if you later choose to post publicly.",
          "Tap I agree to continue with the tutorial.",
        ],
        completeEvent: "upload-disclaimer-agreed",
        allowTargetClick: true,
      },
      {
        id: "quick-start-file-picker",
        pageId: "upload",
        selector: null,
        title: "Pick one file from your device",
        body: [
          "Your device file picker is open now. Choose one image to continue.",
          "For a first test, use a single clear image rather than a collage, screenshot strip, or very compressed file. That makes the result easier to interpret.",
        ],
        completeEvent: "upload-file-selected",
        allowTargetClick: false,
      },
      {
        id: "quick-start-crop",
        pageId: "upload",
        selector: "#upload-frame",
        title: "Adjust what the model will actually inspect",
        body: [
          "This square is the exact view that will be analyzed. Drag the image until the most important area sits well inside the frame.",
          "You are not editing the original file here. You are only deciding which part AIclipse should inspect first. If the framing looks wrong, reset it and try again.",
        ],
        nextLabel: "Next",
        allowTargetClick: false,
      },
      {
        id: "quick-start-analyze",
        pageId: "upload",
        selector: "#btn-check",
        title: "Run the scan",
        body: [
          "When the crop looks right, start the scan.",
          "From here, AIclipse analyzes the cropped image and prepares a result screen where you can review the signal before deciding what to do next.",
        ],
        completeEvent: "scan-analysis-success",
        allowTargetClick: true,
      },
      {
        id: "quick-start-results-overview",
        pageId: "results",
        selector: "#detect-card",
        title: "Treat the result as evidence, not as absolute truth",
        body: [
          "This card summarizes the detector's judgment for the scan you just ran.",
          "A strong result can guide your next step, but good practice is to combine it with context: where the image came from, whether it was re-shared many times, and whether visual artifacts support the score.",
        ],
        nextLabel: "Next",
        allowTargetClick: false,
      },
      {
        id: "quick-start-confidence-bar",
        pageId: "results",
        selector: ".progress-panel",
        title: "What the probability bar actually means",
        body: [
          "The bar shows how strongly the model leans toward AI-generated content for this scan.",
          "High confidence does not mean certainty, and lower confidence does not mean the image is safe. It means the signal is weaker, so interpretation should be more careful.",
        ],
        nextLabel: "Next",
        allowTargetClick: false,
      },
      {
        id: "quick-start-private-mode",
        pageId: "results",
        selector: ".visibility-selector",
        title: "Keep your first scan private",
        body: [
          "For this walkthrough, stay in Private mode. Private is the safer default when you are still learning how to read the result or when the image may be sensitive.",
          "You can always publish a later scan, but starting private helps you review before exposing anything to the community.",
        ],
        nextLabel: "Next",
        allowTargetClick: false,
        beforeShow() {
          const savePublic = document.getElementById("save-public");
          if (!savePublic || savePublic.checked !== true) return null;

          return {
            selector: "#mode-private",
            title: "Switch back to Private before saving",
            body: [
              "This tutorial follows the private flow, so change the visibility back to Private now.",
              "Why: Public is for community posts. Private saves the scan only to your profile, which is the better default for a first run or for sensitive images.",
            ],
            completeEvent: "results-private-selected",
            advanceOnComplete: false,
            allowTargetClick: true,
          };
        },
      },
      {
        id: "quick-start-save",
        pageId: "results",
        selector: "#btn-save",
        title: "Save the scan to your profile",
        body: [
          "Now save the scan. This stores the result in your account so you can return to it later.",
          "Because this flow stays private, the action saves the scan for you only and does not publish anything to the Community feed.",
        ],
        completeEvent: "private-save-success",
        allowTargetClick: true,
      },
      {
        id: "quick-start-profile",
        pageId: "profile",
        selector: "#scans-container",
        title: "This is where you find saved scans later",
        body: [
          "Your saved scans live here. Use this area to review past results, compare images, or come back later before deciding whether anything should be shared more widely.",
          "You have finished the quick start.",
        ],
        nextLabel: "Finish",
        allowTargetClick: false,
      },
    ],
  });
})();