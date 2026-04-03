(function () {
  function getDrawerNameEl() {
    return document.getElementById("drawer-user-name");
  }

  function normalizeName(name) {
    if (name == null) return "";
    const s = String(name).trim();
    return s;
  }

  function applyDrawerLabel(name) {
    const drawer = getDrawerNameEl();
    if (!drawer) return;
    const normalized = normalizeName(name);
    drawer.textContent = normalized || "Menu";
  }

  async function doLogout() {
    try {
      await fetch("/logout", { method: "POST", headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" }, credentials: "include" });
    } catch {}
    window.location.href = "/";
  }

  function bindLogout() {
    const btn = document.getElementById("drawer-logout");
    if (!btn) return;
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      doLogout();
    });
  }

  function init() {
    applyDrawerLabel("");
    bindLogout();
  }

  window.AuthUI = {
    init,
    setUser: (user) => {
      applyDrawerLabel(
        user && typeof user === "object" ? user.user_name || user.email || "" : "",
      );
    },
    clear: () => {
      applyDrawerLabel("");
    },
    logout: doLogout,
  };

  document.addEventListener("DOMContentLoaded", init);
})();
