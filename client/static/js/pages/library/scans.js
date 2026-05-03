let allScans = [];

function getVisibility(img) {
  if (img && typeof img.is_public === "boolean") {
    return img.is_public ? "public" : "private";
  }
  return "private";
}

function buildViewscanUrl(img, origin) {
  const imageId = String(img?.image_id || "").trim();
  if (!imageId) return null;

  const resolvedOrigin =
    origin || (typeof window !== "undefined" ? window.location.origin : "http://localhost");
  const viewscanUrl = new URL(`/viewscan/${encodeURIComponent(imageId)}`, resolvedOrigin);
  const postId = String(img?.post_id || img?.postId || img?.community_post_id || "").trim();
  if (postId) {
    viewscanUrl.searchParams.set("from", "scans");
    viewscanUrl.searchParams.set("mark_post_id", postId);
  }

  return viewscanUrl.toString();
}

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
  const card = makeEl("div", "scan-card loading-img"); // Added loading-img class
  const viewscanUrl = buildViewscanUrl(img);

  if (viewscanUrl) {
    card.addEventListener("click", () => {
      window.location.href = viewscanUrl;
    });
  }

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

    image.onload = () => {
      image.classList.add("is-loaded");
      card.classList.remove("loading-img");
    };
    
    if (image.complete) {
      image.classList.add("is-loaded");
      card.classList.remove("loading-img");
    }

    left.appendChild(image);
  } else {
    left.appendChild(makeEl("div", "image-placeholder", "No image"));
    card.classList.remove("loading-img");
  }

 if (getVisibility(img) === "private") {
  const badge = makeEl("div", "scan-visibility-badge");
  
 badge.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
    </svg>
  `;
  left.appendChild(badge);
}

  return card;
}

function renderSkeletonCards(count = 9) {
  const containerEl = document.getElementById("scans-container");
  if (!containerEl) return;
  clearEl(containerEl);
  for (let i = 0; i < count; i += 1) {
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

async function loadScans() {
  const statusEl = document.getElementById("scans-status");
  const containerEl = document.getElementById("scans-container");
  const api = window.AIclipseLibraryApi;
  if (!statusEl || !containerEl || !api) return;

  statusEl.textContent = "";
  renderSkeletonCards(9);

  try {
    const data = await api.listImages();
    allScans = Array.isArray(data?.items) ? data.items : [];
    renderScans();
  } catch (err) {
    clearEl(containerEl);
    statusEl.textContent = err?.message || "Failed to load scans.";
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    loadScans();
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildViewscanUrl,
    getVisibility,
  };
}
