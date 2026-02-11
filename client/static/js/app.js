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

window.addEventListener("DOMContentLoaded", () => {
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
            credentials: "include",
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
          credentials: "include",
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


  (async () => {
    try {
      const { res, data } = await jsonFetch("GET", "/auth/me", null);
      setCurrentUserChip(res.ok ? data : null);
    } catch {}
  })();
});