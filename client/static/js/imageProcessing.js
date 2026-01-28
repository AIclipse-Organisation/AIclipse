function setStatus(el, type, text) {
  if (!el) return;
  el.innerHTML = "";
  if (!text) return;
  const span = document.createElement("span");
  span.textContent = text;
  span.classList.add(
    type === "success" ? "status-success" :
      type === "error" ? "status-error" :
        "status-info"
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

// Helper to get cookie value 
// function getCookie(name) {
//   const value = `; ${document.cookie}`;
//   const parts = value.split(`; ${name}=`);
//   if (parts.length === 2) return parts.pop().split(';').shift();
//   return null;
// }


async function jsonFetch(method, url, body) {
  const opts = { method, headers: { Accept: "application/json" } };
  if (body != null) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  opts.credentials = "include";

  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { data = { detail: "Non-JSON response" }; }
  setDebug({ url, status: res.status, body: data });
  return { res, data };
}

window.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("file-input");
  const btnCheck = document.getElementById("btn-check");
  const checkState = document.getElementById("check-state");
  const detectStatus = document.getElementById("detect-status");
  const detectResult = document.getElementById("detect-result");
  const debugOutput = document.getElementById("debug-output");
  const previewImg = document.getElementById("preview-image");
  let lastPreviewUrl = null;

  // SAVE UI
  const btnSave = document.getElementById("btn-save");
  const savePublic = document.getElementById("save-public");
  const saveState = document.getElementById("save-state");
  const saveStatus = document.getElementById("save-status");
  const saveResult = document.getElementById("save-result");

  // Description UI
  const publicDescWrap = document.getElementById("public-desc-wrap");
  const postDescriptionInput = document.getElementById("post-description");
  const postDescriptionHint = document.getElementById("post-description-hint");

  // elements inside detect card
  const detectCard = document.getElementById("detect-card");
  const verdictEl = document.getElementById("detect-verdict");
  const confidenceEl = document.getElementById("detect-confidence");
  const realFill = document.querySelector(".real-fill");
  const aiFill = document.querySelector(".ai-fill");

  // PUBLIC IMAGES UI
  // const publicImagesEl = document.getElementById("public-images");

  // state
  window.lastFile = null;
  let lastDetectionToken = null;



  // store current user id 
  window.currentUserId = null;

  function syncPublishUI() {
    const isPublic = !!(savePublic && savePublic.checked);
    if (publicDescWrap) publicDescWrap.hidden = !isPublic;
    if (postDescriptionHint) postDescriptionHint.textContent = isPublic ? "Required when publishing." : "";
  }
  if (savePublic) savePublic.addEventListener("change", syncPublishUI);
  syncPublishUI();

  // file chosen -> enable check button
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      window.lastFile = file || null;
      lastDetectionToken = null;

      const uploadLabel = document.querySelector('label.file-upload');

      if (uploadLabel) {
        uploadLabel.classList.toggle("is-selected", !!file);
      }


      if (previewImg) {
        // cleanup old blob url
        if (lastPreviewUrl) {
          URL.revokeObjectURL(lastPreviewUrl);
          lastPreviewUrl = null;
        }

        if (file) {
          lastPreviewUrl = URL.createObjectURL(file);
          previewImg.src = lastPreviewUrl;
          previewImg.hidden = false;
        } else {
          previewImg.src = "";
          previewImg.hidden = true;
        }
      }

      // reset SAVE UI
      if (btnSave) btnSave.disabled = true;
      if (saveState) saveState.textContent = "Run detection first to enable saving.";
      if (saveResult) saveResult.textContent = "";
      if (saveStatus) setStatus(saveStatus, "info", "");

      if (file) {
        if (btnCheck) btnCheck.disabled = false;
        if (checkState) checkState.textContent = `Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`;
        if (detectResult) detectResult.textContent = "No detection yet for this file.";
      } else {
        if (btnCheck) btnCheck.disabled = true;
        if (checkState) checkState.textContent = "Select a file to enable detection.";
        if (detectResult) detectResult.textContent = "No detection yet.";
      }
    });
  }

  // btnCheck click -> POST /checks with file
  if (btnCheck) {
    btnCheck.addEventListener("click", async () => {
      if (!window.lastFile) {
        setStatus(detectStatus, "error", "No file selected.");
        return;
      }

      btnCheck.disabled = true;
      lastDetectionToken = null;

      // disable SAVE until token arrives
      if (btnSave) btnSave.disabled = true;
      if (saveState) saveState.textContent = "Run detection first to enable saving.";
      if (saveResult) saveResult.textContent = "";
      if (saveStatus) setStatus(saveStatus, "info", "");

      setStatus(detectStatus, "info", "Analyzing image...");

      const formData = new FormData();
      formData.append("file", window.lastFile);

      try {
        const res = await fetch("/checks", { method: "POST", body: formData, credentials: "include" });
        let data = null;
        try { data = await res.json(); } catch { data = { detail: "Non-JSON response" }; }
        setDebug({ url: "/checks", status: res.status, body: data });

        if (res.ok) {
          lastDetectionToken = data.detection_token || null;
          window.lastDetectionToken = lastDetectionToken;

          // enable SAVE if we have a token
          if (btnSave) btnSave.disabled = !lastDetectionToken;
          if (saveState) {
            saveState.textContent = lastDetectionToken
              ? "Detection token ready. You can now save this image."
              : "No detection token returned; cannot save.";
          }

          // keep raw JSON for debugging (hidden by default)
          if (detectResult) detectResult.textContent = JSON.stringify(data, null, 2);

          // render verdict/progress bar
          // store results for results page
          sessionStorage.setItem("lastDetectionResponse", JSON.stringify(data));
          sessionStorage.setItem("lastDetectionToken", lastDetectionToken);

          // store preview image too (optional but nice)
          // note: you already have window.lastFile
          if (window.lastFile) {
            const reader = new FileReader();
            reader.onload = () => {
              sessionStorage.setItem("lastDetectionPreview", reader.result);
              window.location.href = "/results";
            };
            reader.readAsDataURL(window.lastFile);
          } else {
            window.location.href = "/results";
          }
          return; // stop running upload page UI code

          setStatus(detectStatus, "success", "Detection completed.");
        } else {
          lastDetectionToken = null;
          if (btnSave) btnSave.disabled = true;
          if (saveState) saveState.textContent = "Run detection first to enable saving.";
          if (detectResult) detectResult.textContent = JSON.stringify(data, null, 2);
          setStatus(detectStatus, "error", data.detail || `Detection failed (${res.status})`);
        }
      } catch (err) {
        console.error(err);
        if (btnSave) btnSave.disabled = true;
        if (saveState) saveState.textContent = "Run detection first to enable saving.";
        setStatus(detectStatus, "error", "Network error during detection.");
      } finally {
        btnCheck.disabled = false;
      }
    });
  }

  // SAVE button -> POST /upload/image with file + detection_token
  if (btnSave) {
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
      const description = (postDescriptionInput && postDescriptionInput.value ? postDescriptionInput.value : "").trim();

      // Check authentication before attempting to save if publishing
      if (isPublic && !window.currentUserId) {
        setStatus(saveStatus, "error", "You must be signed in to publish to community.");
        return;
      }

      if (isPublic && !description) {
        setStatus(saveStatus, "error", "Description is required when publishing.");
        return;
      }

      // Validate description length 
      if (description.length > 1000) {
        setStatus(saveStatus, "error", `Description too long (${description.length}/1000 characters).`);
        return;
      }

      btnSave.disabled = true;
      setStatus(saveStatus, "info", "Saving image...");

      const formData = new FormData();
      formData.append("file", window.lastFile);
      formData.append("detection_token", window.lastDetectionToken);
      formData.append("is_public", isPublic ? "true" : "false");

      try {
        const res = await fetch("/upload/image", { method: "POST", body: formData, credentials: "include" });
        let data = null;
        try { data = await res.json(); } catch { data = { detail: "Non-JSON response" }; }
        setDebug({ url: "/upload/image", status: res.status, body: data });

        if (!res.ok) {
          setStatus(saveStatus, "error", data.detail || `Save failed (${res.status})`);
          return;
        }

        setStatus(saveStatus, "success", "Saved image.");


        if (isPublic) {
          setStatus(saveStatus, "info", "Creating community post...");

          const uploadPayload = (data && typeof data === "object" && data.body && typeof data.body === "object")
            ? data.body
            : data;


          const resolvedImageId =
            (uploadPayload && uploadPayload.image_id) ||
            (uploadPayload && uploadPayload.image && uploadPayload.image.image_id) ||
            (data && data.image && data.image.image_id) || null;

          if (!resolvedImageId) {
            console.error("Upload response missing image_id. Raw response:", data);
            setStatus(saveStatus, "error", "Saved image, but could not read image_id from server response.");
            return;
          }

          const resolvedVerdict =
            (uploadPayload && uploadPayload.verdict) ||
            (uploadPayload && uploadPayload.result && uploadPayload.result.verdict) ||
            (data && data.verdict) ||
            null;

          const resolvedLabel =
            (uploadPayload && uploadPayload.label) ||
            (uploadPayload && uploadPayload.result && uploadPayload.result.label) ||
            (data && data.label) ||
            null;

          const resolvedConfidence =
            (uploadPayload && uploadPayload.confidence) ||
            (uploadPayload && uploadPayload.result && uploadPayload.result.confidence) ||
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
              "Accept": "application/json"
            },
            credentials: "include",
            body: JSON.stringify(postBody),
          });

          let postJson = null;
          try { postJson = await postRes.json(); } catch { postJson = { detail: "Non-JSON response" }; }
          setDebug({ url: "/community/posts", status: postRes.status, body: postJson });

          if (postRes.ok) {
            setStatus(saveStatus, "success", "Saved image + published post.");
            // Redirect to community after publishing
            setTimeout(() => {
              window.location.href = "/community";
            }, 1000);
          } else {
            setStatus(saveStatus, "error", postJson.error || postJson.detail || `Post failed (${postRes.status})`);
          }
        } else {
          // Private image - redirect to scans page
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

  // renderDetection: updates the verdict text, confidence, and two-color bar
  function renderDetection(resp) {
    if (!resp || typeof resp !== "object") {
      if (detectResult) { detectResult.style.display = ""; detectResult.textContent = JSON.stringify(resp, null, 2); }
      if (detectCard) detectCard.hidden = true;
      return;
    }

    const label = (resp.label || resp.result || "Unknown").toString();
    const confidence = Number.isFinite(resp.confidence) ? resp.confidence : (resp.score || 0);

    // compute ai vs real probabilities (mirror your server logic)
    const labelLower = label.toLowerCase();
    const isAi = labelLower.includes("ai");
    const ai_prob = isAi ? confidence : (1 - confidence);
    const real_prob = 1 - ai_prob;

    // decide label class
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

    // update UI
    if (verdictEl) {
      verdictEl.textContent = label;
      verdictEl.className = `verdict-text ${labelClass}`;
    }
    if (confidenceEl) confidenceEl.textContent = `Confidence: ${(confidence * 100).toFixed(1)}%`;

    if (realFill && aiFill) {
      realFill.style.width = `${(real_prob * 100).toFixed(2)}%`;
      aiFill.style.width = `${(ai_prob * 100).toFixed(2)}%`;
    }

    if (detectResult) detectResult.style.display = "none";
    if (detectCard) detectCard.hidden = false;

    // keep the last response on the card for future actions (if needed)
    if (detectCard) detectCard.latestResponse = resp;
  }

  // load public images on page load
  // loadPublicImages();

  // Initial auth/me to populate header user chip (silent if fails)
  (async () => {
    try {
      const { res, data } = await jsonFetch("GET", "/auth/me", null);
      if (res.ok) {
        setCurrentUserChip(data);
        window.currentUserId = data.user_id || null;
        setStatus(document.getElementById("detect-status"), "info", "Session restored from cookie.");
      } else {
        setCurrentUserChip(null);
        window.currentUserId = null;
      }
    } catch (err) {
      // ignore
    }
  })();
});
