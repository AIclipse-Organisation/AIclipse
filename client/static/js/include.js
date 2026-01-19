// Navbar and
async function loadPartials() {
  const nodes = document.querySelectorAll("[data-include]");
  for (const el of nodes) {
    const url = el.getAttribute("data-include");
    const res = await fetch(url);
    el.outerHTML = await res.text();
  }
}

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

