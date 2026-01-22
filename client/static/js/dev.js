// static/js/dev.js
function setStatus(el, type, text) {
  if (!el) return;
  el.innerHTML = "";
  if (!text) return;

  const span = document.createElement("span");
  span.textContent = text;
  span.classList.add(
    type === "success" ? "status-success" :
    type === "error" ? "status-error" :
    "status-info"
  );
  el.appendChild(span);
}

function setDebug(data) {
  const pre = document.getElementById("debug-output");
  if (!pre) return;
  pre.textContent = JSON.stringify(data, null, 2);
}

function setCurrentUserChip(user) {
  const chip = document.getElementById("current-user-chip");
  if (!chip) return;

  if (!user) {
    chip.textContent = "Not signed in";
    chip.classList.remove("success");
    return;
  }

  chip.textContent = `${user.user_name || user.email || "User"} · plan ${user.plan ?? "?"}`;
  chip.classList.add("success");
}

async function jsonFetch(method, url, body) {
  const opts = { method, headers: { Accept: "application/json" }, credentials: "include" };
  if (body !== undefined && body !== null) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { data = { detail: "Non-JSON response" }; }

  setDebug({ url, status: res.status, body: data });
  return { res, data };
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function safeText(v) {
  return (v === undefined || v === null) ? "" : String(v);
}

function fmtDate(v) {
  const s = safeText(v);
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toISOString().replace("T", " ").replace("Z", " UTC");
}

function maskKeyRow(item) {
  const prefix = item.prefix || item.key_prefix || item.first6 || "";
  const last4 = item.last4 || item.key_last4 || item.last_4 || "";
  if (prefix && last4) return `${prefix}…${last4}`;
  if (last4) return `****${last4}`;
  if (item.key_id || item.id || item.kid) return `id:${item.key_id || item.id || item.kid}`;
  return "—";
}

function isRevoked(item) {
  if (typeof item.revoked === "boolean") return item.revoked;
  if (typeof item.is_revoked === "boolean") return item.is_revoked;
  if (typeof item.active === "boolean") return !item.active;
  return false;
}

function buildCurl(origin, apiKey) {
  const key = apiKey ? apiKey : "YOUR_API_KEY";
  return [
    `curl -X POST "${origin}/api/v1/checks" \\`,
    `  -H "X-Api-Key: ${key}" \\`,
    `  -F "file=@image.jpg"`
  ].join("\n");
}

window.addEventListener("DOMContentLoaded", async () => {
  // Ensure partials are in DOM (topbar/navbar)
  if (typeof window.loadPartials === "function") {
    try { await window.loadPartials(); } catch {}
  }

  const devStatus = document.getElementById("dev-status");

  const apiKeyInput = document.getElementById("api-key-input");
  const btnGenerate = document.getElementById("btn-generate-key");
  const btnRefresh = document.getElementById("btn-refresh-keys");

  const newKeyWrap = document.getElementById("new-key-wrap");
  const newApiKeyEl = document.getElementById("new-api-key");
  const newKeyMeta = document.getElementById("new-key-meta");
  const btnCopyKey = document.getElementById("btn-copy-key");

  const keysEmpty = document.getElementById("keys-empty");
  const keysTable = document.getElementById("keys-table");
  const keysTbody = document.getElementById("keys-tbody");

  const usageCurl = document.getElementById("usage-curl");
  const btnCopyCurl = document.getElementById("btn-copy-curl");

  const testFile = document.getElementById("test-file");
  const btnTest = document.getElementById("btn-test-call");
  const testState = document.getElementById("test-state");
  const testStatus = document.getElementById("test-status");
  const testResult = document.getElementById("test-result");

  const KEYS_BASE = "/auth/api-keys";
  const API_CHECK_URL = "/api/v1/checks";

  function currentKey() {
    return safeText(apiKeyInput && apiKeyInput.value).trim();
  }

  function syncCurl() {
    const origin = window.location.origin;
    if (usageCurl) usageCurl.textContent = buildCurl(origin, currentKey());
  }

  function syncTestUI() {
    const hasKey = !!currentKey();
    const hasFile = !!(testFile && testFile.files && testFile.files[0]);
    if (btnTest) btnTest.disabled = !(hasKey && hasFile);

    if (testState) {
      if (!hasFile && !hasKey) testState.textContent = "Select a file and provide an API key.";
      else if (!hasFile) testState.textContent = "Select a file to enable the test.";
      else if (!hasKey) testState.textContent = "Provide an API key to enable the test.";
      else testState.textContent = "Ready.";
    }
  }

  async function loadMe() {
    try {
      const { res, data } = await jsonFetch("GET", "/auth/me");
      if (res.ok) {
        setCurrentUserChip(data);
        setStatus(devStatus, "info", "");
        return true;
      }
      setCurrentUserChip(null);
      setStatus(devStatus, "error", "Sign in to manage API keys.");
      return false;
    } catch {
      setCurrentUserChip(null);
      setStatus(devStatus, "error", "Failed to reach server.");
      return false;
    }
  }

  function renderKeys(items) {
    if (!keysEmpty || !keysTable || !keysTbody) return;

    keysTbody.innerHTML = "";
    if (!Array.isArray(items) || items.length === 0) {
      keysEmpty.textContent = "No keys found.";
      keysEmpty.hidden = false;
      keysTable.hidden = true;
      return;
    }

    keysEmpty.hidden = true;
    keysTable.hidden = false;

    for (const item of items) {
      const tr = document.createElement("tr");

      const tdKey = document.createElement("td");
      tdKey.textContent = maskKeyRow(item);

      const tdCreated = document.createElement("td");
      tdCreated.textContent = fmtDate(item.created_at || item.createdAt);

      const tdLastUsed = document.createElement("td");
      tdLastUsed.textContent = fmtDate(item.last_used_at || item.lastUsedAt);

      const tdStatus = document.createElement("td");
      tdStatus.textContent = isRevoked(item) ? "revoked" : "active";

      const tdAct = document.createElement("td");
      const id = item.key_id || item.id || item.kid;
      if (!isRevoked(item) && id) {
        const btn = document.createElement("button");
        btn.textContent = "Revoke";
        btn.className = "secondary";
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          setStatus(devStatus, "info", "Revoking…");
          try {
            const { res, data } = await jsonFetch("DELETE", `${KEYS_BASE}/${encodeURIComponent(id)}`);
            if (res.ok) {
              setStatus(devStatus, "success", "Key revoked.");
              await refreshKeys();
            } else {
              setStatus(devStatus, "error", data.detail || `Revoke failed (${res.status})`);
            }
          } catch {
            setStatus(devStatus, "error", "Network error while revoking.");
          } finally {
            btn.disabled = false;
          }
        });
        tdAct.appendChild(btn);
      } else {
        tdAct.textContent = "—";
      }

      tr.appendChild(tdKey);
      tr.appendChild(tdCreated);
      tr.appendChild(tdLastUsed);
      tr.appendChild(tdStatus);
      tr.appendChild(tdAct);
      keysTbody.appendChild(tr);
    }
  }

  async function refreshKeys() {
    setStatus(devStatus, "info", "Loading keys…");
    try {
      const { res, data } = await jsonFetch("GET", KEYS_BASE);
      if (!res.ok) {
        setStatus(devStatus, "error", data.detail || `Failed to load keys (${res.status})`);
        renderKeys([]);
        return;
      }

      const items = Array.isArray(data) ? data : (data.items || data.keys || []);
      renderKeys(items);
      setStatus(devStatus, "info", "");
    } catch {
      setStatus(devStatus, "error", "Network error while loading keys.");
      renderKeys([]);
    }
  }

  async function generateKey() {
    setStatus(devStatus, "info", "Generating…");
    if (newKeyWrap) newKeyWrap.hidden = true;

    try {
      const { res, data } = await jsonFetch("POST", KEYS_BASE, {});
      if (!res.ok) {
        setStatus(devStatus, "error", data.detail || `Generate failed (${res.status})`);
        return;
      }

      const apiKey = data.api_key || data.key || data.token || "";
      const keyId = data.key_id || data.id || data.kid || "";
      const prefix = data.prefix || data.key_prefix || "";
      const last4 = data.last4 || data.key_last4 || "";
      const createdAt = data.created_at || data.createdAt || "";

      if (newApiKeyEl) newApiKeyEl.value = apiKey;
      if (apiKeyInput) apiKeyInput.value = apiKey;
      syncCurl();
      syncTestUI();

      if (newKeyMeta) {
        const parts = [];
        if (keyId) parts.push(`id: ${keyId}`);
        if (prefix || last4) parts.push(`masked: ${prefix ? prefix + "…" : "****"}${last4 || ""}`);
        if (createdAt) parts.push(`created: ${fmtDate(createdAt)}`);
        newKeyMeta.textContent = parts.join(" · ");
      }

      if (newKeyWrap) newKeyWrap.hidden = false;

      setStatus(devStatus, "success", "New key generated. Copy it now.");
      await refreshKeys();
    } catch {
      setStatus(devStatus, "error", "Network error while generating key.");
    }
  }

  async function testCall() {
    const key = currentKey();
    const file = testFile && testFile.files && testFile.files[0];
    if (!key || !file) return;

    setStatus(testStatus, "info", "Sending…");
    if (testResult) testResult.textContent = "…";

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch(API_CHECK_URL, {
        method: "POST",
        headers: { "X-Api-Key": key, "Accept": "application/json" },
        body: form,
        credentials: "omit"
      });

      let data = null;
      try { data = await res.json(); } catch { data = { detail: "Non-JSON response" }; }
      setDebug({ url: API_CHECK_URL, status: res.status, body: data });

      if (testResult) testResult.textContent = JSON.stringify(data, null, 2);

      if (res.ok) setStatus(testStatus, "success", "OK");
      else setStatus(testStatus, "error", (data.detail || `Failed (${res.status})`));
    } catch {
      setStatus(testStatus, "error", "Network error.");
      if (testResult) testResult.textContent = "Network error.";
    }
  }

  if (apiKeyInput) apiKeyInput.addEventListener("input", () => { syncCurl(); syncTestUI(); });
  if (testFile) testFile.addEventListener("change", syncTestUI);

  if (btnCopyCurl) {
    btnCopyCurl.addEventListener("click", async () => {
      const ok = await copyToClipboard(usageCurl ? usageCurl.textContent : "");
      setStatus(devStatus, ok ? "success" : "error", ok ? "curl copied." : "Copy failed.");
    });
  }

  if (btnCopyKey) {
    btnCopyKey.addEventListener("click", async () => {
      const ok = await copyToClipboard(newApiKeyEl ? newApiKeyEl.value : "");
      setStatus(devStatus, ok ? "success" : "error", ok ? "Key copied." : "Copy failed.");
    });
  }

  if (btnRefresh) btnRefresh.addEventListener("click", refreshKeys);
  if (btnGenerate) btnGenerate.addEventListener("click", generateKey);
  if (btnTest) btnTest.addEventListener("click", testCall);

  syncCurl();
  syncTestUI();

  const authed = await loadMe();
  if (authed) await refreshKeys();
});
