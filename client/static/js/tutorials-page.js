(function initTutorialsPage() {
  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function buildActionHref(moduleId, isActive) {
    return isActive
      ? "/tutorials?resume=1"
      : `/tutorials?start=${encodeURIComponent(moduleId)}`;
  }

  function renderPage() {
    const pageRoot = document.getElementById("tutorials-list");
    const activeRoot = document.getElementById("tutorials-active");
    const resetBtn = document.getElementById("tutorials-reset");

    if (!pageRoot || !window.AIclipseTutorial) return;

    const registry = window.AIclipseTutorial.getRegistry();
    const progress = window.AIclipseTutorial.getProgress();
    const runtime = window.AIclipseTutorial.getRuntime();

    const modules = registry?.modules || [];
    const activeModule = modules.find((m) => m.id === runtime.moduleId) || null;

    if (activeRoot) {
      if (activeModule) {
        activeRoot.innerHTML = `
          <div class="tutorials-hero-card">
            <div class="tutorials-hero-kicker">In progress</div>
            <h2 class="tutorials-hero-title">${escapeHtml(activeModule.title)}</h2>
            <p class="tutorials-hero-text">
              Continue the active tutorial from the current step.
            </p>
            <div class="tutorials-hero-actions">
              <a class="tutorials-action tutorials-action--primary" href="/tutorials?resume=1">
                Continue tutorial
              </a>
            </div>
          </div>
        `;
      } else {
        activeRoot.innerHTML = "";
      }
    }

    pageRoot.innerHTML = modules
      .map((module) => {
        const isCompleted = progress.completed[module.id] === registry.version;
        const isActive = runtime.moduleId === module.id;

        const badge = isCompleted
          ? `<span class="tutorials-badge">Completed</span>`
          : isActive
            ? `<span class="tutorials-badge">In progress</span>`
            : `<span class="tutorials-badge tutorials-badge--muted">Not started</span>`;

        const actionLabel = isActive ? "Continue" : isCompleted ? "Replay" : "Start";

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
                href="${buildActionHref(module.id, isActive)}"
              >
                ${escapeHtml(actionLabel)}
              </a>
            </div>
          </article>
        `;
      })
      .join("");

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        if (!window.AIclipseTutorial) return;
        window.AIclipseTutorial.resetAll();
        window.location.href = "/tutorials";
      });
    }
  }

  document.addEventListener("DOMContentLoaded", renderPage);
})();