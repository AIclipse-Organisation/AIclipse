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

  function applyChipName(name) {
    const chip = getChip();
    if (!chip) return;

    const n = normalizeName(name);

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

  function applyDrawerLabel() {
    const drawer = getDrawerNameEl();
    if (!drawer) return;
    drawer.textContent = "Menu";
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
    applyChipName(existing);
    applyDrawerLabel();
    bindLogout();
  }

  window.AuthUI = {
    init,
    setUser: (user) => {
      if (user && typeof user === "object") {
        applyChipName(user.user_name || user.email || "");
      } else {
        applyChipName("");
      }
      applyDrawerLabel();
    },
    clear: () => {
      applyChipName("");
      applyDrawerLabel();
    },
    logout: doLogout,
  };

  document.addEventListener("DOMContentLoaded", init);
})();
