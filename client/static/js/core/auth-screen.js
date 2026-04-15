const {
  ageFromDobString,
  applyPasswordPolicyUI,
  evaluatePasswordPolicy,
  isPasswordPolicyOk,
  normalizeApiErrorDetail,
  onEl,
} = window.AuthScreenHelpers;
const { jsonFetch } = window.AIclipseHttp;
const { render: setStatus } = window.AIclipseStatus;

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

  if (!loginContent && !signupPanel && !loginPanel) return;

  let policyActivated = false;
  if (signupPolicyRoot) signupPolicyRoot.hidden = true;

  function syncSignupButtonState() {
    if (!btnSignup) return;
    btnSignup.disabled = signupTerms ? !signupTerms.checked : false;
  }

  function switchAuthMode(mode) {
    const panels = document.querySelector(".auth-panels");
    if (panels) panels.dataset.mode = mode === "signup" ? "signup" : "login";
    if (loginContent) loginContent.hidden = false;
    if (loginSpinner) loginSpinner.hidden = true;

    if (signupStatus) signupStatus.innerHTML = "";
    if (loginStatus) loginStatus.innerHTML = "";
  }

  switchLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      switchAuthMode(link.getAttribute("data-mode"));
    });
  });

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
      if (signupHowFoundDetailLabel) signupHowFoundDetailLabel.hidden = !isOther;
      if (signupHowFoundDetail) {
        signupHowFoundDetail.hidden = !isOther;
        if (!isOther) signupHowFoundDetail.value = "";
      }
    };

    signupHowFoundSelect.addEventListener("change", syncHowFoundDetailVisibility);
    syncHowFoundDetailVisibility();
  }

  function updateSignupPolicyUI() {
    if (!policyActivated || !signupPolicyRoot || !signupPasswordInput) return;
    applyPasswordPolicyUI(signupPolicyRoot, signupPasswordInput.value || "", evaluatePasswordPolicy(signupPasswordInput.value || ""));
  }

  function activateSignupPolicyIfNeeded() {
    if (policyActivated || !signupPolicyRoot || !signupPasswordInput) return;
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

      if (!document.getElementById("signup-terms")?.checked) {
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
      if (!Number.isInteger(age) || age > 150) {
        setStatus(signupStatus, "error", "Please provide a valid date of birth.");
        return;
      }
      if (age < 18) {
        setStatus(signupStatus, "error", "Must be 18 or older.");
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

      switchAuthMode("login");
      if (loginContent) loginContent.hidden = true;
      if (loginSpinner) loginSpinner.hidden = false;

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
          switchAuthMode("signup");
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
          setStatus(signupStatus, "error", normalized.message || `Signup failed (${res.status})`);
        }
      } catch (err) {
        console.error(err);
        switchAuthMode("signup");
        setStatus(signupStatus, "error", "Network error during signup.");
      } finally {
        if (!requestSubmitted) {
          btnSignupEl.disabled = false;
          if (loginSpinner) loginSpinner.hidden = true;
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

      if (loginContent) loginContent.hidden = true;
      if (loginSpinner) loginSpinner.hidden = false;
      setStatus(loginStatus, "info", "");

      try {
        const { res, data } = await jsonFetch("POST", "/auth/login", { email, password }, { debugTargetId: "debug-output" });

        if (res.ok && data.user) {
          setStatus(loginStatus, "success", "Logged in.");
          window.location.href = "/upload";
        } else {
          if (loginContent) loginContent.hidden = false;
          if (loginSpinner) loginSpinner.hidden = true;
          const normalized = normalizeApiErrorDetail(data);
          setStatus(loginStatus, "error", normalized.message || `Login failed (${res.status})`);
        }
      } catch (err) {
        console.error(err);
        if (loginContent) loginContent.hidden = false;
        if (loginSpinner) loginSpinner.hidden = true;
        setStatus(loginStatus, "error", "Network error during login.");
      } finally {
        btnLogin.disabled = false;
      }
    });
  });
});


document.addEventListener("DOMContentLoaded", () => {
  const toggleButtons = document.querySelectorAll('.password-toggle');

  toggleButtons.forEach(button => {
    button.addEventListener('click', function() {
      // Find the input and icons associated with this specific button
      const wrapper = this.closest('.password-input-wrapper');
      const input = wrapper.querySelector('input');
      const eyeIcon = this.querySelector('.eye-icon');
      const eyeOffIcon = this.querySelector('.eye-off-icon');

      // Toggle the password visibility
      if (input.type === 'password') {
        input.type = 'text';
        eyeIcon.style.display = 'none';
        eyeOffIcon.style.display = 'block';
      } else {
        input.type = 'password';
        eyeIcon.style.display = 'block';
        eyeOffIcon.style.display = 'none';
      }
    });
  });
});