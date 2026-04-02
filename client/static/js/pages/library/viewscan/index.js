(function initViewscanPage() {
  const shared = window.AIclipseViewscanShared;
  const comments = window.AIclipseViewscanComments;
  const actions = window.AIclipseViewscanActions;

  if (!shared || !comments || !actions) return;

  const {
    clamp,
    consumeScansMarkPostId,
    createScrambledNumber,
    formatDate,
    getBootstrappedImageId,
    getCurrentScan,
    getPostId,
    isPrivateScan,
    markNotificationsReadForPost,
    normalizeId,
    readBootstrappedPageModel,
    setCurrentContext,
  } = shared;

  const {
    setupDeletePost,
    setupDeleteScan,
    setupEditDescriptionInline,
    setupMakePublicInline,
  } = actions;

  const { setupShowComments } = comments;

  const GRADIENT_AICLIPSE = "#cfb87c 0%, #cfb87c 40%, #e07043 60%, #cc2222 100%";

  function setFillWithGradient(fillEl, aiPct, gradient) {
    if (!fillEl) return;
    const p = clamp(aiPct, 0, 100);
    fillEl.style.width = p === 0 ? "0px" : `calc(${p}% - 8px)`;
    fillEl.dataset.p = String(p);
    const pctSafe = Math.max(p, 0.1);
    const zoneSize = `${(10000 / pctSafe).toFixed(2)}%`;
    fillEl.style.background = `linear-gradient(to right, rgba(0,0,0,0.28), transparent) left / 100% 100% no-repeat, linear-gradient(to right, ${gradient}) left / ${zoneSize} 100% no-repeat`;
  }

  function setZoneLabels(container, aiPct) {
    if (!container) return;
    const zone = aiPct < 40 ? "safe" : aiPct <= 60 ? "neutral" : "risk";
    container.querySelectorAll(".comm_zoneLabel").forEach((el) => {
      el.classList.toggle("comm_zoneLabel--active", el.classList.contains(`comm_zoneLabel--${zone}`));
    });
  }

  function animateVerdictBars() {
    const block = document.getElementById("verdict-block");
    if (!block || block.hidden) return;
    block.classList.remove("is-revealed");
    block.classList.add("is-hidden");
    void block.offsetWidth;
    block.classList.remove("is-hidden");
    block.classList.add("is-revealed");
  }

  function getRealLikelihoodPercent(img) {
    if (!img) return 0;

    const verdict = String(img.verdict || "unknown").toLowerCase();
    const label = String(img.label || img.result || verdict).toLowerCase();
    const confidenceRaw = Number.isFinite(img.confidence) ? img.confidence : (img.score ?? 0);
    const confidence = clamp(confidenceRaw, 0, 1);
    const prediction = verdict !== "unknown" ? verdict : label;
    const realProb = prediction === "real" ? confidence : 1 - confidence;
    return clamp(realProb * 100, 0, 100);
  }

  function renderAiclipseCard(img) {
    const wrap = document.getElementById("verdict-block");
    const card = document.getElementById("aiclipse-card");
    const fillEl = document.getElementById("aiclipse-fill");
    const pctEl = document.getElementById("aiclipse-percent");

    if (!wrap || !card || !fillEl || !pctEl) return;
    if (!img) {
      card.hidden = true;
      return;
    }

    const realPct = getRealLikelihoodPercent(img);
    const aiPct = 100 - realPct;
    pctEl.textContent = `${Math.round(aiPct)}%`;
    setFillWithGradient(fillEl, aiPct, GRADIENT_AICLIPSE);
    setZoneLabels(card, aiPct);

    wrap.hidden = false;
    card.hidden = false;
  }

  function renderCommunityCard(img) {
    const card = document.getElementById("community-card");
    const privateNote = document.getElementById("community-private-note");
    const realFillEl = document.getElementById("community-real-fill");
    const fakeFillEl = document.getElementById("community-fake-fill");
    const realPctEl = document.getElementById("community-real-pct");
    const fakePctEl = document.getElementById("community-fake-pct");
    const realCountEl = document.getElementById("community-real-count");
    const fakeCountEl = document.getElementById("community-fake-count");
    const summaryEl = document.getElementById("community-summary");
    const totalEl = document.getElementById("community-total");
    const verdictEl = document.getElementById("community-verdict");

    if (!card) return;
    if (!img) {
      card.hidden = true;
      return;
    }

    if (privateNote) privateNote.hidden = !isPrivateScan(img);

    const up = Number(img.up_vote_count);
    const down = Number(img.down_vote_count);
    const upN = Number.isFinite(up) ? up : 0;
    const downN = Number.isFinite(down) ? down : 0;
    const total = upN + downN;

    if (realCountEl) realCountEl.textContent = `${upN} ${upN === 1 ? "vote" : "votes"}`;
    if (fakeCountEl) fakeCountEl.textContent = `${downN} ${downN === 1 ? "vote" : "votes"}`;

    if (total <= 0) {
      if (realFillEl) {
        realFillEl.style.width = "0px";
        realFillEl.style.background = "linear-gradient(to right, rgba(0,0,0,0.28), transparent), #cfb87c";
      }
      if (fakeFillEl) {
        fakeFillEl.style.width = "0px";
        fakeFillEl.style.background = "linear-gradient(to right, rgba(0,0,0,0.28), transparent), linear-gradient(to right, #cfb87c, #e07043, #cc2222)";
      }
      if (realPctEl) realPctEl.textContent = "0%";
      if (fakePctEl) fakePctEl.textContent = "0%";
      if (summaryEl) summaryEl.hidden = true;
      card.hidden = false;
      return;
    }

    const pctReal = clamp((upN / total) * 100, 0, 100);
    const pctFake = 100 - pctReal;

    if (realFillEl) {
      realFillEl.style.width = pctReal === 0 ? "0px" : `calc(${pctReal}% - 8px)`;
      const zoneSize = `${(10000 / Math.max(pctReal, 0.1)).toFixed(2)}%`;
      realFillEl.style.background = `linear-gradient(to right, rgba(0,0,0,0.28), transparent) left / 100% 100% no-repeat, linear-gradient(to right, #cfb87c) left / ${zoneSize} 100% no-repeat`;
    }

    if (fakeFillEl) {
      fakeFillEl.style.width = pctFake === 0 ? "0px" : `calc(${pctFake}% - 8px)`;
      const zoneSize = `${(10000 / Math.max(pctFake, 0.1)).toFixed(2)}%`;
      fakeFillEl.style.background = `linear-gradient(to right, rgba(0,0,0,0.28), transparent) left / 100% 100% no-repeat, linear-gradient(to right, #cfb87c, #e07043, #cc2222) left / ${zoneSize} 100% no-repeat`;
    }

    if (realPctEl) createScrambledNumber(Math.round(pctReal), realPctEl, true, 250);
    if (fakePctEl) createScrambledNumber(Math.round(pctFake), fakePctEl, true, 250);

    if (summaryEl && totalEl && verdictEl) {
      totalEl.textContent = total;

      let verdict = "Split";
      let verdictClass = "comm_voteSummary--split";
      if (pctReal > pctFake) {
        verdict = "Real";
        verdictClass = "comm_voteSummary--real";
      } else if (pctFake > pctReal) {
        verdict = "Fake";
        verdictClass = "comm_voteSummary--fake";
      }

      verdictEl.textContent = verdict;
      verdictEl.className = verdictClass;
      summaryEl.hidden = false;
    }

    card.hidden = false;
  }

  function renderQuickMeta(img) {
    const visibilityEl = document.getElementById("scan-quick-visibility");
    if (visibilityEl && img) {
      visibilityEl.textContent =
        img && typeof img.is_public === "boolean" && img.is_public ? "Public" : "Private";
    }

    const uploadDateEl = document.getElementById("vs-upload-date");
    if (!uploadDateEl) return;

    if (img?.uploaded_at) {
      uploadDateEl.textContent = formatDate(img.uploaded_at);
      uploadDateEl.hidden = false;
      return;
    }

    uploadDateEl.hidden = true;
  }

  function renderDescriptionHeader(img) {
    const section = document.getElementById("description-header-section");
    const textEl = document.getElementById("description-text");
    const privatePlaceholder = document.getElementById("private-description-placeholder");

    if (!section || !textEl || !privatePlaceholder) return;

    const isModerated = !!(img && img.moderation_status === "removed");
    const hasDescription = !!(img && img.description);

    textEl.classList.remove("is-moderated-reason");

    if (isModerated) {
      section.hidden = false;
      textEl.hidden = false;
      textEl.textContent = img.moderation_reason || "This image has been removed by moderation.";
      textEl.classList.add("is-moderated-reason");
      privatePlaceholder.hidden = true;
      return;
    }

    if (hasDescription) {
      section.hidden = false;
      textEl.hidden = false;
      textEl.textContent = String(img.description);
      privatePlaceholder.hidden = true;
      return;
    }

    if (isPrivateScan(img)) {
      section.hidden = true;
      textEl.hidden = true;
      textEl.textContent = "";
      privatePlaceholder.hidden = false;
      return;
    }

    section.hidden = true;
    textEl.hidden = false;
    textEl.textContent = "";
    privatePlaceholder.hidden = true;
  }

  function renderVerdictConfidenceCard(img) {
    const card = document.getElementById("verdict-confidence-card");
    const verdictEl = document.getElementById("card-verdict");
    const confidenceEl = document.getElementById("card-confidence");

    if (!card) return;

    const hasVerdict = img?.verdict != null;
    const hasConfidence = img?.confidence !== undefined && img?.confidence !== null;

    if (!hasVerdict && !hasConfidence) {
      card.hidden = true;
      return;
    }

    card.hidden = false;
    if (verdictEl) verdictEl.textContent = hasVerdict ? String(img.verdict) : "—";
    if (confidenceEl) {
      confidenceEl.textContent = hasConfidence ? `${getRealLikelihoodPercent(img).toFixed(0)}%` : "N/A";
    }
  }

  async function renderScan(img, title) {
    setCurrentContext(img, shared.getCurrentViewer());

    const card = document.getElementById("viewscan-card");
    const imageEl = document.getElementById("viewscan-image");
    const titleEl = document.getElementById("viewscan-title");

    if (!card || !imageEl || !titleEl) return;

    const scansOriginPostId = consumeScansMarkPostId();
    const currentPostId = normalizeId(getPostId(img));
    if (scansOriginPostId && currentPostId && scansOriginPostId === currentPostId) {
      markNotificationsReadForPost(currentPostId);
    }

    if (!img) {
      card.hidden = true;
      titleEl.textContent = "Post Description";
      return;
    }

    titleEl.textContent = title || "Post Description";

    if (img.url) {
      imageEl.src = img.url;
      imageEl.alt = title || "Selected scan image";
      imageEl.style.display = "";
    } else {
      imageEl.removeAttribute("src");
      imageEl.alt = "No image available.";
      imageEl.style.display = "none";
    }

    renderAiclipseCard(img);
    renderCommunityCard(img);
    renderQuickMeta(img);
    renderDescriptionHeader(img);
    renderVerdictConfidenceCard(img);

    card.hidden = false;

    setupEditDescriptionInline(img, renderDescriptionHeader);
    setupShowComments(img);
    setupDeletePost(img);
    setupDeleteScan(img);
    setupMakePublicInline(img);
    animateVerdictBars();
  }

  window.addEventListener("DOMContentLoaded", async () => {
    const bootstrappedImageId = getBootstrappedImageId();
    if (!bootstrappedImageId) {
      window.location.href = "/scans";
      return;
    }

    let img = null;
    let title = null;
    let viewer = null;
    const initialPageModel = readBootstrappedPageModel();
    if (initialPageModel) {
      img = initialPageModel.image || null;
      title = initialPageModel.title || null;
      viewer = initialPageModel.viewer || null;
    }

    setCurrentContext(img, viewer);
    await renderScan(img, title);
  });
})();
