(function initViewscanShared() {
  if (window.AIclipseViewscanShared) return;

  let currentScan = null;
  let currentViewer = null;
  const markedNotificationPostIds = new Set();

  function getBootstrapEl() {
    return document.getElementById("viewscan-bootstrap");
  }

  function getBootstrappedImageId() {
    const bootstrapEl = getBootstrapEl();
    const raw = bootstrapEl?.dataset?.imageId || "";
    return String(raw).trim();
  }

  function readBootstrappedPageModel() {
    const el = document.getElementById("viewscan-page-model");
    if (!el) return null;

    try {
      const parsed = JSON.parse(el.textContent || "null");
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function getViewscanQuery() {
    return new URLSearchParams(window.location.search || "");
  }

  function setCurrentContext(nextScan, nextViewer) {
    currentScan = nextScan || null;
    currentViewer = nextViewer || null;
  }

  function getCurrentScan() {
    return currentScan;
  }

  function getCurrentViewer() {
    return currentViewer;
  }

  function clearEl(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }

  function makeEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  const stylesheetLoads = new Map();

  function ensureStylesheet(id, href) {
    if (document.getElementById(id)) {
      return Promise.resolve();
    }

    if (stylesheetLoads.has(id)) {
      return stylesheetLoads.get(id);
    }

    const pending = new Promise((resolve) => {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = href;
      link.onload = () => resolve();
      link.onerror = () => resolve();
      document.head.appendChild(link);
    });

    stylesheetLoads.set(id, pending);
    return pending;
  }

  function createScrambledNumber(finalValue, element, shouldAnimate, delay = 0) {
    if (!shouldAnimate) {
      element.textContent = `${finalValue}%`;
      return;
    }

    const startTime = Date.now() + delay;
    const duration = 1500;
    const scrambleDuration = 1200;

    const animate = () => {
      const elapsed = Date.now() - startTime;

      if (elapsed < 0) {
        element.textContent = "0%";
        requestAnimationFrame(animate);
        return;
      }

      if (elapsed < scrambleDuration) {
        element.textContent = `${Math.floor(Math.random() * 100)}%`;
        requestAnimationFrame(animate);
        return;
      }

      if (elapsed < duration) {
        const settleProgress = (elapsed - scrambleDuration) / (duration - scrambleDuration);
        const eased = 1 - Math.pow(1 - settleProgress, 3);
        element.textContent = `${Math.round(eased * finalValue)}%`;
        requestAnimationFrame(animate);
        return;
      }

      element.textContent = `${finalValue}%`;
    };

    requestAnimationFrame(animate);
  }

  function fillStyle(aiPct, gradient) {
    const pct = Math.max(aiPct, 0.1);
    const zoneSize = `${(10000 / pct).toFixed(2)}%`;
    return `
      linear-gradient(to right, rgba(0,0,0,0.28), transparent) left / 100% 100% no-repeat,
      linear-gradient(to right, ${gradient}) left / ${zoneSize} 100% no-repeat
    `;
  }

  function clamp(n, min, max) {
    n = Number(n);
    if (!Number.isFinite(n)) n = 0;
    return Math.max(min, Math.min(max, n));
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

  function isPrivateScan(img) {
    if (!img) return false;
    if (typeof img.is_public === "boolean") return img.is_public === false;
    return true;
  }

  function getPostId(img) {
    if (!img) return null;
    if (img.post_id) return img.post_id;
    if (img.postId) return img.postId;
    if (img.community_post_id) return img.community_post_id;
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
    return normalizeId(getViewscanQuery().get("mark_post_id"));
  }

  window.AIclipseViewscanShared = {
    clamp,
    clearEl,
    consumeScansMarkPostId,
    createScrambledNumber,
    fillStyle,
    formatDate,
    getBootstrappedImageId,
    getCurrentScan,
    getCurrentViewer,
    getPostId,
    isPrivateScan,
    makeEl,
    markNotificationsReadForPost,
    normalizeId,
    readBootstrappedPageModel,
    ensureStylesheet,
    setCurrentContext,
  };
})();
