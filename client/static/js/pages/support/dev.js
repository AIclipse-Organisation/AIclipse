const { jsonFetch } = window.AIclipseHttp;
const { render: setStatus } = window.AIclipseStatus;
const { copyToClipboard } = window.AIclipseSupportShared;

function syncCurrentUser(user) {
  window.AuthUI.setUser(user);
}

function clearCurrentUser() {
  window.AuthUI.clear();
}

window.addEventListener("DOMContentLoaded", async () => {
  const devStatus = document.getElementById("dev-status");
  const btnRotate = document.getElementById("btn-rotate-key");

  const newKeyWrap = document.getElementById("new-key-wrap");
  const newApiKeyEl = document.getElementById("new-api-key");
  const btnCopyKey = document.getElementById("btn-copy-key");

  const API_KEY_ENDPOINT = "/auth/api-key";

  function hideKey() {
    if (newApiKeyEl) newApiKeyEl.value = "";
    if (newKeyWrap) newKeyWrap.hidden = true;
  }

  async function requireAuth() {
    try {
      const { res, data } = await jsonFetch("GET", "/auth/me");
      if (!res.ok) {
        clearCurrentUser();
        setStatus(devStatus, "error", "Sign in to manage your API key.");
        return false;
      }
      syncCurrentUser(data);
      setStatus(devStatus, "info", "");
      return true;
    } catch {
      clearCurrentUser();
      setStatus(devStatus, "error", "Failed to reach server.");
      return false;
    }
  }

  async function rotateKey() {
    hideKey();
    setStatus(devStatus, "info", "Generating key…");

    const { res, data } = await jsonFetch("POST", API_KEY_ENDPOINT, {});
    if (!(res.ok || res.status === 201)) {
      throw new Error(data?.detail || `Failed to create key (${res.status})`);
    }

    const apiKey = data.api_key || data.key || data.token || "";
    if (!apiKey) throw new Error("Create response missing api_key");

    if (newApiKeyEl) newApiKeyEl.value = apiKey;
    if (newKeyWrap) newKeyWrap.hidden = false;

    setStatus(devStatus, "success", "New key generated. Copy it now.");
  }

  // Wire up
  if (btnCopyKey) {
    btnCopyKey.addEventListener("click", async () => {
      const key = newApiKeyEl ? newApiKeyEl.value : "";
      const ok = await copyToClipboard(key);
      setStatus(devStatus, ok ? "success" : "error", ok ? "Copied." : "Copy failed.");
    });
  }

  if (btnRotate) {
    btnRotate.addEventListener("click", async () => {
      btnRotate.disabled = true;
      try {
        const authed = await requireAuth();
        if (!authed) return;
        await rotateKey();
      } catch (e) {
        setStatus(devStatus, "error", e?.message || "Rotate failed.");
      } finally {
        btnRotate.disabled = false;
      }
    });
  }

  // Init
  hideKey();
  const authed = await requireAuth();
  if (btnRotate) btnRotate.disabled = !authed;
});
