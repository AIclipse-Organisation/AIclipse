const { render: setStatus } = window.AIclipseStatus;
const { copyToClipboard } = window.AIclipseSupportShared;
const assetUrl = window.AIclipseAssetUrl;

window.addEventListener("DOMContentLoaded", async () => {
  const contentEl = document.querySelector(".docs-main");
  const statusEl = document.getElementById("docs-content-status");

  function flashButtonCopied(btn, text = "Copied", duration = 1200) {
    if (!btn) return;

    if (!btn.dataset.originalHtml) {
      btn.dataset.originalHtml = btn.innerHTML;
    }

    btn.innerHTML = text;
    btn.classList.add("is-copied");

    clearTimeout(btn._copiedTimer);
    btn._copiedTimer = setTimeout(() => {
      btn.innerHTML = btn.dataset.originalHtml;
      btn.classList.remove("is-copied");
    }, duration);
  }

  function bindCopyInteractions() {
    const codeButtons = document.querySelectorAll("[data-copy-target]");
    for (const btn of codeButtons) {
      if (btn.dataset.bound === "1") continue;
      btn.dataset.bound = "1";
      btn.addEventListener("click", async () => {
        const sel = btn.getAttribute("data-copy-target");
        const el = sel ? document.querySelector(sel) : null;
        const codeEl = el ? el.querySelector("code") : null;
        const text = (codeEl || el)?.textContent || "";
        const ok = await copyToClipboard(text.trim());
        setStatus(statusEl, ok ? "success" : "error", ok ? "Copied." : "Copy failed.");
        if (ok) flashButtonCopied(btn);
      });
    }

    const copyEls = document.querySelectorAll("[data-copy]");
    for (const el of copyEls) {
      if (el.dataset.bound === "1") continue;
      el.dataset.bound = "1";
      el.classList.add("docs-copyable");
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("title", el.getAttribute("title") || "Copy");

      const doCopy = async () => {
        const text = el.getAttribute("data-copy") || el.textContent || "";
        const ok = await copyToClipboard(text.trim());
        setStatus(statusEl, ok ? "success" : "error", ok ? "Copied." : "Copy failed.");
        if (ok) flashButtonCopied(el);
      };

      el.addEventListener("click", doCopy);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          doCopy();
        }
      });
    }
  }

  async function loadDocsSections() {
    if (!contentEl || !statusEl) return;

    try {
      const res = await fetch(assetUrl("content/support/docs-sections.html"), {
        headers: { Accept: "text/html" },
        credentials: "same-origin",
      });

      if (!res.ok) throw new Error(`Failed to load docs content (${res.status})`);

      contentEl.innerHTML = await res.text();
      bindCopyInteractions();
    } catch {
      statusEl.textContent = "Failed to load documentation.";
      statusEl.classList.add("is-error");
      return;
    }

    setStatus(statusEl, "info", "");
  }

  await loadDocsSections();
});
