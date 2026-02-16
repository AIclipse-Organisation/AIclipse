(function () {
  function getChip() {
    return document.getElementById("current-user-chip");
  }

  function getDrawerNameEl() {
    return document.getElementById("drawer-user-name");
  }

  function normalizeName(name) {
    if (name == null) return "";
    const s = String(name).trim();
    return s;
  }

  function applyName(name) {
    const chip = getChip();
    const drawer = getDrawerNameEl();
    const n = normalizeName(name);

    if (chip) {
      if (n) {
        chip.textContent = n;
        chip.classList.remove("muted");
        chip.classList.add("success");
      } else {
        chip.textContent = "Not signed in";
        chip.classList.remove("success");
        chip.classList.add("muted");
      }
    }

    if (drawer) {
      drawer.textContent = n || "Menu";
    }
  }

  function readNameFromDom() {
    const chip = getChip();
    if (!chip) return "";
    const fromData = normalizeName(chip.dataset.userName || chip.dataset.username);
    if (fromData) return fromData;
    const fromText = normalizeName(chip.textContent);
    if (fromText && fromText !== "Not signed in") return fromText;
    return "";
  }

  async function doLogout() {
    try {
      await fetch("/logout", { method: "POST", headers: { Accept: "application/json" }, credentials: "include" });
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
    const existing = readNameFromDom();
    applyName(existing);
    bindLogout();
  }

  window.AuthUI = {
    init,
    setUser: (user) => {
      if (user && typeof user === "object") {
        applyName(user.user_name || user.email || "");
      } else {
        applyName("");
      }
    },
    clear: () => applyName(""),
    logout: doLogout,
  };

  document.addEventListener("DOMContentLoaded", init);
})();
