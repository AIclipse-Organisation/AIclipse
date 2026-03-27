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
const markedNotificationPostIds = new Set();

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

// Scrambling number animation
function createScrambledNumber(finalValue, element, shouldAnimate, delay = 0) {
  if (!shouldAnimate) {
    element.textContent = `${finalValue}%`;
    return;
  }

  const startTime = Date.now() + delay;
  const duration = 1500; // 1.5 seconds of scrambling
  const scrambleDuration = 1200; // Scramble for first 1.2 seconds

  const animate = () => {
    const elapsed = Date.now() - startTime;

    if (elapsed < 0) {
      // Still in delay period
      element.textContent = "0%";
      requestAnimationFrame(animate);
      return;
    }

    if (elapsed < scrambleDuration) {
      // Scrambling phase - show random numbers
      const randomValue = Math.floor(Math.random() * 100);
      element.textContent = `${randomValue}%`;
      requestAnimationFrame(animate);
    } else if (elapsed < duration) {
      // Settling phase - ease towards final value
      const settleProgress = (elapsed - scrambleDuration) / (duration - scrambleDuration);
      const eased = 1 - Math.pow(1 - settleProgress, 3); // Ease out cubic
      const currentValue = Math.round(eased * finalValue);
      element.textContent = `${currentValue}%`;
      requestAnimationFrame(animate);
    } else {
      // Animation complete
      element.textContent = `${finalValue}%`;
    }
  };

  requestAnimationFrame(animate);
}

// Zone gradient anchored to bar width + a sheen overlay
function fillStyle(aiPct, gradient) {
  const pct = Math.max(aiPct, 0.1);
  const zoneSize = `${(10000 / pct).toFixed(2)}%`;
  return `
    linear-gradient(to right, rgba(0,0,0,0.28), transparent) left / 100% 100% no-repeat,
    linear-gradient(to right, ${gradient}) left / ${zoneSize} 100% no-repeat
  `;
}

function setFillPercent(fillEl, percent) {
  if (!fillEl) return;
  const p = clamp(percent, 0, 100);
  fillEl.style.width = p === 0 ? "0px" : `calc(${p}% - 8px)`;
  fillEl.dataset.p = String(p);
}

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) n = 0;
  return Math.max(min, Math.min(max, n));
}

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) n = 0;
  return Math.max(min, Math.min(max, n));
}

function setFillPercent(fillEl, percent) {
  if (!fillEl) return;
  const p = clamp(percent, 0, 100);
  fillEl.style.width = `${p}%`;
  fillEl.dataset.p = String(p);
}

function formatDate(dt) {
  if (!dt) return "N/A";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return "N/A";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
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

function normalizeId(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

async function markNotificationsReadForPost(postId) {
  const normalizedPostId = normalizeId(postId);
  if (!normalizedPostId) return;
  if (markedNotificationPostIds.has(normalizedPostId)) return;

  await fetch("/community/notifications/read", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ post_id: normalizedPostId }),
  }).catch(() => null);

  markedNotificationPostIds.add(normalizedPostId);
  window.dispatchEvent(new Event("notifications:updated"));
}

function consumeScansMarkPostId() {
  const raw = sessionStorage.getItem("notif_mark_post_id_from_scans");
  sessionStorage.removeItem("notif_mark_post_id_from_scans");
  return normalizeId(raw);
}

function getImageId(post) {
  if (!post) return null;
  if (post.image_id) return post.image_id;
  if (post.imageId) return post.imageId;
  if (post.image && (post.image.image_id || post.image.id)) return post.image.image_id || post.image.id;
  return null;
}

function findMatchingPost(payload, matcher) {
  if (!payload || typeof matcher !== "function") return null;

  const fromItem = payload.item;
  if (fromItem && matcher(fromItem)) return fromItem;

  if (Array.isArray(payload.items)) {
    const found = payload.items.find((post) => matcher(post));
    if (found) return found;
  }

  if (matcher(payload)) return payload;

  return null;
}

async function fetchPostByImageId(imageId) {
  if (!imageId) return null;

  const requestedImageId = normalizeId(imageId);
  const matchesImageId = (post) => normalizeId(getImageId(post)) === requestedImageId;

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

      const matched = findMatchingPost(data, matchesImageId);
      if (matched) return matched;
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

  const requestedPostId = normalizeId(postId);
  const matchesPostId = (post) => normalizeId(getPostId(post)) === requestedPostId;

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

      const matched = findMatchingPost(data, matchesPostId);
      if (matched) return matched;
    } catch (_) { }
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
// Bar fill + zone label helpers (community bar design)
// -------------------------
const GRADIENT_AICLIPSE = "#cfb87c 0%, #cfb87c 40%, #e07043 60%, #cc2222 100%";
const GRADIENT_COMMUNITY = "#af83c9 0%, #af83c9 40%, #d06bb0 60%, #cc2222 100%";

function setFillWithGradient(fillEl, aiPct, gradient) {
  if (!fillEl) return;
  const p = clamp(aiPct, 0, 100);
  fillEl.style.width = p === 0 ? "0px" : `calc(${p}% - 8px)`;
  fillEl.dataset.p = String(p);
  const pctSafe = Math.max(p, 0.1);
  const zoneSize = `${(10000 / pctSafe).toFixed(2)}%`;
  fillEl.style.background = `linear-gradient(to right, rgba(0,0,0,0.28), transparent) left / 100% 100% no-repeat, linear-gradient(to right, ${gradient}) left / ${zoneSize} 100% no-repeat`;
}

function setZoneLabels(container, aiPct) {
  if (!container) return;
  const zone = aiPct < 40 ? "safe" : aiPct <= 60 ? "neutral" : "risk";
  container.querySelectorAll(".comm_zoneLabel").forEach(el => {
    el.classList.toggle("comm_zoneLabel--active", el.classList.contains(`comm_zoneLabel--${zone}`));
  });
}

// NEW: replay the reveal animation for the View Scan bars
function animateVerdictBars() {
  const block = document.getElementById("verdict-block");
  if (!block || block.hidden) return;

  block.classList.remove("is-revealed");
  block.classList.add("is-hidden");
  void block.offsetWidth; // Force reflow
  block.classList.remove("is-hidden");
  block.classList.add("is-revealed");
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

function getRealLikelihoodPercent(img) {
  if (!img) return 0;

  const verdict = String(img.verdict || "unknown").toLowerCase();
  const label = String(img.label || img.result || verdict).toLowerCase();
  const confidenceRaw = Number.isFinite(img.confidence) ? img.confidence : (img.score ?? 0);
  const confidence = clamp(confidenceRaw, 0, 1);

  // Use verdict for logic, label is just lowercase version of verdict
  const prediction = verdict !== "unknown" ? verdict : label;

  // Calculate real probability based on prediction
  const realProb = prediction === "real" ? confidence : (1 - confidence);
  return clamp(realProb * 100, 0, 100);
}

function renderAiclipseCard(img) {
  const wrap = document.getElementById("verdict-block");
  const card = document.getElementById("aiclipse-card");
  const fillEl = document.getElementById("aiclipse-fill");
  const pctEl = document.getElementById("aiclipse-percent");

  if (!wrap || !card || !fillEl || !pctEl) return;

  if (!img) {
    card.hidden = true;
    return;
  }

  const realPct = getRealLikelihoodPercent(img);
  const aiPct = 100 - realPct;

  pctEl.textContent = `${Math.round(aiPct)}%`;
  setFillWithGradient(fillEl, aiPct, GRADIENT_AICLIPSE);
  setZoneLabels(card, aiPct);

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
  if (pctReal >= 40 && pctReal <= 60) return "SUSPICIOUS";
  if (pctReal > 60) return "REAL";
  return "FAKE";
}

function renderCommunityCard(img) {
  const card = document.getElementById("community-card");
  const privateNote = document.getElementById("community-private-note");
  const realFillEl = document.getElementById("community-real-fill");
  const fakeFillEl = document.getElementById("community-fake-fill");
  const realPctEl = document.getElementById("community-real-pct");
  const fakePctEl = document.getElementById("community-fake-pct");
  const realCountEl = document.getElementById("community-real-count");
  const fakeCountEl = document.getElementById("community-fake-count");
  const summaryEl = document.getElementById("community-summary");
  const totalEl = document.getElementById("community-total");
  const verdictEl = document.getElementById("community-verdict");

  if (!card) return;

  if (!img) {
    card.hidden = true;
    return;
  }

  if (privateNote) privateNote.hidden = !isPrivateScan(img);

  const up = Number(img.up_vote_count);
  const down = Number(img.down_vote_count);
  const upN = Number.isFinite(up) ? up : 0;
  const downN = Number.isFinite(down) ? down : 0;
  const total = upN + downN;

  // Update vote counts
  if (realCountEl) realCountEl.textContent = `${upN} ${upN === 1 ? "vote" : "votes"}`;
  if (fakeCountEl) fakeCountEl.textContent = `${downN} ${downN === 1 ? "vote" : "votes"}`;

  if (total <= 0) {
    // No votes - show empty bars
    if (realFillEl) {
      realFillEl.style.width = "0px";
      realFillEl.style.background = "linear-gradient(to right, rgba(0,0,0,0.28), transparent), #cfb87c";
    }
    if (fakeFillEl) {
      fakeFillEl.style.width = "0px";
      fakeFillEl.style.background = "linear-gradient(to right, rgba(0,0,0,0.28), transparent), linear-gradient(to right, #cfb87c, #e07043, #cc2222)";
    }
    if (realPctEl) realPctEl.textContent = "0%";
    if (fakePctEl) fakePctEl.textContent = "0%";
    if (summaryEl) summaryEl.hidden = true;

    card.hidden = false;
    return;
  }

  const pctReal = clamp((upN / total) * 100, 0, 100);
  const pctFake = 100 - pctReal;

  // Set fill widths and gradients
  if (realFillEl) {
    realFillEl.style.width = pctReal === 0 ? "0px" : `calc(${pctReal}% - 8px)`;
    const realGradient = "#cfb87c";
    const pctSafe = Math.max(pctReal, 0.1);
    const zoneSize = `${(10000 / pctSafe).toFixed(2)}%`;
    realFillEl.style.background = `linear-gradient(to right, rgba(0,0,0,0.28), transparent) left / 100% 100% no-repeat, linear-gradient(to right, ${realGradient}) left / ${zoneSize} 100% no-repeat`;
  }

  if (fakeFillEl) {
    fakeFillEl.style.width = pctFake === 0 ? "0px" : `calc(${pctFake}% - 8px)`;
    const fakeGradient = "#cfb87c, #e07043, #cc2222";
    const pctSafe = Math.max(pctFake, 0.1);
    const zoneSize = `${(10000 / pctSafe).toFixed(2)}%`;
    fakeFillEl.style.background = `linear-gradient(to right, rgba(0,0,0,0.28), transparent) left / 100% 100% no-repeat, linear-gradient(to right, ${fakeGradient}) left / ${zoneSize} 100% no-repeat`;
  }

  // Add scrambling animations with delay
  if (realPctEl) createScrambledNumber(Math.round(pctReal), realPctEl, true, 250);
  if (fakePctEl) createScrambledNumber(Math.round(pctFake), fakePctEl, true, 250);

  // Update summary
  if (summaryEl && totalEl && verdictEl) {
    totalEl.textContent = total;

    let verdict, verdictClass;
    if (pctReal > pctFake) {
      verdict = "Real";
      verdictClass = "comm_voteSummary--real";
    } else if (pctFake > pctReal) {
      verdict = "Fake";
      verdictClass = "comm_voteSummary--fake";
    } else {
      verdict = "Split";
      verdictClass = "comm_voteSummary--split";
    }

    verdictEl.textContent = verdict;
    verdictEl.className = verdictClass;
    summaryEl.hidden = false;
  }

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
    if (pctReal >= 86) return { text: "Highly Unlikely Fake", type: "safe" };
    return { text: "Unlikely Fake", type: "safe" };
  }

  const pctAI = 100 - pctReal;
  if (pctAI >= 86) return { text: "Highly Likely Fake", type: "risk" };
  return { text: "Likely Fake", type: "risk" };
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
  return `${pct.toFixed(2)}% ${verdictType(img) === "safe" ? "Likely Fake" : "Unlikely AI"}`;
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


function renderQuickMeta(img) {
  // Hidden compat elements
  const visibilityEl = document.getElementById("scan-quick-visibility");
  if (visibilityEl && img) visibilityEl.textContent = visibilityOf(img);

  // Instagram-style upload date in the page header
  const uploadDateEl = document.getElementById("vs-upload-date");
  if (uploadDateEl) {
    if (img && img.uploaded_at) {
      uploadDateEl.textContent = formatDate(img.uploaded_at);
      uploadDateEl.hidden = false;
    } else {
      uploadDateEl.hidden = true;
    }
  }
}

// Render description header above image
function renderDescriptionHeader(img) {
  const section = document.getElementById("description-header-section");
  const textEl = document.getElementById("description-text");
  const privatePlaceholder = document.getElementById("private-description-placeholder");

  if (!section || !textEl || !privatePlaceholder) return;

  const isPrivate = isPrivateScan(img);
  const isModerated = !!(img && img.moderation_status === "removed");
  const hasDescription = !!(img && img.description);

  // Reset moderation styling
  textEl.classList.remove("is-moderated-reason");

  if (isModerated) {
    section.hidden = false;
    textEl.hidden = false;
    textEl.textContent = img.moderation_reason || "This image has been removed by moderation.";
    textEl.classList.add("is-moderated-reason");
    privatePlaceholder.hidden = true;
    return;
  }

  if (hasDescription) {
    section.hidden = false;
    textEl.hidden = false;
    textEl.textContent = String(img.description);
    privatePlaceholder.hidden = true;
    return;
  }

  if (isPrivate) {
    section.hidden = true;
    textEl.hidden = true;
    textEl.textContent = "";
    privatePlaceholder.hidden = false;
    return;
  }

  section.hidden = true;
  textEl.hidden = false;
  textEl.textContent = "";
  privatePlaceholder.hidden = true;
}

// Render verdict and confidence in split card
function renderVerdictConfidenceCard(img) {
  const card = document.getElementById("verdict-confidence-card");
  const verdictEl = document.getElementById("card-verdict");
  const confidenceEl = document.getElementById("card-confidence");

  if (!card) return;

  const hasVerdict = img.verdict != null;
  const hasConfidence = img.confidence !== undefined && img.confidence !== null;

  if (hasVerdict || hasConfidence) {
    card.hidden = false;
    verdictEl.textContent = hasVerdict ? String(img.verdict) : "—";
    confidenceEl.textContent = hasConfidence ? `${getRealLikelihoodPercent(img).toFixed(0)}%` : "N/A";
  } else {
    card.hidden = true;
  }
}

// Render votes in split card (only for public posts)
function renderVotesCard(img) {
  const card = document.getElementById("votes-card");
  const upvotesEl = document.getElementById("card-upvotes");
  const downvotesEl = document.getElementById("card-downvotes");
  const privatePlaceholder = document.getElementById("private-votes-placeholder");

  if (!card || !privatePlaceholder) return;

  if (isPrivateScan(img)) {
    card.hidden = true;
    privatePlaceholder.hidden = true;
    return;
  }

  const upVotes = img.up_vote_count !== undefined ? img.up_vote_count : 0;
  const downVotes = img.down_vote_count !== undefined ? img.down_vote_count : 0;

  if (upvotesEl) upvotesEl.textContent = String("(" + upVotes + ")");
  if (downvotesEl) downvotesEl.textContent = String("(" + downVotes + ")");

  privatePlaceholder.hidden = true;
  card.hidden = false;
}

async function renderScan(img, title) {
  currentScan = img;

  const card = document.getElementById("viewscan-card");
  const imageEl = document.getElementById("viewscan-image");
  const titleEl = document.getElementById("viewscan-title");

  if (!card || !imageEl || !titleEl) return;

  // Mark by post only for explicit scans-origin navigation.
  const scansOriginPostId = consumeScansMarkPostId();
  const currentPostId = normalizeId(getPostId(img));
  if (scansOriginPostId && currentPostId && scansOriginPostId === currentPostId) {
    markNotificationsReadForPost(currentPostId);
  }

  if (!img) {
    card.hidden = true;
    titleEl.textContent = "Post Description";
    setStatus("No scan selected. Go back to Scans and click “View more details”.", "error");
    return;
  }

  titleEl.textContent = title || "Post Description";

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

  // Wait for async enrichments first so we only render once
  try {
    await Promise.all([
      refreshCommunityData(img),
      ensurePostIdForPublicScan(img),
    ]);
  } catch (_) {
    // silent fail — page will still render with whatever data is available
  }

  // Single render pass
  renderAiclipseCard(currentScan);
  renderCommunityCard(currentScan);
  renderQuickMeta(currentScan);
  renderDescriptionHeader(currentScan);
  renderVerdictConfidenceCard(currentScan);

  card.hidden = false;
  setStatus("", null);

  // Setup handlers after final data is ready
  setupEditDescriptionInline(currentScan);
  setupShowComments(currentScan);
  setupDeletePost(currentScan);
  setupDeleteScan(currentScan);
  setupMakePublicInline(currentScan);

  // Animate once only
  animateVerdictBars();
}

// -------------------------
// Edit Description (INLINE)
// (UNCHANGED)
// -------------------------
function setupEditDescriptionInline(img) {
  const modal = document.getElementById("edit-desc-modal");
  const openBtn = document.getElementById("btn-edit-description");
  const input = document.getElementById("edit-description-input");
  const countEl = document.getElementById("edit-description-count");
  const statusEl = document.getElementById("edit-description-status");
  const saveBtn = document.getElementById("edit-description-save");
  const cancelBtn = document.getElementById("edit-description-cancel");

  if (!modal || !openBtn || !input || !statusEl || !saveBtn || !cancelBtn) {
    if (openBtn) openBtn.hidden = !(img && getPostId(img));
    return;
  }

  const postId = getPostId(img);
  const shouldShow = !!postId;
  openBtn.hidden = !shouldShow;

  if (!shouldShow) return;

  const maxLen = 1000;
  let originalDescription = img.description || "";
  let modalOpen = false;
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

  const openModal = () => {
    originalDescription = currentScan && currentScan.description ? String(currentScan.description) : "";
    input.value = originalDescription;
    syncCount();
    setFormStatus("", null);

    saveBtn.disabled = false;
    saveBtn.textContent = "Save";

    hasUnsavedChanges = false;
    modalOpen = true;

    modal.hidden = false;
    input.focus();
  };

  const closeModal = () => {
    modal.hidden = true;
    input.value = "";
    if (countEl) countEl.textContent = "0";
    setFormStatus("", null);

    saveBtn.disabled = false;
    saveBtn.textContent = "Save";

    hasUnsavedChanges = false;
    modalOpen = false;
  };

  if (!openBtn.dataset.bound) {
    openBtn.dataset.bound = "1";
    openBtn.addEventListener("click", openModal);
  }

  if (!modal.dataset.bound) {
    modal.dataset.bound = "1";
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
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
      if (modalOpen && hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  if (!cancelBtn.dataset.bound) {
    cancelBtn.dataset.bound = "1";
    cancelBtn.addEventListener("click", () => {
      closeModal();
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
        renderDescriptionHeader(currentScan);

        setFormStatus("✓ Description updated.", "success");

        setTimeout(() => closeModal(), 600);
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
// Comments bottom-sheet drawer
// -------------------------

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(dateStr).toLocaleDateString();
}

function getInitials(name) {
  if (!name) return "?";
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}

function setupShowComments(img) {
  const triggerBtn = document.getElementById("btn-comments");
  const sheet = document.getElementById("comments-sheet");
  const backdrop = document.getElementById("comments-backdrop");
  const closeBtn = document.getElementById("comments-close");
  const handle = document.getElementById("comments-handle");
  const listEl = document.getElementById("comments-list");
  const input = document.getElementById("comments-input");
  const postBtn = document.getElementById("comments-post");

  if (!triggerBtn || !sheet || !backdrop || !listEl) return;

  const postId = getPostId(img);
  const shouldShow = !!(postId && !isPrivateScan(img) && img?.is_public === true);
  triggerBtn.style.display = shouldShow ? "flex" : "none";
  if (!shouldShow) return;

  // Eagerly fetch comment count for the grid cell
  const countEl = document.getElementById("btn-comments-count");
  if (countEl) {
    fetch(`/community/posts/comments?post_id=${encodeURIComponent(postId)}`, {
      headers: { Accept: "application/json" },
      credentials: "include",
    })
      .then((r) => r.json())
      .then((d) => { if (countEl) countEl.textContent = String((d.items || []).length); })
      .catch(() => { if (countEl) countEl.textContent = "0"; });
  }

  // Shift sheet above mobile keyboard using visualViewport API
  let vvHandler = null;
  const attachKeyboardListener = () => {
    const vv = window.visualViewport;
    const body = document.getElementById("comments-body");
    if (!vv || !body) return;

    vvHandler = () => {
      // Record current scroll before height change
      const currentScroll = body.scrollTop;

      const offset = Math.max(0, window.innerHeight - vv.height);
      sheet.style.setProperty("--kb-offset", `${offset}px`);

      if (offset > 0) {
        sheet.classList.add("comm_bottomSheet--keyboard");
      } else {
        sheet.classList.remove("comm_bottomSheet--keyboard");
      }

      // Restore scroll after layout stabilizes
      requestAnimationFrame(() => {
        body.scrollTop = currentScroll;
      });
    };
    vv.addEventListener("resize", vvHandler);
    vvHandler();
  };
  const detachKeyboardListener = () => {
    const vv = window.visualViewport;
    if (vv && vvHandler) vv.removeEventListener("resize", vvHandler);
    vvHandler = null;
    sheet.style.removeProperty("--kb-offset");
    sheet.classList.remove("comm_bottomSheet--keyboard");
  };

  // Open/close helpers
  const navbar = document.querySelector(".navbar");

  const openDrawer = () => {
    const pid = getPostId(currentScan);
    if (!pid) return;
    backdrop.hidden = false;
    sheet.classList.add("comm_bottomSheet--open");
    document.getElementById("app-container")?.style.setProperty("overflow", "hidden");
    if (navbar) navbar.hidden = true;
    attachKeyboardListener();
    if (!sheet.dataset.loaded) {
      loadComments(pid);
      sheet.dataset.loaded = "1";
    }
  };

  const closeDrawer = () => {
    backdrop.hidden = true;
    sheet.classList.remove("comm_bottomSheet--open");
    document.getElementById("app-container")?.style.removeProperty("overflow");
    if (navbar) navbar.hidden = false;
    detachKeyboardListener();
  };

  // Render comments list
  const renderComments = (comments, currentUserId) => {
    clearEl(listEl);
    if (!comments || comments.length === 0) {
      listEl.appendChild(makeEl("div", "comm_emptyComments", "No comments yet. Start the conversation!"));
      return;
    }
    comments.forEach((c) => {
      const row = makeEl("div", "comm_commentRow");

      const avatar = makeEl("div", "comm_commentAvatar", getInitials(c.user_name));

      const content = makeEl("div", "comm_commentContent");
      const top = makeEl("div", "comm_commentTop");
      const author = makeEl("span", "comm_commentAuthor", c.user_name || "Anonymous");
      const time = makeEl("span", "comm_commentTime", timeAgo(c.created_at));
      top.appendChild(author);
      top.appendChild(time);

      const text = makeEl("div", "comm_commentText", c.text || "");
      content.appendChild(top);
      content.appendChild(text);

      if (currentUserId && c.user_id === currentUserId) {
        const delBtn = makeEl("button", "comm_commentDeleteBtn", "Delete");
        delBtn.type = "button";
        delBtn.addEventListener("click", () => showDeleteCommentModal(c.comment_id, row));
        content.appendChild(delBtn);
      }

      row.appendChild(avatar);
      row.appendChild(content);
      listEl.appendChild(row);
    });
  };

  // Fetch comments
  const loadComments = async (pid) => {
    clearEl(listEl);
    listEl.appendChild(makeEl("div", "comm_loadingComments", "Loading..."));
    try {
      const res = await fetch(`/community/posts/comments?post_id=${encodeURIComponent(pid)}`, {
        headers: { Accept: "application/json" },
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      const meRes = await fetch("/auth/me", { credentials: "include" }).catch(() => null);
      const me = meRes?.ok ? await meRes.json().catch(() => ({})) : {};
      renderComments(data.items || [], me.user_id || null);
    } catch {
      clearEl(listEl);
      listEl.appendChild(makeEl("div", "comm_emptyComments", "Failed to load comments."));
    }
  };

  // Delete a comment
  const deleteComment = async (commentId, rowEl) => {
    try {
      const res = await fetch(`/community/posts/comments?comment_id=${encodeURIComponent(commentId)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        rowEl.remove();
        const countEl = document.getElementById("btn-comments-count");
        if (countEl) {
          if (data && typeof data.comment_count === "number") {
            countEl.textContent = String(data.comment_count);
          } else {
            const cur = parseInt(countEl.textContent, 10);
            if (!isNaN(cur)) countEl.textContent = String(Math.max(0, cur - 1));
          }
        }
      }
    } catch { /* silent */ }
  };

  // Delete comment modal
  const deleteCommentModal = document.getElementById("delete-comment-modal");
  const commentModalCancel = document.getElementById("comment-modal-cancel");
  const commentModalConfirm = document.getElementById("comment-modal-confirm");
  let pendingDeleteCommentId = null;
  let pendingDeleteRowEl = null;

  const showDeleteCommentModal = (commentId, rowEl) => {
    pendingDeleteCommentId = commentId;
    pendingDeleteRowEl = rowEl;
    if (deleteCommentModal) deleteCommentModal.hidden = false;
  };

  const hideDeleteCommentModal = () => {
    if (deleteCommentModal) deleteCommentModal.hidden = true;
    pendingDeleteCommentId = null;
    pendingDeleteRowEl = null;
  };

  if (commentModalCancel && !commentModalCancel.dataset.bound) {
    commentModalCancel.dataset.bound = "1";
    commentModalCancel.addEventListener("click", hideDeleteCommentModal);
  }

  if (deleteCommentModal && !deleteCommentModal.dataset.bound) {
    deleteCommentModal.dataset.bound = "1";
    deleteCommentModal.addEventListener("click", (e) => {
      if (e.target === deleteCommentModal) hideDeleteCommentModal();
    });
  }

  if (commentModalConfirm && !commentModalConfirm.dataset.bound) {
    commentModalConfirm.dataset.bound = "1";
    commentModalConfirm.addEventListener("click", async () => {
      if (!pendingDeleteCommentId || !pendingDeleteRowEl) return;
      const commentId = pendingDeleteCommentId;
      const rowEl = pendingDeleteRowEl;
      hideDeleteCommentModal();
      await deleteComment(commentId, rowEl);
    });
  }

  // Post a comment
  const submitComment = async () => {
    const text = input.value.trim();
    if (!text) return;
    const pid = getPostId(currentScan);
    if (!pid) return;

    postBtn.disabled = true;
    try {
      const meRes = await fetch("/auth/me", { credentials: "include" });
      if (!meRes.ok) return;
      const me = await meRes.json().catch(() => ({}));
      if (!me.user_id) return;

      const res = await fetch("/community/posts/comments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ post_id: pid, user_id: me.user_id, user_name: me.user_name || me.user_id, text }),
      });
      if (res.ok) {
        const newComment = await res.json().catch(() => ({}));
        input.value = "";
        postBtn.disabled = true;
        // Reload to pick up new comment with proper ID and refresh count
        sheet.dataset.loaded = "";
        loadComments(pid).then(() => {
          const countEl = document.getElementById("btn-comments-count");
          if (countEl) countEl.textContent = String(listEl.querySelectorAll(".comm_commentRow").length);
        });
      }
    } catch { /* silent */ } finally {
      postBtn.disabled = !input.value.trim();
    }
  };

  // Bind events once
  if (!triggerBtn.dataset.bound) {
    triggerBtn.dataset.bound = "1";
    triggerBtn.addEventListener("click", openDrawer);
    backdrop.addEventListener("click", closeDrawer);
    closeBtn?.addEventListener("click", closeDrawer);
    handle?.addEventListener("click", closeDrawer);
    input?.addEventListener("input", () => { postBtn.disabled = !input.value.trim(); });
    input?.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.value.trim()) submitComment(); });
    postBtn?.addEventListener("click", submitComment);
  }
}

// -------------------------
// Make Private (replaces Delete Post)
// -------------------------
function setupDeletePost(img) {
  const actionBtn = document.getElementById("btn-delete-post");

  if (!actionBtn) {
    return;
  }

  const postId = getPostId(img);

  const shouldShow = !!(postId && !isPrivateScan(img));
  actionBtn.style.display = shouldShow ? "flex" : "none";

  if (!shouldShow) {
    return;
  }

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

  if (!actionBtn.dataset.bound) {
    actionBtn.dataset.bound = "1";
    actionBtn.addEventListener("click", () => {
      if (!currentScan || !getPostId(currentScan)) return;
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
      actionBtn.disabled = true;
      actionBtn.textContent = "Making private...";

      try {
        const res = await fetch(`/image/${encodeURIComponent(currentScan.image_id)}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ is_public: false }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data.error || data.detail || `Failed to make private (${res.status})`);
        }

        currentScan.is_public = false;
        sessionStorage.setItem("selectedScan", JSON.stringify(currentScan));

        setTimeout(() => {
          window.location.href = "/profile";
        }, 600);
      } catch (err) {
        actionBtn.disabled = false;
        actionBtn.textContent = "Make Private";
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
// Delete Scan
// -------------------------
function setupDeleteScan(img) {
  const deleteBtn = document.getElementById("btn-delete-scan");

  if (!deleteBtn) {
    return;
  }

  // Show delete button for all scans owned by user
  const shouldShow = !!(img && img.image_id);
  deleteBtn.style.display = shouldShow ? "flex" : "none";

  if (!shouldShow) {
    return;
  }

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

        sessionStorage.removeItem("selectedScan");
        sessionStorage.removeItem("selectedScanTitle");

        setTimeout(() => {
          window.location.href = "/profile";
        }, 600);
      } catch (err) {
        deleteBtn.disabled = false;
        deleteBtn.textContent = "Delete";
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
  const modal = document.getElementById("make-public-modal");
  const formInput = document.getElementById("make-public-description");
  const formCount = document.getElementById("make-public-count");
  const publishBtn = document.getElementById("make-public-publish");
  const cancelBtn = document.getElementById("make-public-cancel");
  const formStatus = document.getElementById("make-public-status");

  if (!makePublicBtn || !modal || !formInput || !publishBtn || !cancelBtn || !formStatus) {
    if (makePublicBtn) makePublicBtn.style.display = isPrivateScan(img) ? "flex" : "none";
    return;
  }

  // Check if image has been removed by moderation
  const isModerated = img && img.moderation_status === "removed";
  const shouldShow = isPrivateScan(img) && !isModerated;

  makePublicBtn.style.display = shouldShow ? "flex" : "none";

  if (!shouldShow) return;

  const setFormStatus = (text, kind) => {
    formStatus.classList.remove("is-error", "is-success");
    if (kind === "error") formStatus.classList.add("is-error");
    if (kind === "success") formStatus.classList.add("is-success");
    formStatus.textContent = text || "";
  };

  const openModal = () => {
    formInput.value = "";
    if (formCount) formCount.textContent = "0";
    setFormStatus("", null);
    publishBtn.disabled = false;
    publishBtn.textContent = "Publish";
    modal.hidden = false;
    formInput.focus();
  };

  const closeModal = () => {
    modal.hidden = true;
    formInput.value = "";
    if (formCount) formCount.textContent = "0";
    setFormStatus("", null);
    publishBtn.disabled = false;
    publishBtn.textContent = "Publish";
  };

  if (!makePublicBtn.dataset.bound) {
    makePublicBtn.dataset.bound = "1";
    makePublicBtn.addEventListener("click", openModal);
  }

  if (!formInput.dataset.bound) {
    formInput.dataset.bound = "1";
    formInput.addEventListener("input", () => {
      if (formCount) formCount.textContent = String(formInput.value.length);
    });
  }

  if (!cancelBtn.dataset.bound) {
    cancelBtn.dataset.bound = "1";
    cancelBtn.addEventListener("click", closeModal);
  }

  if (!modal.dataset.bound) {
    modal.dataset.bound = "1";
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  }

  if (!publishBtn.dataset.bound) {
    publishBtn.dataset.bound = "1";
    publishBtn.addEventListener("click", async () => {
      if (!currentScan || publishBtn.disabled) return;

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
        window.location.href = "/profile";
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

  // Check if a community post already exists for this image to avoid duplicates
  const existingPost = await fetchPostByImageId(img.image_id);
  const existingPostId = existingPost
    ? (existingPost.post_id || existingPost.postId || existingPost.id || null)
    : (getPostId(img) || null);

  if (existingPostId) {
    // Post already exists — just update the description and re-show via image PATCH
    const patchRes = await fetch(`/community/posts?post_id=${encodeURIComponent(existingPostId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "include",
      body: JSON.stringify({ description }),
    });
    if (!patchRes.ok) {
      const errorData = await patchRes.json().catch(() => ({}));
      throw new Error(errorData.detail || errorData.error || `Failed to update post (${patchRes.status})`);
    }
    img.post_id = existingPostId;
  } else {
    // No existing post — create a new one
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
      if (postRes.status === 403) {
        throw new Error(errorData.error || "This image cannot be posted to the community.");
      }
      throw new Error(errorData.detail || errorData.error || `Failed to publish (${postRes.status})`);
    }

    const postData = await postRes.json().catch(() => ({}));
    if (postData.post_id) img.post_id = postData.post_id;
  }

  // Mark image as public
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

  img.up_vote_count = img.up_vote_count ?? 0;
  img.down_vote_count = img.down_vote_count ?? 0;
  img.is_public = true;
  sessionStorage.setItem("selectedScan", JSON.stringify(img));
}

// -------------------------
// Init
// -------------------------
window.addEventListener("DOMContentLoaded", async () => {
  let img = null;
  let title = null;

  try {
    const raw = sessionStorage.getItem("selectedScan");
    title = sessionStorage.getItem("selectedScanTitle");
    img = raw ? JSON.parse(raw) : null;
  } catch (_) {
    img = null;
  }

  await renderScan(img, title);
});