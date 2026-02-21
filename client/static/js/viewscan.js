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

// Scans page uses number percent for bar width.
// Keep this helper local to viewscan so we can do width like scans.
function toPercentNumber(confidence) {
  const n = Number(confidence);
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.max(0, Math.min(1, n));
  return Math.round(clamped * 100);
}

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) n = 0;
  return Math.max(min, Math.min(max, n));
}

function setFillPercent(fillEl, percent) {
  if (!fillEl) return;
  const p = clamp(percent, 0, 100);
  fillEl.style.transform = `scaleX(${p / 100})`;
  fillEl.dataset.p = String(p);
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

function getPostId(img) {
  if (!img) return null;

  // Most common
  if (img.post_id) return img.post_id;

  // Common variations across branches / APIs
  if (img.postId) return img.postId;
  if (img.community_post_id) return img.community_post_id;

  // Nested shapes (just in case)
  if (img.post && (img.post.post_id || img.post.id)) return img.post.post_id || img.post.id;

  return null;
}

async function fetchPostByImageId(imageId) {
  if (!imageId) return null;

  // Try a couple likely endpoints (only GETs). We gracefully ignore failures.
  const urls = [
    `/community/posts?image_id=${encodeURIComponent(imageId)}`,
    `/community/posts/by_image?image_id=${encodeURIComponent(imageId)}`,
    `/community/posts/by_image_id?image_id=${encodeURIComponent(imageId)}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
      });

      if (!res.ok) continue;

      const data = await res.json().catch(() => null);
      if (!data) continue;

      // Handle common shapes:
      // { item: {...} }
      if (data.item && (data.item.post_id || data.item.postId || data.item.id)) return data.item;

      // { items: [...] }
      if (Array.isArray(data.items) && data.items[0]) return data.items[0];

      // direct object {...}
      if (data.post_id || data.postId || data.id) return data;
    } catch (_) {
      // ignore and try next
    }
  }

  return null;
}

async function ensurePostIdForPublicScan(img) {
  // Only for public scans missing post id
  if (!img || isPrivateScan(img)) return false;
  if (getPostId(img)) return true;
  if (!img.image_id) return false;

  const post = await fetchPostByImageId(img.image_id);
  if (!post) return false;

  // Normalize onto currentScan so the rest of your code works unchanged
  img.post_id = post.post_id || post.postId || post.id || null;

  // If the post has a description and scan doesn't, use it
  if (!img.description && post.description) img.description = post.description;

  return !!img.post_id;
}

// =========================
// NEW (necessary): refresh live community vote counts from backend
// so View Scan matches Community page.
// =========================

async function fetchPostByPostId(postId) {
  if (!postId) return null;

  const urls = [
    `/community/posts?post_id=${encodeURIComponent(postId)}`,
    `/community/posts/by_id?post_id=${encodeURIComponent(postId)}`,
    `/community/posts/by_post_id?post_id=${encodeURIComponent(postId)}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
      });

      if (!res.ok) continue;

      const data = await res.json().catch(() => null);
      if (!data) continue;

      if (data.item) return data.item;
      if (Array.isArray(data.items) && data.items[0]) return data.items[0];
      if (data.post_id || data.postId || data.id) return data;
    } catch (_) {}
  }

  return null;
}

function mergePostFieldsIntoScan(scan, post) {
  if (!scan || !post) return;

  // normalize post id (keep your behavior)
  scan.post_id = scan.post_id || post.post_id || post.postId || post.id || null;

  // IMPORTANT: pull the live vote counts
  if (post.up_vote_count != null) scan.up_vote_count = post.up_vote_count;
  if (post.down_vote_count != null) scan.down_vote_count = post.down_vote_count;

  // optional: keep some common fields in sync if present
  if (!scan.description && post.description) scan.description = post.description;
  if (post.updated_at) scan.updated_at = post.updated_at;
  if (post.comment_count != null) scan.comment_count = post.comment_count;
}

async function refreshCommunityData(scan) {
  // Only matters for public scans
  if (!scan || isPrivateScan(scan)) return false;

  // Prefer post_id (most accurate)
  const pid = getPostId(scan);
  if (pid) {
    const post = await fetchPostByPostId(pid);
    if (post) {
      mergePostFieldsIntoScan(scan, post);
      return true;
    }
  }

  // Fallback by image_id (what you already do)
  if (scan.image_id) {
    const post = await fetchPostByImageId(scan.image_id);
    if (post) {
      mergePostFieldsIntoScan(scan, post);
      return true;
    }
  }

  return false;
}

// -------------------------
// Button selection helpers
// - Selected state is driven by whether the dropdown is open
// -------------------------
function setSelected(btn, on) {
  if (!btn) return;
  btn.classList.toggle("is-selected", !!on);
}

function hidePanel(panel) {
  if (!panel) return;
  panel.hidden = true;
}

function showPanel(panel) {
  if (!panel) return;
  panel.hidden = false;
}

// -------------------------
// NEW: Aiclipse card (gold) computations
// Matches your Results logic:
// - If AI/fake/deepfake => confidence is AI% => REAL = 1 - confidence
// - If REAL => confidence is REAL% => REAL = confidence
// - Otherwise => treat as AI% => REAL = 1 - confidence
// -------------------------
function normalizeLabelText(raw) {
  const s = (raw || "Unknown").toString();
  return s.replace(/^\s*\d+(\.\d+)?%\s*/i, "").trim();
}

function renderAiclipseCard(img) {
  const wrap = document.getElementById("verdict-block");
  const card = document.getElementById("aiclipse-card");
  const verdictEl = document.getElementById("aiclipse-verdict");
  const fillEl = document.getElementById("aiclipse-fill");
  const pctEl = document.getElementById("aiclipse-percent");

  if (!wrap || !card || !verdictEl || !fillEl || !pctEl) return;

  if (!img) {
    card.hidden = true;
    return;
  }

  const rawLabel = normalizeLabelText(img.label || img.result || img.verdict || "Unknown");
  const labelLower = rawLabel.toLowerCase();

  const confidenceRaw = Number.isFinite(img.confidence) ? img.confidence : (img.score ?? 0);
  const confidence = clamp(confidenceRaw, 0, 1);

  const isAi =
    labelLower.includes("ai") ||
    labelLower.includes("fake") ||
    labelLower.includes("deepfake");

  const isReal = labelLower.includes("real") && !isAi;

  let realProb = isReal ? confidence : (1 - confidence);
  realProb = clamp(realProb, 0, 1);

  const realPct = realProb * 100;

  verdictEl.textContent = rawLabel || "—";
  pctEl.textContent = `${realPct.toFixed(2)}%`;

  setFillPercent(fillEl, realPct);

  wrap.hidden = false;
  card.hidden = false;
}

// -------------------------
// NEW: Community card (purple)
// - bar shows REAL vote share (up/(up+down))
// - verdict text uses your buckets
// - no votes => "No community votes" and 0.00%
// -------------------------
function communityVerdictText(pctReal) {
  if (pctReal >= 40 && pctReal <= 60) return "Not sure";

  if (pctReal > 60) {
    if (pctReal >= 86) return "Most Likely Real";
    return "Likely Real";
  }

  const pctAI = 100 - pctReal;
  if (pctAI >= 86) return "Most Likely AI";
  return "Likely AI";
}

function renderCommunityCard(img) {
  const card = document.getElementById("community-card");
  const verdictEl = document.getElementById("community-verdict");
  const fillEl = document.getElementById("community-fill");
  const pctEl = document.getElementById("community-percent");

  if (!card || !verdictEl || !fillEl || !pctEl) return;

  // Only show for public posts
  if (!img || isPrivateScan(img)) {
    card.hidden = true;
    return;
  }

  const up = Number(img.up_vote_count);
  const down = Number(img.down_vote_count);
  const upN = Number.isFinite(up) ? up : 0;
  const downN = Number.isFinite(down) ? down : 0;
  const total = upN + downN;

  if (total <= 0) {
    verdictEl.textContent = "No community votes";
    pctEl.textContent = "0.00%";
    setFillPercent(fillEl, 0);
    card.hidden = false;
    return;
  }

  const pctReal = clamp((upN / total) * 100, 0, 100);

  verdictEl.textContent = communityVerdictText(pctReal);
  pctEl.textContent = `${pctReal.toFixed(2)}%`;
  setFillPercent(fillEl, pctReal);

  card.hidden = false;
}

// -------------------------
// Verdict + confidence helpers (match scans page behavior)
// (LEFT AS-IS, no longer used by renderScan)
// -------------------------
function verdictType(img) {
  const v = (img && img.verdict != null ? String(img.verdict) : "").toLowerCase();
  const l = (img && img.label != null ? String(img.label) : "").toLowerCase();

  // safe signals
  if (v.includes("real") || v === "safe" || l.includes("real")) return "safe";

  // risk signals
  if (v.includes("ai") || v.includes("fake") || v.includes("deepfake") || v === "deepfake") return "risk";
  if (l.includes("ai") || l.includes("fake") || l.includes("deepfake")) return "risk";

  // unknown: match scans page (red)
  return "risk";
}

// -------------------------
// Votes helpers (LEFT AS-IS, no longer used by renderScan)
// -------------------------
function getVoteCounts(img) {
  const up = Number(img && img.up_vote_count);
  const down = Number(img && img.down_vote_count);
  return {
    up: Number.isFinite(up) ? up : 0,
    down: Number.isFinite(down) ? down : 0,
  };
}

function voteRealPercent(img) {
  const { up, down } = getVoteCounts(img);
  const total = up + down;
  if (total <= 0) return null; // no votes
  const pct = (up / total) * 100;
  return Math.max(0, Math.min(100, pct));
}

function voteBucket(pctReal) {
  if (pctReal >= 40 && pctReal <= 60) return { text: "Not sure", type: "neutral" };

  if (pctReal > 60) {
    if (pctReal >= 86) return { text: "Most Likely Real", type: "safe" };
    return { text: "Likely Real", type: "safe" };
  }

  const pctAI = 100 - pctReal;
  if (pctAI >= 86) return { text: "Most Likely AI", type: "risk" };
  return { text: "Likely AI", type: "risk" };
}

function renderVotesBlock(img) {
  const block = document.getElementById("votes-block");
  const line = document.getElementById("votes-line");
  const track = document.getElementById("votes-bar");
  const fill = document.getElementById("votes-fill");

  if (!block || !line || !track || !fill) return;

  if (!img || isPrivateScan(img)) {
    block.hidden = true;
    track.hidden = true;
    line.textContent = "";
    line.classList.remove("is-safe", "is-risk", "is-neutral");
    fill.style.width = "0%";

    track.style.removeProperty("background");
    fill.style.removeProperty("background");

    return;
  }

  const pctReal = voteRealPercent(img);

  if (pctReal === null) {
    line.textContent = "No community votes";
    line.classList.remove("is-safe", "is-risk");
    line.classList.add("is-neutral");

    const grey = "rgba(255, 255, 255, 0.22)";
    track.classList.remove("is-risk");
    fill.classList.remove("is-risk");

    track.style.background = grey;
    fill.style.background = grey;
    fill.style.width = "100%";

    track.setAttribute("role", "img");
    track.setAttribute("aria-label", "No community votes");

    block.hidden = false;
    track.hidden = false;
    return;
  }

  const bucket = voteBucket(pctReal);
  const pctAI = 100 - pctReal;
  const displayPct = bucket.type === "risk" ? pctAI : pctReal;

  line.textContent = `${displayPct.toFixed(0)}% ${bucket.text} (Community)`;

  line.classList.remove("is-safe", "is-risk", "is-neutral");
  if (bucket.type === "safe") line.classList.add("is-safe");
  else if (bucket.type === "risk") line.classList.add("is-risk");
  else line.classList.add("is-neutral");

  fill.classList.remove("is-risk");
  track.classList.remove("is-risk");
  fill.style.width = `${pctReal}%`;

  track.style.removeProperty("background");
  fill.style.removeProperty("background");

  track.setAttribute("role", "img");
  track.setAttribute(
    "aria-label",
    bucket.type === "risk"
      ? `Vote confidence ${pctAI.toFixed(0)}% AI`
      : `Vote confidence ${pctReal.toFixed(0)}% real`
  );

  block.hidden = false;
  track.hidden = false;
}

function verdictLineText(img) {
  const label = (img && img.label != null ? String(img.label) : "").trim();
  if (label) return label;

  const pct = toPercentNumber(img && img.confidence);
  return `${pct.toFixed(2)}% ${verdictType(img) === "safe" ? "Likely Real" : "Likely AI"}`;
}

function renderVerdictBlock(img) {
  const block = document.getElementById("verdict-block");
  const line = document.getElementById("verdict-line");
  const track = document.getElementById("verdict-bar");
  const fill = document.getElementById("verdict-fill");

  if (!block || !line || !track || !fill) return;

  if (!img) {
    block.hidden = true;
    track.hidden = true;
    line.textContent = "";
    line.classList.remove("is-safe", "is-risk");
    track.classList.remove("is-risk");
    fill.classList.remove("is-risk");
    fill.style.width = "0%";
    return;
  }

  const pct = toPercentNumber(img.confidence);
  const type = verdictType(img);

  line.textContent = verdictLineText(img);
  line.classList.remove("is-safe", "is-risk");
  line.classList.add(type === "safe" ? "is-safe" : "is-risk");

  track.classList.toggle("is-risk", type === "risk");
  fill.classList.toggle("is-risk", type === "risk");
  fill.style.width = `${pct}%`;

  track.setAttribute("role", "img");
  track.setAttribute("aria-label", `Confidence ${pct}%`);

  block.hidden = false;
  track.hidden = false;
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
    "image_id",
    "url",
    "is_reported",
    "s3_key",
    "user_id",
    "_id",
    "post_id",
    "is_public",
    "clicks_count",
    "comment_count",
    "controversial_since",
    "created_at",
    "debug",
    "result",
    "score",
    "user_name",
  ]);

  // ---- Show only allowed fields ----
  addMeta("Visibility", visibilityOf(img));
  addMeta("Uploaded", formatDate(img.uploaded_at));
  addMeta("Verdict", img.verdict != null ? String(img.verdict) : "N/A");
  addMeta("Confidence", toPercent(img.confidence));

  // Always show description field (even if empty/not set yet)
  const descValue = img.description ? String(img.description) : "(No description yet)";
  addMeta("Description", descValue);

  // Show vote counts for public posts
  if (!isPrivateScan(img)) {
    const upVotes = img.up_vote_count !== undefined ? img.up_vote_count : 0;
    const downVotes = img.down_vote_count !== undefined ? img.down_vote_count : 0;
    addMeta("Up Votes", String(upVotes));
    addMeta("Down Votes", String(downVotes));
  }

  // Show updated_at if it exists (formatted like uploaded_at)
  if (img.updated_at) {
    addMeta("Updated", formatDate(img.updated_at));
  }

  // Show any other non-hidden fields (but skip description since we showed it above)
  const alreadyShown = new Set([
    "is_public",
    "uploaded_at",
    "label",
    "verdict",
    "confidence",
    "description",
    "updated_at",
    "up_vote_count",
    "down_vote_count",
  ]);

  Object.keys(img || {})
    .sort()
    .forEach((key) => {
      if (hiddenFields.has(key) || alreadyShown.has(key)) return;

      const val = img[key];
      let out;

      if (val === null || val === undefined) out = "N/A";
      else if (typeof val === "object") {
        try {
          out = JSON.stringify(val);
        } catch (_) {
          out = "[object]";
        }
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

  // ✅ NEW (necessary): refresh live votes from backend, then re-render community card/meta.
  // This keeps the first render fast (cached), and then syncs with Community page.
  refreshCommunityData(img).then((ok) => {
    if (!ok) return;

    renderMeta(currentScan);

    setupEditDescriptionInline(currentScan);
    setupShowComments(currentScan);
    setupDeletePost(currentScan);

    renderCommunityCard(currentScan);
  });

  // Keep your existing enrichment (post_id/description) as-is
  ensurePostIdForPublicScan(img).then((ok) => {
    if (!ok) return;

    renderMeta(currentScan);

    setupEditDescriptionInline(currentScan);
    setupShowComments(currentScan);
    setupDeletePost(currentScan);

    // re-render community card after enrichment (votes/post id)
    renderCommunityCard(currentScan);
  });

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

  // NEW: community-style cards
  renderAiclipseCard(img);
  renderCommunityCard(img);

  renderMeta(img);
  card.hidden = false;
  setStatus("", null);

  // Edit Description (INLINE, only when post_id exists)
  setupEditDescriptionInline(img);

  // Show Comments (only for public posts with post_id)
  setupShowComments(img);

  // Delete Post (only for public posts with post_id)
  setupDeletePost(img);

  // Delete Scan (only for private scans)
  setupDeleteScan(img);

  // Inline Make Public UI (ONLY when private)
  setupMakePublicInline(img);
}

// -------------------------
// Edit Description (INLINE)
// (UNCHANGED)
// -------------------------
function setupEditDescriptionInline(img) {
  const section = document.getElementById("edit-description-section");
  const openBtn = document.getElementById("btn-edit-description");
  const form = document.getElementById("edit-description-form");
  const input = document.getElementById("edit-description-input");
  const countEl = document.getElementById("edit-description-count");
  const statusEl = document.getElementById("edit-description-status");
  const saveBtn = document.getElementById("edit-description-save");
  const cancelBtn = document.getElementById("edit-description-cancel");

  if (!section || !openBtn || !form || !input || !statusEl || !saveBtn || !cancelBtn) {
    if (section) section.style.display = img && getPostId(img) ? "block" : "none";
    return;
  }

  const postId = getPostId(img);
  const shouldShow = !!postId;
  section.style.display = shouldShow ? "block" : "none";

  if (!shouldShow) {
    form.hidden = true;
    setSelected(openBtn, false);
    return;
  }

  const maxLen = 1000;
  let originalDescription = img.description || "";
  let formOpen = false;
  let hasUnsavedChanges = false;

  const setFormStatus = (text, kind) => {
    statusEl.classList.remove("is-error", "is-success");
    if (kind === "error") statusEl.classList.add("is-error");
    if (kind === "success") statusEl.classList.add("is-success");
    statusEl.textContent = text || "";
  };

  const syncCount = () => {
    if (!countEl) return;
    countEl.textContent = String(input.value.length);
  };

  const openForm = () => {
    originalDescription = currentScan && currentScan.description ? String(currentScan.description) : "";
    input.value = originalDescription;
    syncCount();
    setFormStatus("", null);

    saveBtn.disabled = false;
    saveBtn.textContent = "Save";

    hasUnsavedChanges = false;
    formOpen = true;

    showPanel(form);
    setSelected(openBtn, true);
    input.focus();
  };

  const closeForm = () => {
    hidePanel(form);
    input.value = "";
    if (countEl) countEl.textContent = "0";
    setFormStatus("", null);

    saveBtn.disabled = false;
    saveBtn.textContent = "Save";

    hasUnsavedChanges = false;
    formOpen = false;

    setSelected(openBtn, false);
  };

  const toggleForm = () => {
    const makePublicForm = document.getElementById("make-public-form");
    const makePublicBtn = document.getElementById("btn-make-public");
    if (makePublicForm && !makePublicForm.hidden) {
      hidePanel(makePublicForm);
      setSelected(makePublicBtn, false);
    }

    if (form.hidden) openForm();
    else closeForm();
  };

  if (!openBtn.dataset.bound) {
    openBtn.dataset.bound = "1";
    openBtn.addEventListener("click", toggleForm);
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
      if (formOpen && hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  if (!cancelBtn.dataset.bound) {
    cancelBtn.dataset.bound = "1";
    cancelBtn.addEventListener("click", () => {
      closeForm();
    });
  }

  if (!saveBtn.dataset.bound) {
    saveBtn.dataset.bound = "1";
    saveBtn.addEventListener("click", async () => {
      const postIdNow = getPostId(currentScan);
      if (!currentScan || !postIdNow) return;
      if (saveBtn.disabled) return;

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
        await patchPostDescription(postIdNow, description);

        currentScan.description = description;
        currentScan.updated_at = new Date().toISOString();
        renderMeta(currentScan);

        setFormStatus("✓ Description updated.", "success");

        setTimeout(() => closeForm(), 600);
      } catch (err) {
        setFormStatus(err?.message || "Failed to update description.", "error");
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
      }
    });
  }
}

async function patchPostDescription(postId, description) {
  const response = await fetch(`/community/posts?post_id=${encodeURIComponent(postId)}`, {
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

// -------------------------
// Show Comments (UNCHANGED)
// -------------------------
function setupShowComments(img) {
  const section = document.getElementById("show-comments-section");
  const showBtn = document.getElementById("btn-show-comments");
  const container = document.getElementById("comments-container");
  const statusEl = document.getElementById("comments-status");
  const listEl = document.getElementById("comments-list");

  if (!section || !showBtn || !container || !statusEl || !listEl) {
    if (section) section.style.display = "none";
    return;
  }

  const postId = getPostId(img);

  const shouldShow = !!(postId && !isPrivateScan(img));
  section.style.display = shouldShow ? "block" : "none";

  if (!shouldShow) {
    return;
  }

  let commentsVisible = false;

  const setStatus = (text, isError) => {
    statusEl.textContent = text || "";
  };

  const renderComments = (comments) => {
    clearEl(listEl);

    if (!comments || comments.length === 0) {
      listEl.appendChild(makeEl("div", "comment-empty", "No comments yet."));
      return;
    }

    comments.forEach((comment) => {
      const commentDiv = makeEl("div", "comment-item");

      const header = makeEl("div", "comment-header");
      const username = makeEl("span", "comment-username", comment.user_name || "Anonymous");
      const date = makeEl(
        "span",
        "comment-date",
        comment.created_at ? new Date(comment.created_at).toLocaleString() : ""
      );
      header.appendChild(username);
      header.appendChild(date);

      const body = makeEl("div", "comment-body", comment.text || "");

      commentDiv.appendChild(header);
      commentDiv.appendChild(body);
      listEl.appendChild(commentDiv);
    });
  };

  const toggleComments = async () => {
    if (commentsVisible) {
      container.hidden = true;
      commentsVisible = false;
      showBtn.textContent = "Show Comments";
      setSelected(showBtn, false);
    } else {
      container.hidden = false;
      commentsVisible = true;
      showBtn.textContent = "Hide Comments";
      setSelected(showBtn, true);

      setStatus("Loading comments...", false);
      clearEl(listEl);

      try {
        const postIdNow = getPostId(currentScan);
        if (!postIdNow) {
          setStatus("Missing post id for this scan.", true);
          return;
        }

        const res = await fetch(`/community/posts/comments?post_id=${encodeURIComponent(postIdNow)}`, {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "include",
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setStatus(data.error || data.detail || `Failed to load comments (${res.status})`, true);
          return;
        }

        setStatus("", false);
        renderComments(data.items || []);
      } catch (err) {
        setStatus("Network error loading comments.", true);
      }
    }
  };

  if (!showBtn.dataset.bound) {
    showBtn.dataset.bound = "1";
    showBtn.addEventListener("click", toggleComments);
  }
}

// -------------------------
// Delete Post (UNCHANGED)
// -------------------------
function setupDeletePost(img) {
  const section = document.getElementById("delete-post-section");
  const deleteBtn = document.getElementById("btn-delete-post");
  const statusEl = document.getElementById("delete-post-status");

  if (!section || !deleteBtn || !statusEl) {
    if (section) section.style.display = "none";
    return;
  }

  const postId = getPostId(img);

  const shouldShow = !!(postId && !isPrivateScan(img));
  section.style.display = shouldShow ? "block" : "none";

  if (!shouldShow) {
    return;
  }

  const setStatus = (text, kind) => {
    statusEl.classList.remove("is-error", "is-success");
    if (kind === "error") statusEl.classList.add("is-error");
    if (kind === "success") statusEl.classList.add("is-success");
    statusEl.textContent = text || "";
  };

  const modal = document.getElementById("delete-modal");
  const modalConfirm = document.getElementById("modal-confirm");
  const modalCancel = document.getElementById("modal-cancel");

  if (modal) modal.hidden = true;

  const showModal = () => {
    if (modal) modal.hidden = false;
  };

  const hideModal = () => {
    if (modal) modal.hidden = true;
  };

  if (!deleteBtn.dataset.bound) {
    deleteBtn.dataset.bound = "1";
    deleteBtn.addEventListener("click", () => {
      const postIdNow = getPostId(currentScan);
      if (!currentScan || !postIdNow) return;
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
      const postIdNow = getPostId(currentScan);
      if (!currentScan || !postIdNow) return;

      hideModal();
      deleteBtn.disabled = true;
      deleteBtn.textContent = "Deleting...";
      setStatus("Deleting post...", null);

      try {
        const res = await fetch(`/community/posts?post_id=${encodeURIComponent(postIdNow)}`, {
          method: "DELETE",
          credentials: "include",
          headers: { Accept: "application/json" },
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data.error || data.detail || `Failed to delete post (${res.status})`);
        }

        setStatus("✓ Post deleted. Redirecting...", "success");

        sessionStorage.removeItem("selectedScan");
        sessionStorage.removeItem("selectedScanTitle");

        setTimeout(() => {
          window.location.href = "/scans";
        }, 800);
      } catch (err) {
        setStatus(err?.message || "Failed to delete post.", "error");
        deleteBtn.disabled = false;
        deleteBtn.textContent = "Delete Post";
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

// -------------------------
// Delete Scan (UNCHANGED)
// -------------------------
function setupDeleteScan(img) {
  const section = document.getElementById("delete-scan-section");
  const deleteBtn = document.getElementById("btn-delete-scan");
  const statusEl = document.getElementById("delete-scan-status");

  if (!section || !deleteBtn || !statusEl) {
    if (section) section.style.display = "none";
    return;
  }

  const shouldShow = !!(img && img.image_id && isPrivateScan(img));
  section.style.display = shouldShow ? "block" : "none";

  if (!shouldShow) {
    return;
  }

  const setStatus = (text, kind) => {
    statusEl.classList.remove("is-error", "is-success");
    if (kind === "error") statusEl.classList.add("is-error");
    if (kind === "success") statusEl.classList.add("is-success");
    statusEl.textContent = text || "";
  };

  const modal = document.getElementById("delete-scan-modal");
  const modalConfirm = document.getElementById("scan-modal-confirm");
  const modalCancel = document.getElementById("scan-modal-cancel");

  if (modal) modal.hidden = true;

  const showModal = () => {
    if (modal) modal.hidden = false;
  };

  const hideModal = () => {
    if (modal) modal.hidden = true;
  };

  if (!deleteBtn.dataset.bound) {
    deleteBtn.dataset.bound = "1";
    deleteBtn.addEventListener("click", () => {
      if (!currentScan || !currentScan.image_id) return;
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
      if (!currentScan || !currentScan.image_id) return;

      hideModal();
      deleteBtn.disabled = true;
      deleteBtn.textContent = "Deleting...";
      setStatus("Deleting scan...", null);

      try {
        const res = await fetch(`/image/${encodeURIComponent(currentScan.image_id)}`, {
          method: "DELETE",
          credentials: "include",
          headers: { Accept: "application/json" },
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data.error || data.detail || `Failed to delete scan (${res.status})`);
        }

        setStatus("✓ Scan deleted. Redirecting...", "success");

        sessionStorage.removeItem("selectedScan");
        sessionStorage.removeItem("selectedScanTitle");

        setTimeout(() => {
          window.location.href = "/scans";
        }, 800);
      } catch (err) {
        setStatus(err?.message || "Failed to delete scan.", "error");
        deleteBtn.disabled = false;
        deleteBtn.textContent = "Delete Scan";
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

// -------------------------
// Make Public (INLINE, no modal) (UNCHANGED)
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
    setSelected(makePublicBtn, false);
    return;
  }

  const setFormStatus = (text, kind) => {
    formStatus.classList.remove("is-error", "is-success");
    if (kind === "error") formStatus.classList.add("is-error");
    if (kind === "success") formStatus.classList.add("is-success");
    formStatus.textContent = text || "";
  };

  const openForm = () => {
    showPanel(form);
    formInput.value = "";
    if (formCount) formCount.textContent = "0";
    setFormStatus("", null);

    setSelected(makePublicBtn, true);
    formInput.focus();
  };

  const closeForm = () => {
    hidePanel(form);
    formInput.value = "";
    if (formCount) formCount.textContent = "0";
    setFormStatus("", null);

    publishBtn.disabled = false;
    publishBtn.textContent = "Publish";

    setSelected(makePublicBtn, false);
  };

  const toggleForm = () => {
    const editForm = document.getElementById("edit-description-form");
    const editBtn = document.getElementById("btn-edit-description");
    if (editForm && !editForm.hidden) {
      hidePanel(editForm);
      setSelected(editBtn, false);
    }

    if (form.hidden) openForm();
    else closeForm();
  };

  if (!makePublicBtn.dataset.bound) {
    makePublicBtn.dataset.bound = "1";
    makePublicBtn.addEventListener("click", toggleForm);
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

        sessionStorage.removeItem("selectedScan");
        sessionStorage.removeItem("selectedScanTitle");

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
    throw new Error(
      errorData.detail || errorData.error || `Failed to update image visibility (${updateRes.status})`
    );
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