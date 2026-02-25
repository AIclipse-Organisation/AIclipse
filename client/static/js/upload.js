// upload.js

/* upload.js 
   - Upload page: shows a fixed preview frame + lets user drag to reposition crop
   - When clicking "View Results" (btn-check), it exports a CROPPED file via canvas
     and sends that cropped file to /checks (and uses it for later save/publish too).
   - Safe to load on other pages: everything is guarded by element existence.
*/

function setStatus(el, type, text) {
  if (!el) return;

  while (el.firstChild) el.removeChild(el.firstChild);

  if (!text) return;

  const span = document.createElement("span");
  span.textContent = text; // safe
  span.classList.add(
    type === "success"
      ? "status-success"
      : type === "error"
        ? "status-error"
        : "status-info",
  );

  el.appendChild(span);
}

function setDebug(data) {
  const pre = document.getElementById("debug-output");
  if (!pre) return;
  pre.textContent = JSON.stringify(data, null, 2);
}

function setCurrentUserChip(user) {
  const chip = document.getElementById("current-user-chip");
  if (!chip) return;

  if (!user) {
    chip.textContent = "Not signed in";
    chip.classList.remove("success");
    return;
  }
  chip.textContent = `${user.user_name || user.email || "User"} · plan ${user.plan ?? "?"}`;
  chip.classList.add("success");
}

async function jsonFetch(method, url, body) {
  const opts = { method, headers: { Accept: "application/json" } };
  if (body != null) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  opts.credentials = "include";

  const res = await fetch(url, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { detail: "Non-JSON response" };
  }
  setDebug({ url, status: res.status, body: data });
  return { res, data };
}

window.addEventListener("DOMContentLoaded", () => {
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const TOO_LARGE_MSG = "Image is too large. Max allowed size is 5 MB.";

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

  let lastPreviewUrl = null;

  // SAVE UI (only exists on results page; guarded)
  const btnSave = document.getElementById("btn-save");
  const savePublic = document.getElementById("save-public");
  const saveState = document.getElementById("save-state");
  const saveStatus = document.getElementById("save-status");
  const saveResult = document.getElementById("save-result");

  // Description UI (results page)
  const publicDescWrap = document.getElementById("public-desc-wrap");
  const postDescriptionInput = document.getElementById("post-description");
  const postDescriptionHint = document.getElementById("post-description-hint");

  // Results card elements (results page)
  const detectCard = document.getElementById("detect-card");
  const verdictEl = document.getElementById("detect-verdict");
  const confidenceEl = document.getElementById("detect-confidence");
  const realFill = document.querySelector(".real-fill");
  const aiFill = document.querySelector(".ai-fill");

  // =========================
  // State
  // =========================
  // [ADDED] Don't clobber results.js values on /results
  if (!("lastFile" in window)) window.lastFile = null;
  if (!("lastDetectionToken" in window)) window.lastDetectionToken = null;
  if (!("currentUserId" in window)) window.currentUserId = null;

  // Crop state (object-position % values)
  let cropX = 50; // 0..100
  let cropY = 20; // 0..100 (top-biased helps keep heads)

  function updateFileLabel(hasFile) {
    if (!fileLabel) return;
    fileLabel.classList.toggle("is-selected", !!hasFile);
    fileLabel.textContent = hasFile ? "Change Image" : "Choose Image";
  }

  function syncPublishUI() {
    const isPublic = !!(savePublic && savePublic.checked);
    if (publicDescWrap) publicDescWrap.hidden = !isPublic;
    if (postDescriptionHint)
      postDescriptionHint.textContent = isPublic
        ? "Required when publishing."
        : "";
  }
  if (savePublic) savePublic.addEventListener("change", syncPublishUI);
  syncPublishUI();

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function closeQuotaModal() {
    if (!quotaModal) return;
    quotaModal.hidden = true;
  }

  function openQuotaModal(message) {
    if (!quotaModal) return;
    if (quotaModalText) {
      quotaModalText.textContent =
        message || "You've reached your free quota of 10 uploads this month.";
    }
    quotaModal.hidden = false;
  }

  function getLimitMessage(payload) {
    if (!payload || typeof payload !== "object") return null;
    const detail = payload.detail;
    if (detail && typeof detail === "object") {
      if (typeof detail.message === "string" && detail.message.trim()) {
        return detail.message;
      }
      if (typeof detail.error === "string" && detail.error.trim()) {
        return detail.error;
      }
    }
    if (typeof detail === "string" && detail.trim()) return detail;
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }
    return null;
  }

  function isUsageLimitExceeded(statusCode, payload) {
    const detail = payload && typeof payload === "object" ? payload.detail : null;
    const errorCode =
      detail && typeof detail === "object" && typeof detail.error === "string"
        ? detail.error
        : null;
    return statusCode === 403 && errorCode === "usage_limit_exceeded";
  }

  if (quotaModalClose) {
    quotaModalClose.addEventListener("click", closeQuotaModal);
  }
  if (quotaModalPlan) {
    quotaModalPlan.addEventListener("click", () => {
      closeQuotaModal();
      window.location.href = "/plan";
    });
  }
  if (quotaModal) {
    quotaModal.addEventListener("click", (event) => {
      if (event.target === quotaModal) closeQuotaModal();
    });
  }

  function applyCropPosition() {
    if (!previewImg) return;
    previewImg.style.objectPosition = `${cropX}% ${cropY}%`;
  }

  // Prevent browser native dragging (important for crop drag UX)
  if (previewImg) {
    previewImg.setAttribute("draggable", "false");
    previewImg.addEventListener("dragstart", (e) => e.preventDefault());
    applyCropPosition();
  }

  // Drag-to-reposition crop (Upload page)
  (function setupUploadCropDrag() {
    if (!uploadFrame || !previewImg) return;

    let dragging = false;
    let startX = 0,
      startY = 0;
    let startCropX = cropX,
      startCropY = cropY;

    uploadFrame.addEventListener("pointerdown", (e) => {
      if (!previewImg.src) return;
      e.preventDefault();
      uploadFrame.setPointerCapture?.(e.pointerId);

      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startCropX = cropX;
      startCropY = cropY;

      previewImg.style.cursor = "grabbing";
      if (cropHint) cropHint.style.opacity = "0";
    });

    uploadFrame.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const rect = uploadFrame.getBoundingClientRect();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      cropX = clamp(startCropX + (dx / rect.width) * 100, 0, 100);
      cropY = clamp(startCropY + (dy / rect.height) * 100, 0, 100);
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
    cropResetBtn?.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
  })();

  async function makeCroppedFileFromOriginal(originalFile, frameAspect = 1) {
    // Reads file -> image -> crops to match frame aspect using current cropX/cropY -> outputs JPEG file + data URL preview.

    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(originalFile);
    });

    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });

    const srcW = img.naturalWidth;
    const srcH = img.naturalHeight;

    // Crop rect sized to "cover" the output aspect (like object-fit: cover)
    let cropW, cropH;
    if (srcW / srcH > frameAspect) {
      cropH = srcH;
      cropW = Math.round(srcH * frameAspect);
    } else {
      cropW = srcW;
      cropH = Math.round(srcW / frameAspect);
    }

    // Max pan range in pixels
    const maxX = Math.max(0, srcW - cropW);
    const maxY = Math.max(0, srcH - cropH);

    // Map object-position % -> pixel offsets
    const x = Math.round((cropX / 100) * maxX);
    const y = Math.round((cropY / 100) * maxY);

    // Output size: keep reasonable; match aspect.
    const outLong = 1024;
    let outW, outH;
    if (frameAspect >= 1) {
      outW = outLong;
      outH = Math.round(outLong / frameAspect);
    } else {
      outH = outLong;
      outW = Math.round(outLong * frameAspect);
    }

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, x, y, cropW, cropH, 0, 0, outW, outH);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );

    const baseName = originalFile.name.replace(/\.\w+$/, "");
    const croppedFile = new File([blob], `${baseName}-cropped.jpg`, {
      type: "image/jpeg",
    });
    const previewDataUrl = canvas.toDataURL("image/jpeg", 0.92);

    return { croppedFile, previewDataUrl };
  }


function setImageSrcSafe(imgEl, url) {
  if (!imgEl) return;

  // 1. Basic Type Check
  if (typeof url !== "string") {
    imgEl.removeAttribute("src");
    return;
  }

  // 2. Protocol Validation (Allowlist Approach)
  // We only permit specifically generated blob: or data: image strings.
  const lowerUrl = url.toLowerCase().trim();
  const isBlob = lowerUrl.startsWith("blob:");
  const isData = lowerUrl.startsWith("data:");

  if (isBlob) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "blob:") {
        imgEl.removeAttribute("src");
        return;
      }
    } catch {
      imgEl.removeAttribute("src");
      return;
    }
  } else if (isData) {
    // Rigid Regex for base64 image data URLs only (png, jpeg, jpg, webp)
    // This blocks data:text/html or data:application/javascript injections.
    const dataUrlRegex = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i;
    if (!dataUrlRegex.test(url)) {
      imgEl.removeAttribute("src");
      return;
    }
  } else {
    // Blocks javascript:, vbscript:, and standard http/https if not intended
    imgEl.removeAttribute("src");
    return;
  }

  // 3. Safe Assignment
  imgEl.setAttribute("src", url);
}


const previewWrap = document.getElementById('upload-preview-wrap');

  // File chosen -> show preview frame + enable button
  if (fileInput) {
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    const uploadPlaceholder = document.getElementById("upload-placeholder"); // Get placeholder ref

    updateFileLabel(!!file);

    // --- CASE 1: FILE TOO LARGE ---
    if (file && file.size > MAX_IMAGE_BYTES) {
      window.lastFile = null;
      window.lastDetectionToken = null;

      try {
        fileInput.value = "";
      } catch {}

      updateFileLabel(false);

      if (previewImg) {
        if (lastPreviewUrl) {
          URL.revokeObjectURL(lastPreviewUrl);
          lastPreviewUrl = null;
        }
        previewImg.src = "";
      }
      
      // UI Reset: Hide preview, Show placeholder
      if (uploadPreviewWrap) uploadPreviewWrap.hidden = true;
      if (uploadPlaceholder) uploadPlaceholder.hidden = false;

      if (btnSave) btnSave.disabled = true;
      if (saveState) saveState.textContent = "Run detection first to enable saving.";
      if (saveResult) saveResult.textContent = "";
      if (saveStatus) setStatus(saveStatus, "info", "");

      if (btnCheck) btnCheck.hidden = true;
      if (checkState) checkState.textContent = TOO_LARGE_MSG;

      if (detectResult) detectResult.textContent = "No detection yet.";
      if (detectStatus) setStatus(detectStatus, "info", "");

      if (btnCheck) {
        btnCheck.disabled = true;
        btnCheck.hidden = true;
      }

      return;
    }

    // --- CASE 2: VALID FILE OR CLEARED ---
    window.lastFile = file || null;
    window.lastDetectionToken = null;

    cropX = 50;
    cropY = 20;
    applyCropPosition();
    if (cropHint) cropHint.style.opacity = "0.9";

    if (previewImg) {
      if (lastPreviewUrl) {
        URL.revokeObjectURL(lastPreviewUrl);
        lastPreviewUrl = null;
      }
      if (file) {
        lastPreviewUrl = URL.createObjectURL(file);
        setImageSrcSafe(previewImg, lastPreviewUrl);
      } else {
        previewImg.removeAttribute("src");
      }
    }

    // Toggle Preview vs Placeholder
    if (uploadPreviewWrap) uploadPreviewWrap.hidden = !file;
    if (uploadPlaceholder) uploadPlaceholder.hidden = !!file;

    // Reset SAVE UI if present
    if (btnSave) btnSave.disabled = true;
    if (saveState) saveState.textContent = "Run detection first to enable saving.";
    if (saveResult) saveResult.textContent = "";
    if (saveStatus) setStatus(saveStatus, "info", "");

    if (file) {
      if (btnCheck) {
        btnCheck.hidden = false;
        btnCheck.disabled = false;
      }
      if (checkState)
        checkState.textContent = `Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`;
      if (detectResult)
        detectResult.textContent = "No detection yet for this file.";
    } else {
      if (btnCheck) {
        btnCheck.disabled = true;
        btnCheck.hidden = true;
      }
      if (checkState) checkState.textContent = "Select an image to analyze.";
      if (detectResult) detectResult.textContent = "No detection yet.";
    }
  });
}

  // btnCheck click -> exports cropped file -> POST /checks with cropped file -> store preview+response -> /results
if (btnCheck) {
  btnCheck.addEventListener("click", async () => {
    if (!window.lastFile) {
      setStatus(detectStatus, "error", "No file selected.");
      return;
    }

    if (window.lastFile.size > MAX_IMAGE_BYTES) {
      window.lastFile = null;
      try {
        if (fileInput) fileInput.value = "";
      } catch {}
      btnCheck.disabled = true;
      if (checkState) checkState.textContent = TOO_LARGE_MSG;
      if (detectStatus) setStatus(detectStatus, "info", "");
      return;
    }

    // 1. Show the Global Loader
    window.AppLoader.show("AIclipse is analyzing your image...");

    btnCheck.disabled = true;
    window.lastDetectionToken = null;

    // disable SAVE UI
    if (btnSave) btnSave.disabled = true;
    if (saveState) saveState.textContent = "Run detection first to enable saving.";
    if (saveResult) saveResult.textContent = "";
    if (saveStatus) setStatus(saveStatus, "info", "");

    setStatus(detectStatus, "info", "Analyzing image...");

    try {
      const frameAspect = 1;
      const { croppedFile, previewDataUrl } =
        await makeCroppedFileFromOriginal(window.lastFile, frameAspect);

      window.lastFile = croppedFile;
      sessionStorage.setItem("lastDetectionPreview", previewDataUrl);

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
      
      setDebug({ url: "/checks", status: res.status, body: data });

      if (!res.ok) {
        window.lastDetectionToken = null;
        if (btnSave) btnSave.disabled = true;
        if (saveState) saveState.textContent = "Run detection first to enable saving.";
        if (detectResult) detectResult.textContent = JSON.stringify(data, null, 2);

        if (isUsageLimitExceeded(res.status, data)) {
          const limitMessage = getLimitMessage(data) || "You've reached your free quota.";
          setStatus(detectStatus, "error", limitMessage);
          
          // Hide loader before showing a modal so they don't overlap
          window.AppLoader.hide(); 
          openQuotaModal(limitMessage);
          return;
        }

        if (res.status === 413) {
          if (checkState) checkState.textContent = TOO_LARGE_MSG;
          if (detectStatus) setStatus(detectStatus, "info", "");
        } else {
          setStatus(detectStatus, "error", data.detail || `Detection failed (${res.status})`);
        }
        return;
      }

      const lastDetectionToken = data.detection_token || null;
      window.lastDetectionToken = lastDetectionToken;

      if (btnSave) btnSave.disabled = !lastDetectionToken;
      if (saveState) {
        saveState.textContent = lastDetectionToken
          ? "Detection token ready. You can now save this image."
          : "No detection token returned; cannot save.";
      }

      sessionStorage.setItem("lastDetectionResponse", JSON.stringify(data));
      sessionStorage.setItem("lastDetectionToken", lastDetectionToken);

      setStatus(detectStatus, "success", "Detection completed.");
      
      // We don't hide the loader here because we are redirecting. 
      // It creates a smoother transition to the next page.
      window.location.href = "/results";

    } catch (err) {
      console.error(err);
      if (btnSave) btnSave.disabled = true;
      if (saveState) saveState.textContent = "Run detection first to enable saving.";
      setStatus(detectStatus, "error", "Network error during detection.");
      
      // Only hide on error so the user can see the error message
      window.AppLoader.hide(); 
    } finally {
      btnCheck.disabled = false;
      // If we didn't redirect (e.g., an error happened or we stayed on page), hide it.
      if (window.location.pathname !== "/results") {
        window.AppLoader.hide();
      }
    }
  });
}

  if (btnSave && !btnSave.dataset.bound) {
    btnSave.dataset.bound = "1";

    btnSave.addEventListener("click", async () => {
      if (!window.lastFile) {
        setStatus(saveStatus, "error", "No file selected.");
        return;
      }
      if (!window.lastDetectionToken) {
        setStatus(saveStatus, "error", "No detection token. Run detection first.");
        return;
      }

      const isPublic = !!(savePublic && savePublic.checked);
      const description = (
        postDescriptionInput && postDescriptionInput.value
          ? postDescriptionInput.value
          : ""
      ).trim();

      if (isPublic && !window.currentUserId) {
        setStatus(saveStatus, "error", "You must be signed in to publish to community.");
        return;
      }
      if (isPublic && !description) {
        setStatus(saveStatus, "error", "Description is required when publishing.");
        return;
      }
      if (description.length > 1000) {
        setStatus(
          saveStatus,
          "error",
          `Description too long (${description.length}/1000 characters).`,
        );
        return;
      }

      // 1. Show the Global Loader immediately
      if (window.AppLoader) {
        window.AppLoader.show(isPublic ? "Publishing to Community..." : "Saving your scan...");
      }

      btnSave.disabled = true;
      setStatus(saveStatus, "info", isPublic ? "Saving + publishing..." : "Saving image...");

      const formData = new FormData();
      formData.append("file", window.lastFile);
      formData.append("detection_token", window.lastDetectionToken);
      formData.append("is_public", isPublic ? "true" : "false");

      try {
        const res = await fetch("/upload/image", {
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
        setDebug({ url: "/upload/image", status: res.status, body: data });

        if (!res.ok) {
          // Hide loader only on error so user can see the status message
          if (window.AppLoader) window.AppLoader.hide();
          setStatus(saveStatus, "error", data.detail || `Save failed (${res.status})`);
          btnSave.disabled = false;
          return;
        }

        // --- PRIVATE SAVE PATH ---
        if (!isPublic) {
          setStatus(saveStatus, "success", "Saved image.");
          // Update loader for private redirect
          if (window.AppLoader) window.AppLoader.show("Redirecting to your scans...");
          setTimeout(() => {
            window.location.href = "/scans";
          }, 900);
          return;
        }

        // --- PUBLIC PUBLISHING PATH ---
        setStatus(saveStatus, "info", "Creating community post...");

        const uploadPayload =
          data &&
          typeof data === "object" &&
          data.body &&
          typeof data.body === "object"
            ? data.body
            : data;

        const resolvedImageId =
          (uploadPayload && uploadPayload.image_id) ||
          (uploadPayload && uploadPayload.image && uploadPayload.image.image_id) ||
          (data && data.image && data.image.image_id) ||
          null;

        if (!resolvedImageId) {
          if (window.AppLoader) window.AppLoader.hide();
          console.error("Upload response missing image_id. Raw response:", data);
          setStatus(
            saveStatus,
            "error",
            "Saved image, but could not read image_id from server response.",
          );
          btnSave.disabled = false;
          return;
        }

        const postBody = {
          user_id: window.currentUserId,
          image_id: resolvedImageId,
          description,
          result: {
            verdict: (uploadPayload && uploadPayload.verdict) || (data && data.verdict) || null,
            label: (uploadPayload && uploadPayload.label) || (data && data.label) || null,
            confidence: (uploadPayload && uploadPayload.confidence) || (data && data.confidence) || null,
          },
        };

        const postRes = await fetch("/community/posts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "include",
          body: JSON.stringify(postBody),
        });

        let postJson = null;
        try {
          postJson = await postRes.json();
        } catch {
          postJson = { detail: "Non-JSON response" };
        }
        setDebug({ url: "/community/posts", status: postRes.status, body: postJson });

        if (postRes.ok) {
          setStatus(saveStatus, "success", "Saved image + published post.");
          
          // 2. Lock the loader for the external redirect
          if (window.AppLoader) {
            window.AppLoader.show("Loading Community...");
          }

          // Use a buffer to ensure the loader is visible while the browser fetches the external module
          setTimeout(() => {
            window.location.href = "/community";
          }, 1000);
        } else {
          if (window.AppLoader) window.AppLoader.hide();
          setStatus(
            saveStatus,
            "error",
            postJson.error ||
              postJson.detail ||
              `Post failed (${postRes.status})`,
          );
          btnSave.disabled = false;
        }

        if (saveResult) saveResult.textContent = "";
      } catch (err) {
        console.error(err);
        if (window.AppLoader) window.AppLoader.hide();
        setStatus(saveStatus, "error", "Network error during save.");
        btnSave.disabled = false;
      }
    });
  }

  // Expose renderDetection if you ever want to call it from results.js
  function renderDetection(resp) {
    if (!resp || typeof resp !== "object") {
      if (detectResult) {
        detectResult.style.display = "";
        detectResult.textContent = JSON.stringify(resp, null, 2);
      }
      if (detectCard) detectCard.hidden = true;
      return;
    }

    const label = (resp.label || resp.result || "Unknown").toString();
    const confidence = Number.isFinite(resp.confidence)
      ? resp.confidence
      : resp.score || 0;

    const labelLower = label.toLowerCase();
    const isAi = labelLower.includes("ai");
    const ai_prob = isAi ? confidence : 1 - confidence;
    const real_prob = 1 - ai_prob;

    let labelClass = "label-neutral";
    if (labelLower.includes("ai")) {
      if (labelLower.includes("most likely")) labelClass = "label-strong-ai";
      else if (labelLower.includes("likely")) labelClass = "label-medium-ai";
      else labelClass = "label-medium-ai";
    } else if (labelLower.includes("real")) {
      if (labelLower.includes("most likely")) labelClass = "label-strong-real";
      else if (labelLower.includes("likely")) labelClass = "label-medium-real";
      else labelClass = "label-medium-real";
    } else if (labelLower.includes("not sure")) {
      labelClass = "label-neutral";
    } else {
      labelClass = "label-neutral";
    }

    if (verdictEl) {
      verdictEl.textContent = label;
      verdictEl.className = `verdict-text ${labelClass}`;
    }
    if (confidenceEl)
      confidenceEl.textContent = `Confidence: ${(confidence * 100).toFixed(1)}%`;

    if (realFill && aiFill) {
      realFill.style.width = `${(real_prob * 100).toFixed(2)}%`;
      aiFill.style.width = `${(ai_prob * 100).toFixed(2)}%`;
    }

    if (detectResult) detectResult.style.display = "none";
    if (detectCard) detectCard.hidden = false;

    if (detectCard) detectCard.latestResponse = resp;
  }

  // Initial auth/me to populate header user chip (silent if fails)
  (async () => {
    try {
      const { res, data } = await jsonFetch("GET", "/auth/me", null);
      if (res.ok) {
        setCurrentUserChip(data);
        window.currentUserId = data.user_id || null;
      } else {
        setCurrentUserChip(null);
        window.currentUserId = null;
      }
    } catch {
      // ignore
    }
  })();

  // Only export this renderDetection on the UPLOAD page.
  // (On Results page, results.js owns renderDetection.)
  if (document.getElementById("btn-check")) {
    window.renderDetection = renderDetection;
  }
});