// =========================
// Scans page: fetch + render all scans
// =========================

let allScans = [];

// -------------------------
// Helper: Get Visibility
// -------------------------
function getVisibility(img) {
  if (img && typeof img.is_public === "boolean")
    return img.is_public ? "public" : "private";
  return "private";
}

// -------------------------
// Compute REAL% (No changes here)
// -------------------------
function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function cleanLabelText(raw) {
  const s = (raw || "").toString();
  return s.replace(/^\s*\d+(\.\d+)?%\s*/i, "").trim();
}

function computeRealPct(img) {
  const rawLabel = cleanLabelText(img?.label || img?.result || "Unknown");
  const labelLower = rawLabel.toLowerCase();

  const confidenceRaw = Number.isFinite(img?.confidence)
    ? img.confidence
    : (img?.score ?? 0);

  const confidence = clamp01(confidenceRaw);

  const isAi =
    labelLower.includes("ai") ||
    labelLower.includes("fake") ||
    labelLower.includes("deepfake");

  const isReal = labelLower.includes("real") && !isAi;

  let realProb = isReal ? confidence : 1 - confidence;
  realProb = clamp01(realProb);

  return {
    label: rawLabel || "Unknown",
    realPct: (realProb * 100).toFixed(2),
  };
}

// -------------------------
// DOM helpers
// -------------------------
function clearEl(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// Unified empty state since tabs are gone
function createEmptyState() {
  const wrapper = makeEl("div", "scans-empty-state");
  const box = makeEl("div", "scans-empty-box");
  
  const iconEl = document.createElement("img");
  iconEl.className = "scans-empty-icon";
  iconEl.src = "/static/images/upload_icon.png";
  iconEl.alt = "Upload icon";
  
  const text = makeEl("p", "scans-empty-text", "No scans yet.");
  
  box.appendChild(iconEl);
  box.appendChild(text);
  wrapper.appendChild(box);

  const button = makeEl("button", "scans-empty-btn", "Go to Upload");
  button.type = "button";
  button.addEventListener("click", () => {
    window.location.href = "/upload";
  });
  wrapper.appendChild(button);

  return wrapper;
}

function createScanCard(img, index) {
  const scanNumber = index + 1;
  const card = makeEl("div", "scan-card");

  card.addEventListener("click", () => {
    sessionStorage.setItem("selectedScan", JSON.stringify(img));
    window.location.href = "/viewscan";
  });

  const row = makeEl("div", "scan-row");
  card.appendChild(row);

  const left = makeEl("div", "scan-left");
  row.appendChild(left);

  if (img.url) {
    const image = document.createElement("img");
    image.className = "scan-image";
    image.src = img.url;
    image.alt = `Scan ${img.image_id || scanNumber}`;
    image.draggable = false;
    left.appendChild(image);
  } else {
    left.appendChild(makeEl("div", "image-placeholder", "No image"));
  }

  // --- ADD VISIBILITY BADGE ---
  const visibility = getVisibility(img);
  
 if (visibility === "private") {
    const badge = makeEl("div", "scan-visibility-badge");
    badge.title = "Private Scan";
    badge.innerHTML = `<svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/></svg>`;
    
    left.appendChild(badge);
  }
  

  return card;
}

// -------------------------
// Skeleton Loader & Fetch
// -------------------------
function renderSkeletonCards(count = 9) {
  const containerEl = document.getElementById("scans-container");
  if (!containerEl) return;
  clearEl(containerEl);
  for (let i = 0; i < count; i++) {
    containerEl.appendChild(makeEl("div", "skeleton-card"));
  }
}

function renderScans() {
  const containerEl = document.getElementById("scans-container");
  if (!containerEl) return;
  clearEl(containerEl);

  // Since tabs are gone, we just use allScans directly
  if (allScans.length === 0) {
    containerEl.appendChild(createEmptyState());
    return;
  }

  allScans.forEach((img, idx) => {
    containerEl.appendChild(createScanCard(img, idx));
  });
}

async function loadScans() {
  const statusEl = document.getElementById("scans-status");
  const containerEl = document.getElementById("scans-container");
  if (!statusEl || !containerEl) return;

  statusEl.textContent = "";
  renderSkeletonCards(9);

  try {
    const res = await fetch("/images", { credentials: "include" });
    if (!res.ok) {
      clearEl(containerEl);
      statusEl.textContent = "Failed to load scans.";
      return;
    }

    const data = await res.json();
    allScans = data.items || [];
    statusEl.textContent = "";

    renderScans();
  } catch (err) {
    clearEl(containerEl);
    statusEl.textContent = "Error loading scans.";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  // Setup tabs has been removed completely! Just load data.
  loadScans();
});