(function bootstrapAIclipseTutorial() {
  const PAGE_MAP = {
    "/upload": "upload",
    "/results": "results",
    "/profile": "profile",
    "/notification": "notifications",
    "/plan": "plan",
    "/community": "community-feed",
    "/tutorials": "tutorials",
  };

  const ROUTE_BY_PAGE_ID = {
    upload: "/upload",
    results: "/results",
    profile: "/profile",
    notifications: "/notification",
    plan: "/plan",
    "community-feed": "/community",
    tutorials: "/tutorials",
  };

  const registryApi = window.AIclipseTutorialRegistry || {
    version: 1,
    getModules() {
      return [];
    },
    getModule() {
      return null;
    },
  };

  const VERSION = Number(registryApi.version || 1);

  let refreshTimer = null;
  let uiSuspended = false;
  let trackingFrame = 0;
  let trackedTarget = null;
  let renderedStepKey = "";
  let autoScrolledStepKey = "";
  let hitboxMode = "hidden";

  function getUserScope() {
    const fromBody = document.body?.dataset?.tutorialUser;
    if (fromBody && String(fromBody).trim()) {
      return String(fromBody).trim().toLowerCase();
    }

    const scopeEl = document.getElementById("tutorial-user-scope");
    const fromHidden = scopeEl?.dataset?.userId;
    if (fromHidden && String(fromHidden).trim()) {
      return String(fromHidden).trim().toLowerCase();
    }

    const chip = document.getElementById("current-user-chip");
    const chipText = chip?.textContent?.trim();
    if (chipText && chipText !== "Not signed in") {
      return chipText.toLowerCase();
    }

    return "anonymous";
  }

  const USER_SCOPE = getUserScope();
  const PROGRESS_KEY = `aiclipse:tutorial:v${VERSION}:progress:${USER_SCOPE}`;
  const RUNTIME_KEY = `aiclipse:tutorial:v${VERSION}:runtime:${USER_SCOPE}`;

  function readJson(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      if (!raw) return fallback;
      return { ...fallback, ...JSON.parse(raw) };
    } catch {
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function getProgress() {
    return readJson(localStorage, PROGRESS_KEY, {
      version: VERSION,
      welcomeSeenVersion: 0,
      dismissedAt: null,
      completed: {},
      skipped: {},
    });
  }

  function setProgress(next) {
    writeJson(localStorage, PROGRESS_KEY, next);
  }

  function getRuntime() {
    return readJson(sessionStorage, RUNTIME_KEY, {
      version: VERSION,
      moduleId: null,
      stepIndex: 0,
      paused: false,
      context: {},
    });
  }

  function setRuntime(next) {
    writeJson(sessionStorage, RUNTIME_KEY, next);
  }

  function clearRuntime() {
    try {
      sessionStorage.removeItem(RUNTIME_KEY);
    } catch {}
  }

  function normalizePathname(pathname) {
    const clean = (pathname || "/").replace(/\/+$/, "");
    return clean || "/";
  }

  function getCurrentPageId() {
    const fromDom = document.body?.dataset?.pageId;
    if (fromDom) return fromDom;
    return PAGE_MAP[normalizePathname(window.location.pathname)] || normalizePathname(window.location.pathname);
  }

  function getRegistry() {
    return {
      version: VERSION,
      modules: registryApi.getModules(),
    };
  }

  function getModule(moduleId) {
    return registryApi.getModule(moduleId);
  }

  function getBaseStep(runtime = getRuntime()) {
    const module = getModule(runtime.moduleId);
    if (!module) return null;
    return module.steps[runtime.stepIndex] || null;
  }

  function resolveStep(runtime = getRuntime()) {
    const module = getModule(runtime.moduleId);
    const baseStep = getBaseStep(runtime);

    if (!module || !baseStep) return null;

    if (typeof baseStep.beforeShow !== "function") {
      return baseStep;
    }

    const override = baseStep.beforeShow({
      runtime,
      module,
      step: baseStep,
      api: API,
    });

    if (!override || typeof override !== "object") {
      return baseStep;
    }

    return {
      ...baseStep,
      ...override,
      id: override.id || baseStep.id,
    };
  }

  function getStepKey(runtime = getRuntime(), step = null) {
    const resolved = step || resolveStep(runtime);
    const stepId = resolved?.id || "none";
    const selectorKey = resolved?.selector || "no-selector";
    const titleKey = resolved?.title || "untitled";
    return `${runtime.moduleId || "none"}:${runtime.stepIndex || 0}:${stepId}:${selectorKey}:${titleKey}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizeBody(body) {
    if (Array.isArray(body)) return body.filter(Boolean).map(String);
    if (body == null || body === "") return [];
    return [String(body)];
  }

  function renderBodyHtml(body) {
    const paragraphs = normalizeBody(body);
    if (!paragraphs.length) return "";
    return paragraphs
      .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
      .join("");
  }

  function ensureDom() {
    let topShade = document.getElementById("aiclipse-tutorial-shade-top");
    let rightShade = document.getElementById("aiclipse-tutorial-shade-right");
    let bottomShade = document.getElementById("aiclipse-tutorial-shade-bottom");
    let leftShade = document.getElementById("aiclipse-tutorial-shade-left");
    let hitbox = document.getElementById("aiclipse-tutorial-hitbox");
    let card = document.getElementById("aiclipse-tutorial-card");

    const makeShade = (id, extraClass) => {
      const el = document.createElement("div");
      el.id = id;
      el.className = `aiclipse-tutorial-shade ${extraClass}`;
      el.addEventListener("click", () => API.pause());
      document.body.appendChild(el);
      return el;
    };

    if (!topShade) topShade = makeShade("aiclipse-tutorial-shade-top", "aiclipse-tutorial-shade--top");
    if (!rightShade) rightShade = makeShade("aiclipse-tutorial-shade-right", "aiclipse-tutorial-shade--right");
    if (!bottomShade) bottomShade = makeShade("aiclipse-tutorial-shade-bottom", "aiclipse-tutorial-shade--bottom");
    if (!leftShade) leftShade = makeShade("aiclipse-tutorial-shade-left", "aiclipse-tutorial-shade--left");

    if (!hitbox) {
      hitbox = document.createElement("button");
      hitbox.id = "aiclipse-tutorial-hitbox";
      hitbox.className = "aiclipse-tutorial-hitbox";
      hitbox.type = "button";

      hitbox.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (hitboxMode !== "click") {
          return;
        }

        const target = trackedTarget;
        if (!target || !isVisibleElement(target)) return;

        if (typeof target.click === "function") {
          target.click();
          return;
        }

        target.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
      });

      document.body.appendChild(hitbox);
    }

    if (!card) {
      card = document.createElement("div");
      card.id = "aiclipse-tutorial-card";
      card.className = "aiclipse-tutorial-card";
      document.body.appendChild(card);
    }

    return { topShade, rightShade, bottomShade, leftShade, hitbox, card };
  }

  function clearTargetHighlight() {
    document.querySelectorAll(".aiclipse-tutorial-target").forEach((el) => {
      el.classList.remove("aiclipse-tutorial-target");
    });
    trackedTarget = null;
  }

  function stopTracking() {
    if (trackingFrame) {
      cancelAnimationFrame(trackingFrame);
      trackingFrame = 0;
    }
  }

  function setHitboxMode(nextMode) {
    hitboxMode = nextMode;
    const { hitbox } = ensureDom();
    hitbox.classList.toggle("is-clickable", nextMode === "click");
  }

  function clearOverlayStyles() {
    const { topShade, rightShade, bottomShade, leftShade, hitbox, card } = ensureDom();

    [topShade, rightShade, bottomShade, leftShade].forEach((el) => {
      el.classList.remove("is-open");
      el.style.top = "";
      el.style.left = "";
      el.style.width = "";
      el.style.height = "";
    });

    hitbox.classList.remove("is-open");
    hitbox.style.top = "";
    hitbox.style.left = "";
    hitbox.style.width = "";
    hitbox.style.height = "";
    hitbox.style.borderRadius = "";
    setHitboxMode("hidden");

    card.classList.remove("is-open");
    card.style.top = "";
    card.style.left = "";
    card.style.transform = "";
  }

  function hideUi() {
    stopTracking();
    clearOverlayStyles();
    const { card } = ensureDom();
    card.innerHTML = "";
    clearTargetHighlight();
    renderedStepKey = "";
  }

  function openUi() {
    const { card } = ensureDom();
    card.classList.add("is-open");
    return ensureDom();
  }

  function isVisibleElement(el) {
    if (!el) return false;

    if (typeof el.disabled === "boolean" && el.disabled) {
      return false;
    }

    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findTarget(step) {
    if (!step || !step.selector) return null;
    const el = document.querySelector(step.selector);
    if (!isVisibleElement(el)) return null;
    return el;
  }

  function getClampedRect(rawRect) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const left = Math.max(0, Math.min(rawRect.left, viewportWidth));
    const top = Math.max(0, Math.min(rawRect.top, viewportHeight));
    const right = Math.max(0, Math.min(rawRect.right, viewportWidth));
    const bottom = Math.max(0, Math.min(rawRect.bottom, viewportHeight));

    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function getBorderRadius(target) {
    if (!target) return "0px";
    const style = window.getComputedStyle(target);
    return style.borderRadius || "0px";
  }

  function applyTargetHighlight(target) {
    if (trackedTarget === target) return;

    clearTargetHighlight();

    if (target) {
      target.classList.add("aiclipse-tutorial-target");
      trackedTarget = target;
    }
  }

  function positionShades(rect) {
    const { topShade, rightShade, bottomShade, leftShade } = ensureDom();

    if (!rect || rect.width <= 0 || rect.height <= 0) {
      topShade.classList.add("is-open");
      topShade.style.top = "0px";
      topShade.style.left = "0px";
      topShade.style.width = `${window.innerWidth}px`;
      topShade.style.height = `${window.innerHeight}px`;

      rightShade.classList.remove("is-open");
      bottomShade.classList.remove("is-open");
      leftShade.classList.remove("is-open");
      return;
    }

    topShade.classList.add("is-open");
    rightShade.classList.add("is-open");
    bottomShade.classList.add("is-open");
    leftShade.classList.add("is-open");

    topShade.style.top = "0px";
    topShade.style.left = "0px";
    topShade.style.width = `${window.innerWidth}px`;
    topShade.style.height = `${Math.max(0, rect.top)}px`;

    bottomShade.style.top = `${Math.max(0, rect.bottom)}px`;
    bottomShade.style.left = "0px";
    bottomShade.style.width = `${window.innerWidth}px`;
    bottomShade.style.height = `${Math.max(0, window.innerHeight - rect.bottom)}px`;

    leftShade.style.top = `${rect.top}px`;
    leftShade.style.left = "0px";
    leftShade.style.width = `${Math.max(0, rect.left)}px`;
    leftShade.style.height = `${rect.height}px`;

    rightShade.style.top = `${rect.top}px`;
    rightShade.style.left = `${Math.max(0, rect.right)}px`;
    rightShade.style.width = `${Math.max(0, window.innerWidth - rect.right)}px`;
    rightShade.style.height = `${rect.height}px`;
  }

  function positionHitbox(rect, target, mode = "hidden") {
    const { hitbox } = ensureDom();

    if (!rect || rect.width <= 0 || rect.height <= 0 || !target || mode === "hidden") {
      hitbox.classList.remove("is-open");
      setHitboxMode("hidden");
      return;
    }

    setHitboxMode(mode);
    hitbox.classList.add("is-open");
    hitbox.style.top = `${rect.top}px`;
    hitbox.style.left = `${rect.left}px`;
    hitbox.style.width = `${rect.width}px`;
    hitbox.style.height = `${rect.height}px`;
    hitbox.style.borderRadius = getBorderRadius(target);
  }

  function rectNeedsScroll(rect) {
    if (!rect) return false;
    const margin = 28;
    return (
      rect.top < margin ||
      rect.left < margin ||
      rect.bottom > window.innerHeight - margin ||
      rect.right > window.innerWidth - margin
    );
  }

  function ensureTargetInView(stepKey, target, rect) {
    if (!target || !rect) return;
    if (autoScrolledStepKey === stepKey) return;
    if (!rectNeedsScroll(rect)) return;

    autoScrolledStepKey = stepKey;
    target.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "auto",
    });
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function positionCard(card, rect) {
    const margin = 14;
    const gap = 14;
    const cardRect = card.getBoundingClientRect();
    const cardWidth = cardRect.width || Math.min(430, window.innerWidth - margin * 2);
    const cardHeight = cardRect.height || 220;

    if (!rect || rect.width <= 0 || rect.height <= 0) {
      card.style.top = "50%";
      card.style.left = "50%";
      card.style.transform = "translate(-50%, -50%)";
      return;
    }

    const centeredLeft = clamp(
      rect.left + rect.width / 2 - cardWidth / 2,
      margin,
      Math.max(margin, window.innerWidth - cardWidth - margin),
    );

    const canPlaceBelow = rect.bottom + gap + cardHeight <= window.innerHeight - margin;
    const canPlaceAbove = rect.top - gap - cardHeight >= margin;

    let top;
    const left = centeredLeft;

    if (canPlaceBelow) {
      top = rect.bottom + gap;
    } else if (canPlaceAbove) {
      top = rect.top - cardHeight - gap;
    } else {
      const availableBelow = window.innerHeight - rect.bottom - gap - margin;
      const availableAbove = rect.top - gap - margin;

      if (availableBelow >= availableAbove) {
        top = clamp(
          rect.bottom + gap,
          margin,
          Math.max(margin, window.innerHeight - cardHeight - margin),
        );
      } else {
        top = clamp(
          rect.top - cardHeight - gap,
          margin,
          Math.max(margin, window.innerHeight - cardHeight - margin),
        );
      }
    }

    card.style.top = `${Math.round(top)}px`;
    card.style.left = `${Math.round(left)}px`;
    card.style.transform = "none";
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => API.refresh(), 120);
  }

  function navigateToStep(step) {
    const path = ROUTE_BY_PAGE_ID[step?.pageId];
    if (!path) return;
    if (normalizePathname(window.location.pathname) === normalizePathname(path)) return;
    window.location.href = path;
  }

  function renderCard({ kicker, title, body, actions, target = null, stepKey = "" }) {
    const { card } = openUi();

    renderedStepKey = stepKey;

    card.innerHTML = `
      <div class="aiclipse-tutorial-head">
        ${kicker ? `<div class="aiclipse-tutorial-kicker">${escapeHtml(kicker)}</div>` : ""}
        <h3 class="aiclipse-tutorial-title">${escapeHtml(title)}</h3>
      </div>
      <div class="aiclipse-tutorial-body">${renderBodyHtml(body)}</div>
      ${
        actions.length
          ? `
        <div class="aiclipse-tutorial-actions">
          ${actions
            .map(
              (action, index) => `
                <button
                  type="button"
                  class="aiclipse-tutorial-btn ${escapeHtml(action.variant)}"
                  data-action-index="${index}"
                >
                  ${escapeHtml(action.label)}
                </button>
              `,
            )
            .join("")}
        </div>
      `
          : ""
      }
    `;

    card.querySelectorAll("[data-action-index]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.getAttribute("data-action-index"));
        const action = actions[index];
        if (action && typeof action.onClick === "function") {
          action.onClick();
        }
      });
    });

    applyTargetHighlight(target);
    startTracking();
  }

  function markModuleCompleted(moduleId) {
    const progress = getProgress();
    progress.completed[moduleId] = VERSION;
    delete progress.skipped[moduleId];
    setProgress(progress);
  }

  function markModulePaused(moduleId) {
    const progress = getProgress();
    delete progress.skipped[moduleId];
    if (!progress.completed[moduleId]) {
      progress.dismissedAt = Date.now();
    }
    setProgress(progress);
  }

  function maybeShowWelcome() {
    const progress = getProgress();
    const runtime = getRuntime();

    if (getCurrentPageId() !== "upload") return;
    if (progress.welcomeSeenVersion === VERSION) return;
    if (runtime.moduleId) return;

    renderCard({
      kicker: "Welcome",
      title: "Get started with AIclipse",
      body: [
        "Start the quick tour now or open Tutorials from the menu later.",
      ],
      stepKey: "welcome",
      actions: [
        {
          label: "Start quick tour",
          variant: "aiclipse-tutorial-btn--primary",
          onClick: () => {
            const next = getProgress();
            next.welcomeSeenVersion = VERSION;
            setProgress(next);
            API.startModule("quick_start");
          },
        },
        {
          label: "Not now",
          variant: "aiclipse-tutorial-btn--neutral",
          onClick: () => {
            const next = getProgress();
            next.welcomeSeenVersion = VERSION;
            next.dismissedAt = Date.now();
            setProgress(next);
            hideUi();
          },
        },
      ],
    });
  }

  function buildStepActions(module, step, runtime) {
    const actions = [];
    const isFinalStep = runtime.stepIndex >= module.steps.length - 1;

    if (step.nextLabel) {
      actions.push({
        label: step.nextLabel,
        variant: "aiclipse-tutorial-btn--primary",
        onClick: () => API.nextStep(),
      });
    } else if (!step.completeEvent) {
      actions.push({
        label: isFinalStep ? "Done" : "Continue",
        variant: "aiclipse-tutorial-btn--primary",
        onClick: () => API.nextStep(),
      });
    }

    actions.push({
      label: "Not now",
      variant: "aiclipse-tutorial-btn--neutral",
      onClick: () => API.pause(),
    });

    return actions;
  }

  function renderActiveStep() {
    const pageId = getCurrentPageId();

    if (pageId === "tutorials") {
      hideUi();
      return;
    }

    if (uiSuspended) {
      hideUi();
      return;
    }

    const runtime = getRuntime();

    if (!runtime.moduleId) {
      hideUi();
      maybeShowWelcome();
      return;
    }

    if (runtime.paused) {
      hideUi();
      return;
    }

    const module = getModule(runtime.moduleId);
    const step = resolveStep(runtime);

    if (!module || !step) {
      if (runtime.moduleId) {
        markModuleCompleted(runtime.moduleId);
      }
      clearRuntime();
      hideUi();
      return;
    }

    if (step.pageId !== pageId) {
      hideUi();
      return;
    }

    const target = step.selector ? findTarget(step) : null;

    if (step.selector && !target) {
      hideUi();
      scheduleRefresh();
      return;
    }

    const stepNumber = runtime.stepIndex + 1;
    const totalSteps = module.steps.length;

    renderCard({
      kicker: `${module.title} · Step ${stepNumber} of ${totalSteps}`,
      title: step.title,
      body: step.body,
      target,
      actions: buildStepActions(module, step, runtime),
      stepKey: getStepKey(runtime, step),
    });
  }

  function updateTrackedLayout() {
    const pageId = getCurrentPageId();
    const runtime = getRuntime();
    const { card } = ensureDom();

    if (!card.classList.contains("is-open")) return;

    if (uiSuspended || runtime.paused || pageId === "tutorials") {
      hideUi();
      return;
    }

    if (!runtime.moduleId) {
      clearOverlayStyles();
      card.classList.add("is-open");
      positionShades(null);
      positionHitbox(null, null, "hidden");
      positionCard(card, null);
      return;
    }

    const step = resolveStep(runtime);
    if (!step || step.pageId !== pageId) {
      hideUi();
      return;
    }

    const stepKey = getStepKey(runtime, step);
    if (renderedStepKey !== stepKey) {
      renderActiveStep();
      return;
    }

    const target = step.selector ? findTarget(step) : null;
    if (step.selector && !target) {
      hideUi();
      scheduleRefresh();
      return;
    }

    let rect = null;
    if (target) {
      rect = getClampedRect(target.getBoundingClientRect());
      ensureTargetInView(stepKey, target, rect);
      rect = getClampedRect(target.getBoundingClientRect());
    }

    applyTargetHighlight(target);
    positionShades(rect);
    positionHitbox(rect, target, target ? (step.allowTargetClick ? "click" : "block") : "hidden");
    positionCard(card, rect);
  }

  function startTracking() {
    stopTracking();

    const loop = () => {
      updateTrackedLayout();

      if (document.getElementById("aiclipse-tutorial-card")?.classList.contains("is-open")) {
        trackingFrame = requestAnimationFrame(loop);
      } else {
        trackingFrame = 0;
      }
    };

    trackingFrame = requestAnimationFrame(loop);
  }

  function advanceRuntime(detail = {}, navigateFromTutorialsPage = false) {
    const runtime = getRuntime();
    const module = getModule(runtime.moduleId);

    if (!module) {
      clearRuntime();
      hideUi();
      return;
    }

    runtime.stepIndex = runtime.stepIndex + 1;
    runtime.paused = false;
    runtime.context = { ...(runtime.context || {}), ...detail };
    setRuntime(runtime);

    const nextStep = module.steps[runtime.stepIndex] || null;

    if (!nextStep) {
      markModuleCompleted(runtime.moduleId);
      clearRuntime();
      hideUi();
      return;
    }

    autoScrolledStepKey = "";

    const currentPageId = getCurrentPageId();

    if (navigateFromTutorialsPage && nextStep.pageId !== currentPageId) {
      navigateToStep(nextStep);
      return;
    }

    if (nextStep.pageId !== currentPageId) {
      hideUi();
      return;
    }

    renderActiveStep();
  }

  const API = {
    startModule(moduleId) {
      const module = getModule(moduleId);
      if (!module) return;

      uiSuspended = false;
      autoScrolledStepKey = "";

      setRuntime({
        version: VERSION,
        moduleId,
        stepIndex: 0,
        paused: false,
        context: {},
      });

      const progress = getProgress();
      if (progress.welcomeSeenVersion !== VERSION) {
        progress.welcomeSeenVersion = VERSION;
        setProgress(progress);
      }

      const firstStep = module.steps[0];
      if (!firstStep) return;

      if (firstStep.pageId !== getCurrentPageId()) {
        navigateToStep(firstStep);
        return;
      }

      renderActiveStep();
    },

    continueActiveModule() {
      const runtime = getRuntime();
      if (!runtime.moduleId) {
        window.location.href = "/tutorials";
        return;
      }

      uiSuspended = false;
      runtime.paused = false;
      setRuntime(runtime);

      const step = resolveStep(runtime);
      if (!step) {
        clearRuntime();
        hideUi();
        return;
      }

      if (step.pageId !== getCurrentPageId()) {
        navigateToStep(step);
        return;
      }

      renderActiveStep();
    },

    pause() {
      const runtime = getRuntime();

      if (!runtime.moduleId) {
        hideUi();
        return;
      }

      runtime.paused = true;
      setRuntime(runtime);
      markModulePaused(runtime.moduleId);
      hideUi();
    },

    nextStep() {
      advanceRuntime();
    },

    emit(eventName, detail = {}) {
      const runtime = getRuntime();
      if (!runtime.moduleId) return;

      const step = resolveStep(runtime);
      if (!step || !step.completeEvent) return;
      if (step.completeEvent !== eventName) return;

      if (step.advanceOnComplete === false) {
        runtime.context = { ...(runtime.context || {}), ...detail };
        setRuntime(runtime);
        autoScrolledStepKey = "";
        renderActiveStep();
        return;
      }

      advanceRuntime(detail, false);
    },

    refresh() {
      renderActiveStep();
    },

    suspendUi() {
      uiSuspended = true;
      hideUi();
    },

    resumeUi() {
      uiSuspended = false;
      renderActiveStep();
    },

    resetAll() {
      uiSuspended = false;
      clearRuntime();
      try {
        localStorage.removeItem(PROGRESS_KEY);
      } catch {}
      hideUi();
      maybeShowWelcome();
    },

    openTutorialsPage() {
      window.location.href = "/tutorials";
    },

    getRegistry() {
      return getRegistry();
    },

    getProgress() {
      return getProgress();
    },

    getRuntime() {
      return getRuntime();
    },
  };

  function bindGlobalEventsOnce() {
    if (window.__aiclipseTutorialBound) return;
    window.__aiclipseTutorialBound = true;

    window.addEventListener("pageshow", () => API.refresh());
    window.addEventListener("resize", () => scheduleRefresh());
    window.addEventListener("scroll", () => scheduleRefresh(), true);

    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-tutorial-open]");
      if (!trigger) return;
      event.preventDefault();
      API.openTutorialsPage();
    });
  }

  function maybeHandleTutorialQuery() {
    if (getCurrentPageId() !== "tutorials") return false;

    const params = new URLSearchParams(window.location.search);
    const start = params.get("start");
    const resume = params.get("resume");

    if (start && getModule(start)) {
      API.startModule(start);
      return true;
    }

    if (resume === "1") {
      API.continueActiveModule();
      return true;
    }

    hideUi();
    return false;
  }

  function init() {
    ensureDom();
    bindGlobalEventsOnce();

    if (maybeHandleTutorialQuery()) {
      return;
    }

    renderActiveStep();
  }

  window.AIclipseTutorial = API;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();