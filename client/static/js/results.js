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

  fillEl.style.width = p === 0 ? "0px" : `calc(${p}% - 8px)`;
  fillEl.dataset.p = String(p);
}

// Scrambling number animation
function createScrambledNumber(finalValue, element, shouldAnimate, delay = 0) {
  if (!shouldAnimate) {
    element.textContent = `${finalValue}%`;
    return;
  }

  const startTime = Date.now() + delay;
  const duration = 1500; // 1.5 seconds of scrambling
  const scrambleDuration = 1200; // Scramble for first 1.2 seconds

  const animate = () => {
    const elapsed = Date.now() - startTime;

    if (elapsed < 0) {
      // Still in delay period
      element.textContent = "0%";
      requestAnimationFrame(animate);
      return;
    }

    if (elapsed < scrambleDuration) {
      // Scrambling phase - show random numbers
      const randomValue = Math.floor(Math.random() * 100);
      element.textContent = `${randomValue}%`;
      requestAnimationFrame(animate);
    } else if (elapsed < duration) {
      // Settling phase - ease towards final value
      const settleProgress = (elapsed - scrambleDuration) / (duration - scrambleDuration);
      const eased = 1 - Math.pow(1 - settleProgress, 3); // Ease out cubic
      const currentValue = Math.round(eased * finalValue);
      element.textContent = `${currentValue}%`;
      requestAnimationFrame(animate);
    } else {
      // Animation complete
      element.textContent = `${finalValue}%`;
    }
  };

  requestAnimationFrame(animate);
}

// Zone gradient anchored to bar width + a sheen overlay
function fillStyle(aiPct, gradient) {
  const pct = Math.max(aiPct, 0.1);
  const zoneSize = `${(10000 / pct).toFixed(2)}%`;
  return `
    linear-gradient(to right, rgba(0,0,0,0.28), transparent) left / 100% 100% no-repeat,
    linear-gradient(to right, ${gradient}) left / ${zoneSize} 100% no-repeat
  `;
}

function renderDetection(resp) {
  const detectCard = document.getElementById("detect-card");
  const verdictEl = document.getElementById("detect-verdict");
  const confidenceEl = document.getElementById("detect-confidence");

  const aiFill = document.getElementById("ai-fill");
  const aiPercentEl = document.getElementById("ai-percent");
  const barBlock = document.getElementById("aiclipse-bar-block");

  if (!resp || typeof resp !== "object") {
    if (detectCard) detectCard.hidden = true;
    return;
  }

  const rawLabel = (resp.label || resp.result || "Unknown").toString();
  const cleanLabel = rawLabel.replace(/^\s*\d+(\.\d+)?%\s*/i, "").trim();

  const confidenceRaw = Number.isFinite(resp.confidence)
    ? resp.confidence
    : (resp.score ?? 0);

  const confidence = Math.max(0, Math.min(1, Number(confidenceRaw) || 0));

  const labelLower = cleanLabel.toLowerCase();

  // Handle simple real/fake labels from detector
  let aiProb;
  if (labelLower === "real") {
    aiProb = 1 - confidence; // Real with confidence X means (1-X) fake probability
  } else if (labelLower === "fake") {
    aiProb = confidence; // Fake with confidence X means X fake probability
  } else {
    // Fallback for unknown labels - use verdict
    const verdict = (resp.verdict || "").toString().toLowerCase();
    if (verdict === "real") {
      aiProb = 1 - confidence;
    } else {
      aiProb = confidence;
    }
  }

  aiProb = Math.max(0, Math.min(1, aiProb));
  const aiPct = aiProb * 100;

  window.__lastAiPct = aiPct;

  const labelClass = "label-gold";
  const verdictLabel = aiPct < 40 ? "Real" : aiPct <= 60 ? "Suspicious" : "Fake";

  if (verdictEl) {
    verdictEl.textContent = verdictLabel;
    verdictEl.className = `verdict-text ${labelClass}`;
  }

  if (confidenceEl) {
    confidenceEl.textContent = `Confidence: ${(confidence * 100).toFixed(1)}%`;
  }

  setFillPercent(aiFill, aiPct);
  if (aiFill) {
    const gradient = "#cfb87c 0%, #cfb87c 40%, #e07043 60%, #cc2222 100%";
    aiFill.style.background = fillStyle(aiPct, gradient);
  }

  // Add scrambling animation to percentage
  if (aiPercentEl) {
    createScrambledNumber(Math.round(aiPct), aiPercentEl, true, 250);
  }

  if (barBlock) {
    const zone = aiPct < 40 ? "safe" : aiPct <= 60 ? "neutral" : "risk";
    barBlock.querySelectorAll(".comm_zoneLabel").forEach(el => {
      el.classList.toggle("comm_zoneLabel--active", el.classList.contains(`comm_zoneLabel--${zone}`));
    });
  }

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
    window.location.href = "/upload";
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
  if (img) {
    img.onload = () => {
      const barBlock = document.getElementById("aiclipse-bar-block");
      if (barBlock) {
        barBlock.classList.remove("is-hidden");
        barBlock.classList.add("is-revealed");
      }
    };
    img.src = preview;
  }

  const data = JSON.parse(stored);
  renderDetection(data);
  window.renderDetection = renderDetection;

  const btnSave = document.getElementById("btn-save");
  const saveState = document.getElementById("save-state");
  if (btnSave) btnSave.disabled = false;
  if (saveState) saveState.textContent = "Ready to save.";

  const btnBack = document.getElementById("btn-back");
  if (btnBack) btnBack.addEventListener("click", () => history.back());

  const modePrivate = document.getElementById("mode-private");
  const modePublic = document.getElementById("mode-public");
  const toggleTrack = modePrivate && modePrivate.closest(".res-toggle");
  const publishCheck = document.getElementById("save-public");

  // Publish modal
  const publishModal = document.getElementById("publish-modal");
  const publishModalCancel = document.getElementById("publish-modal-cancel");
  const publishModalConfirm = document.getElementById("publish-modal-confirm");
  const publishDescInput = document.getElementById("post-description");
  const publishDescCount = document.getElementById("publish-desc-count");
  const publishModalStatus = document.getElementById("publish-modal-status");

  function openPublishModal() {
    if (!publishModal) return;
    if (publishDescInput) publishDescInput.value = "";
    if (publishDescCount) publishDescCount.textContent = "0";
    if (publishModalStatus) publishModalStatus.textContent = "";
    publishModal.hidden = false;
    if (publishDescInput) publishDescInput.focus();
  }

  function closePublishModal() {
    if (publishModal) publishModal.hidden = true;
    if (publishModalStatus) publishModalStatus.textContent = "";
  }

  if (publishDescInput && publishDescCount) {
    publishDescInput.addEventListener("input", () => {
      publishDescCount.textContent = String(publishDescInput.value.length);
    });
  }

  if (publishModalCancel) {
    publishModalCancel.addEventListener("click", () => {
      closePublishModal();
      updateVisibility(false, { fromUser: false });
    });
  }

  if (publishModal) {
    publishModal.addEventListener("click", (e) => {
      if (e.target === publishModal) {
        closePublishModal();
        updateVisibility(false, { fromUser: false });
      }
    });
  }

  if (publishModalConfirm) {
    publishModalConfirm.addEventListener("click", () => {
      const desc = publishDescInput ? publishDescInput.value.trim() : "";
      if (!desc) {
        if (publishModalStatus) publishModalStatus.textContent = "Description is required.";
        return;
      }
      if (desc.length > 1000) {
        if (publishModalStatus) publishModalStatus.textContent = `Too long (${desc.length}/1000).`;
        return;
      }
      closePublishModal();
      // Trigger the actual save now that description is filled
      if (btnSave && !btnSave.disabled) btnSave.click();
    });
  }

  // Intercept save button (capture phase = runs before upload.js bubble handler)
  if (btnSave) {
    btnSave.addEventListener("click", (e) => {
      const isPublic = !!(publishCheck && publishCheck.checked);
      const desc = publishDescInput ? publishDescInput.value.trim() : "";
      if (isPublic && !desc) {
        e.stopImmediatePropagation();
        openPublishModal();
      }
    }, true);
  }

  function updateVisibility(isPublic, options = {}) {
    const fromUser = !!options.fromUser;

    if (publishCheck) publishCheck.checked = isPublic;
    if (toggleTrack) toggleTrack.classList.toggle("is-public", isPublic);

    setSelected(modePublic, isPublic);
    setSelected(modePrivate, !isPublic);

    if (btnSave) {
      btnSave.textContent = "Save";
    }

    if (fromUser && window.AIclipseTutorial && typeof window.AIclipseTutorial.emit === "function") {
      window.AIclipseTutorial.emit("results-visibility-selected", { isPublic });
      if (isPublic) {
        window.AIclipseTutorial.emit("results-public-selected", { isPublic: true });
      } else {
        window.AIclipseTutorial.emit("results-private-selected", { isPublic: false });
      }
    }
  }

  if (modePrivate && modePublic) {
    modePrivate.addEventListener("click", () => updateVisibility(false, { fromUser: true }));
    modePublic.addEventListener("click", () => updateVisibility(true, { fromUser: true }));
  }

  updateVisibility(!!publishCheck?.checked, { fromUser: false });

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