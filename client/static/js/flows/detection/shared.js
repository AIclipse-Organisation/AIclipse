(function attachDetectionFlowShared(global) {
  const { jsonFetch: baseJsonFetch, setDebug } = global.AIclipseHttp;
  const { render: setStatus } = global.AIclipseStatus;

  function setCurrentUserChip(user) {
    if (!user) {
      window.AuthUI.clear();
      return;
    }

    window.AuthUI.setUser(user);
  }

  async function jsonFetch(method, url, body) {
    return baseJsonFetch(method, url, body, { debugTargetId: "debug-output" });
  }

  async function loadCurrentUserContext() {
    try {
      const { res, data } = await jsonFetch("GET", "/auth/me", null);
      if (!res.ok) {
        setCurrentUserChip(null);
        return null;
      }

      setCurrentUserChip(data);
      return data;
    } catch {
      setCurrentUserChip(null);
      return null;
    }
  }

  async function clearPendingDetectionState() {
    const store = global.AIclipsePendingDetectionStore;
    if (!store || typeof store.clear !== "function") {
      throw new Error("IndexedDB pending detection store unavailable");
    }

    await store.clear();
  }

  async function persistPendingDetectionState(file, detectionResponse) {
    const store = global.AIclipsePendingDetectionStore;
    if (!store || typeof store.save !== "function") {
      throw new Error("IndexedDB pending detection store unavailable");
    }

    const saved = await store.save({ file, detectionResponse });
    if (!saved) {
      throw new Error("Failed to persist pending detection state");
    }

    return { storage: "indexeddb" };
  }

  async function loadPendingDetectionState() {
    const store = global.AIclipsePendingDetectionStore;
    if (!store || typeof store.load !== "function") {
      throw new Error("IndexedDB pending detection store unavailable");
    }

    const record = await store.load();
    const token = record?.detectionResponse?.detection_token || "";
    if (!(record && record.file && record.detectionResponse && token)) return null;

    const file =
      record.file instanceof File
        ? record.file
        : new File([record.file], "upload.jpg", {
            type: record.file?.type || "image/jpeg",
          });

    return {
      file,
      previewUrl: URL.createObjectURL(file),
      source: "indexeddb",
      token,
      response: record.detectionResponse,
    };
  }

  function clamp(n, min, max) {
    n = Number(n);
    if (!Number.isFinite(n)) n = 0;
    return Math.max(min, Math.min(max, n));
  }

  function setImageSrcSafe(imgEl, url) {
    if (!imgEl) return;

    if (typeof url !== "string") {
      imgEl.removeAttribute("src");
      return;
    }

    const lowerUrl = url.toLowerCase().trim();
    const isBlob = lowerUrl.startsWith("blob:");
    const isData = lowerUrl.startsWith("data:");

    if (isBlob) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "blob:") {
          imgEl.removeAttribute("src");
          return;
        }
      } catch {
        imgEl.removeAttribute("src");
        return;
      }
    } else if (isData) {
      const dataUrlRegex = /^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/i;
      if (!dataUrlRegex.test(url)) {
        imgEl.removeAttribute("src");
        return;
      }
    } else {
      imgEl.removeAttribute("src");
      return;
    }

    imgEl.setAttribute("src", url);
  }

  function getLimitMessage(payload) {
    if (!payload || typeof payload !== "object") return null;

    const detail = payload.detail;

    if (detail && typeof detail === "object") {
      if (typeof detail.message === "string" && detail.message.trim()) {
        return detail.message;
      }
      if (typeof detail.error === "string" && detail.error.trim()) {
        return detail.error;
      }
    }

    if (typeof detail === "string" && detail.trim()) return detail;
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }

    return null;
  }

  function isUsageLimitExceeded(statusCode, payload) {
    const detail = payload && typeof payload === "object" ? payload.detail : null;
    const errorCode =
      detail && typeof detail === "object" && typeof detail.error === "string"
        ? detail.error
        : null;

    return statusCode === 403 && errorCode === "usage_limit_exceeded";
  }

  global.AIclipseDetectionFlowShared = {
    clearPendingDetectionState,
    clamp,
    getLimitMessage,
    isUsageLimitExceeded,
    jsonFetch,
    loadCurrentUserContext,
    loadPendingDetectionState,
    persistPendingDetectionState,
    setCurrentUserChip,
    setDebug,
    setImageSrcSafe,
    setStatus,
  };
})(window);
