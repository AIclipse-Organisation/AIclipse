function setDebug(data) {
  const pre = document.getElementById("debug-output");
  if (!pre) return;
  pre.textContent = JSON.stringify(data, null, 2);
}

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) n = 0;
  return Math.max(min, Math.min(max, n));
}

function setFillPercent(fillEl, percent) {
  if (!fillEl) return;
  const p = clamp(percent, 0, 100);

  fillEl.style.width = p === 0 ? "0px" : `calc(${p}% - 0px)`;
  fillEl.dataset.p = String(p);
}

function renderDetection(resp) {
  const detectCard = document.getElementById("detect-card");
  const verdictEl = document.getElementById("detect-verdict");
  const confidenceEl = document.getElementById("detect-confidence");

  const panel = document.querySelector(".progress-panel");
  const realFill = document.querySelector(".progress-panel .real-fill");
  const aiFill = document.querySelector(".progress-panel .ai-fill");

  const realPercentEl = document.getElementById("real-percent");

  if (!resp || typeof resp !== "object") {
    if (detectCard) detectCard.hidden = true;
    return;
  }

  const rawLabel = (resp.label || resp.result || "Unknown").toString();

  // Strip "87.74%" if present
  const cleanLabel = rawLabel.replace(/^\s*\d+(\.\d+)?%\s*/i, "").trim();

  const confidenceRaw = Number.isFinite(resp.confidence)
    ? resp.confidence
    : (resp.score ?? 0);

  const confidence = Math.max(0, Math.min(1, Number(confidenceRaw) || 0));

  const labelLower = cleanLabel.toLowerCase();

  const isAi =
    labelLower.includes("ai") ||
    labelLower.includes("fake") ||
    labelLower.includes("deepfake");

  const isReal = labelLower.includes("real") && !isAi;

  // REAL% rules:
  // - If verdict is AI: confidence is AI% => REAL = 1 - confidence
  // - If verdict is REAL: confidence is REAL% => REAL = confidence
  // - Otherwise: treat confidence as AI% => REAL = 1 - confidence
  let realProb = isReal ? confidence : (1 - confidence);

  realProb = Math.max(0, Math.min(1, realProb));
  const realPct = realProb * 100;

  window.__lastRealPct = realPct;

  const labelClass = "label-gold";

  if (verdictEl) {
    verdictEl.textContent = cleanLabel;
    verdictEl.className = `verdict-text ${labelClass}`;
  }

  if (confidenceEl) {
    confidenceEl.textContent = `Confidence: ${(confidence * 100).toFixed(1)}%`;
  }

  setFillPercent(realFill, realPct);

  setFillPercent(aiFill, 0);

  if (realPercentEl) realPercentEl.textContent = `${realPct.toFixed(2)}%`;

  if (panel) panel.classList.toggle("is-risk", isAi);

  if (detectCard) detectCard.hidden = false;
}

window.renderDetection = renderDetection;

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

// Button selection helpers
function setSelected(btn, on) {
  if (!btn) return;
  btn.classList.toggle("is-selected", !!on);
}

window.addEventListener("DOMContentLoaded", () => {
  const stored = sessionStorage.getItem("lastDetectionResponse");
  const preview = sessionStorage.getItem("lastDetectionPreview");
  const token = sessionStorage.getItem("lastDetectionToken") || "";

  if (!stored || !preview || !token) {
    console.log("Missing sessionStorage items:", {
      stored: !!stored,
      preview: !!preview,
      token: !!token,
    });
    window.location.href = "/imgProcessing";
    return;
  }

  window.lastDetectionToken = token;
  window.lastFile = dataURLtoFile(preview, "upload.png");

  setDebug({
    from: "sessionStorage",
    tokenExists: !!window.lastDetectionToken,
    tokenPreview: token.slice(0, 10) + "...",
    previewStartsWith: preview.slice(0, 30),
    fileExists: !!window.lastFile,
    fileType: window.lastFile?.type,
    fileSize: window.lastFile?.size,
  });

  if (!window.lastFile) {
    const saveStatus = document.getElementById("save-status");
    if (saveStatus) {
      saveStatus.textContent =
        "Could not rebuild file for saving. Please re-upload.";
    }
    return;
  }

  const img = document.getElementById("preview-image");
  if (img) img.src = preview;

  const data = JSON.parse(stored);
  renderDetection(data);
  window.renderDetection = renderDetection;

  const btnSave = document.getElementById("btn-save");
  const saveState = document.getElementById("save-state");
  if (btnSave) btnSave.disabled = false;
  if (saveState) saveState.textContent = "Ready to save.";

  const btnBack = document.getElementById("btn-back");
  if (btnBack) btnBack.addEventListener("click", () => history.back());

  // NEW: Visibility Toggle elements
  const modePrivate = document.getElementById("mode-private");
  const modePublic = document.getElementById("mode-public");
  const publishCheck = document.getElementById("save-public");
  const wrap = document.getElementById("public-desc-wrap");

  // NEW: Function to sync button states and UI visibility
  function updateVisibility(isPublic) {
    if (publishCheck) publishCheck.checked = isPublic;
    if (wrap) wrap.hidden = !isPublic;
    
    // Update visual button selection state
    setSelected(modePublic, isPublic);
    setSelected(modePrivate, !isPublic);
    
    // Update main button text contextually
    if (btnSave) {
      btnSave.textContent = isPublic ? "Publish to Community" : "Confirm & Save";
    }
  }

  // NEW: Listeners for Public/Private segmented toggle
  if (modePrivate && modePublic) {
    modePrivate.addEventListener("click", () => updateVisibility(false));
    modePublic.addEventListener("click", () => updateVisibility(true));
  }

  updateVisibility(!!publishCheck?.checked);

  const deleteBtn = document.getElementById("btn-delete");
  const modal = document.getElementById("delete-modal");
  const cancelBtn = document.getElementById("cancel-delete");
  const confirmBtn = document.getElementById("confirm-delete");

  if (modal) modal.hidden = true;

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
});