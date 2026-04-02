(function attachResultsPage(global) {
  const shared = global.AIclipseDetectionFlowShared;

  function setFillPercent(fillEl, percent) {
    if (!fillEl) return;
    const p = shared.clamp(percent, 0, 100);
    fillEl.style.width = p === 0 ? "0px" : `calc(${p}% - 8px)`;
    fillEl.dataset.p = String(p);
  }

  function createScrambledNumber(finalValue, element, shouldAnimate, delay = 0) {
    if (!shouldAnimate) {
      element.textContent = `${finalValue}%`;
      return;
    }

    const startTime = Date.now() + delay;
    const duration = 1500;
    const scrambleDuration = 1200;

    const animate = () => {
      const elapsed = Date.now() - startTime;

      if (elapsed < 0) {
        element.textContent = "0%";
        requestAnimationFrame(animate);
        return;
      }

      if (elapsed < scrambleDuration) {
        element.textContent = `${Math.floor(Math.random() * 100)}%`;
        requestAnimationFrame(animate);
      } else if (elapsed < duration) {
        const settleProgress = (elapsed - scrambleDuration) / (duration - scrambleDuration);
        const eased = 1 - Math.pow(1 - settleProgress, 3);
        const currentValue = Math.round(eased * finalValue);
        element.textContent = `${currentValue}%`;
        requestAnimationFrame(animate);
      } else {
        element.textContent = `${finalValue}%`;
      }
    };

    requestAnimationFrame(animate);
  }

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

    let aiProb;
    if (labelLower === "real") {
      aiProb = 1 - confidence;
    } else if (labelLower === "fake") {
      aiProb = confidence;
    } else {
      const verdict = (resp.verdict || "").toString().toLowerCase();
      aiProb = verdict === "real" ? 1 - confidence : confidence;
    }

    aiProb = Math.max(0, Math.min(1, aiProb));
    const aiPct = aiProb * 100;
    global.__lastAiPct = aiPct;

    if (verdictEl) {
      verdictEl.textContent = aiPct < 40 ? "Real" : aiPct <= 60 ? "Suspicious" : "Fake";
      verdictEl.className = "verdict-text label-gold";
    }

    if (confidenceEl) {
      confidenceEl.textContent = `Confidence: ${(confidence * 100).toFixed(1)}%`;
    }

    setFillPercent(aiFill, aiPct);
    if (aiFill) {
      aiFill.style.background = fillStyle(
        aiPct,
        "#cfb87c 0%, #cfb87c 40%, #e07043 60%, #cc2222 100%",
      );
    }

    if (aiPercentEl) {
      createScrambledNumber(Math.round(aiPct), aiPercentEl, true, 250);
    }

    if (barBlock) {
      const zone = aiPct < 40 ? "safe" : aiPct <= 60 ? "neutral" : "risk";
      barBlock.querySelectorAll(".comm_zoneLabel").forEach((el) => {
        el.classList.toggle(
          "comm_zoneLabel--active",
          el.classList.contains(`comm_zoneLabel--${zone}`),
        );
      });
    }

    if (detectCard) detectCard.hidden = false;
  }

  function init() {
    const bootstrap = document.getElementById("results-bootstrap");
    const img = document.getElementById("preview-image");
    const btnSave = document.getElementById("btn-save");
    const saveState = document.getElementById("save-state");
    const saveStatus = document.getElementById("save-status");
    const saveResult = document.getElementById("save-result");
    const savePublic = document.getElementById("save-public");
    const modePrivate = document.getElementById("mode-private");
    const modePublic = document.getElementById("mode-public");
    const toggleTrack = modePrivate && modePrivate.closest(".res-toggle");
    const publishModal = document.getElementById("publish-modal");
    const publishModalCancel = document.getElementById("publish-modal-cancel");
    const publishModalConfirm = document.getElementById("publish-modal-confirm");
    const publishDescInput = document.getElementById("post-description");
    const publishDescCount = document.getElementById("publish-desc-count");
    const publishModalStatus = document.getElementById("publish-modal-status");
    const deleteBtn = document.getElementById("btn-delete");
    const deleteModal = document.getElementById("delete-modal");
    const cancelDeleteBtn = document.getElementById("cancel-delete");
    const confirmDeleteBtn = document.getElementById("confirm-delete");

    if (!img || !btnSave || !savePublic) return;

    if (!("lastFile" in global)) global.lastFile = null;
    if (!("lastDetectionToken" in global)) global.lastDetectionToken = null;
    if (!("currentUserId" in global)) global.currentUserId = null;

    global.currentUserId = bootstrap?.dataset.userId || null;

    function setSelected(btn, on) {
      if (!btn) return;
      btn.classList.toggle("is-selected", !!on);
    }

    function closePublishModal() {
      if (publishModal) publishModal.hidden = true;
      if (publishModalStatus) publishModalStatus.textContent = "";
    }

    function openPublishModal() {
      if (!publishModal) return;
      if (publishDescInput) publishDescInput.value = "";
      if (publishDescCount) publishDescCount.textContent = "0";
      if (publishModalStatus) publishModalStatus.textContent = "";
      publishModal.hidden = false;
      if (publishDescInput) publishDescInput.focus();
    }

    function updateVisibility(isPublic, options = {}) {
      const fromUser = !!options.fromUser;
      savePublic.checked = isPublic;
      if (toggleTrack) toggleTrack.classList.toggle("is-public", isPublic);
      setSelected(modePublic, isPublic);
      setSelected(modePrivate, !isPublic);
      btnSave.textContent = "Save";

      if (fromUser && global.AIclipseTutorial && typeof global.AIclipseTutorial.emit === "function") {
        global.AIclipseTutorial.emit("results-visibility-selected", { isPublic });
        global.AIclipseTutorial.emit(
          isPublic ? "results-public-selected" : "results-private-selected",
          { isPublic },
        );
      }
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
      publishModal.addEventListener("click", (event) => {
        if (event.target === publishModal) {
          closePublishModal();
          updateVisibility(false, { fromUser: false });
        }
      });
    }

    if (publishModalConfirm) {
      publishModalConfirm.addEventListener("click", () => {
        const description = publishDescInput ? publishDescInput.value.trim() : "";
        if (!description) {
          if (publishModalStatus) publishModalStatus.textContent = "Description is required.";
          return;
        }
        if (description.length > 1000) {
          if (publishModalStatus) {
            publishModalStatus.textContent = `Too long (${description.length}/1000).`;
          }
          return;
        }
        closePublishModal();
        if (!btnSave.disabled) btnSave.click();
      });
    }

    btnSave.addEventListener(
      "click",
      (event) => {
        const isPublic = !!savePublic.checked;
        const description = publishDescInput ? publishDescInput.value.trim() : "";
        if (isPublic && !description) {
          event.stopImmediatePropagation();
          openPublishModal();
        }
      },
      true,
    );

    modePrivate?.addEventListener("click", () => updateVisibility(false, { fromUser: true }));
    modePublic?.addEventListener("click", () => updateVisibility(true, { fromUser: true }));

    if (deleteModal) deleteModal.hidden = true;

    deleteBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (deleteModal) deleteModal.hidden = false;
    });

    cancelDeleteBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      if (deleteModal) deleteModal.hidden = true;
    });

    confirmDeleteBtn?.addEventListener("click", async (event) => {
      event.preventDefault();
      if (deleteModal) deleteModal.hidden = true;

      try {
        await shared.clearPendingDetectionState();
        img.src = "";
        const verdict = document.getElementById("detect-verdict");
        if (verdict) verdict.textContent = "—";
        global.history.back();
      } catch (err) {
        console.error("Delete failed", err);
      }
    });

    btnSave.addEventListener("click", async () => {
      if (!global.lastFile) {
        shared.setStatus(saveStatus, "error", "No file selected.");
        return;
      }

      if (!global.lastDetectionToken) {
        shared.setStatus(saveStatus, "error", "No detection token. Run detection first.");
        return;
      }

      const isPublic = !!savePublic.checked;
      const description = (publishDescInput?.value || "").trim();

      if (isPublic && !global.currentUserId) {
        shared.setStatus(saveStatus, "error", "You must be signed in to publish to community.");
        return;
      }

      if (isPublic && !description) {
        shared.setStatus(saveStatus, "error", "Description is required when publishing.");
        return;
      }

      if (description.length > 1000) {
        shared.setStatus(
          saveStatus,
          "error",
          `Description too long (${description.length}/1000 characters).`,
        );
        return;
      }

      if (global.AppLoader && typeof global.AppLoader.show === "function") {
        global.AppLoader.show(isPublic ? "Publishing to Community..." : "Saving your scan...");
      }

      btnSave.disabled = true;
      shared.setStatus(
        saveStatus,
        "info",
        isPublic ? "Saving + publishing..." : "Saving image...",
      );

      const formData = new FormData();
      formData.append("file", global.lastFile);
      formData.append("detection_token", global.lastDetectionToken);
      formData.append("is_public", isPublic ? "true" : "false");
      formData.append("description", description);

      try {
        const res = await fetch("/results/save", {
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

        shared.setDebug({ url: "/results/save", status: res.status, body: data });

        if (!res.ok) {
          if (global.AppLoader && typeof global.AppLoader.hide === "function") {
            global.AppLoader.hide();
          }

          shared.setStatus(saveStatus, "error", data.detail || `Save failed (${res.status})`);
          btnSave.disabled = false;
          return;
        }

        const resolvedImageId = data?.image_id || data?.upload?.image_id || data?.upload?.body?.image_id || null;

        if (!isPublic) {
          if (global.AIclipseTutorial && typeof global.AIclipseTutorial.emit === "function") {
            global.AIclipseTutorial.emit("private-save-success", {
              imageId: resolvedImageId || null,
            });
          }

          await shared.clearPendingDetectionState();
          shared.setStatus(saveStatus, "success", "Saved image.");

          if (global.AppLoader && typeof global.AppLoader.show === "function") {
            global.AppLoader.show("Redirecting to your scans...");
          }

          global.setTimeout(() => {
            global.location.href = "/profile";
          }, 900);
          return;
        }

        if (global.AIclipseTutorial && typeof global.AIclipseTutorial.emit === "function") {
          global.AIclipseTutorial.emit("publish-success", {
            imageId: resolvedImageId || null,
            postId: data?.post_id || null,
          });
        }

        await shared.clearPendingDetectionState();
        shared.setStatus(saveStatus, "success", "Saved image + published post.");

        if (global.AppLoader && typeof global.AppLoader.show === "function") {
          global.AppLoader.show("Loading Community...");
        }

        global.setTimeout(() => {
          global.location.href = "/community";
        }, 1000);

        if (saveResult) saveResult.textContent = "";
      } catch (err) {
        console.error(err);

        if (global.AppLoader && typeof global.AppLoader.hide === "function") {
          global.AppLoader.hide();
        }

        shared.setStatus(saveStatus, "error", "Network error during save.");
        btnSave.disabled = false;
      }
    });

    updateVisibility(!!savePublic.checked, { fromUser: false });

    void (async () => {
      let pending = null;
      try {
        pending = await shared.loadPendingDetectionState();
      } catch {
        console.log("Pending detection store unavailable:", {
          indexedDbReady: !!global.AIclipsePendingDetectionStore,
        });
        global.location.href = "/upload";
        return;
      }

      if (!pending) {
        console.log("Missing pending detection state:", {
          indexedDbReady: !!global.AIclipsePendingDetectionStore,
        });
        global.location.href = "/upload";
        return;
      }

      global.lastDetectionToken = pending.token;
      global.lastFile = pending.file;
      shared.setDebug({
        from: pending.source,
        tokenExists: !!global.lastDetectionToken,
        tokenPreview: pending.token.slice(0, 10) + "...",
        previewStartsWith: pending.previewUrl.slice(0, 30),
        fileExists: !!global.lastFile,
        fileType: global.lastFile?.type,
        fileSize: global.lastFile?.size,
      });

      if (!global.lastFile) {
        if (saveState) {
          saveState.textContent = "Could not rebuild file for saving. Please re-upload.";
        }
        return;
      }

      img.onload = () => {
        const barBlock = document.getElementById("aiclipse-bar-block");
        if (barBlock) {
          barBlock.classList.remove("is-hidden");
          barBlock.classList.add("is-revealed");
        }
      };
      img.src = pending.previewUrl;

      if (pending.source === "indexeddb" && pending.previewUrl.startsWith("blob:")) {
        global.addEventListener(
          "pagehide",
          () => {
            URL.revokeObjectURL(pending.previewUrl);
          },
          { once: true },
        );
      }

      renderDetection(pending.response);
      btnSave.disabled = false;
      if (saveState) saveState.textContent = "Ready to save.";
    })();

  }

  global.AIclipseResultsPage = {
    init,
    renderDetection,
  };
})(window);
