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

function setCurrentUserChip(user) {
  const chip = document.getElementById("current-user-chip");
  if (!chip) return;

  if (!user) {
    chip.textContent = "Not signed in";
    chip.classList.remove("success");
    return;
  }

  chip.textContent = user.user_name || user.email || "User";
  chip.classList.add("success");
}

async function jsonFetch(method, url, body) {
  const opts = {
    method,
    headers: { Accept: "application/json" },
    credentials: "include",
  };

  if (body !== undefined && body !== null) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { detail: "Non-JSON response" };
  }
  return { res, data };
}

async function copyToClipboard(text) {
  if (!text) return false;

  // Modern clipboard API, requires secure context
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy method
  }

  // Legacy fallback, works on http in most browsers
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
  // Ensure partials are in DOM
  if (typeof window.loadPartials === "function") {
    try {
      await window.loadPartials();
    } catch {}
  }

  const devStatus = document.getElementById("dev-status");
  const btnRotate = document.getElementById("btn-rotate-key");

  const newKeyWrap = document.getElementById("new-key-wrap");
  const newApiKeyEl = document.getElementById("new-api-key");
  const btnCopyKey = document.getElementById("btn-copy-key");

  const KEYS_LIST = "/auth/api-keys";
  const KEYS_CREATE = "/auth/api-keys";
  const KEY_REVOKE = (keyId) => `/auth/api-keys/${encodeURIComponent(keyId)}/revoke`;

  function hideKey() {
    if (newApiKeyEl) newApiKeyEl.value = "";
    if (newKeyWrap) newKeyWrap.hidden = true;
  }

  async function requireAuth() {
    try {
      const { res, data } = await jsonFetch("GET", "/auth/me");
      if (!res.ok) {
        setCurrentUserChip(null);
        setStatus(devStatus, "error", "Sign in to manage your API key.");
        return false;
      }
      setCurrentUserChip(data);
      setStatus(devStatus, "info", "");
      return true;
    } catch {
      setCurrentUserChip(null);
      setStatus(devStatus, "error", "Failed to reach server.");
      return false;
    }
  }

  async function listKeys() {
    const { res, data } = await jsonFetch("GET", KEYS_LIST);
    if (!res.ok) throw new Error(data?.detail || `Failed to load keys (${res.status})`);
    return Array.isArray(data) ? data : (data.items || []);
  }

  function isActiveKey(item) {
    // Auth returns revoked_at when revoked; treat missing/empty as active
    return !item.revoked_at && !item.revokedAt;
  }

  function getKeyId(item) {
    return item.key_id || item.keyId || item.id || item.kid || "";
  }

  async function revokeKey(keyId) {
    const { res, data } = await jsonFetch("POST", KEY_REVOKE(keyId), {});
    if (!res.ok) throw new Error(data?.detail || `Failed to revoke (${res.status})`);
  }

  async function createKey() {
    const { res, data } = await jsonFetch("POST", KEYS_CREATE, {});
    if (!(res.ok || res.status === 201)) {
      throw new Error(data?.detail || `Failed to create key (${res.status})`);
    }
    const apiKey = data.api_key || data.key || data.token || "";
    if (!apiKey) throw new Error("Create response missing api_key");
    return apiKey;
  }

  async function rotateKey() {
    hideKey();
    setStatus(devStatus, "info", "Rotating key…");

    // 1) Load existing keys
    const items = await listKeys();
    const active = items.filter(isActiveKey).map(getKeyId).filter(Boolean);

    // 2) Revoke all active keys (must succeed before creating new key)
    for (const id of active) {
      await revokeKey(id);
    }

    // 3) Create new key (shown once)
    const apiKey = await createKey();
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
