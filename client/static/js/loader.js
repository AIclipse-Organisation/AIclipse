(function attachLoaderApi() {
  const OVERLAY_ID = "app-loader-overlay";
  const TEXT_ID = "app-loader-text";

  function ensureOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "app-loader-overlay";
    overlay.hidden = true;

    const card = document.createElement("div");
    card.className = "app-loader-card";
    card.setAttribute("role", "status");
    card.setAttribute("aria-live", "polite");

    const spinner = document.createElement("div");
    spinner.className = "app-loader-spinner";
    spinner.setAttribute("aria-hidden", "true");

    const text = document.createElement("p");
    text.id = TEXT_ID;
    text.className = "app-loader-text";
    text.textContent = "Please wait...";

    card.appendChild(spinner);
    card.appendChild(text);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    return overlay;
  }

  function show(message) {
    const overlay = ensureOverlay();
    const textEl = document.getElementById(TEXT_ID);
    if (textEl) {
      textEl.textContent = message && String(message).trim() ? String(message) : "Please wait...";
    }
    overlay.hidden = false;
  }

  function hide() {
    const overlay = ensureOverlay();
    overlay.hidden = true;
  }

  window.AppLoader = { show, hide };
})();

window.addEventListener("beforeunload", () => {
  if (window.AppLoader) {
    window.AppLoader.show("Loading next page...");
  }
});

// This ensures the loader is hidden if the user hits the "Back" button
window.addEventListener("pageshow", (event) => {
  if (event.persisted && window.AppLoader) {
    window.AppLoader.hide();
  }
});