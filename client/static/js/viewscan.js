// =========================
// View Scan page
// - Reads selected scan object from sessionStorage
// - Shows it (image + meta)
// - Shows passed title e.g. "Scan 1 (Private)"
// =========================

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

  // ---- Priority fields (common + important) ----
  addMeta("Visibility", visibilityOf(img));
  addMeta("Image ID", img.image_id != null ? String(img.image_id) : "N/A");
  addMeta("Uploaded", formatDate(img.uploaded_at));
  addMeta("Label", img.label != null ? String(img.label) : "N/A");
  addMeta("Verdict", img.verdict != null ? String(img.verdict) : "N/A");
  addMeta("Confidence", toPercent(img.confidence));
  addMeta("URL", img.url != null ? String(img.url) : "N/A");

  // ---- Dump the raw payload keys too (so you KNOW what comes in) ----
  // This is exactly what you asked for: see everything that arrives.
  const seen = new Set(["is_public", "image_id", "uploaded_at", "label", "verdict", "confidence", "url"]);

  Object.keys(img || {}).sort().forEach((key) => {
    if (seen.has(key)) return;

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
