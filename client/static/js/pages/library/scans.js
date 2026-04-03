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

function createEmptyState() {
  const wrapper = makeEl("div", "scans-empty-state");
  const box = makeEl("div", "scans-empty-box");
  const assetUrl = window.AIclipseAssetUrl;

  const iconEl = document.createElement("img");
  iconEl.className = "scans-empty-icon";
  iconEl.src = assetUrl("images/upload_icon.png");
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
    const postId = String(
      img?.post_id || img?.postId || img?.community_post_id || "",
    ).trim();
    const imageId = String(img?.image_id || "").trim();
    if (!imageId) return;

    const viewscanUrl = new URL(`/viewscan/${encodeURIComponent(imageId)}`, window.location.origin);
    if (postId) {
      viewscanUrl.searchParams.set("from", "scans");
      viewscanUrl.searchParams.set("mark_post_id", postId);
    }

    window.location.href = viewscanUrl.toString();
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

  // --- ADD MODERATION BADGE ---
  if (img.moderation_status === "removed") {
    const modBadge = makeEl("div", "scan-moderation-badge");
    modBadge.title = img.moderation_reason || "Removed by moderation";
    modBadge.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
    left.appendChild(modBadge);
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

  if (allScans.length === 0) {
    containerEl.appendChild(createEmptyState());
    return;
  }

  allScans.forEach((img, idx) => {
    containerEl.appendChild(createScanCard(img, idx));
  });
}

function applyModerationStatuses(scans, moderationItems) {
  const moderationByImageId = {};
  (moderationItems || []).forEach((item) => {
    if (item?.image_id) {
      moderationByImageId[item.image_id] = item;
    }
  });

  scans.forEach((img) => {
    const moderation = moderationByImageId[img.image_id];
    if (!moderation) return;
    img.moderation_status = moderation.moderation_status;
    img.moderation_reason = moderation.moderation_reason;
  });
}

async function enrichModerationStatuses(scans) {
  if (!Array.isArray(scans) || scans.length === 0) return;

  try {
    const imageIds = scans.map((img) => img.image_id).filter(Boolean);

    const modRes = await fetch("/community/posts/moderation-status", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({ image_ids: imageIds }),
    });

    if (!modRes.ok) return;

    const modData = await modRes.json();
    applyModerationStatuses(scans, modData.items);
  } catch (err) {
    console.warn("Failed to fetch moderation status:", err);
  }
}

async function loadScans() {
  const statusEl = document.getElementById("scans-status");
  const containerEl = document.getElementById("scans-container");
  if (!statusEl || !containerEl) return;

  statusEl.textContent = "";
  renderSkeletonCards(9);

  try {
    const res = await fetch("/images", { credentials: "include", cache: "no-store" });
    if (!res.ok) {
      clearEl(containerEl);
      statusEl.textContent = "Failed to load scans.";
      return;
    }

    const data = await res.json();
    allScans = data.items || [];

    await enrichModerationStatuses(allScans);

    statusEl.textContent = "";
    renderScans();
  } catch (err) {
    clearEl(containerEl);
    statusEl.textContent = "Error loading scans.";
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    loadScans();
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    applyModerationStatuses,
    getVisibility,
  };
}
