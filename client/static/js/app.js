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

function setDebug(data) {
  const pre = document.getElementById("debug-output");
  if (!pre) return;
  pre.textContent = JSON.stringify(data, null, 2);
}

function setCurrentUserChip(user) {
  if (window.AuthUI && typeof window.AuthUI.setUser === "function") {
    window.AuthUI.setUser(user);
    return;
  }

  const chip = document.getElementById("current-user-chip");
  if (!chip) return;

  if (!user) {
    chip.textContent = "Not signed in";
    chip.classList.remove("success");
    return;
  }

  chip.textContent = `${user.user_name}`;
}

async function jsonFetch(method, url, body) {
  const opts = {
    method,
    headers: {
      Accept: "application/json",
    },
    credentials: "include",
  };

  if (body != null) {
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
  setDebug({ url, status: res.status, body: data });
  return { res, data };
}

function onEl(id, callback) {
  const el = document.getElementById(id);
  if (el) callback(el);
}

function _bytesLenUtf8(s) {
  try {
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(String(s || "")).length;
    }
  } catch {}
  return String(s || "").length;
}

function evaluatePasswordPolicy(password) {
  const p = String(password || "");
  const len = _bytesLenUtf8(p);

  return {
    min_length: len >= 8,
    max_length: len <= 72,
    no_spaces: !/\s/.test(p),
    has_lowercase: /[a-z]/.test(p),
    has_uppercase: /[A-Z]/.test(p),
    has_number: /\d/.test(p),
    has_symbol: /[^A-Za-z0-9]/.test(p),
  };
}

function isPasswordPolicyOk(checks) {
  if (!checks || typeof checks !== "object") return false;
  const keys = Object.keys(checks);
  if (keys.length === 0) return false;
  return keys.every((k) => checks[k] === true);
}

function applyPasswordPolicyUI(rootEl, password, checks) {
  if (!rootEl) return;
  const p = String(password || "");
  const items = rootEl.querySelectorAll("li[data-rule]");

  items.forEach((li) => {
    const rule = li.getAttribute("data-rule");
    const ok = !!(checks && checks[rule]);

    li.classList.remove("is-neutral", "is-ok", "is-bad");

    const icon = li.querySelector(".policy-icon");
    if (!p) {
      li.classList.add("is-neutral");
      if (icon) icon.textContent = "•";
      return;
    }

    if (ok) {
      li.classList.add("is-ok");
      if (icon) icon.textContent = "✓";
      return;
    }

    li.classList.add("is-bad");
    if (icon) icon.textContent = "✕";
  });
}

function normalizeApiErrorDetail(data) {
  const detail = data && data.detail;

  if (typeof detail === "string") {
    return { message: detail, checks: null };
  }

  if (detail && typeof detail === "object") {
    return {
      message: detail.message || detail.detail || "Request failed",
      checks:
        detail.checks && typeof detail.checks === "object" ? detail.checks : null,
      code: detail.code || null,
    };
  }

  return { message: (data && data.message) || "Request failed", checks: null };
}

window.addEventListener("DOMContentLoaded", () => {
  const loginContent = document.getElementById("login-content");
  const loginSpinner = document.getElementById("login-spinner-container");
  const signupPanel = document.querySelector('[data-panel="signup"]');
  const loginPanel = document.querySelector('[data-panel="login"]');
  const accountStatus = document.getElementById("account-status");
  const tabs = document.querySelectorAll(".auth-tab");
  const authToggleContainer = document.querySelector(".auth-toggle");

  const signupPasswordInput = document.getElementById("signup-password");
  const signupPolicyRoot = document.getElementById("signup-password-policy");

  let policyActivated = false;

  if (signupPolicyRoot) signupPolicyRoot.hidden = true;

  function updateSignupPolicyUI() {
    if (!policyActivated) return;
    if (!signupPolicyRoot || !signupPasswordInput) return;

    const p = signupPasswordInput.value || "";
    applyPasswordPolicyUI(signupPolicyRoot, p, evaluatePasswordPolicy(p));
  }

  function activateSignupPolicyIfNeeded() {
    if (policyActivated) return;
    if (!signupPolicyRoot || !signupPasswordInput) return;

    policyActivated = true;
    signupPolicyRoot.hidden = false;

    updateSignupPolicyUI();

    signupPasswordInput.addEventListener("input", updateSignupPolicyUI);
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const mode = tab.getAttribute("data-mode");
      tabs.forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");

      if (mode === "signup") {
        if (signupPanel) signupPanel.style.display = "block";
        if (loginPanel) loginPanel.style.display = "none";
      } else {
        if (signupPanel) signupPanel.style.display = "none";
        if (loginPanel) loginPanel.style.display = "block";
      }
      if (accountStatus) accountStatus.innerHTML = "";
    });
  });

  onEl("btn-signup", (btnSignup) => {
    btnSignup.addEventListener("click", async () => {
      const user_name = document
        .getElementById("signup-username")
        ?.value.trim();
      const email = document.getElementById("signup-email")?.value.trim();
      const password = document.getElementById("signup-password")?.value;
      let loginSuccess = false;

      activateSignupPolicyIfNeeded();

      if (!user_name || !email || !password) {
        setStatus(accountStatus, "error", "Please fill username, email and password.");
        updateSignupPolicyUI();
        return;
      }

      if (signupPolicyRoot) {
        const checks = evaluatePasswordPolicy(password);
        applyPasswordPolicyUI(signupPolicyRoot, password, checks);
        if (!isPasswordPolicyOk(checks)) {
          setStatus(accountStatus, "error", "Password does not meet requirements.");
          return;
        }
      }

      if (signupPanel) signupPanel.style.display = "none";
      if (authToggleContainer) authToggleContainer.style.display = "none";
      if (loginSpinner) loginSpinner.style.display = "block";

      btnSignup.disabled = true;
      setStatus(accountStatus, "info", "Creating account...");

      try {
        const { res, data } = await jsonFetch("POST", "/auth/signup", {
          user_name,
          email,
          password,
        });

        if (res.ok) {
          setStatus(accountStatus, "info", "Account created. Logging in...");

          const loginRes = await fetch("/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            credentials: "include",
            body: JSON.stringify({ email, password }),
          });

          let loginData = {};
          try {
            loginData = await loginRes.json();
          } catch {}

          if (loginRes.ok && loginData.user) {
            loginSuccess = true;
            setStatus(accountStatus, "success", "Logged in. Redirecting...");
            setCurrentUserChip(loginData.user);
            window.location.href = "/community";
          } else {
            setStatus(
              accountStatus,
              "error",
              "Account created, but auto-login failed. Please log in manually."
            );
          }
        } else {
          const normalized = normalizeApiErrorDetail(data);

          if (signupPolicyRoot && normalized.checks) {
            applyPasswordPolicyUI(signupPolicyRoot, password, normalized.checks);
          } else {
            updateSignupPolicyUI();
          }

          setStatus(
            accountStatus,
            "error",
            normalized.message || `Signup failed (${res.status})`
          );
        }
      } catch (err) {
        console.error(err);
        setStatus(accountStatus, "error", "Network error during signup.");
      } finally {
        if (!loginSuccess) {
          btnSignup.disabled = false;
          if (signupPanel) signupPanel.style.display = "block";
          if (authToggleContainer) authToggleContainer.style.display = "";
          if (loginSpinner) loginSpinner.style.display = "none";
        }
      }
    });
  });

  onEl("btn-login", (btnLogin) => {
    btnLogin.addEventListener("click", async () => {
      const email = document.getElementById("login-email")?.value.trim();
      const password = document.getElementById("login-password")?.value;

      if (!email || !password) {
        setStatus(accountStatus, "error", "Please fill email and password.");
        return;
      }

      if (loginContent) loginContent.style.display = "none";
      if (authToggleContainer) authToggleContainer.style.display = "none";
      if (loginSpinner) loginSpinner.style.display = "block";
      setStatus(accountStatus, "info", "");

      try {
        const res = await fetch("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, password }),
        });

        let data = null;
        try {
          data = await res.json();
        } catch {
          data = { detail: "Non-JSON response" };
        }
        setDebug({ url: "/auth/login", status: res.status, body: data });

        if (res.ok && data.user) {
          setStatus(accountStatus, "success", "Logged in.");
          setCurrentUserChip(data.user);
          window.location.href = "/community";
        } else {
          if (loginContent) loginContent.style.display = "block";
          if (authToggleContainer) authToggleContainer.style.display = "";
          if (loginSpinner) loginSpinner.style.display = "none";

          const normalized = normalizeApiErrorDetail(data);
          setStatus(
            accountStatus,
            "error",
            normalized.message || `Login failed (${res.status})`
          );
          setCurrentUserChip(null);
        }
      } catch (err) {
        console.error(err);
        if (loginContent) loginContent.style.display = "block";
        if (authToggleContainer) authToggleContainer.style.display = "";
        if (loginSpinner) loginSpinner.style.display = "none";
        setStatus(accountStatus, "error", "Network error during login.");
        setCurrentUserChip(null);
      } finally {
        btnLogin.disabled = false;
      }
    });
  });

  onEl("btn-check", (btnCheck) => {
    btnCheck.addEventListener("click", async () => {
      const detectStatus = document.getElementById("detect-status");
      const detectResult = document.getElementById("detect-result");

      if (!lastFile) {
        setStatus(detectStatus, "error", "No file selected.");
        return;
      }

      btnCheck.disabled = true;
      lastDetectionToken = null;
      setStatus(detectStatus, "info", "Analyzing image...");

      const formData = new FormData();
      formData.append("file", lastFile);

      try {
        const res = await fetch("/checks", { method: "POST", body: formData });
        let data = null;
        try {
          data = await res.json();
        } catch {
          data = { detail: "Non-JSON response" };
        }

        setDebug({ url: "/checks", status: res.status, body: data });

        if (res.ok) {
          lastDetectionToken = data.detection_token || null;
          if (detectResult) detectResult.textContent = JSON.stringify(data, null, 2);
          renderDetection(data);
          setStatus(detectStatus, "success", "Detection completed.");
        } else {
          if (detectResult) detectResult.textContent = JSON.stringify(data, null, 2);
          setStatus(
            detectStatus,
            "error",
            data.detail || `Detection failed (${res.status})`
          );
        }
      } catch (err) {
        console.error(err);
        setStatus(detectStatus, "error", "Network error during detection.");
      } finally {
        btnCheck.disabled = false;
      }
    });
  });

  function renderDetection(resp) {
    const card = document.getElementById("detect-card");
    const thumb = document.getElementById("detect-thumb");
    const verdict = document.getElementById("detect-verdict");
    const confLabel = document.getElementById("detect-confidence");
    const rawPre = document.getElementById("detect-result");

    if (!card || !verdict || !confLabel || !rawPre) return;

    const label = (resp.label || resp.result || "Unknown").toString();
    const confidence = Number.isFinite(resp.confidence)
      ? resp.confidence
      : resp.score || 0;
    const labelLower = label.toLowerCase();
    const isAi = labelLower.includes("ai");
    const ai_prob = isAi ? confidence : 1 - confidence;
    const real_prob = 1 - ai_prob;

    let labelClass = "label-neutral";
    if (labelLower.includes("ai")) {
      labelClass = labelLower.includes("most likely")
        ? "label-strong-ai"
        : "label-medium-ai";
    } else if (labelLower.includes("real")) {
      labelClass = labelLower.includes("most likely")
        ? "label-strong-real"
        : "label-medium-real";
    }

    if (window.lastFile) {
      if (_lastObjectUrl) URL.revokeObjectURL(_lastObjectUrl);
      _lastObjectUrl = URL.createObjectURL(window.lastFile);
      if (thumb) thumb.src = _lastObjectUrl;
    }

    verdict.textContent = label;
    verdict.className = `verdict-text ${labelClass}`;
    confLabel.textContent = `Confidence: ${(confidence * 100).toFixed(1)}%`;

    const realFill = document.querySelector(".real-fill");
    const aiFill = document.querySelector(".ai-fill");
    if (realFill) realFill.style.width = `${(real_prob * 100).toFixed(2)}%`;
    if (aiFill) aiFill.style.width = `${(ai_prob * 100).toFixed(2)}%`;

    rawPre.style.display = "none";
    card.hidden = false;
  }

  window.addEventListener("beforeunload", () => {
    if (_lastObjectUrl) URL.revokeObjectURL(_lastObjectUrl);
  });
});
