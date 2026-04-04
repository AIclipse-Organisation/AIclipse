function normalizeTutorialPathname(pathname) {
  const clean = String(pathname || "/").replace(/\/+$/, "");
  return clean || "/";
}

function shouldAutoLoadTutorials({
  pathname = "/",
  hasActiveRuntime = false,
  search = "",
} = {}) {
  const path = normalizeTutorialPathname(pathname);
  const tutorialPages = new Set([
    "/upload",
    "/results",
    "/profile",
    "/notification",
    "/plan",
    "/tutorials",
  ]);

  if (tutorialPages.has(path)) return true;
  if (hasActiveRuntime) return true;

  const params = new URLSearchParams(search || "");
  if (params.get("resume") === "1") return true;
  if (params.has("start")) return true;

  return false;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeTutorialPathname,
    shouldAutoLoadTutorials,
  };
}

if (typeof window !== "undefined") {
  (function initTutorialLoader() {
    if (window.__aiclipseTutorialLoader) return;
    window.__aiclipseTutorialLoader = true;

    const assetUrl = window.AIclipseAssetUrl;
    const CSS_HREF = assetUrl("css/tutorials/tutorial.css");
    const SCRIPT_SRCS = [
      assetUrl("js/tutorials/registry.js"),
      assetUrl("js/tutorials/modules/quick-start.js"),
      assetUrl("js/tutorials/modules/publish-public.js"),
      assetUrl("js/tutorials/modules/profile-basics.js"),
      assetUrl("js/tutorials/modules/notifications-basics.js"),
      assetUrl("js/tutorials/modules/plan-basics.js"),
      assetUrl("js/tutorials/modules/community-basics.js"),
      assetUrl("js/tutorials/core.js"),
    ];

    function hasActiveTutorialRuntime() {
      try {
        for (let i = 0; i < sessionStorage.length; i += 1) {
          const key = sessionStorage.key(i);
          if (!key || !key.startsWith("aiclipse:tutorial:v") || !key.includes(":runtime:")) {
            continue;
          }

          const raw = sessionStorage.getItem(key);
          if (!raw) continue;

          const runtime = JSON.parse(raw);
          if (runtime && runtime.moduleId && runtime.paused !== true) {
            return true;
          }
        }
      } catch {}

      return false;
    }

    function ensureTutorialStylesheet() {
      if (document.querySelector(`link[href="${CSS_HREF}"]`)) return;

      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = CSS_HREF;
      document.head.appendChild(link);
    }

    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
          if (existing.dataset.loaded === "1") {
            resolve();
            return;
          }
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
          return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.defer = true;
        script.addEventListener(
          "load",
          () => {
            script.dataset.loaded = "1";
            resolve();
          },
          { once: true },
        );
        script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
        document.head.appendChild(script);
      });
    }

    async function loadTutorialStack() {
      if (window.__aiclipseTutorialReadyPromise) {
        return window.__aiclipseTutorialReadyPromise;
      }

      window.__aiclipseTutorialReadyPromise = (async () => {
        ensureTutorialStylesheet();
        for (const src of SCRIPT_SRCS) {
          await loadScript(src);
        }
        document.dispatchEvent(new CustomEvent("aiclipse:tutorial-ready"));
      })();

      return window.__aiclipseTutorialReadyPromise;
    }

    if (
      shouldAutoLoadTutorials({
        pathname: window.location.pathname,
        hasActiveRuntime: hasActiveTutorialRuntime(),
        search: window.location.search,
      })
    ) {
      loadTutorialStack().catch(() => {});
    }

    window.AIclipseTutorialLoader = {
      load: loadTutorialStack,
    };
  })();
}
