// =========================
// Scans page: fetch + render + Private/Public tabs
// Updated: decimal precision + fixed layout
// =========================

let allScans = [];
let activeFilter = "private";

// -------------------------
// Filter helpers
// -------------------------
function getVisibility(img) {
  if (img && typeof img.is_public === "boolean")
    return img.is_public ? "public" : "private";
  return "private";
}

function getFilteredScans() {
  return allScans.filter((img) => getVisibility(img) === activeFilter);
}

function setupScanTabs() {
  const tabs = document.querySelectorAll(".scans-tab");
  if (!tabs.length) return;

  tabs.forEach((t) => {
    const isActive = t.dataset.filter === activeFilter;
    t.classList.toggle("is-active", isActive);
    t.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter || "private";

      tabs.forEach((t) => {
        const isActive = t.dataset.filter === activeFilter;
        t.classList.toggle("is-active", isActive);
        t.setAttribute("aria-selected", isActive ? "true" : "false");
      });

      renderScans();
    });
  });
}

// -------------------------
// Compute REAL% (same logic as results.js)
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
    realPct: (realProb * 100).toFixed(2), // 🔥 KEEP DECIMALS
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

function createEmptyStateForActiveTab() {
  const wrapper = makeEl("div", "scans-empty-state");

  const iconSrc =
    activeFilter === "public"
      ? "/static/images/community_icon.png"
      : "/static/images/upload_icon.png";
  const iconAlt = activeFilter === "public" ? "Published icon" : "Upload icon";

  const message =
    activeFilter === "public"
      ? "No published scans yet."
      : "No uploads done yet.";

  const box = makeEl("div", "scans-empty-box");
  const iconEl = document.createElement("img");
  iconEl.className = "scans-empty-icon";
  iconEl.src = iconSrc;
  iconEl.alt = iconAlt;
  const text = makeEl("p", "scans-empty-text", message);
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
  // We still need these values for the bar width and accessibility label
  const { label, realPct } = computeRealPct(img);

  const card = makeEl("div", "scan-card");

  // Make the entire card clickable
  card.addEventListener("click", () => {
    sessionStorage.setItem("selectedScan", JSON.stringify(img));
    window.location.href = "/viewscan";
  });

  const row = makeEl("div", "scan-row");
  card.appendChild(row);

  // The Image Container
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

  // --- THE BAR HAS BEEN COMPLETELY REMOVED ---
  // No track, no fill, no appending.

  return card;
}

// -------------------------
// Render + Fetch
// -------------------------
function renderScans() {
  const containerEl = document.getElementById("scans-container");
  if (!containerEl) return;

  clearEl(containerEl);

  const items = getFilteredScans();

  if (items.length === 0) {
    containerEl.appendChild(createEmptyStateForActiveTab());
    return;
  }

  items.forEach((img, idx) => {
    containerEl.appendChild(createScanCard(img, idx));
  });
}

// -------------------------
// Skeleton Loader
// -------------------------
function renderSkeletonCards(count = 9) { // 9 cards perfectly fills 3 rows
  const containerEl = document.getElementById("scans-container");
  if (!containerEl) return;

  clearEl(containerEl);

  for (let i = 0; i < count; i++) {
    const skeleton = makeEl("div", "skeleton-card");
    containerEl.appendChild(skeleton);
  }
}

// -------------------------
// Render + Fetch
// -------------------------
async function loadScans() {
  const statusEl = document.getElementById("scans-status");
  const containerEl = document.getElementById("scans-container");
  if (!statusEl || !containerEl) return;

  // 1. Clear any old text and show the animated skeletons
  statusEl.textContent = ""; 
  renderSkeletonCards(2); 

  try {
    const res = await fetch("/images", { credentials: "include" });
    if (!res.ok) {
      clearEl(containerEl); // Remove skeletons on error
      statusEl.textContent = "Failed to load scans.";
      return;
    }

    const data = await res.json();
    allScans = data.items || [];
    statusEl.textContent = "";

    // 2. Render the real scans (this automatically overwrites the skeletons)
    renderScans();
  } catch (err) {
    clearEl(containerEl); // Remove skeletons on error
    statusEl.textContent = "Error loading scans.";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  setupScanTabs();
  loadScans();
});
