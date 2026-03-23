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

  function hasDetectionReady() {
    if (window.location.pathname === "/results") return true;
    if (window.lastDetectionToken) return true;
    if (sessionStorage.getItem("lastDetectionToken")) return true;
    if (sessionStorage.getItem("lastDetectionResponse")) return true;
    return false;
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
    if (overlay) overlay.style.display = "block";
  }

  registry.registerModule({
    id: "quick_start",
    title: "Quick start",
    description: "Learn the private scan flow from upload to saved scans.",
    steps: [
      {
        id: "quick-start-choose-image",
        pageId: "upload",
        selector: "label.file-upload",
        title: "",
        body: [
          "Choose the image you want to check.",
        ],
        completeEvent: "upload-choose-image-clicked",
        allowTargetClick: true,
        isSatisfied() {
          return hasSelectedValidImage();
        },
      },
      {
        id: "quick-start-disclaimer-read",
        pageId: "upload",
        selector: "#disclaimer-modal .modal-text--disclaimer",
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
        selector: "#disclaimer-agree",
        title: "",
        body: [
            "If everything is clear, agree to continue with the scan.",
        ],
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
        body: [
          "Choose the file you want to scan.",
        ],
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
            hitTargetSelector: "label.file-upload",
            title: "",
            body: [
              "This image is too large, so choose a smaller one to continue.",
            ],
            completeEvent: "upload-file-selected",
            allowTargetClick: true,
          };
        },
      },
      {
        id: "quick-start-crop",
        pageId: "upload",
        selector: "#upload-frame",
        title: "",
        body: [
          "AIclipse reads the area inside this frame first, so check that the important part is inside it.",
        ],
        nextLabel: "Next",
        allowTargetClick: false,
        note: ["Read-only for this step."],
      },
      {
        id: "quick-start-analyze",
        pageId: "upload",
        selector: "#btn-check",
        title: "",
        body: [
          "Run the scan when the frame looks right, and AIclipse will open the result screen.",
        ],
        completeEvent: "scan-analysis-success",
        allowTargetClick: true,
        isSatisfied() {
          return hasDetectionReady();
        },
      },
      {
        id: "quick-start-results-overview",
        pageId: "results",
        selector: "#detect-card",
        title: "",
        body: [
          "Read this result as a strong signal, not as final proof on its own.",
        ],
        nextLabel: "Next",
        allowTargetClick: false,
      },
      {
        id: "quick-start-confidence-bar",
        pageId: "results",
        selector: ".progress-panel",
        title: "",
        body: [
          "A higher score means the model sees a stronger AI-like pattern in the image.",
        ],
        nextLabel: "Next",
        allowTargetClick: false,
      },
      {
        id: "quick-start-private-mode",
        pageId: "results",
        selector: ".visibility-selector",
        title: "",
        body: [
          "Keep this first scan in `Private`, because that is the safer way to learn the flow.",
        ],
        nextLabel: "Next",
        allowTargetClick: false,
        beforeShow() {
          if (isPrivateSelected()) return null;

          return {
            id: "quick-start-private-mode-fix",
            selector: "#mode-private",
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
        selector: "#btn-save",
        title: "",
        body: [
          "Save the scan to your profile so you can come back to it later.",
        ],
        completeEvent: "private-save-success",
        allowTargetClick: true,
        isSatisfied() {
          return window.location.pathname === "/profile";
        },
      },
      {
        id: "quick-start-profile",
        pageId: "profile",
        selector: "#scans-container",
        title: "",
        body: [
          "This is your private review area, where saved scans stay easy to find.",
        ],
        nextLabel: "Next",
        allowTargetClick: false,
      },
      {
        id: "quick-start-tutorials-shortcut",
        pageId: "profile",
        selector: '#nav-drawer a[href="/tutorials"]',
        title: "",
        body: [
          "If you want guided help later, open `Tutorials` from here and the app will walk you through the flow again.",
        ],
        nextLabel: "Finish",
        allowTargetClick: false,
        elevateSelectors: ["#nav-drawer", "#menu-overlay"],
        beforeShow() {
          openDrawer();
          return null;
        },
      },
    ],
  });
})();