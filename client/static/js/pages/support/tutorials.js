(function initTutorialsPage() {
  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function buildActionHref(moduleId) {
    return `/tutorials?start=${encodeURIComponent(moduleId)}`;
  }

  function renderPage() {
    const pageRoot = document.getElementById("tutorials-list");
    const activeRoot = document.getElementById("tutorials-active");
    const resetBtn = document.getElementById("tutorials-reset");

    if (!pageRoot || !window.AIclipseTutorial) return;

    const registry = window.AIclipseTutorial.getRegistry();
    const progress = window.AIclipseTutorial.getProgress();

    const modules = registry?.modules || [];

    if (activeRoot) {
      activeRoot.innerHTML = "";
    }

    pageRoot.innerHTML = modules
      .map((module) => {
        const isCompleted = progress.completed[module.id] === registry.version;

        const badge = isCompleted
          ? `<span class="tutorials-badge">Completed</span>`
          : `<span class="tutorials-badge tutorials-badge--muted">Not started</span>`;

        const actionLabel = isCompleted ? "Replay" : "Start";

        return `
          <article class="tutorials-card">
            <div class="tutorials-card-head">
              <div>
                <h3 class="tutorials-card-title">${escapeHtml(module.title)}</h3>
                <p class="tutorials-card-text">${escapeHtml(module.description)}</p>
              </div>
              ${badge}
            </div>

            <div class="tutorials-card-actions">
              <a
                class="tutorials-action tutorials-action--primary"
                href="${buildActionHref(module.id)}"
              >
                ${escapeHtml(actionLabel)}
              </a>
            </div>
          </article>
        `;
      })
      .join("");

    if (resetBtn && !resetBtn.dataset.bound) {
      resetBtn.dataset.bound = "1";
      resetBtn.addEventListener("click", () => {
        if (!window.AIclipseTutorial) return;
        window.AIclipseTutorial.resetAll();
        window.location.href = "/tutorials";
      });
    }
  }

  function ensureTutorialRuntimeThenRender() {
    if (window.AIclipseTutorial) {
      renderPage();
      return;
    }

    if (window.AIclipseTutorialLoader && typeof window.AIclipseTutorialLoader.load === "function") {
      window.AIclipseTutorialLoader.load().then(renderPage).catch(() => {});
      return;
    }

    document.addEventListener("aiclipse:tutorial-ready", renderPage, { once: true });
  }

  document.addEventListener("DOMContentLoaded", ensureTutorialRuntimeThenRender);
})();
