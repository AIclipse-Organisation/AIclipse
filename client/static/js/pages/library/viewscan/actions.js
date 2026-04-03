function normalizeViewscanActionState(actions) {
  const state = actions && typeof actions === "object" ? actions : {};
  return {
    showDeleteScan: state.show_delete_scan === true,
    showPublish: state.show_publish === true,
    showMakePrivate: state.show_make_private === true,
    showEditDescription: state.show_edit_description === true,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeViewscanActionState,
  };
}

(function initViewscanActions() {
  if (typeof window === "undefined") return;
  if (window.AIclipseViewscanActions) return;

  const shared = window.AIclipseViewscanShared;
  if (!shared) return;

  const {
    ensureStylesheet,
    getCurrentActions,
    getCurrentScan,
  } = shared;
  const assetUrl = window.AIclipseAssetUrl;

  function ensureModalStylesheet() {
    return ensureStylesheet("viewscan-modals-css", assetUrl("css/pages/library/viewscan/modals.css"));
  }

  function setHidden(el, shouldHide) {
    if (el) el.hidden = !!shouldHide;
  }

  function getActionState() {
    const actions = getCurrentActions();
    if (!actions || typeof actions !== "object") return {};
    return actions;
  }

  function syncActionButtons() {
    const publishBtn = document.getElementById("btn-make-public");
    const makePrivateBtn = document.getElementById("btn-delete-post");
    const deleteBtn = document.getElementById("btn-delete-scan");
    const editDescriptionBtn = document.getElementById("btn-edit-description");

    const visible = normalizeViewscanActionState(getActionState());

    setHidden(publishBtn, !visible.showPublish);
    setHidden(makePrivateBtn, !visible.showMakePrivate);
    setHidden(deleteBtn, !visible.showDeleteScan);
    setHidden(editDescriptionBtn, !visible.showEditDescription);
  }

  async function patchDescriptionByImageId(imageId, description) {
    const response = await fetch(`/viewscan/${encodeURIComponent(imageId)}/description`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ description }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || data.detail || `Failed to update (${response.status})`);
    }

    return data;
  }

  function setupEditDescriptionInline(img, renderDescriptionHeader) {
    const modal = document.getElementById("edit-desc-modal");
    const openBtn = document.getElementById("btn-edit-description");
    const input = document.getElementById("edit-description-input");
    const countEl = document.getElementById("edit-description-count");
    const statusEl = document.getElementById("edit-description-status");
    const saveBtn = document.getElementById("edit-description-save");
    const cancelBtn = document.getElementById("edit-description-cancel");
    const actions = getActionState();

    if (!modal || !openBtn || !input || !statusEl || !saveBtn || !cancelBtn) {
      if (openBtn) openBtn.hidden = actions.show_edit_description !== true;
      return;
    }

    const shouldShow = actions.show_edit_description === true;
    openBtn.hidden = !shouldShow;
    if (!shouldShow) return;

    void ensureModalStylesheet();

    const maxLen = 1000;
    let originalDescription = img.description || "";
    let modalOpen = false;
    let hasUnsavedChanges = false;

    const setFormStatus = (text, kind) => {
      statusEl.classList.remove("is-error", "is-success");
      if (kind === "error") statusEl.classList.add("is-error");
      if (kind === "success") statusEl.classList.add("is-success");
      statusEl.textContent = text || "";
    };

    const syncCount = () => {
      if (countEl) countEl.textContent = String(input.value.length);
    };

    const openModal = async () => {
      await ensureModalStylesheet();
      originalDescription = getCurrentScan()?.description ? String(getCurrentScan().description) : "";
      input.value = originalDescription;
      syncCount();
      setFormStatus("", null);
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
      hasUnsavedChanges = false;
      modalOpen = true;
      modal.hidden = false;
      input.focus();
    };

    const closeModal = () => {
      modal.hidden = true;
      input.value = "";
      if (countEl) countEl.textContent = "0";
      setFormStatus("", null);
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
      hasUnsavedChanges = false;
      modalOpen = false;
    };

    if (!openBtn.dataset.bound) {
      openBtn.dataset.bound = "1";
      openBtn.addEventListener("click", openModal);
    }

    if (!modal.dataset.bound) {
      modal.dataset.bound = "1";
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
      });
    }

    if (!input.dataset.bound) {
      input.dataset.bound = "1";
      input.addEventListener("input", () => {
        syncCount();
        hasUnsavedChanges = input.value.trim() !== originalDescription.trim();
      });
    }

    if (!window.__editDescBeforeUnloadBound) {
      window.__editDescBeforeUnloadBound = true;
      window.addEventListener("beforeunload", (e) => {
        if (modalOpen && hasUnsavedChanges) {
          e.preventDefault();
          e.returnValue = "";
        }
      });
    }

    if (!cancelBtn.dataset.bound) {
      cancelBtn.dataset.bound = "1";
      cancelBtn.addEventListener("click", closeModal);
    }

    if (!saveBtn.dataset.bound) {
      saveBtn.dataset.bound = "1";
      saveBtn.addEventListener("click", async () => {
        const activeScan = getCurrentScan();
        if (!activeScan || !activeScan.image_id || saveBtn.disabled) return;

        const description = input.value.trim();
        if (!description) {
          setFormStatus("Description cannot be empty.", "error");
          return;
        }
        if (description.length > maxLen) {
          setFormStatus(`Description too long (${description.length}/${maxLen}).`, "error");
          return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
        setFormStatus("Saving...", null);

        try {
          await patchDescriptionByImageId(activeScan.image_id, description);
          activeScan.description = description;
          activeScan.updated_at = new Date().toISOString();
          renderDescriptionHeader(activeScan);
          setFormStatus("✓ Description updated.", "success");
          setTimeout(closeModal, 600);
        } catch (err) {
          setFormStatus(err?.message || "Failed to update description.", "error");
          saveBtn.disabled = false;
          saveBtn.textContent = "Save";
        }
      });
    }
  }

  function setupDeletePost(img) {
    const actionBtn = document.getElementById("btn-delete-post");
    if (!actionBtn) return;

    syncActionButtons();

    const shouldShow = !actionBtn.hidden;
    if (!shouldShow) return;

    void ensureModalStylesheet();

    const modal = document.getElementById("delete-modal");
    const modalConfirm = document.getElementById("modal-confirm");
    const modalCancel = document.getElementById("modal-cancel");

    if (modal) modal.hidden = true;

    const showModal = async () => {
      await ensureModalStylesheet();
      if (modal) modal.hidden = false;
    };
    const hideModal = () => {
      if (modal) modal.hidden = true;
    };

    if (!actionBtn.dataset.bound) {
      actionBtn.dataset.bound = "1";
      actionBtn.addEventListener("click", () => {
        if (!getCurrentScan()?.image_id) return;
        showModal();
      });
    }

    if (modalCancel && !modalCancel.dataset.bound) {
      modalCancel.dataset.bound = "1";
      modalCancel.addEventListener("click", hideModal);
    }

    if (modalConfirm && !modalConfirm.dataset.bound) {
      modalConfirm.dataset.bound = "1";
      modalConfirm.addEventListener("click", async () => {
        const activeScan = getCurrentScan();
        if (!activeScan?.image_id) return;

        hideModal();
        actionBtn.disabled = true;
        actionBtn.textContent = "Making private...";

        try {
          const res = await fetch(`/viewscan/${encodeURIComponent(activeScan.image_id)}/make-private`, {
            method: "POST",
            credentials: "include",
            headers: { Accept: "application/json" },
          });

          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data.error || data.detail || `Failed to make private (${res.status})`);
          }

          activeScan.is_public = false;
          setTimeout(() => {
            window.location.href = "/profile";
          }, 600);
        } catch {
          actionBtn.disabled = false;
          actionBtn.textContent = "Make Private";
        }
      });
    }

    if (modal && !modal.dataset.bound) {
      modal.dataset.bound = "1";
      modal.addEventListener("click", (e) => {
        if (e.target === modal) hideModal();
      });
    }
  }

  function setupDeleteScan(img) {
    const deleteBtn = document.getElementById("btn-delete-scan");
    if (!deleteBtn) return;

    syncActionButtons();

    const shouldShow = !deleteBtn.hidden;
    if (!shouldShow) return;

    void ensureModalStylesheet();

    const modal = document.getElementById("delete-scan-modal");
    const modalConfirm = document.getElementById("scan-modal-confirm");
    const modalCancel = document.getElementById("scan-modal-cancel");

    if (modal) modal.hidden = true;

    const showModal = async () => {
      await ensureModalStylesheet();
      if (modal) modal.hidden = false;
    };
    const hideModal = () => {
      if (modal) modal.hidden = true;
    };

    if (!deleteBtn.dataset.bound) {
      deleteBtn.dataset.bound = "1";
      deleteBtn.addEventListener("click", () => {
        if (!getCurrentScan()?.image_id) return;
        showModal();
      });
    }

    if (modalCancel && !modalCancel.dataset.bound) {
      modalCancel.dataset.bound = "1";
      modalCancel.addEventListener("click", hideModal);
    }

    if (modalConfirm && !modalConfirm.dataset.bound) {
      modalConfirm.dataset.bound = "1";
      modalConfirm.addEventListener("click", async () => {
        const activeScan = getCurrentScan();
        if (!activeScan?.image_id) return;

        hideModal();
        deleteBtn.disabled = true;
        deleteBtn.textContent = "Deleting...";

        try {
          const res = await fetch(`/viewscan/${encodeURIComponent(activeScan.image_id)}`, {
            method: "DELETE",
            credentials: "include",
            headers: { Accept: "application/json" },
          });

          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data.error || data.detail || `Failed to delete scan (${res.status})`);
          }

          setTimeout(() => {
            window.location.href = "/profile";
          }, 600);
        } catch {
          deleteBtn.disabled = false;
          deleteBtn.textContent = "Delete";
        }
      });
    }

    if (modal && !modal.dataset.bound) {
      modal.dataset.bound = "1";
      modal.addEventListener("click", (e) => {
        if (e.target === modal) hideModal();
      });
    }
  }

  async function handleMakePublic(img, description) {
    const publishRes = await fetch(`/viewscan/${encodeURIComponent(img.image_id)}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "include",
      body: JSON.stringify({
        description,
        verdict: img.verdict || null,
        label: img.label || null,
        confidence: img.confidence || null,
      }),
    });

    if (!publishRes.ok) {
      const errorData = await publishRes.json().catch(() => ({}));
      throw new Error(errorData.detail || errorData.error || `Failed to publish (${publishRes.status})`);
    }

    const publishData = await publishRes.json().catch(() => ({}));
    if (publishData.post_id) img.post_id = publishData.post_id;
    img.up_vote_count = img.up_vote_count ?? 0;
    img.down_vote_count = img.down_vote_count ?? 0;
    img.is_public = true;
  }

  function setupMakePublicInline(img) {
    const makePublicBtn = document.getElementById("btn-make-public");
    const modal = document.getElementById("make-public-modal");
    const formInput = document.getElementById("make-public-description");
    const formCount = document.getElementById("make-public-count");
    const publishBtn = document.getElementById("make-public-publish");
    const cancelBtn = document.getElementById("make-public-cancel");
    const formStatus = document.getElementById("make-public-status");

    if (!makePublicBtn || !modal || !formInput || !publishBtn || !cancelBtn || !formStatus) {
      syncActionButtons();
      return;
    }

    syncActionButtons();

    const shouldShow = !makePublicBtn.hidden;
    if (!shouldShow) return;

    void ensureModalStylesheet();

    const setFormStatus = (text, kind) => {
      formStatus.classList.remove("is-error", "is-success");
      if (kind === "error") formStatus.classList.add("is-error");
      if (kind === "success") formStatus.classList.add("is-success");
      formStatus.textContent = text || "";
    };

    const openModal = async () => {
      await ensureModalStylesheet();
      formInput.value = "";
      if (formCount) formCount.textContent = "0";
      setFormStatus("", null);
      publishBtn.disabled = false;
      publishBtn.textContent = "Publish";
      modal.hidden = false;
      formInput.focus();
    };

    const closeModal = () => {
      modal.hidden = true;
      formInput.value = "";
      if (formCount) formCount.textContent = "0";
      setFormStatus("", null);
      publishBtn.disabled = false;
      publishBtn.textContent = "Publish";
    };

    if (!makePublicBtn.dataset.bound) {
      makePublicBtn.dataset.bound = "1";
      makePublicBtn.addEventListener("click", openModal);
    }

    if (!formInput.dataset.bound) {
      formInput.dataset.bound = "1";
      formInput.addEventListener("input", () => {
        if (formCount) formCount.textContent = String(formInput.value.length);
      });
    }

    if (!cancelBtn.dataset.bound) {
      cancelBtn.dataset.bound = "1";
      cancelBtn.addEventListener("click", closeModal);
    }

    if (!modal.dataset.bound) {
      modal.dataset.bound = "1";
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
      });
    }

    if (!publishBtn.dataset.bound) {
      publishBtn.dataset.bound = "1";
      publishBtn.addEventListener("click", async () => {
        const activeScan = getCurrentScan();
        if (!activeScan || publishBtn.disabled) return;

        const description = formInput.value.trim();
        if (!description) {
          setFormStatus("Description is required.", "error");
          return;
        }
        if (description.length > 1000) {
          setFormStatus(`Description too long (${description.length}/1000).`, "error");
          return;
        }

        publishBtn.disabled = true;
        publishBtn.textContent = "Publishing...";
        setFormStatus("Publishing...", null);

        try {
          await handleMakePublic(activeScan, description);
          window.location.href = "/profile";
        } catch (err) {
          setFormStatus(err?.message || "Failed to publish.", "error");
          publishBtn.disabled = false;
          publishBtn.textContent = "Publish";
        }
      });
    }
  }

  window.AIclipseViewscanActions = {
    setupDeletePost,
    setupDeleteScan,
    setupEditDescriptionInline,
    setupMakePublicInline,
  };
})();
