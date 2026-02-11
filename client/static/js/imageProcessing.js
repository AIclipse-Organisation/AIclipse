window.addEventListener("DOMContentLoaded", () => {
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const TOO_LARGE_MSG = "Image is too large. Max allowed size is 5 MB.";

  const fileInput = document.getElementById("file-input");
  const btnCheck = document.getElementById("btn-check");
  const checkState = document.getElementById("check-state");
  const previewImg = document.getElementById("preview-image");
  let lastPreviewUrl = null;

  // SAVE UI
  const btnSave = document.getElementById("btn-save");
  const savePublic = document.getElementById("save-public");
  const saveState = document.getElementById("save-state");
  const saveStatus = document.getElementById("save-status");
  const saveResult = document.getElementById("save-result");

  const publicDescWrap = document.getElementById("public-desc-wrap");
  const postDescriptionInput = document.getElementById("post-description");
  const postDescriptionHint = document.getElementById("post-description-hint");

  // state
  window.lastFile = null;
  window.lastDetectionToken = window.lastDetectionToken || null;
  window.currentUserId = null;

  function setCheck(text, kind) {
    if (!checkState) return;
    checkState.textContent = text || "";
    checkState.classList.remove("status-error", "status-success", "status-info");
    if (kind === "error") checkState.classList.add("status-error");
    else if (kind === "success") checkState.classList.add("status-success");
    else if (kind === "info") checkState.classList.add("status-info");
  }

  function clearFileSelection(message, kind = "info") {
    window.lastFile = null;
    try { if (fileInput) fileInput.value = ""; } catch {}
    if (btnCheck) btnCheck.disabled = true;

    if (previewImg) {
      if (lastPreviewUrl) URL.revokeObjectURL(lastPreviewUrl);
      lastPreviewUrl = null;
      previewImg.src = "";
      previewImg.hidden = true;
    }

    setCheck(message || "Select an image to analyze.", kind);

    // reset SAVE UI if present
    if (btnSave) btnSave.disabled = true;
    if (saveState) saveState.textContent = "Run detection first to enable saving.";
    if (saveResult) saveResult.textContent = "";
    if (typeof window.setStatus === "function") window.setStatus(saveStatus, "info", "");
  }

  // Upload page: file chosen
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0] || null;

      // label selected style
      const uploadLabel = document.querySelector("label.file-upload");
      if (uploadLabel) uploadLabel.classList.toggle("is-selected", !!file);

      if (!file) {
        clearFileSelection("Select an image to analyze.", "info");
        return;
      }

      if (file.size > MAX_IMAGE_BYTES) {
        clearFileSelection(TOO_LARGE_MSG, "error");
        return;
      }

      window.lastFile = file;
      if (btnCheck) btnCheck.disabled = false;


      if (previewImg) {
        if (lastPreviewUrl) URL.revokeObjectURL(lastPreviewUrl);
        lastPreviewUrl = URL.createObjectURL(file);
        previewImg.src = lastPreviewUrl;
        previewImg.hidden = false;
      }

      // reset SAVE UI
      if (btnSave) btnSave.disabled = true;
      if (saveState) saveState.textContent = "Run detection first to enable saving.";
      if (saveResult) saveResult.textContent = "";
      if (typeof window.setStatus === "function") window.setStatus(saveStatus, "info", "");

      setCheck(`Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`, "info");
    });
  }

  if (btnCheck) {
    btnCheck.addEventListener("click", async () => {
      const file = window.lastFile;

      if (!file) {
        setCheck("No file selected.", "error");
        return;
      }

      if (file.size > MAX_IMAGE_BYTES) {
        clearFileSelection(TOO_LARGE_MSG, "error");
        return;
      }

      btnCheck.disabled = true;
      setCheck("Analyzing image...", "info");

      // disable SAVE until token arrives
      if (btnSave) btnSave.disabled = true;
      if (saveState) saveState.textContent = "Run detection first to enable saving.";
      if (saveResult) saveResult.textContent = "";
      if (typeof window.setStatus === "function") window.setStatus(saveStatus, "info", "");

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/checks", { method: "POST", body: formData, credentials: "include" });

        let data = null;
        try { data = await res.json(); } catch { data = { detail: "Non-JSON response" }; }
        if (typeof window.setDebug === "function") window.setDebug({ url: "/checks", status: res.status, body: data });

        if (!res.ok) {
          if (res.status === 413) {
            clearFileSelection(TOO_LARGE_MSG, "error");
            return;
          }
          setCheck(data.detail || `Detection failed (${res.status})`, "error");
          return;
        }

        const token = data.detection_token || null;
        window.lastDetectionToken = token;

        // store for results page
        try { sessionStorage.setItem("lastDetectionResponse", JSON.stringify(data)); } catch {}
        try { sessionStorage.setItem("lastDetectionToken", token || ""); } catch {}

        // store preview as dataURL for results page
        try {
          const reader = new FileReader();
          reader.onload = () => {
            try { sessionStorage.setItem("lastDetectionPreview", reader.result); } catch {}
            window.location.href = "/results";
          };
          reader.onerror = () => window.location.href = "/results";
          reader.readAsDataURL(file);
        } catch {
          window.location.href = "/results";
        }
      } catch (err) {
        console.error(err);
        setCheck("Network error during detection.", "error");
      } finally {
        btnCheck.disabled = false;
      }
    });
  }

  // Results page: Save Image
  if (btnSave) {
    btnSave.addEventListener("click", async () => {
      if (!window.lastFile) {
        if (typeof window.setStatus === "function") window.setStatus(saveStatus, "error", "No file selected.");
        return;
      }
      if (!window.lastDetectionToken) {
        if (typeof window.setStatus === "function") window.setStatus(saveStatus, "error", "No detection token. Run detection first.");
        return;
      }

      const isPublic = !!(savePublic && savePublic.checked);
      const description = (postDescriptionInput && postDescriptionInput.value ? postDescriptionInput.value : "").trim();

      // Publishing requirements
      if (isPublic && !window.currentUserId) {
        if (typeof window.setStatus === "function") window.setStatus(saveStatus, "error", "You must be signed in to publish to community.");
        return;
      }
      if (isPublic && !description) {
        if (typeof window.setStatus === "function") window.setStatus(saveStatus, "error", "Description is required when publishing.");
        return;
      }
      if (description.length > 1000) {
        if (typeof window.setStatus === "function") window.setStatus(saveStatus, "error", `Description too long (${description.length}/1000 characters).`);
        return;
      }

      btnSave.disabled = true;
      if (typeof window.setStatus === "function") window.setStatus(saveStatus, "info", "Saving image...");

      const formData = new FormData();
      formData.append("file", window.lastFile);
      formData.append("detection_token", window.lastDetectionToken);
      formData.append("is_public", isPublic ? "true" : "false");

      try {
        const res = await fetch("/upload/image", { method: "POST", body: formData, credentials: "include" });

        let data = null;
        try { data = await res.json(); } catch { data = { detail: "Non-JSON response" }; }
        if (typeof window.setDebug === "function") window.setDebug({ url: "/upload/image", status: res.status, body: data });

        if (!res.ok) {
          const msg = (res.status === 413) ? TOO_LARGE_MSG : (data.detail || `Save failed (${res.status})`);
          if (typeof window.setStatus === "function") window.setStatus(saveStatus, "error", msg);
          return;
        }

        if (typeof window.setStatus === "function") window.setStatus(saveStatus, "success", "Saved image.");

        if (isPublic) {
          if (typeof window.setStatus === "function") window.setStatus(saveStatus, "info", "Creating community post...");

          const uploadPayload =
            (data && typeof data === "object" && data.body && typeof data.body === "object")
              ? data.body
              : data;

          const resolvedImageId =
            (uploadPayload && uploadPayload.image_id) ||
            (uploadPayload && uploadPayload.image && uploadPayload.image.image_id) ||
            (data && data.image && data.image.image_id) || null;

          if (!resolvedImageId) {
            console.error("Upload response missing image_id. Raw response:", data);
            if (typeof window.setStatus === "function") window.setStatus(saveStatus, "error", "Saved image, but could not read image_id from server response.");
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
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            credentials: "include",
            body: JSON.stringify(postBody),
          });

          let postJson = null;
          try { postJson = await postRes.json(); } catch { postJson = { detail: "Non-JSON response" }; }
          if (typeof window.setDebug === "function") window.setDebug({ url: "/community/posts", status: postRes.status, body: postJson });

          if (postRes.ok) {
            if (typeof window.setStatus === "function") window.setStatus(saveStatus, "success", "Saved image + published post.");
            setTimeout(() => { window.location.href = "/community"; }, 800);
          } else {
            if (typeof window.setStatus === "function") window.setStatus(saveStatus, "error", postJson.error || postJson.detail || `Post failed (${postRes.status})`);
          }
        } else {
          setTimeout(() => { window.location.href = "/scans"; }, 800);
        }

        if (saveResult) saveResult.textContent = "";
      } catch (err) {
        console.error(err);
        if (typeof window.setStatus === "function") window.setStatus(saveStatus, "error", "Network error during save.");
      } finally {
        btnSave.disabled = false;
      }
    });
  }

  // Auth/me for chip + currentUserId (no check-state spam)
  (async () => {
    try {
      const res = await fetch("/auth/me", { method: "GET", headers: { Accept: "application/json" }, credentials: "include" });
      if (!res.ok) {
        if (typeof window.setCurrentUserChip === "function") window.setCurrentUserChip(null);
        window.currentUserId = null;
        return;
      }
      const data = await res.json().catch(() => null);
      if (typeof window.setCurrentUserChip === "function") window.setCurrentUserChip(data);
      window.currentUserId = data?.user_id || null;
    } catch {
      // ignore
    }
  })();

  window.addEventListener("beforeunload", () => {
    if (lastPreviewUrl) URL.revokeObjectURL(lastPreviewUrl);
  });
});
