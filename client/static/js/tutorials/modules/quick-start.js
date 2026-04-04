const QUICK_START_SELECTORS = Object.freeze({
  chooseImage: "label.file-upload",
  disclaimerText: "#disclaimer-modal .modal-text--disclaimer",
  disclaimerAgree: "#disclaimer-agree",
  uploadFrame: "#upload-frame",
  analyzeButton: "#btn-check",
  resultsConfidenceBar: ".comm_progressPanel",
  resultsVisibilityToggle: ".res-toggle",
  resultsPrivateModeButton: "#mode-private",
  resultsSaveButton: "#btn-save",
  profileScans: "#scans-container",
  tutorialsShortcut: '#nav-drawer a[href="/tutorials"]',
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    QUICK_START_SELECTORS,
  };
}

if (typeof window !== "undefined") {
  (function registerQuickStartTutorial() {
    const registry = window.AIclipseTutorialRegistry;
    if (!registry || typeof registry.registerModule !== "function") return;

    function getCheckStateText() {
      const el = document.getElementById("check-state");
      return (el?.textContent || "").trim().toLowerCase();
    }

    function isTooLargeState() {
      const text = getCheckStateText();
      if (!text) return false;

      return (
        text.includes("too large") ||
        text.includes("max allowed") ||
        (text.includes("large") && text.includes("mb"))
      );
    }

    function hasSelectedValidImage() {
      if (isTooLargeState()) return false;

      const fileInput = document.getElementById("file-input");
      if (fileInput?.files?.length) return true;
      if (window.lastFile) return true;

      const previewWrap = document.getElementById("upload-preview-wrap");
      const previewImage = document.getElementById("preview-image");

      return !!previewImage?.getAttribute("src") && previewWrap?.hidden === false;
    }

    function isPrivateSelected() {
      const savePublic = document.getElementById("save-public");
      if (!savePublic) return true;
      return !savePublic.checked;
    }

    function openDrawer() {
      if (window.AIclipseNavDrawer && typeof window.AIclipseNavDrawer.open === "function") {
        window.AIclipseNavDrawer.open();
        return;
      }

      const drawer = document.getElementById("nav-drawer");
      const overlay = document.getElementById("menu-overlay");

      if (drawer) drawer.classList.add("active");
      if (overlay) overlay.hidden = false;
    }

    function closeDrawer() {
      if (window.AIclipseNavDrawer && typeof window.AIclipseNavDrawer.close === "function") {
        window.AIclipseNavDrawer.close();
        return;
      }

      const drawer = document.getElementById("nav-drawer");
      const overlay = document.getElementById("menu-overlay");

      if (drawer) drawer.classList.remove("active");
      if (overlay) overlay.hidden = true;
    }

    registry.registerModule({
      id: "quick_start",
      title: "Quick start",
      description: "Learn the private scan flow from upload to saved scans.",
      steps: [
        {
          id: "quick-start-choose-image",
          pageId: "upload",
          selector: QUICK_START_SELECTORS.chooseImage,
          title: "",
          body: ["Choose an image you want to scan."],
          completeEvent: "upload-choose-image-clicked",
          allowTargetClick: true,
          isSatisfied() {
            return hasSelectedValidImage();
          },
        },
        {
          id: "quick-start-disclaimer-read",
          pageId: "upload",
          selector: QUICK_START_SELECTORS.disclaimerText,
          title: "",
          body: [
            "Read this note before scanning. You can open the full terms here if you want more detail, and you can continue only if you agree.",
          ],
          nextLabel: "Next",
          allowTargetClick: false,
          allowDirectInteraction: true,
        },
        {
          id: "quick-start-disclaimer",
          pageId: "upload",
          selector: QUICK_START_SELECTORS.disclaimerAgree,
          title: "",
          body: ["If everything is clear, agree to continue with the scan."],
          completeEvent: "upload-disclaimer-agreed",
          allowTargetClick: true,
          isSatisfied() {
            return hasSelectedValidImage();
          },
        },
        {
          id: "quick-start-file-picker",
          pageId: "upload",
          selector: null,
          title: "",
          body: ["Choose an image you want to scan."],
          completeEvent: "upload-file-selected",
          allowTargetClick: false,
          isSatisfied() {
            return hasSelectedValidImage();
          },
          beforeShow() {
            if (!isTooLargeState()) return null;

            return {
              id: "quick-start-file-too-large",
              selector: ".upload-actions",
              hitTargetSelector: QUICK_START_SELECTORS.chooseImage,
              title: "",
              body: ["This image is too large, so choose a smaller one to continue."],
              completeEvent: "upload-file-selected",
              allowTargetClick: true,
            };
          },
        },
        {
          id: "quick-start-crop",
          pageId: "upload",
          selector: QUICK_START_SELECTORS.uploadFrame,
          title: "",
          body: [
            "You can see the image you selected. During normal use, you can adjust the crop and drag the image to set its position before sending it for scanning. During this tutorial, those controls are locked.",
          ],
          nextLabel: "Next",
          allowTargetClick: false,
        },
        {
          id: "quick-start-analyze",
          pageId: "upload",
          selector: QUICK_START_SELECTORS.analyzeButton,
          title: "",
          body: ["Click `Analyze Image` to see the result."],
          completeEvent: "scan-analysis-success",
          allowTargetClick: true,
        },
        {
          id: "quick-start-confidence-bar",
          pageId: "results",
          selector: QUICK_START_SELECTORS.resultsConfidenceBar,
          title: "",
          body: [
            "The higher the score, the more confident the detector is that the image was AI-generated. The lower the score, the more confident it is that the image is real.",
          ],
          nextLabel: "Next",
          allowTargetClick: false,
        },
        {
          id: "quick-start-private-mode",
          pageId: "results",
          selector: QUICK_START_SELECTORS.resultsVisibilityToggle,
          title: "",
          body: [
            "Use this switch to choose the image visibility: `Private` or `Public`. It is `Private` by default, and we will keep it private for this walkthrough.",
          ],
          nextLabel: "Next",
          allowTargetClick: false,
          beforeShow() {
            if (isPrivateSelected()) return null;

            return {
              id: "quick-start-private-mode-fix",
              selector: QUICK_START_SELECTORS.resultsPrivateModeButton,
              title: "",
              body: [
                "Switch back to `Private`, because this walkthrough follows the private flow.",
              ],
              completeEvent: "results-private-selected",
              allowTargetClick: true,
              advanceOnComplete: false,
            };
          },
        },
        {
          id: "quick-start-save",
          pageId: "results",
          selector: QUICK_START_SELECTORS.resultsSaveButton,
          title: "",
          body: ["Save the scan to your profile so you can come back to it later."],
          completeEvent: "private-save-success",
          allowTargetClick: true,
          isSatisfied() {
            return window.location.pathname === "/profile";
          },
        },
        {
          id: "quick-start-profile",
          pageId: "profile",
          selector: QUICK_START_SELECTORS.profileScans,
          title: "",
          body: [
            "You are now in the `Profile` section, where you can view your stats and all the images you have saved.",
          ],
          nextLabel: "Next",
          allowTargetClick: false,
        },
        {
          id: "quick-start-tutorials-shortcut",
          pageId: "profile",
          selector: QUICK_START_SELECTORS.tutorialsShortcut,
          title: "",
          body: [
            "If you need help later, open `Tutorials` and follow another guided walkthrough.",
          ],
          nextLabel: "Finish",
          allowTargetClick: false,
          elevateSelectors: ["#nav-drawer", "#menu-overlay"],
          beforeShow() {
            openDrawer();
            return {
              cleanup: closeDrawer,
            };
          },
        },
      ],
    });
  })();
}
