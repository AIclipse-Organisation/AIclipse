function setDebug(data) {
    const pre = document.getElementById("debug-output");
    if (!pre) return;
    pre.textContent = JSON.stringify(data, null, 2);
}

function renderDetection(resp) {
    const detectCard = document.getElementById("detect-card");
    const verdictEl = document.getElementById("detect-verdict");
    const confidenceEl = document.getElementById("detect-confidence");
    const realFill = document.querySelector(".real-fill");
    const aiFill = document.querySelector(".ai-fill");

    if (!resp || typeof resp !== "object") {
        if (detectCard) detectCard.hidden = true;
        return;
    }

    const label = (resp.label || resp.result || "Unknown").toString();
    const confidence = Number.isFinite(resp.confidence) ? resp.confidence : (resp.score || 0);

    const labelLower = label.toLowerCase();
    const isAi = labelLower.includes("ai");
    const ai_prob = isAi ? confidence : (1 - confidence);
    const real_prob = 1 - ai_prob;

    let labelClass = "label-neutral";
    if (labelLower.includes("ai")) {
        if (labelLower.includes("most likely")) labelClass = "label-strong-ai";
        else labelClass = "label-medium-ai";
    } else if (labelLower.includes("real")) {
        if (labelLower.includes("most likely")) labelClass = "label-strong-real";
        else labelClass = "label-medium-real";
    }

    if (verdictEl) {
        verdictEl.textContent = label;
        verdictEl.className = `verdict-text ${labelClass}`;
    }
    if (confidenceEl) confidenceEl.textContent = `Confidence: ${(confidence * 100).toFixed(1)}%`;

    if (realFill && aiFill) {
        realFill.style.width = `${(real_prob * 100).toFixed(2)}%`;
        aiFill.style.width = `${(ai_prob * 100).toFixed(2)}%`;
    }

    if (detectCard) detectCard.hidden = false;
}

function dataURLtoFile(dataUrl, filename = "upload.png") {
  const [header, base64] = (dataUrl || "").split(",");
  if (!header || !base64) return null;

  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";

  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);

  return new File([bytes], filename, { type: mime });
}

window.addEventListener("DOMContentLoaded", () => {
  const stored = sessionStorage.getItem("lastDetectionResponse");
  const preview = sessionStorage.getItem("lastDetectionPreview");
  const token = sessionStorage.getItem("lastDetectionToken") || "";

  // Must have these to use results + save
  if (!stored || !preview || !token) {
    console.log("Missing sessionStorage items:", { stored: !!stored, preview: !!preview, token: !!token });
    window.location.href = "/imgProcessing";
    return;
  }

  // Rebuild file + token for saving
  window.lastDetectionToken = token;
  window.lastFile = dataURLtoFile(preview, "upload.png");

  // HARD DEBUG (this will show you immediately what's wrong)
  setDebug({
    from: "sessionStorage",
    tokenExists: !!window.lastDetectionToken,
    tokenPreview: token.slice(0, 10) + "...",
    previewStartsWith: preview.slice(0, 30),
    fileExists: !!window.lastFile,
    fileType: window.lastFile?.type,
    fileSize: window.lastFile?.size,
  });

  // If file reconstruction failed, stop and show error
  if (!window.lastFile) {
    const saveStatus = document.getElementById("save-status");
    if (saveStatus) {
      saveStatus.textContent = "Could not rebuild file for saving. Please re-upload.";
    }
    return;
  }

  // Preview image
  const img = document.getElementById("preview-image");
  if (img) img.src = preview;

  // Render results UI
  const data = JSON.parse(stored);
  renderDetection(data);

  // Enable Save now that we have file + token
  const btnSave = document.getElementById("btn-save");
  const saveState = document.getElementById("save-state");
  if (btnSave) btnSave.disabled = false;
  if (saveState) saveState.textContent = "Ready to save.";

  // Back button
  const btnBack = document.getElementById("btn-back");
  if (btnBack) btnBack.addEventListener("click", () => history.back());
});


  // Delete modal
  const deleteBtn = document.getElementById("btn-delete");
  const modal = document.getElementById("delete-modal");
  const cancelBtn = document.getElementById("cancel-delete");
  const confirmBtn = document.getElementById("confirm-delete");

  if (modal) modal.hidden = true; // force closed on load

  if (deleteBtn && modal && cancelBtn && confirmBtn) {
    deleteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      modal.hidden = false;
    });

    cancelBtn.addEventListener("click", (e) => {
      e.preventDefault();
      modal.hidden = true;
    });

    confirmBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      modal.hidden = true;

      try {
        // Clear UI (safe fallback)
        const preview = document.getElementById("preview-image");
        if (preview) preview.src = "";

        const verdict = document.getElementById("detect-verdict");
        if (verdict) verdict.textContent = "—";

        window.history.back();
      } catch (err) {
        console.error("Delete failed", err);
      }
    });
  }
