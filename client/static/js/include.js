
function setActiveNavLink() {
  const nav = document.getElementById("bottom-nav");
  if (!nav) return false;

  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const links = nav.querySelectorAll("a[href]");

  links.forEach((a) => {
    const href = new URL(a.getAttribute("href"), window.location.origin).pathname
      .replace(/\/+$/, "") || "/";

    const isActive = href === path;
    a.classList.toggle("active", isActive);
  });

  return true;
}

// Wait until the navbar partial is actually in the DOM
(function waitForNavbarThenActivate() {
  if (setActiveNavLink()) return;

  const observer = new MutationObserver(() => {
    if (setActiveNavLink()) observer.disconnect();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

document.addEventListener("DOMContentLoaded", loadPartials);

function goToCommunity() {
  window.location.href = "/community";
}

(function () {
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

  setMode("login");
})();

// --- Menu Logic ---

function initNavDrawer() {
  const toggle = document.getElementById('menu-toggle');
  const drawer = document.getElementById('nav-drawer');
  const overlay = document.getElementById('menu-overlay');
  const close = document.getElementById('close-menu');
  const logoutBtn = document.getElementById('drawer-logout');

  if (!toggle || !drawer || !overlay) return false;

  const toggleAction = (e) => {
    if (e) e.preventDefault();
    console.log("Menu Toggle Triggered");
    const isActive = drawer.classList.toggle('active');
    overlay.style.display = isActive ? 'block' : 'none';
  };

  toggle.onclick = toggleAction;
  overlay.onclick = toggleAction;
  if (close) close.onclick = toggleAction;

  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      const res = await fetch('/logout', { method: 'POST' });
      if (res.ok) window.location.href = '/';
    };
  }

  return true;
}

(function waitForPartials() {
  const navReady = setActiveNavLink();
  const drawerReady = initNavDrawer();

  if (navReady && drawerReady) return;

  const observer = new MutationObserver(() => {
    const isNavNowReady = setActiveNavLink();
    const isDrawerNowReady = initNavDrawer();
    
    if (isNavNowReady && isDrawerNowReady) {
       console.log("All partials initialized and bound.");
       observer.disconnect();
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

