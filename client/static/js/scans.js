// =========================
// Scans page: fetch + render + Private/Public tabs
// No HTML strings in JS: DOM is built with createElement()
// =========================

let allScans = [];
let activeFilter = "private";

// -------------------------
// Filter helpers
// -------------------------
function getVisibility(img) {
  if (img && typeof img.is_public === "boolean") return img.is_public ? "public" : "private";
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
// Verdict + confidence helpers
// -------------------------
function toPercent(confidence) {
  // confidence expected as 0..1
  const n = Number(confidence);
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.max(0, Math.min(1, n));
  return Math.round(clamped * 100);
}

function verdictType(img) {
  // Determine safe/risk using BOTH verdict and label (more robust)
  const v = (img.verdict || "").toString().toLowerCase();
  const l = (img.label || "").toString().toLowerCase();

  // safe signals
  if (v.includes("real") || v === "safe" || l.includes("real")) return "safe";

  // risk signals
  if (v.includes("ai") || v.includes("fake") || v.includes("deepfake") || v === "deepfake") return "risk";
  if (l.includes("ai") || l.includes("fake") || l.includes("deepfake")) return "risk";

  // unknown: be conservative visually (red)
  return "risk";
}

function verdictLineText(img) {
  // You said backend is giving: "Likely Real" etc. Use it as source of truth.
  const label = (img.label || "").toString().trim();
  if (label) return label;

  // fallback if label missing
  const pct = toPercent(img.confidence);
  return `${pct}% ${verdictType(img) === "safe" ? "Likely Real" : "Likely AI"}`;
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

function createScanCard(img, index) {
  const scanNumber = index + 1;
  const pct = toPercent(img.confidence);
  const type = verdictType(img); // "safe" | "risk"

  // Card
  const card = makeEl("div", "scan-card");

  // Title: Scan 1, Scan 2...
  const title = makeEl("div", "scan-title", `Scan ${scanNumber}`);
  card.appendChild(title);

  // Row: image left, analysis right
  const row = makeEl("div", "scan-row");
  card.appendChild(row);

  // Left: image/placeholder
  const left = makeEl("div", "scan-left");
  row.appendChild(left);

  if (img.url) {
    const image = document.createElement("img");
    image.className = "scan-image";
    image.src = img.url;
    image.alt = `Scan ${img.image_id || scanNumber}`;
    image.addEventListener("click", () => window.open(img.url, "_blank"));
    left.appendChild(image);
  } else {
    left.appendChild(makeEl("div", "image-placeholder", "No image available"));
  }

  // Right: analysis
  const analysis = makeEl("div", "scan-analysis");
  row.appendChild(analysis);

  const h3 = makeEl("h3", null, "Analysis");
  analysis.appendChild(h3);

  // Remove "Our model says" completely per your request

  // Verdict line: use accurate backend label
  // Also: color matches bar fill
  const verdictLine = makeEl("div", `scan-verdict-line verdict-text ${type === "safe" ? "is-safe" : "is-risk"}`);
  verdictLine.textContent = verdictLineText(img);
  analysis.appendChild(verdictLine);

  // Bar: remainder should be red, fill overlays it
  const track = makeEl("div", "confidence-track");
  track.setAttribute("role", "img");
  track.setAttribute("aria-label", `Confidence ${pct}%`);

  const fill = makeEl("div", `confidence-fill ${type === "risk" ? "is-risk" : ""}`);
  fill.style.width = `${pct}%`;

  track.appendChild(fill);
  analysis.appendChild(track);

  // Meta: uploaded date (same as before but without HTML string)
  const meta = makeEl("div", "scan-meta");

  const uploadedText = img.uploaded_at
    ? `Uploaded: ${new Date(img.uploaded_at).toLocaleDateString()}`
    : "Uploaded: N/A";

  meta.textContent = uploadedText;
  analysis.appendChild(meta);

  // -------------------------
  // View more details link
  // -------------------------
  const detailsLink = makeEl("a", "scan-details-link", "View more details");
  detailsLink.href = "/viewscan.html";

  detailsLink.addEventListener("click", (e) => {
    e.preventDefault();

    const vis = getVisibility(img); // "private" or "public"
    const scanNumber = index + 1;
    const title = `Scan ${scanNumber} (${vis.charAt(0).toUpperCase() + vis.slice(1)})`;

    try {
      // Store exactly what we got from /images so viewscan can render it
      sessionStorage.setItem("selectedScan", JSON.stringify(img));
      sessionStorage.setItem("selectedScanTitle", title);
    } catch (_) {
      // If storage fails for any reason, still navigate (page can fallback)
    }

    window.location.href = "/viewscan";
  });

  analysis.appendChild(detailsLink);

  // -------------------------
  // Action buttons
  // -------------------------
  if (getVisibility(img) === "private") {
    // Make Public button (only for private images)
    const makePublicBtn = makeEl("button", "btn-make-public", "Make Public");
    makePublicBtn.type = "button";
    makePublicBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showMakePublicModal(img);
    });
    analysis.appendChild(makePublicBtn);
  } else {
    // Edit Description button (only for public images)
    const editBtn = makeEl("button", "btn-make-public", "Edit Description");
    editBtn.type = "button";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showEditDescriptionModal(img);
    });
    analysis.appendChild(editBtn);
  }

  return card;
}

// -------------------------
// Render
// -------------------------
function renderScans() {
  const statusEl = document.getElementById("scans-status");
  const containerEl = document.getElementById("scans-container");
  if (!statusEl || !containerEl) return;

  clearEl(containerEl);

  const items = getFilteredScans();

  if (items.length === 0) {
    const msg = makeEl("div", "status-message", `No ${activeFilter} scans found.`);
    containerEl.appendChild(msg);
    return;
  }

  items.forEach((img, idx) => {
    containerEl.appendChild(createScanCard(img, idx));
  });
}

// -------------------------
// Fetch and display all user scans
// -------------------------
async function loadScans() {
  const statusEl = document.getElementById("scans-status");
  const containerEl = document.getElementById("scans-container");
  if (!statusEl || !containerEl) return;

  // status: loading
  statusEl.classList.remove("error");
  statusEl.textContent = "Loading your scans...";
  statusEl.classList.add("loading");

  clearEl(containerEl);

  try {
    // Fetch both images and posts 
    const [imagesResponse, postsResponse] = await Promise.all([
      fetch("/images", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
      }),
      fetch("/community/posts", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
      }).catch(() => null), 
    ]);

    if (!imagesResponse.ok) {
      statusEl.classList.remove("loading");
      statusEl.classList.add("error");

      if (imagesResponse.status === 401) {
        statusEl.textContent = "Please log in to view your scans.";
        return;
      }

      statusEl.textContent = `Failed to load scans (${imagesResponse.status})`;
      return;
    }

    const imagesData = await imagesResponse.json();
    const images = imagesData.items || [];
    
    // Fetch posts data if available
    let posts = [];
    if (postsResponse && postsResponse.ok) {
      const postsData = await postsResponse.json().catch(() => ({}));
      posts = postsData.items || [];
    }

    const postByImageId = new Map(posts.map((post) => [post.image_id, post]));

    // Merge images with their post data
    allScans = images.map((img) => {
      const post = postByImageId.get(img.image_id);
      if (post) {
        return { ...img, ...post };
      }
      return img;
    });

    statusEl.classList.remove("loading");
    statusEl.textContent = "";

    if (allScans.length === 0) {
      const msg = makeEl("div", "status-message", "No scans found. Upload and analyze some images first!");
      containerEl.appendChild(msg);
      return;
    }

    renderScans();
  } catch (error) {
    console.error("Error loading scans:", error);

    statusEl.classList.remove("loading");
    statusEl.classList.add("error");
    statusEl.textContent = `Error: ${error.message}`;
  }
}

// -------------------------
// Init
// -------------------------
window.addEventListener("DOMContentLoaded", () => {
  setupScanTabs();
  loadScans();
  setupMakePublicModal();
});

// -------------------------
// Make Public / Edit Description Modal
// -------------------------
let currentImageForPublish = null;
let modalMode = "makePublic"; // "makePublic" or "editDescription"

function setupMakePublicModal() {
  const modal = document.getElementById("make-public-modal");
  const cancelBtn = document.getElementById("modal-cancel");
  const publishBtn = document.getElementById("modal-publish");
  const descInput = document.getElementById("public-description-input");
  const charCounter = document.getElementById("char-counter");
  const modalStatus = document.getElementById("modal-status");

  if (!modal || !cancelBtn || !publishBtn || !descInput) return;

  // Character counter
  if (charCounter) {
    descInput.addEventListener("input", () => {
      charCounter.textContent = descInput.value.length;
    });
  }

  // Cancel button
  cancelBtn.addEventListener("click", () => {
    modal.style.display = "none";
    descInput.value = "";
    if (charCounter) charCounter.textContent = "0";
    if (modalStatus) modalStatus.textContent = "";
    currentImageForPublish = null;
  });

  // Publish button
  publishBtn.addEventListener("click", async () => {
    if (!currentImageForPublish) return;
    if (publishBtn.disabled) return; // Prevent double-click

    const description = descInput.value.trim();
    if (!description) {
      if (modalStatus) {
        modalStatus.className = "status-message error";
        modalStatus.textContent = "Description is required.";
      }
      return;
    }

    if (description.length > 1000) {
      if (modalStatus) {
        modalStatus.className = "status-message error";
        modalStatus.textContent = `Description too long (${description.length}/1000 characters).`;
      }
      return;
    }

    // Disable button during request
    publishBtn.disabled = true;
    if (modalStatus) {
      modalStatus.className = "status-message";
      modalStatus.textContent = modalMode === "editDescription" ? "Updating..." : "Publishing...";
    }

    try {
      if (modalMode === "editDescription") {
        // Edit existing post description
        await handleEditDescription(currentImageForPublish, description, modalStatus);
      } else {
        // Make image public (create new post)
        await handleMakePublic(currentImageForPublish, description, modalStatus);
      }

      // Success - close modal and reload scans
      if (modalStatus) {
        modalStatus.className = "status-message success";
        modalStatus.textContent = modalMode === "editDescription" ? "Updated successfully!" : "Published successfully!";
      }

      setTimeout(() => {
        modal.style.display = "none";
        descInput.value = "";
        if (charCounter) charCounter.textContent = "0";
        if (modalStatus) modalStatus.textContent = "";
        currentImageForPublish = null;
        
        // Reload scans to reflect the change
        loadScans();
      }, 1000);

    } catch (error) {
      console.error("Error:", error);
      if (modalStatus) {
        modalStatus.className = "status-message error";
        modalStatus.textContent = error.message;
      }
    } finally {
      publishBtn.disabled = false;
    }
  });

  // Close modal on backdrop click
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      cancelBtn.click();
    }
  });

  // Close modal on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.style.display === "flex") {
      cancelBtn.click();
    }
  });
}

async function handleMakePublic(img, description, modalStatus) {
  // Get current user ID
  const meRes = await fetch("/auth/me", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "include",
  });

  if (!meRes.ok) {
    throw new Error("You must be signed in to publish.");
  }

  const userData = await meRes.json();
  const userId = userData.user_id;

  // Create post body matching existing structure
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
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    credentials: "include",
    body: JSON.stringify(postBody),
  });

  if (!postRes.ok) {
    const errorData = await postRes.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.error || `Failed to publish (${postRes.status})`);
  }

  // Update image to set is_public = true
  const updateRes = await fetch(`/image/${img.image_id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    credentials: "include",
    body: JSON.stringify({ is_public: true }),
  });

  if (!updateRes.ok) {
    const errorData = await updateRes.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.error || `Failed to update image visibility (${updateRes.status})`);
  }
}

async function handleEditDescription(img, description, modalStatus) {
  // Find the post_id for this image
  if (!img.post_id) {
    throw new Error("No post found for this image");
  }

  // Update post description
  const patchRes = await fetch(`/community/posts?post_id=${img.post_id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    credentials: "include",
    body: JSON.stringify({ description }),
  });

  if (!patchRes.ok) {
    const errorData = await patchRes.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.error || `Failed to update description (${patchRes.status})`);
  }
}

function showMakePublicModal(img) {
  const modal = document.getElementById("make-public-modal");
  const modalTitle = modal?.querySelector("h2");
  const modalText = modal?.querySelector("p");
  const descInput = document.getElementById("public-description-input");
  const publishBtn = document.getElementById("modal-publish");
  const charCounter = document.getElementById("char-counter");
  const modalStatus = document.getElementById("modal-status");

  if (!modal || !descInput) return;

  modalMode = "makePublic";
  currentImageForPublish = img;
  descInput.value = "";
  if (charCounter) charCounter.textContent = "0";
  if (modalStatus) modalStatus.textContent = "";
  if (modalTitle) modalTitle.textContent = "Make Image Public";
  if (modalText) modalText.textContent = "Add a description for your post (required, max 1000 characters):";
  if (publishBtn) publishBtn.textContent = "Publish";
  
  modal.style.display = "flex";
  descInput.focus();
}

function showEditDescriptionModal(img) {
  const modal = document.getElementById("make-public-modal");
  const modalTitle = modal?.querySelector("h2");
  const modalText = modal?.querySelector("p");
  const descInput = document.getElementById("public-description-input");
  const publishBtn = document.getElementById("modal-publish");
  const charCounter = document.getElementById("char-counter");
  const modalStatus = document.getElementById("modal-status");

  if (!modal || !descInput) return;

  modalMode = "editDescription";
  currentImageForPublish = img;
  descInput.value = img.description || "";
  if (charCounter) charCounter.textContent = descInput.value.length.toString();
  if (modalStatus) modalStatus.textContent = "";
  if (modalTitle) modalTitle.textContent = "Edit Description";
  if (modalText) modalText.textContent = "Update your post description (required, max 1000 characters):";
  if (publishBtn) publishBtn.textContent = "Update";
  
  modal.style.display = "flex";
  descInput.focus();
}
