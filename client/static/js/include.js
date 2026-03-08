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
  const toggle = document.getElementById('menu-toggle');
  const drawer = document.getElementById('nav-drawer');
  const overlay = document.getElementById('menu-overlay');
  const close = document.getElementById('close-menu');
  const logoutBtn = document.getElementById('drawer-logout');

  // Critical check: Ensure core elements exist
  if (!toggle || !drawer || !overlay) return;

  // Prevent double-binding if already initialized
  if (toggle.dataset.bound === "true") return;

  const toggleAction = (e) => {
    if (e) e.preventDefault();
    const isActive = drawer.classList.toggle('active');
    overlay.style.display = isActive ? 'block' : 'none';
  };

  toggle.addEventListener('click', toggleAction);
  overlay.addEventListener('click', toggleAction);
  
  if (close) {
    close.addEventListener('click', toggleAction);
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault(); // good practice to prevent default if it's a link/button
      try {
        const res = await fetch('/logout', { method: 'POST' });
        if (res.ok) window.location.href = '/';
      } catch (err) {
        console.error("Logout failed", err);
      }
    });
  }

  toggle.dataset.bound = "true";
  console.log("Nav Drawer initialized.");
}

// --- Auth Tab Logic (Login/Signup Toggles) ---
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

  // Default state check
  const activeTab = document.querySelector(".auth-tab.is-active");
  if (!activeTab) {
      setMode("login"); 
  }
}

function goToCommunity() {
  window.location.href = "/community";
}

async function updateNotificationDot() {
  // Notification badge element in the bottom navigation.
  const dot = document.getElementById("notif-dot");
  if (!dot) return;

  try {
    // Ask the backend for the current unread notification count.
    const res = await fetch("/community/notifications/unread-count", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    // Hide the dot when request fails (unauthorized/server/network issues).
    if (!res.ok) {
      dot.hidden = true;
      return;
    }

    // Parse count safely; default to zero when payload is missing/invalid.
    const data = await res.json().catch(() => ({}));
    const unread = Number(data?.unread_count || 0);

    // Show the dot only if there is at least one unread notification.
    dot.hidden = unread <= 0;
  } catch {
    // Fail closed: hide indicator if unread count cannot be fetched.
    dot.hidden = true;
  }
}

// Main Initialization
document.addEventListener("DOMContentLoaded", () => {
  setActiveNavLink();
  initNavDrawer();
  initAuthTabs();

  // On the notifications page itself, always hide the nav dot.
  // On other pages, refresh the dot from unread-count endpoint.
  const isNotificationPage = window.location.pathname === "/notification";
  if (isNotificationPage) {
    const dot = document.getElementById("notif-dot");
    if (dot) dot.hidden = true;
  } else {
    updateNotificationDot();
  }
});

window.addEventListener("notifications:updated", () => {
  // Keep badge state in sync after notification read/update actions.
  updateNotificationDot();
});