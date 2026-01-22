// =========================
// Scans page: fetch + render + filter tabs (Private/Public)
// =========================

// Hold all scans returned by the API (unfiltered)
let allScans = [];

// Current active filter tab
// "private" = saved, "public" = published
let activeFilter = "private";

/**
 * Turn whatever your backend returns into a stable "private" / "public" string.
 * Your current API uses img.is_public (boolean), so we key off that.
 * If it's missing, default to private (safer).
 */
function getVisibility(img) {
  if (img && typeof img.is_public === "boolean") {
    return img.is_public ? "public" : "private";
  }
  return "private";
}

/**
 * Return filtered list based on activeFilter.
 */
function getFilteredScans() {
  return allScans.filter((img) => getVisibility(img) === activeFilter);
}

/**
 * Wire up the Private/Public tabs.
 * Expects HTML buttons with:
 *  - class="scans-tab"
 *  - data-filter="private" or data-filter="public"
 */
function setupScanTabs() {
  const tabs = document.querySelectorAll(".scans-tab");
  if (!tabs.length) return; // If you haven't added the HTML yet, don't break.

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter || "private";

      // Update active styles + aria-selected
      tabs.forEach((t) => {
        const isActive = (t.dataset.filter === activeFilter);
        t.classList.toggle("is-active", isActive);
        t.setAttribute("aria-selected", isActive ? "true" : "false");
      });

      // Re-render cards based on filter
      renderScans();
    });
  });
}

/**
 * Render the scans currently in memory (allScans) using the active filter.
 * Keeps your card design unchanged.
 */
function renderScans() {
  const statusEl = document.getElementById("scans-status");
  const containerEl = document.getElementById("scans-container");

  if (!statusEl || !containerEl) return;

  containerEl.innerHTML = "";

  const items = getFilteredScans();

  if (items.length === 0) {
    // Match your existing "status-message" style
    containerEl.innerHTML = `<div class="status-message">No ${activeFilter} scans found.</div>`;
    return;
  }

  // Render filtered images (your original card markup)
  items.forEach((img) => {
    const card = document.createElement("div");
    card.className = "scan-card";

    const verdictClass =
      img.verdict === "safe"
        ? "verdict-safe"
        : img.verdict === "deepfake"
        ? "verdict-deepfake"
        : "";

    // Create image element or placeholder
    let imageHTML = "";
    if (img.url) {
      imageHTML = `<img src="${img.url}" alt="Scan ${img.image_id}" class="scan-image" onclick="window.open('${img.url}', '_blank')">`;
    } else {
      imageHTML = '<div class="image-placeholder">No image available</div>';
    }

    card.innerHTML = `
      ${imageHTML}
      <div class="scan-content">
        <div>
          <strong>ID:</strong> ${img.image_id || "N/A"}
        </div>
        <div class="meta">
          <strong>Verdict:</strong> <span class="${verdictClass}">${img.verdict || "N/A"}</span>
        </div>
        <div class="meta">
          <strong>Label:</strong> ${img.label || "N/A"}
        </div>
        <div class="meta">
          <strong>Confidence:</strong> ${img.confidence != null ? img.confidence.toFixed(3) : "N/A"}
        </div>
        <div class="flags">
          Visibility: ${img.is_public ? "Public" : "Private"} • 
          Uploaded: ${img.uploaded_at ? new Date(img.uploaded_at).toLocaleDateString() : "N/A"}
        </div>
      </div>
    `;

    containerEl.appendChild(card);
  });
}

// Fetch and display all user scans
async function loadScans() {
  const statusEl = document.getElementById("scans-status");
  const containerEl = document.getElementById("scans-container");

  if (!statusEl || !containerEl) return;

  statusEl.innerHTML = '<div class="loading">Loading your scans...</div>';
  containerEl.innerHTML = "";

  try {
    // Fetch all images without any filter (no is_public parameter)
    const response = await fetch("/images", {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      credentials: "include",
    });

    if (!response.ok) {
      if (response.status === 401) {
        statusEl.innerHTML = '<div class="error">Please log in to view your scans.</div>';
        return;
      }
      throw new Error(`Failed to load scans (${response.status})`);
    }

    const data = await response.json();
    const items = data.items || [];

    statusEl.innerHTML = "";

    // Store all scans, then render based on activeFilter
    allScans = items;

    // If the API returns nothing, keep your original empty state text
    if (allScans.length === 0) {
      containerEl.innerHTML =
        '<div class="status-message">No scans found. Upload and analyze some images first!</div>';
      return;
    }

    // Render filtered view
    renderScans();
  } catch (error) {
    console.error("Error loading scans:", error);
    statusEl.innerHTML = `<div class="error">Error: ${error.message}</div>`;
  }
}

// Load scans + setup tabs when page loads
window.addEventListener("DOMContentLoaded", () => {
  setupScanTabs();
  loadScans();
});
