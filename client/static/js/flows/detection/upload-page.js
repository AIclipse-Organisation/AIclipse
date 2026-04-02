(function attachUploadPage(global) {
  const shared = global.AIclipseDetectionFlowShared;

  function makeCroppedFileFromOriginal(originalFile, cropX, cropY, frameAspect = 1) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = async () => {
          try {
            const srcW = image.naturalWidth;
            const srcH = image.naturalHeight;
            let cropW;
            let cropH;

            if (srcW / srcH > frameAspect) {
              cropH = srcH;
              cropW = Math.round(srcH * frameAspect);
            } else {
              cropW = srcW;
              cropH = Math.round(srcW / frameAspect);
            }

            const maxX = Math.max(0, srcW - cropW);
            const maxY = Math.max(0, srcH - cropH);
            const x = Math.round((cropX / 100) * maxX);
            const y = Math.round((cropY / 100) * maxY);
            const outLong = 1024;
            const outW = frameAspect >= 1 ? outLong : Math.round(outLong * frameAspect);
            const outH = frameAspect >= 1 ? Math.round(outLong / frameAspect) : outLong;

            const canvas = document.createElement("canvas");
            canvas.width = outW;
            canvas.height = outH;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(image, x, y, cropW, cropH, 0, 0, outW, outH);

            const blob = await new Promise((blobResolve) =>
              canvas.toBlob(blobResolve, "image/jpeg", 0.92),
            );

            const baseName = originalFile.name.replace(/\.\w+$/, "");
            resolve(
              new File([blob], `${baseName}-cropped.jpg`, {
                type: "image/jpeg",
              }),
            );
          } catch (err) {
            reject(err);
          }
        };
        image.onerror = reject;
        image.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(originalFile);
    });
  }

  function init() {
    const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
    const TOO_LARGE_MSG = "Image is too large. Max allowed size is 20 MB.";
    const fileInput = document.getElementById("file-input");
    const fileLabel = document.querySelector("label.file-upload");
    const btnCheck = document.getElementById("btn-check");
    const checkState = document.getElementById("check-state");
    const detectStatus = document.getElementById("detect-status");
    const detectResult = document.getElementById("detect-result");
    const previewImg = document.getElementById("preview-image");
    const uploadFrame = document.getElementById("upload-frame");
    const cropHint = document.getElementById("crop-hint");
    const cropResetBtn = document.getElementById("btn-crop-reset");
    const uploadPreviewWrap = document.getElementById("upload-preview-wrap");
    const quotaModal = document.getElementById("quota-modal");
    const quotaModalText = document.getElementById("quota-modal-text");
    const quotaModalClose = document.getElementById("quota-modal-close");
    const quotaModalPlan = document.getElementById("quota-modal-plan");
    const disclaimerModal = document.getElementById("disclaimer-modal");
    const disclaimerDontShowAgain = document.getElementById("disclaimer-dont-show-again");
    const disclaimerDisagreeBtn = document.getElementById("disclaimer-disagree");
    const disclaimerAgreeBtn = document.getElementById("disclaimer-agree");

    if (!fileInput || !btnCheck || !previewImg || !uploadFrame) return;

    let lastPreviewUrl = null;
    let doNotShowDisclaimerAgain = false;
    let disclaimerAcceptedThisSession = false;
    let resumeTutorialAfterPicker = null;
    let cropX = 50;
    let cropY = 20;

    if (!("lastFile" in global)) global.lastFile = null;
    if (!("lastDetectionToken" in global)) global.lastDetectionToken = null;
    if (!("currentUserId" in global)) global.currentUserId = null;

    function suspendTutorialForFilePicker() {
      const tutorial = global.AIclipseTutorial;

      if (
        !tutorial ||
        typeof tutorial.suspendUi !== "function" ||
        typeof tutorial.resumeUi !== "function"
      ) {
        return () => {
          if (tutorial && typeof tutorial.refresh === "function") tutorial.refresh();
        };
      }

      let resumed = false;

      const resume = () => {
        if (resumed) return;
        resumed = true;
        global.removeEventListener("focus", onWindowFocus, true);
        tutorial.resumeUi();
      };

      const onWindowFocus = () => {
        global.setTimeout(resume, 80);
      };

      tutorial.suspendUi();
      global.addEventListener("focus", onWindowFocus, true);
      return resume;
    }

    function updateFlowStep(step) {
      const steps = document.querySelectorAll(".flow-step");
      const connectors = document.querySelectorAll(".flow-step-connector");
      const title = document.querySelector(".flow-header .page-title");
      const instruction = document.querySelector(".flow-header .flow-instruction");
      const topbarBackBtn = document.getElementById("topbar-back-dynamic");
      const menuToggle = document.getElementById("menu-toggle");

      steps.forEach((el, i) => {
        const stepNum = i + 1;
        el.classList.toggle("is-active", stepNum <= step);
        el.classList.toggle("is-complete", stepNum < step);
      });

      connectors.forEach((el, i) => {
        el.classList.toggle("is-complete", i + 1 < step);
      });

      if (step === 1) {
        if (title) title.textContent = "Upload";
        if (instruction) instruction.textContent = "Choose an image to scan for AI manipulation";
        if (topbarBackBtn) topbarBackBtn.hidden = true;
        if (menuToggle) menuToggle.hidden = false;
      } else if (step === 2) {
        if (title) title.textContent = "Analyze";
        if (instruction) {
          instruction.textContent = "Our model will scan your image for signs of AI manipulation";
        }
        if (topbarBackBtn) topbarBackBtn.hidden = false;
        if (menuToggle) menuToggle.hidden = true;
      }
    }

    function updateFileLabel(hasFile) {
      if (!fileLabel) return;
      fileLabel.classList.toggle("is-selected", !!hasFile);
      fileLabel.hidden = !!hasFile;
      fileLabel.textContent = hasFile ? "Change Image" : "Choose Image";
      updateFlowStep(hasFile ? 2 : 1);
    }

    function closeQuotaModal() {
      if (quotaModal) quotaModal.hidden = true;
    }

    function openQuotaModal(message) {
      if (!quotaModal) return;
      if (quotaModalText) {
        quotaModalText.textContent =
          message || "You've reached your free quota of 10 uploads this month.";
      }
      quotaModal.hidden = false;
    }

    function closeDisclaimerModal() {
      if (disclaimerModal) disclaimerModal.hidden = true;
    }

    function openDisclaimerModal() {
      if (!disclaimerModal) return;
      if (disclaimerDontShowAgain) disclaimerDontShowAgain.checked = false;
      disclaimerModal.hidden = false;
    }

    function applyCropPosition() {
      previewImg.style.objectPosition = `${cropX}% ${cropY}%`;
    }

    function clearImage() {
      const uploadPlaceholder = document.getElementById("upload-placeholder");

      try {
        fileInput.value = "";
      } catch {}

      if (lastPreviewUrl) {
        URL.revokeObjectURL(lastPreviewUrl);
        lastPreviewUrl = null;
      }

      previewImg.removeAttribute("src");
      if (uploadPreviewWrap) uploadPreviewWrap.hidden = true;
      if (uploadPlaceholder) uploadPlaceholder.hidden = false;

      updateFileLabel(false);
      btnCheck.hidden = true;
      global.lastFile = null;
      global.lastDetectionToken = null;
      void shared.clearPendingDetectionState();
    }

    if (quotaModalClose) quotaModalClose.addEventListener("click", closeQuotaModal);
    if (quotaModalPlan) {
      quotaModalPlan.addEventListener("click", () => {
        closeQuotaModal();
        global.location.href = "/plan";
      });
    }
    if (quotaModal) {
      quotaModal.addEventListener("click", (event) => {
        if (event.target === quotaModal) closeQuotaModal();
      });
    }

    if (fileLabel) {
      fileLabel.addEventListener("click", (event) => {
        event.preventDefault();

        if (global.AIclipseTutorial && typeof global.AIclipseTutorial.emit === "function") {
          global.AIclipseTutorial.emit("upload-choose-image-clicked");
        }

        if (doNotShowDisclaimerAgain || disclaimerAcceptedThisSession) {
          if (global.AIclipseTutorial && typeof global.AIclipseTutorial.emit === "function") {
            global.AIclipseTutorial.emit("upload-disclaimer-agreed");
          }

          resumeTutorialAfterPicker = suspendTutorialForFilePicker();
          fileInput.click();
          return;
        }

        openDisclaimerModal();
      });
    }

    if (disclaimerDisagreeBtn) {
      disclaimerDisagreeBtn.addEventListener("click", closeDisclaimerModal);
    }

    if (disclaimerModal) {
      disclaimerModal.addEventListener("click", (event) => {
        if (event.target === disclaimerModal) closeDisclaimerModal();
      });
    }

    if (disclaimerAgreeBtn) {
      disclaimerAgreeBtn.addEventListener("click", async () => {
        const wantsToSkip = !!disclaimerDontShowAgain?.checked;

        if (wantsToSkip && !doNotShowDisclaimerAgain) {
          try {
            const { res } = await shared.jsonFetch("PATCH", "/auth/me", {
              do_not_show_disclaimer_again: true,
            });
            if (res.ok) doNotShowDisclaimerAgain = true;
          } catch {}
        }

        disclaimerAcceptedThisSession = true;
        closeDisclaimerModal();

        if (global.AIclipseTutorial && typeof global.AIclipseTutorial.emit === "function") {
          global.AIclipseTutorial.emit("upload-disclaimer-agreed");
        }

        resumeTutorialAfterPicker = suspendTutorialForFilePicker();
        fileInput.click();
      });
    }

    previewImg.setAttribute("draggable", "false");
    previewImg.addEventListener("dragstart", (event) => event.preventDefault());
    applyCropPosition();

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startCropX = cropX;
    let startCropY = cropY;

    uploadFrame.addEventListener("pointerdown", (event) => {
      if (!previewImg.src) return;

      event.preventDefault();
      uploadFrame.setPointerCapture?.(event.pointerId);
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startCropX = cropX;
      startCropY = cropY;
      previewImg.style.cursor = "grabbing";
      if (cropHint) cropHint.style.opacity = "0";
    });

    uploadFrame.addEventListener("pointermove", (event) => {
      if (!dragging) return;

      const rect = uploadFrame.getBoundingClientRect();
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      cropX = shared.clamp(startCropX + (dx / rect.width) * 100, 0, 100);
      cropY = shared.clamp(startCropY + (dy / rect.height) * 100, 0, 100);
      applyCropPosition();
    });

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      previewImg.style.cursor = "grab";
    }

    uploadFrame.addEventListener("pointerup", endDrag);
    uploadFrame.addEventListener("pointercancel", endDrag);

    cropResetBtn?.addEventListener("click", () => {
      cropX = 50;
      cropY = 20;
      applyCropPosition();
      if (cropHint) cropHint.style.opacity = "0.9";
    });

    cropResetBtn?.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });

    const clearImageBtn = document.getElementById("btn-clear-image");
    clearImageBtn?.addEventListener("click", clearImage);
    clearImageBtn?.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });

    const topbarBackBtn = document.getElementById("topbar-back-dynamic");
    topbarBackBtn?.addEventListener("click", clearImage);

    fileInput.addEventListener("change", () => {
      if (typeof resumeTutorialAfterPicker === "function") {
        const resume = resumeTutorialAfterPicker;
        resumeTutorialAfterPicker = null;
        global.setTimeout(resume, 60);
      }

      const file = fileInput.files?.[0] || null;
      const uploadPlaceholder = document.getElementById("upload-placeholder");

      updateFileLabel(!!file);

      if (file && file.size > MAX_IMAGE_BYTES) {
        global.lastFile = null;
        global.lastDetectionToken = null;
        void shared.clearPendingDetectionState();

        try {
          fileInput.value = "";
        } catch {}

        updateFileLabel(false);

        if (lastPreviewUrl) {
          URL.revokeObjectURL(lastPreviewUrl);
          lastPreviewUrl = null;
        }

        previewImg.removeAttribute("src");
        if (uploadPreviewWrap) uploadPreviewWrap.hidden = true;
        if (uploadPlaceholder) uploadPlaceholder.hidden = false;

        btnCheck.disabled = true;
        btnCheck.hidden = true;
        if (checkState) checkState.textContent = TOO_LARGE_MSG;
        if (detectResult) detectResult.textContent = "No detection yet.";
        if (detectStatus) shared.setStatus(detectStatus, "info", "");

        if (global.AIclipseTutorial && typeof global.AIclipseTutorial.refresh === "function") {
          global.AIclipseTutorial.refresh();
        }
        return;
      }

      global.lastFile = file;
      global.lastDetectionToken = null;
      void shared.clearPendingDetectionState();
      cropX = 50;
      cropY = 20;
      applyCropPosition();
      if (cropHint) cropHint.style.opacity = "0.9";

      if (lastPreviewUrl) {
        URL.revokeObjectURL(lastPreviewUrl);
        lastPreviewUrl = null;
      }

      if (file) {
        lastPreviewUrl = URL.createObjectURL(file);
        shared.setImageSrcSafe(previewImg, lastPreviewUrl);
      } else {
        previewImg.removeAttribute("src");
      }

      if (uploadPreviewWrap) uploadPreviewWrap.hidden = !file;
      if (uploadPlaceholder) uploadPlaceholder.hidden = !!file;

      if (file) {
        btnCheck.hidden = false;
        btnCheck.disabled = false;
        if (checkState) {
          checkState.textContent = `Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`;
        }
        if (detectResult) detectResult.textContent = "No detection yet for this file.";

        if (global.AIclipseTutorial && typeof global.AIclipseTutorial.emit === "function") {
          global.AIclipseTutorial.emit("upload-file-selected", { fileName: file.name });
        }
      } else {
        btnCheck.disabled = true;
        btnCheck.hidden = true;
        if (checkState) checkState.textContent = "Select an image to analyze.";
        if (detectResult) detectResult.textContent = "No detection yet.";
      }

      if (global.AIclipseTutorial && typeof global.AIclipseTutorial.refresh === "function") {
        global.AIclipseTutorial.refresh();
      }
    });

    btnCheck.addEventListener("click", async () => {
      if (!global.lastFile) {
        shared.setStatus(detectStatus, "error", "No file selected.");
        return;
      }

      if (global.lastFile.size > MAX_IMAGE_BYTES) {
        global.lastFile = null;

        try {
          fileInput.value = "";
        } catch {}

        btnCheck.disabled = true;
        if (checkState) checkState.textContent = TOO_LARGE_MSG;
        if (detectStatus) shared.setStatus(detectStatus, "info", "");
        return;
      }

      if (global.AppLoader && typeof global.AppLoader.show === "function") {
        global.AppLoader.show("AIclipse is analyzing your image...");
      }

      btnCheck.disabled = true;
      global.lastDetectionToken = null;
      shared.setStatus(detectStatus, "info", "Analyzing image...");

      try {
        const croppedFile = await makeCroppedFileFromOriginal(global.lastFile, cropX, cropY, 1);
        global.lastFile = croppedFile;
        await shared.clearPendingDetectionState();

        const formData = new FormData();
        formData.append("file", croppedFile);

        const res = await fetch("/checks", {
          method: "POST",
          body: formData,
          credentials: "include",
        });

        let data = null;
        try {
          data = await res.json();
        } catch {
          data = { detail: "Non-JSON response" };
        }

        shared.setDebug({ url: "/checks", status: res.status, body: data });

        if (!res.ok) {
          global.lastDetectionToken = null;
          if (detectResult) detectResult.textContent = JSON.stringify(data, null, 2);

          if (shared.isUsageLimitExceeded(res.status, data)) {
            const limitMessage =
              shared.getLimitMessage(data) || "You've reached your free quota.";
            shared.setStatus(detectStatus, "error", limitMessage);

            if (global.AppLoader && typeof global.AppLoader.hide === "function") {
              global.AppLoader.hide();
            }

            openQuotaModal(limitMessage);
            return;
          }

          if (res.status === 413) {
            if (checkState) checkState.textContent = TOO_LARGE_MSG;
            if (detectStatus) shared.setStatus(detectStatus, "info", "");
          } else {
            shared.setStatus(
              detectStatus,
              "error",
              data.detail || `Detection failed (${res.status})`,
            );
          }

          return;
        }

        global.lastDetectionToken = data.detection_token || null;
        try {
          await shared.persistPendingDetectionState(croppedFile, data);
        } catch {
          shared.setStatus(
            detectStatus,
            "error",
            "This browser cannot continue the scan flow right now. Please enable IndexedDB and try again.",
          );
          global.lastDetectionToken = null;
          return;
        }
        shared.setStatus(detectStatus, "success", "Detection completed.");

        if (global.AIclipseTutorial && typeof global.AIclipseTutorial.emit === "function") {
          global.AIclipseTutorial.emit("scan-analysis-success", {
            detectionToken: global.lastDetectionToken || null,
          });
        }

        global.location.href = "/results";
      } catch (err) {
        console.error(err);
        shared.setStatus(detectStatus, "error", "Network error during detection.");

        if (global.AppLoader && typeof global.AppLoader.hide === "function") {
          global.AppLoader.hide();
        }
      } finally {
        btnCheck.disabled = false;
        if (global.location.pathname !== "/results") {
          if (global.AppLoader && typeof global.AppLoader.hide === "function") {
            global.AppLoader.hide();
          }
        }
      }
    });

    void (async () => {
      const currentUser = await shared.loadCurrentUserContext();
      global.currentUserId = currentUser?.user_id || null;
      doNotShowDisclaimerAgain = !!currentUser?.do_not_show_disclaimer_again;

      if (
        currentUser &&
        global.AIclipseTutorial &&
        typeof global.AIclipseTutorial.setUserScope === "function"
      ) {
        global.AIclipseTutorial.setUserScope(
          currentUser.user_id || currentUser.email || currentUser.user_name || "",
        );
      }
    })();
  }

  global.AIclipseUploadPage = { init };
})(window);
