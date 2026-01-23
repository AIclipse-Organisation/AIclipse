// =========================
// View Scan page
// - Reads selected scan object from sessionStorage
// - Shows it (image + meta)
// - Shows passed title e.g. "Scan 1 (Private)"
// - Supports editing post descriptions
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
  
  // Always show edit section if this is a post with post_id (meaning it's public and in community)
  if (img.post_id) {
    showEditSection(img);
  }
}

function showEditSection(img) {
  const editSection = document.getElementById("edit-section");
  const descriptionInput = document.getElementById("description-input");
  
  if (!editSection || !descriptionInput) return;
  
  // Set current description
  const originalDescription = img.description || "";
  descriptionInput.value = originalDescription;
  editSection.style.display = "block";
  
  // Warn before leaving if there are unsaved changes
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
  
  // Setup save button
  const saveBtn = document.getElementById("save-btn");
  const cancelBtn = document.getElementById("cancel-edit-btn");
  
  if (saveBtn) {
    saveBtn.onclick = () => {
      hasUnsavedChanges = false; // Clear flag before save
      saveDescription(img.post_id);
    };
  }
  
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      if (hasUnsavedChanges && !confirm("You have unsaved changes. Are you sure you want to leave?")) {
        return;
      }
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
  
  // Disable button during save
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
    
    // Success - show message and redirect
    editStatus.textContent = "✓ Description updated successfully!";
    editStatus.style.color = "#28a745";
    
    // Clean up sessionStorage before redirect
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
