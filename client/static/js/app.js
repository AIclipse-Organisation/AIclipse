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

window.addEventListener("DOMContentLoaded", () => {
  let lastDetectionToken = null;
  let lastFile = null;
  let _lastObjectUrl = null;

  const loginContent = document.getElementById("login-content");
  const loginSpinner = document.getElementById("login-spinner-container");
  const signupPanel = document.querySelector('[data-panel="signup"]');
  const loginPanel = document.querySelector('[data-panel="login"]');
  const accountStatus = document.getElementById("account-status");
  const tabs = document.querySelectorAll(".auth-tab");
  const authToggleContainer = document.querySelector(".auth-toggle");

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

  onEl("file-input", (fileInput) => {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      lastFile = file || null;
      window.lastFile = lastFile;
      lastDetectionToken = null;

      const btnCheck = document.getElementById("btn-check");
      const checkState = document.getElementById("check-state");
      const detectResult = document.getElementById("detect-result");

      if (file) {
        if (btnCheck) btnCheck.disabled = false;
        if (checkState) checkState.textContent = `Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`;
        if (detectResult) detectResult.textContent = "No detection yet for this file.";
      } else {
        if (btnCheck) btnCheck.disabled = true;
        if (checkState) checkState.textContent = "Select a file to enable detection.";
        if (detectResult) detectResult.textContent = "No detection yet.";
      }
    });
  });

  onEl("btn-signup", (btnSignup) => {
    btnSignup.addEventListener("click", async () => {
      const user_name = document.getElementById("signup-username")?.value.trim();
      const email = document.getElementById("signup-email")?.value.trim();
      const password = document.getElementById("signup-password")?.value;
      let loginSuccess = false; // Flag to stop UI reset if redirecting

      if (!user_name || !email || !password) {
        setStatus(accountStatus, "error", "Please fill username, email and password.");
        return;
      }

      // Hide UI components
      if (signupPanel) signupPanel.style.display = "none";
      if (authToggleContainer) authToggleContainer.style.display = "none";
      if (loginSpinner) loginSpinner.style.display = "block";
      
      btnSignup.disabled = true;
      setStatus(accountStatus, "info", "Creating account...");

      try {
        const { res, data } = await jsonFetch("POST", "/auth/signup", { user_name, email, password });
        
        if (res.ok) {
          // --- AUTO LOGIN START ---
          setStatus(accountStatus, "info", "Account created. Logging in...");
          
          const loginRes = await fetch("/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ email, password }),
          });

          let loginData = {};
          try { loginData = await loginRes.json(); } catch {}

          if (loginRes.ok && loginData.user) {
            loginSuccess = true; // Success! Don't restore the signup form
            setStatus(accountStatus, "success", "Logged in. Redirecting...");
            setCurrentUserChip(loginData.user);
            window.location.href = "/community";
          } else {
            setStatus(accountStatus, "error", "Account created, but auto-login failed. Please log in manually.");
          }
          // --- AUTO LOGIN END ---

        } else {
          setStatus(accountStatus, "error", data.detail || `Signup failed (${res.status})`);
        }
      } catch (err) {
        console.error(err);
        setStatus(accountStatus, "error", "Network error during signup.");
      } finally {
        // Only restore the signup form if we aren't successfully redirecting
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
          body: JSON.stringify({ email, password }),
        });

        let data = null;
        try { data = await res.json(); } catch { data = { detail: "Non-JSON response" }; }
        setDebug({ url: "/auth/login", status: res.status, body: data });

        if (res.ok && data.user) {
          setStatus(accountStatus, "success", "Logged in.");
          setCurrentUserChip(data.user);
          window.location.href = "/community";
        } else {
          if (loginContent) loginContent.style.display = "block";
          if (authToggleContainer) authToggleContainer.style.display = "";
          if (loginSpinner) loginSpinner.style.display = "none";
          setStatus(accountStatus, "error", data.detail || `Login failed (${res.status})`);
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

  onEl("btn-logout", (btnLogout) => {
    btnLogout.addEventListener("click", async () => {
      setStatus(accountStatus, "info", "Logging out...");
      try {
        const { res, data } = await jsonFetch("POST", "/logout", null);
        if (res.ok) setStatus(accountStatus, "success", "Logged out.");
        else setStatus(accountStatus, "error", data.detail || `Logout failed (${res.status})`);
      } catch (err) {
        console.error(err);
        setStatus(accountStatus, "error", "Network error during logout.");
      } finally {
        setCurrentUserChip(null);
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
        try { data = await res.json(); } catch { data = { detail: "Non-JSON response" }; }

        setDebug({ url: "/checks", status: res.status, body: data });

        if (res.ok) {
          lastDetectionToken = data.detection_token || null;
          if (detectResult) detectResult.textContent = JSON.stringify(data, null, 2);
          renderDetection(data);
          setStatus(detectStatus, "success", "Detection completed.");
        } else {
          if (detectResult) detectResult.textContent = JSON.stringify(data, null, 2);
          setStatus(detectStatus, "error", data.detail || `Detection failed (${res.status})`);
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
    const card = document.getElementById('detect-card');
    const thumb = document.getElementById('detect-thumb');
    const verdict = document.getElementById('detect-verdict');
    const confLabel = document.getElementById('detect-confidence');
    const rawPre = document.getElementById('detect-result');

    if (!card || !verdict || !confLabel || !rawPre) return;

    const label = (resp.label || resp.result || 'Unknown').toString();
    const confidence = Number.isFinite(resp.confidence) ? resp.confidence : (resp.score || 0);
    const labelLower = label.toLowerCase();
    const isAi = labelLower.includes('ai');
    const ai_prob = isAi ? confidence : (1 - confidence);
    const real_prob = 1 - ai_prob;

    let labelClass = 'label-neutral';
    if (labelLower.includes('ai')) {
      labelClass = labelLower.includes('most likely') ? 'label-strong-ai' : 'label-medium-ai';
    } else if (labelLower.includes('real')) {
      labelClass = labelLower.includes('most likely') ? 'label-strong-real' : 'label-medium-real';
    }

    if (window.lastFile) {
      if (_lastObjectUrl) URL.revokeObjectURL(_lastObjectUrl);
      _lastObjectUrl = URL.createObjectURL(window.lastFile);
      if (thumb) thumb.src = _lastObjectUrl;
    }

    verdict.textContent = label;
    verdict.className = `verdict-text ${labelClass}`;
    confLabel.textContent = `Confidence: ${(confidence * 100).toFixed(1)}%`;

    const realFill = document.querySelector('.real-fill');
    const aiFill = document.querySelector('.ai-fill');
    if (realFill) realFill.style.width = `${(real_prob * 100).toFixed(2)}%`;
    if (aiFill) aiFill.style.width = `${(ai_prob * 100).toFixed(2)}%`;

    rawPre.style.display = 'none';
    card.hidden = false;
  }

  window.addEventListener('beforeunload', () => {
    if (_lastObjectUrl) URL.revokeObjectURL(_lastObjectUrl);
  });

  (async () => {
    try {
      const { res, data } = await jsonFetch("GET", "/auth/me", null);
      if (res.ok) {
        setCurrentUserChip(data);
      } else {
        setCurrentUserChip(null);
      }
    } catch {}
  })();
});