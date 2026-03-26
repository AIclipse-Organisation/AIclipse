const { fetch: originalFetch } = window;

function _getFetchUrl(input) {
  try {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    if (input && typeof input.url === "string") return input.url; // Request-like
  } catch {}
  return "";
}

function _loaderShow(message) {
  if (window.AppLoader && typeof window.AppLoader.show === "function") {
    window.AppLoader.show(message);
  }
}

function _loaderHide() {
  if (window.AppLoader && typeof window.AppLoader.hide === "function") {
    window.AppLoader.hide();
  }
}

window.fetch = async (...args) => {
  const url = _getFetchUrl(args[0]);
  const isApiCall = url.includes("/api/") || url.includes("/scan");

  if (isApiCall) _loaderShow("Analyzing Image...");

  try {
    const response = await originalFetch(...args);
    return response;
  } finally {
    if (isApiCall) _loaderHide();
  }
};

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("form").forEach((form) => {
    form.addEventListener("submit", () => {
      _loaderShow("Processing...");
    });
  });

  document.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      const href = link.getAttribute("href");
      if (href && !href.startsWith("#") && !link.target) {
        _loaderShow("Loading...");
      }
    });
  });
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    _loaderHide();
  }
});

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
      : "status-info",
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

  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] || {};
    const loc = Array.isArray(first.loc) ? first.loc.join(".") : null;
    const msg = typeof first.msg === "string" ? first.msg : "Validation error";
    return {
      message: loc ? `${loc}: ${msg}` : msg,
      checks: null,
      code: null,
    };
  }

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

function parseDobDayMonthYear(dobString) {
  const raw = String(dobString || "").trim();
  const match = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const dob = new Date(year, month - 1, day);

  if (
    Number.isNaN(dob.getTime()) ||
    dob.getFullYear() !== year ||
    dob.getMonth() !== month - 1 ||
    dob.getDate() !== day
  ) {
    return null;
  }

  return dob;
}

function ageFromDobString(dobString) {
  const dob = parseDobDayMonthYear(dobString);
  if (!dob) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > dob.getMonth() ||
    (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
  if (!hasBirthdayPassed) age -= 1;
  return age;
}

window.lastFile = window.lastFile ?? null;
window.lastDetectionToken = window.lastDetectionToken ?? null;
window._lastObjectUrl = window._lastObjectUrl ?? null;

window.addEventListener("DOMContentLoaded", () => {
  const fileInputs = document.querySelectorAll('input[type="file"]');
  fileInputs.forEach((input) => {
    if (input.dataset.reselectBound === "1") return;
    input.dataset.reselectBound = "1";
    input.addEventListener("click", () => {
      input.value = "";
    });
  });

  const loginContent = document.getElementById("login-content");
  const loginSpinner = document.getElementById("login-spinner-container");
  const signupPanel = document.querySelector('[data-panel="signup"]');
  const loginPanel = document.querySelector('[data-panel="login"]');
  const signupStatus = document.getElementById("signup-status");
  const loginStatus = document.getElementById("login-status");
  const switchLinks = document.querySelectorAll(".auth-link");

  const signupPasswordInput = document.getElementById("signup-password");
  const signupPolicyRoot = document.getElementById("signup-password-policy");
  const signupDobInput = document.getElementById("signup-date-of-birth");
  const signupHowFoundSelect = document.getElementById("signup-how-found");
  const signupHowFoundDetailLabel = document.getElementById("signup-how-found-detail-label");
  const signupHowFoundDetail = document.getElementById("signup-how-found-detail");

  const signupTerms = document.getElementById("signup-terms");
  const btnSignup = document.getElementById("btn-signup");

  let policyActivated = false;

  if (signupPolicyRoot) signupPolicyRoot.hidden = true;

  function syncSignupButtonState() {
    if (!btnSignup) return;
    btnSignup.disabled = signupTerms ? !signupTerms.checked : false;
  }

  function switchAuthMode(mode) {
    if (mode === "signup") {
      if (signupPanel) signupPanel.style.display = "block";
      if (loginPanel) loginPanel.style.display = "none";
    } else {
      if (signupPanel) signupPanel.style.display = "none";
      if (loginPanel) loginPanel.style.display = "block";
    }

    if (signupStatus) signupStatus.innerHTML = "";
    if (loginStatus) loginStatus.innerHTML = "";
  }

  if (switchLinks.length > 0) {
    switchLinks.forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const mode = link.getAttribute("data-mode");
        switchAuthMode(mode);
      });
    });
  }

  switchAuthMode("login");

  if (signupTerms) {
    signupTerms.addEventListener("change", syncSignupButtonState);
    syncSignupButtonState();
  }

  if (signupDobInput) {
    signupDobInput.addEventListener("input", () => {
      const digits = String(signupDobInput.value || "").replace(/\D/g, "").slice(0, 8);
      const parts = [];
      if (digits.length > 0) parts.push(digits.slice(0, Math.min(2, digits.length)));
      if (digits.length > 2) parts.push(digits.slice(2, Math.min(4, digits.length)));
      if (digits.length > 4) parts.push(digits.slice(4, 8));
      signupDobInput.value = parts.join("-");
    });
  }

  if (signupHowFoundSelect) {
    const syncHowFoundDetailVisibility = () => {
      const isOther = signupHowFoundSelect.value === "other";
      if (signupHowFoundDetailLabel) {
        signupHowFoundDetailLabel.style.display = isOther ? "block" : "none";
      }
      if (signupHowFoundDetail) {
        signupHowFoundDetail.style.display = isOther ? "block" : "none";
        if (!isOther) signupHowFoundDetail.value = "";
      }
    };

    signupHowFoundSelect.addEventListener("change", syncHowFoundDetailVisibility);
    syncHowFoundDetailVisibility();
  }

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

  onEl("btn-signup", (btnSignupEl) => {
    btnSignupEl.addEventListener("click", async (event) => {
      event.preventDefault();
      const user_name = document.getElementById("signup-username")?.value.trim();
      const email = document.getElementById("signup-email")?.value.trim();
      const dateOfBirthRaw = document.getElementById("signup-date-of-birth")?.value;
      const password = document.getElementById("signup-password")?.value;
      const howDidYouFindUs = document.getElementById("signup-how-found")?.value;
      const howDidYouFindUsDetail = document.getElementById("signup-how-found-detail")?.value?.trim();

      const termsAccepted = document.getElementById("signup-terms")?.checked;
      if (!termsAccepted) {
        setStatus(signupStatus, "error", "You must accept the Terms & Conditions to sign up.");
        return;
      }

      let requestSubmitted = false;

      activateSignupPolicyIfNeeded();

      if (!user_name || !email || !password || !String(dateOfBirthRaw || "").trim() || !howDidYouFindUs) {
        setStatus(signupStatus, "error", "Please fill username, email, date of birth, password and how you found us.");
        updateSignupPolicyUI();
        return;
      }

      if (howDidYouFindUs === "other" && !String(howDidYouFindUsDetail || "").trim()) {
        setStatus(signupStatus, "error", "Please elaborate on how you found us.");
        return;
      }

      if (!/^\d{2}-\d{2}-\d{4}$/.test(String(dateOfBirthRaw))) {
        setStatus(signupStatus, "error", "Date of birth must be in DD-MM-YYYY format.");
        return;
      }

      const age = ageFromDobString(String(dateOfBirthRaw));
      if (!Number.isInteger(age)) {
        setStatus(signupStatus, "error", "Please provide a valid date of birth.");
        return;
      }
      if (age < 18) {
        setStatus(signupStatus, "error", "Must be 18 or older.");
        return;
      }
      if (age > 150) {
        setStatus(signupStatus, "error", "Please provide a valid date of birth.");
        return;
      }

      if (signupPolicyRoot) {
        const checks = evaluatePasswordPolicy(password);
        applyPasswordPolicyUI(signupPolicyRoot, password, checks);
        if (!isPasswordPolicyOk(checks)) {
          setStatus(signupStatus, "error", "Password does not meet requirements.");
          return;
        }
      }

      if (signupPanel) signupPanel.style.display = "none";
      if (loginSpinner) loginSpinner.style.display = "block";

      btnSignupEl.disabled = true;
      setStatus(signupStatus, "info", "Submitting access request...");

      try {
        const { res, data } = await jsonFetch("POST", "/auth/signup", {
          user_name,
          email,
          date_of_birth: dateOfBirthRaw,
          password,
          how_did_you_find_us: howDidYouFindUs,
          how_did_you_find_us_detail: howDidYouFindUsDetail || null,
        });

          if (res.ok) {
            requestSubmitted = true;

            if (loginSpinner) loginSpinner.style.display = "none";
            if (signupPanel) signupPanel.style.display = "block";
            if (loginPanel) loginPanel.style.display = "none";

            setStatus(
              signupStatus,
              "success",
              data?.message || "Thank you. An admin will review your request and contact you soon.",
            );
          } else {
          const normalized = normalizeApiErrorDetail(data);

          if (signupPolicyRoot && normalized.checks) {
            applyPasswordPolicyUI(signupPolicyRoot, password, normalized.checks);
          } else {
            updateSignupPolicyUI();
          }

          switchAuthMode("signup");

          setStatus(
            signupStatus,
            "error",
            normalized.message || `Signup failed (${res.status})`,
          );
        }
      } catch (err) {
        console.error(err);
        switchAuthMode("signup");
        setStatus(signupStatus, "error", "Network error during signup.");
      } finally {
        if (!requestSubmitted) {
          btnSignupEl.disabled = false;
          if (loginSpinner) loginSpinner.style.display = "none";
        }
      }
    });
  });

  onEl("btn-login", (btnLogin) => {
    btnLogin.addEventListener("click", async (event) => {
      event.preventDefault();
      const email = document.getElementById("login-email")?.value.trim();
      const password = document.getElementById("login-password")?.value;

      if (!email || !password) {
        setStatus(loginStatus, "error", "Please fill email and password.");
        return;
      }

      if (loginContent) loginContent.style.display = "none";
      if (loginSpinner) loginSpinner.style.display = "block";
      setStatus(loginStatus, "info", "");

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
          setStatus(loginStatus, "success", "Logged in.");
          setCurrentUserChip(data.user);
          window.location.href = "/upload";
        } else {
          if (loginContent) loginContent.style.display = "block";
          if (loginSpinner) loginSpinner.style.display = "none";

          const normalized = normalizeApiErrorDetail(data);
          setStatus(
            loginStatus,
            "error",
            normalized.message || `Login failed (${res.status})`,
          );
          setCurrentUserChip(null);
        }
      } catch (err) {
        console.error(err);
        if (loginContent) loginContent.style.display = "block";
        if (loginSpinner) loginSpinner.style.display = "none";
        setStatus(loginStatus, "error", "Network error during login.");
        setCurrentUserChip(null);
      } finally {
        btnLogin.disabled = false;
      }
    });
  });
});