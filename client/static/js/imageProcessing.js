/* imageProcessing.js
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
  const btnCheck = document.getElementById("btn-check");
  const checkState = document.getElementById("check-state");

  const detectStatus = document.getElementById("detect-status");
  const detectResult = document.getElementById("detect-result");

  const previewImg = document.getElementById("preview-image");
  const uploadFrame = document.getElementById("upload-frame");
  const cropHint = document.getElementById("crop-hint");
  const cropResetBtn = document.getElementById("btn-crop-reset");
  const uploadPreviewWrap = document.getElementById("upload-preview-wrap");

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

  // State
  window.lastFile = null; // IMPORTANT: will become the cropped file after user clicks View Results
  window.lastDetectionToken = null;
  window.currentUserId = null;

  // Crop state (object-position % values)
  let cropX = 50; // 0..100
  let cropY = 20; // 0..100 (top-biased helps keep heads)

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

    // Only allow safe blob: or data: URLs (what we generate client-side)
    if (typeof url !== "string") {
      imgEl.removeAttribute("src");
      return;
    }

    const isBlobUrl = url.startsWith("blob:");
    const isDataUrl = url.startsWith("data:");

    // For blob: URLs, do a minimal structural check to ensure they look like
    // ones produced via URL.createObjectURL (e.g., "blob:<origin>/<uuid>").
    if (isBlobUrl) {
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
    } else if (isDataUrl) {
      // Only allow data URLs for image media types, e.g. data:image/png;base64,...
      // This prevents arbitrary data: payloads from being used as active content.
      if (!/^data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+$/.test(url)) {
        imgEl.removeAttribute("src");
        return;
      }
    } else {
      imgEl.removeAttribute("src");
      return;
    }

    imgEl.src = url;
  }

  // File chosen -> show preview frame + enable button
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];

      if (file && file.size > MAX_IMAGE_BYTES) {
        window.lastFile = null;
        window.lastDetectionToken = null;

        try {
          fileInput.value = "";
        } catch {}

        const uploadLabel = document.querySelector("label.file-upload");
        if (uploadLabel) uploadLabel.classList.remove("is-selected");

        if (previewImg) {
          if (lastPreviewUrl) {
            URL.revokeObjectURL(lastPreviewUrl);
            lastPreviewUrl = null;
          }
          previewImg.src = "";
        }
        if (uploadPreviewWrap) uploadPreviewWrap.hidden = true;

        if (btnSave) btnSave.disabled = true;
        if (saveState)
          saveState.textContent = "Run detection first to enable saving.";
        if (saveResult) saveResult.textContent = "";
        if (saveStatus) setStatus(saveStatus, "info", "");

        if (btnCheck) btnCheck.disabled = true;
        if (checkState) checkState.textContent = TOO_LARGE_MSG;

        if (detectResult) detectResult.textContent = "No detection yet.";
        if (detectStatus) setStatus(detectStatus, "info", "");
        return;
      }

      window.lastFile = file || null;
      window.lastDetectionToken = null;

      const uploadLabel = document.querySelector("label.file-upload");
      if (uploadLabel) uploadLabel.classList.toggle("is-selected", !!file);

      // Reset crop position on new file (nice UX)
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

      if (uploadPreviewWrap) uploadPreviewWrap.hidden = !file;

      // Reset SAVE UI if present
      if (btnSave) btnSave.disabled = true;
      if (saveState)
        saveState.textContent = "Run detection first to enable saving.";
      if (saveResult) saveResult.textContent = "";
      if (saveStatus) setStatus(saveStatus, "info", "");

      if (file) {
        if (btnCheck) btnCheck.disabled = false;
        if (checkState)
          checkState.textContent = `Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`;
        if (detectResult)
          detectResult.textContent = "No detection yet for this file.";
      } else {
        if (btnCheck) btnCheck.disabled = true;
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

      btnCheck.disabled = true;
      window.lastDetectionToken = null;

      // disable SAVE until token arrives (if present)
      if (btnSave) btnSave.disabled = true;
      if (saveState)
        saveState.textContent = "Run detection first to enable saving.";
      if (saveResult) saveResult.textContent = "";
      if (saveStatus) setStatus(saveStatus, "info", "");

      setStatus(detectStatus, "info", "Analyzing image...");

      try {
        // IMPORTANT: create cropped file based on user's drag framing.
        // Must match your CSS aspect-ratio. If square: 1. If 4/5: 0.8, etc.
        const frameAspect = 1; // <-- change if you change the frame ratio in CSS
        const { croppedFile, previewDataUrl } =
          await makeCroppedFileFromOriginal(window.lastFile, frameAspect);

        // Use CROPPED file from now on (for checks + later saving/publishing)
        window.lastFile = croppedFile;

        // Store CROPPED preview for results page
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
          if (saveState)
            saveState.textContent = "Run detection first to enable saving.";
          if (detectResult)
            detectResult.textContent = JSON.stringify(data, null, 2);

          if (res.status === 413) {
            if (checkState) checkState.textContent = TOO_LARGE_MSG;
            if (detectStatus) setStatus(detectStatus, "info", "");
          } else {
            setStatus(
              detectStatus,
              "error",
              data.detail || `Detection failed (${res.status})`,
            );
          }
          return;
        }

        const lastDetectionToken = data.detection_token || null;
        window.lastDetectionToken = lastDetectionToken;
        window.lastDetectionToken = lastDetectionToken;

        // enable SAVE if we have a token (results page only)
        if (btnSave) btnSave.disabled = !lastDetectionToken;
        if (saveState) {
          saveState.textContent = lastDetectionToken
            ? "Detection token ready. You can now save this image."
            : "No detection token returned; cannot save.";
        }

        // store results for results page
        sessionStorage.setItem("lastDetectionResponse", JSON.stringify(data));
        sessionStorage.setItem("lastDetectionToken", lastDetectionToken);

        setStatus(detectStatus, "success", "Detection completed.");
        window.location.href = "/results";
      } catch (err) {
        console.error(err);
        if (btnSave) btnSave.disabled = true;
        if (saveState)
          saveState.textContent = "Run detection first to enable saving.";
        setStatus(detectStatus, "error", "Network error during detection.");
      } finally {
        btnCheck.disabled = false;
      }
    });
  }

  // SAVE button -> POST /upload/image with file + detection_token (uses CROPPED window.lastFile)
  if (btnSave) {
    btnSave.addEventListener("click", async () => {
      if (!window.lastFile) {
        setStatus(saveStatus, "error", "No file selected.");
        return;
      }
      if (!window.lastDetectionToken) {
        setStatus(
          saveStatus,
          "error",
          "No detection token. Run detection first.",
        );
        return;
      }

      const isPublic = !!(savePublic && savePublic.checked);
      const description = (
        postDescriptionInput && postDescriptionInput.value
          ? postDescriptionInput.value
          : ""
      ).trim();

      if (isPublic && !window.currentUserId) {
        setStatus(
          saveStatus,
          "error",
          "You must be signed in to publish to community.",
        );
        return;
      }
      if (isPublic && !description) {
        setStatus(
          saveStatus,
          "error",
          "Description is required when publishing.",
        );
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

      btnSave.disabled = true;
      setStatus(saveStatus, "info", "Saving image...");

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
          setStatus(
            saveStatus,
            "error",
            data.detail || `Save failed (${res.status})`,
          );
          return;
        }

        setStatus(saveStatus, "success", "Saved image.");

        if (isPublic) {
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
            (uploadPayload &&
              uploadPayload.image &&
              uploadPayload.image.image_id) ||
            (data && data.image && data.image.image_id) ||
            null;

          if (!resolvedImageId) {
            console.error(
              "Upload response missing image_id. Raw response:",
              data,
            );
            setStatus(
              saveStatus,
              "error",
              "Saved image, but could not read image_id from server response.",
            );
            return;
          }

          const resolvedVerdict =
            (uploadPayload && uploadPayload.verdict) ||
            (uploadPayload &&
              uploadPayload.result &&
              uploadPayload.result.verdict) ||
            (data && data.verdict) ||
            null;

          const resolvedLabel =
            (uploadPayload && uploadPayload.label) ||
            (uploadPayload &&
              uploadPayload.result &&
              uploadPayload.result.label) ||
            (data && data.label) ||
            null;

          const resolvedConfidence =
            (uploadPayload && uploadPayload.confidence) ||
            (uploadPayload &&
              uploadPayload.result &&
              uploadPayload.result.confidence) ||
            (data && data.confidence) ||
            null;

          const postBody = {
            user_id: window.currentUserId,
            image_id: resolvedImageId,
            description,
            result: {
              verdict: resolvedVerdict,
              label: resolvedLabel,
              confidence: resolvedConfidence,
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
          setDebug({
            url: "/community/posts",
            status: postRes.status,
            body: postJson,
          });

          if (postRes.ok) {
            setStatus(saveStatus, "success", "Saved image + published post.");
            setTimeout(() => {
              window.location.href = "/community";
            }, 1000);
          } else {
            setStatus(
              saveStatus,
              "error",
              postJson.error ||
                postJson.detail ||
                `Post failed (${postRes.status})`,
            );
          }
        } else {
          setTimeout(() => {
            window.location.href = "/scans";
          }, 1000);
        }

        if (saveResult) saveResult.textContent = "";
      } catch (err) {
        console.error(err);
        setStatus(saveStatus, "error", "Network error during save.");
      } finally {
        btnSave.disabled = false;
      }
    });
  }

  // Optional renderDetection (used on results page if you call it)
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

  // Expose renderDetection if you ever want to call it from results.js
  window.renderDetection = renderDetection;
});
