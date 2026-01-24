// =========================
// View Scan page
// - Reads selected scan object from sessionStorage
// - Shows it (image + meta)
// - Shows passed title e.g. "Scan 1 (Private)"
// - Supports editing post descriptions (for public posts)
// - Allows making PRIVATE scans public from this page only
//   (no modal: static inline publish UI that shows/hides)
// =========================

let currentScan = null;

function clearEl(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function setStatus(text, type) {
  const statusEl = document.getElementById("viewscan-status");
  if (!statusEl) return;

  statusEl.classList.remove("error", "loading");
  if (type) statusEl.classList.add(type);

  statusEl.textContent = text || "";
}

function toPercent(confidence) {
  const n = Number(confidence);
  if (!Number.isFinite(n)) return "N/A";
  const clamped = Math.max(0, Math.min(1, n));
  return `${Math.round(clamped * 100)}%`;
}

function formatDate(dt) {
  if (!dt) return "N/A";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return "N/A";
  return d.toLocaleString();
}

function visibilityOf(img) {
  if (img && typeof img.is_public === "boolean") return img.is_public ? "Public" : "Private";
  return "Private";
}

function isPrivateScan(img) {
  if (!img) return false;
  if (typeof img.is_public === "boolean") return img.is_public === false;
  return true; // default to private if missing
}

// Renders a definition list from whatever keys exist.
// Also renders “known” fields in a nicer order first.
function renderMeta(img) {
  const metaList = document.getElementById("meta-list");
  if (!metaList) return;

  clearEl(metaList);

  const addMeta = (label, value) => {
    metaList.appendChild(makeEl("dt", "meta-key", label));
    metaList.appendChild(makeEl("dd", "meta-value", value));
  };

  // Fields to hide
  const hiddenFields = new Set([
    "image_id", "url", "is_reported", "s3_key", "user_id",
    "_id", "post_id", "is_public",
    "clicks_count", "comment_count", "controversial_since",
    "created_at", "debug", "down_vote_count", "result",
    "score", "up_vote_count", "user_name"
  ]);

  // ---- Show only allowed fields ----
  addMeta("Visibility", visibilityOf(img));
  addMeta("Uploaded", formatDate(img.uploaded_at));
  addMeta("Label", img.label != null ? String(img.label) : "N/A");
  addMeta("Verdict", img.verdict != null ? String(img.verdict) : "N/A");
  addMeta("Confidence", toPercent(img.confidence));

  // Always show description field (even if empty/not set yet)
  const descValue = img.description ? String(img.description) : "(No description yet)";
  addMeta("Description", descValue);

  // Show updated_at if it exists (formatted like uploaded_at)
  if (img.updated_at) {
    addMeta("Updated", formatDate(img.updated_at));
  }

  // Show any other non-hidden fields (but skip description since we showed it above)
  const alreadyShown = new Set([
    "is_public", "uploaded_at", "label", "verdict", "confidence", "description", "updated_at"
  ]);

  Object.keys(img || {}).sort().forEach((key) => {
    if (hiddenFields.has(key) || alreadyShown.has(key)) return;

    const val = img[key];
    let out;

    if (val === null || val === undefined) out = "N/A";
    else if (typeof val === "object") {
      try { out = JSON.stringify(val); } catch (_) { out = "[object]"; }
    } else {
      out = String(val);
    }

    addMeta(key, out);
  });
}

function renderScan(img, title) {
  currentScan = img;

  const card = document.getElementById("viewscan-card");
  const imageEl = document.getElementById("viewscan-image");
  const titleEl = document.getElementById("viewscan-title");

  if (!card || !imageEl || !titleEl) return;

  if (!img) {
    card.hidden = true;
    titleEl.textContent = "View Scan";
    setStatus("No scan selected. Go back to Scans and click “View more details”.", "error");
    return;
  }

  titleEl.textContent = title || "View Scan";

  // Image
  if (img.url) {
    imageEl.src = img.url;
    imageEl.alt = title || "Selected scan image";
    imageEl.style.display = "";
  } else {
    imageEl.removeAttribute("src");
    imageEl.alt = "No image available.";
    imageEl.style.display = "none";
  }

  renderMeta(img);
  card.hidden = false;
  setStatus("", null);

  // Public post edit section (only when post_id exists)
  if (img.post_id) {
    showEditSection(img);
  } else {
    // If not a post, ensure edit UI is hidden
    const editSection = document.getElementById("edit-section");
    if (editSection) editSection.style.display = "none";
  }

  // Inline Make Public UI (ONLY when private)
  setupMakePublicInline(img);
}

// -------------------------
// Edit section (existing public-post edit)
// -------------------------
function showEditSection(img) {
  const editSection = document.getElementById("edit-section");
  const descriptionInput = document.getElementById("description-input");

  if (!editSection || !descriptionInput) return;

  const originalDescription = img.description || "";
  descriptionInput.value = originalDescription;
  editSection.style.display = "block";

  let hasUnsavedChanges = false;
  descriptionInput.addEventListener("input", () => {
    hasUnsavedChanges = descriptionInput.value.trim() !== originalDescription;
  });

  window.addEventListener("beforeunload", (e) => {
    if (hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  const saveBtn = document.getElementById("save-btn");
  const cancelBtn = document.getElementById("cancel-edit-btn");

  if (saveBtn) {
    saveBtn.onclick = () => {
      hasUnsavedChanges = false;
      saveDescription(img.post_id);
    };
  }

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      if (hasUnsavedChanges && !confirm("You have unsaved changes. Are you sure you want to leave?")) return;
      sessionStorage.removeItem("selectedScan");
      sessionStorage.removeItem("selectedScanTitle");
      window.location.href = "/community";
    };
  }
}

async function saveDescription(postId) {
  const descriptionInput = document.getElementById("description-input");
  const editStatus = document.getElementById("edit-status");
  const saveBtn = document.getElementById("save-btn");

  if (!descriptionInput || !editStatus || !saveBtn) return;

  const description = descriptionInput.value.trim();

  if (!description) {
    editStatus.textContent = "Description cannot be empty.";
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";
  editStatus.textContent = "";

  try {
    const response = await fetch(`/community/posts?post_id=${encodeURIComponent(postId)}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ description })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      editStatus.textContent = data.error || data.detail || `Failed to update (${response.status})`;
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Changes";
      return;
    }

    editStatus.textContent = "✓ Description updated successfully!";
    editStatus.style.color = "#28a745";

    sessionStorage.removeItem("selectedScan");
    sessionStorage.removeItem("selectedScanTitle");

    setTimeout(() => {
      window.location.href = "/community";
    }, 1500);

  } catch (error) {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Changes";
  }
}

// -------------------------
// Make Public (INLINE, no modal)
// Requirements:
// - "Make Public" button is visible only when scan is private
// - Clicking it reveals a description box + Publish/Cancel
// - Cancel hides it again
// - Publish posts + updates image visibility, then redirects to Scans (Public tab)
// -------------------------
function setupMakePublicInline(img) {
  const makePublicBtn = document.getElementById("btn-make-public");
  const makePublicSection = document.getElementById("make-public-section");
  const form = document.getElementById("make-public-form");
  const formInput = document.getElementById("make-public-description");
  const formCount = document.getElementById("make-public-count");
  const publishBtn = document.getElementById("make-public-publish");
  const cancelBtn = document.getElementById("make-public-cancel");
  const formStatus = document.getElementById("make-public-status");

  if (!makePublicSection || !makePublicBtn || !form || !formInput || !publishBtn || !cancelBtn || !formStatus) {
    if (makePublicSection) makePublicSection.style.display = isPrivateScan(img) ? "block" : "none";
    return;
  }

  const shouldShow = isPrivateScan(img);
  makePublicSection.style.display = shouldShow ? "block" : "none";

  if (!shouldShow) {
    form.hidden = true;
    return;
  }

  const setFormStatus = (text, kind) => {
    formStatus.classList.remove("is-error", "is-success");
    if (kind === "error") formStatus.classList.add("is-error");
    if (kind === "success") formStatus.classList.add("is-success");
    formStatus.textContent = text || "";
  };

  const openForm = () => {
    form.hidden = false;
    formInput.value = "";
    if (formCount) formCount.textContent = "0";
    setFormStatus("", null);
    formInput.focus();
  };

  const closeForm = () => {
    form.hidden = true;
    formInput.value = "";
    if (formCount) formCount.textContent = "0";
    setFormStatus("", null);
    publishBtn.disabled = false;
    publishBtn.textContent = "Publish";
  };

  if (!makePublicBtn.dataset.bound) {
    makePublicBtn.dataset.bound = "1";
    makePublicBtn.addEventListener("click", openForm);
  }

  if (!formInput.dataset.bound) {
    formInput.dataset.bound = "1";
    formInput.addEventListener("input", () => {
      if (formCount) formCount.textContent = String(formInput.value.length);
    });
  }

  if (!cancelBtn.dataset.bound) {
    cancelBtn.dataset.bound = "1";
    cancelBtn.addEventListener("click", () => {
      closeForm();
    });
  }

  if (!publishBtn.dataset.bound) {
    publishBtn.dataset.bound = "1";
    publishBtn.addEventListener("click", async () => {
      if (!currentScan) return;
      if (publishBtn.disabled) return;

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
        await handleMakePublic(currentScan, description);

        // Clean session data (optional)
        sessionStorage.removeItem("selectedScan");
        sessionStorage.removeItem("selectedScanTitle");

        // Redirect to Scans and force Public tab
        window.location.href = "/scans?tab=public";
      } catch (err) {
        setFormStatus(err?.message || "Failed to publish.", "error");
        publishBtn.disabled = false;
        publishBtn.textContent = "Publish";
      }
    });
  }
}

async function handleMakePublic(img, description) {
  const meRes = await fetch("/auth/me", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "include",
  });

  if (!meRes.ok) throw new Error("You must be signed in to publish.");

  const userData = await meRes.json().catch(() => ({}));
  const userId = userData.user_id;
  if (!userId) throw new Error("Could not read current user.");

  const postBody = {
    user_id: userId,
    image_id: img.image_id,
    description,
    result: {
      verdict: img.verdict || null,
      label: img.label || null,
      confidence: img.confidence || null,
    },
  };

  const postRes = await fetch("/community/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "include",
    body: JSON.stringify(postBody),
  });

  if (!postRes.ok) {
    const errorData = await postRes.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.error || `Failed to publish (${postRes.status})`);
  }

  const updateRes = await fetch(`/image/${img.image_id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "include",
    body: JSON.stringify({ is_public: true }),
  });

  if (!updateRes.ok) {
    const errorData = await updateRes.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.error || `Failed to update image visibility (${updateRes.status})`);
  }
}

// -------------------------
// Init
// -------------------------
window.addEventListener("DOMContentLoaded", () => {
  let img = null;
  let title = null;

  try {
    const raw = sessionStorage.getItem("selectedScan");
    title = sessionStorage.getItem("selectedScanTitle");
    img = raw ? JSON.parse(raw) : null;
  } catch (_) {
    img = null;
  }

  renderScan(img, title);
});
