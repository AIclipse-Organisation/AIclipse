function setStatus(el, type, text) {
  if (!el) return;
  el.innerHTML = "";
  if (!text) return;

  const span = document.createElement("span");
  span.textContent = text;
  span.classList.add(
    type === "success"
      ? "status-success"
      : type === "error"
      ? "status-error"
      : "status-info"
  );
  el.appendChild(span);
}

async function copyToClipboard(text) {
  if (!text) return false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.left = "-1000px";
    ta.style.opacity = "0";

    document.body.appendChild(ta);
    ta.focus();
    ta.select();

    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  if (typeof window.loadPartials === "function") {
    try {
      await window.loadPartials();
    } catch {}
  }

  const statusEl = document.getElementById("docs-status");

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

  // Copy code blocks (buttons with data-copy-target="#id")
  const codeButtons = document.querySelectorAll("[data-copy-target]");
  for (const btn of codeButtons) {
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

  // Copy inline values (elements with data-copy="...")
  const copyEls = document.querySelectorAll("[data-copy]");
  for (const el of copyEls) {
    el.style.cursor = "pointer";
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
});
