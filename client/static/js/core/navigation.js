function setActiveNavLink() {
  const nav = document.getElementById("bottom-nav");
  if (!nav) return;

  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const links = nav.querySelectorAll("a[href]");

  links.forEach((a) => {
    const href = new URL(a.getAttribute("href"), window.location.origin).pathname
      .replace(/\/+$/, "") || "/";

    const isActive = href === path;
    a.classList.toggle("active", isActive);
  });
}

function initNavDrawer() {
  const toggle = document.getElementById("menu-toggle");
  const drawer = document.getElementById("nav-drawer");
  const overlay = document.getElementById("menu-overlay");
  const close = document.getElementById("close-menu");

  if (!toggle || !drawer || !overlay) return;
  if (toggle.dataset.bound === "true") return;

  function isOpen() {
    return drawer.classList.contains("active");
  }

  function openDrawer() {
    drawer.classList.add("active");
    overlay.style.display = "block";
  }

  function closeDrawer() {
    drawer.classList.remove("active");
    overlay.style.display = "none";
  }

  function toggleDrawer(e) {
    if (e) e.preventDefault();

    if (isOpen()) {
      closeDrawer();
    } else {
      openDrawer();
    }
  }

  toggle.addEventListener("click", toggleDrawer);
  overlay.addEventListener("click", toggleDrawer);

  if (close) {
    close.addEventListener("click", toggleDrawer);
  }

  window.AIclipseNavDrawer = {
    open: openDrawer,
    close: closeDrawer,
    toggle: toggleDrawer,
    isOpen,
  };

  toggle.dataset.bound = "true";
}

function initAuthTabs() {
  const panels = document.querySelector(".auth-panels");
  const tabs = document.querySelectorAll(".auth-tab");

  if (!panels || !tabs.length) return;

  function setMode(mode) {
    panels.setAttribute("data-mode", mode);
    tabs.forEach((t) => {
      const active = t.dataset.mode === mode;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });

  const activeTab = document.querySelector(".auth-tab.is-active");
  if (!activeTab) {
    setMode("login");
  }
}

function goToCommunity() {
  window.location.href = "/community";
}

const NOTIFICATION_BADGE_CACHE_KEY = "aiclipse:notifications:unread-count";
const NOTIFICATION_BADGE_CACHE_TTL_MS = 15 * 1000;

function readUnreadBadgeCache() {
  try {
    const raw = sessionStorage.getItem(NOTIFICATION_BADGE_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const unread = Number(parsed?.unread);
    const fetchedAt = Number(parsed?.fetchedAt);
    if (!Number.isFinite(unread) || !Number.isFinite(fetchedAt)) return null;
    if ((Date.now() - fetchedAt) > NOTIFICATION_BADGE_CACHE_TTL_MS) return null;

    return unread;
  } catch {
    return null;
  }
}

function writeUnreadBadgeCache(unread) {
  try {
    sessionStorage.setItem(
      NOTIFICATION_BADGE_CACHE_KEY,
      JSON.stringify({
        unread,
        fetchedAt: Date.now(),
      }),
    );
  } catch {}
}

function clearUnreadBadgeCache() {
  try {
    sessionStorage.removeItem(NOTIFICATION_BADGE_CACHE_KEY);
  } catch {}
}

async function updateNotificationDot() {
  const dot = document.getElementById("notif-dot");
  if (!dot) return;

  const cachedUnread = readUnreadBadgeCache();
  if (cachedUnread !== null) {
    dot.hidden = cachedUnread <= 0;
    return;
  }

  try {
    const res = await fetch("/community/notifications/unread-count", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      clearUnreadBadgeCache();
      dot.hidden = true;
      return;
    }

    const data = await res.json().catch(() => ({}));
    const unreadRaw = Number(data?.unread_count ?? 0);
    const unread = Number.isFinite(unreadRaw) ? unreadRaw : 0;
    writeUnreadBadgeCache(unread);
    dot.hidden = unread <= 0;
  } catch {
    clearUnreadBadgeCache();
    dot.hidden = true;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setActiveNavLink();
  initNavDrawer();
  initAuthTabs();

  const isNotificationPage = window.location.pathname === "/notification";
  if (isNotificationPage) {
    const dot = document.getElementById("notif-dot");
    if (dot) dot.hidden = true;
  } else {
    updateNotificationDot();
  }
});

window.addEventListener("notifications:updated", () => {
  clearUnreadBadgeCache();
  updateNotificationDot();
});
