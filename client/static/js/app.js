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

  // SIGNUP
  onEl("btn-signup", (btnSignup) => {
    btnSignup.addEventListener("click", async () => {
      const user_name = document.getElementById("signup-username")?.value.trim();
      const email = document.getElementById("signup-email")?.value.trim();
      const password = document.getElementById("signup-password")?.value;
      const accountStatus = document.getElementById("account-status");

      if (!user_name || !email || !password) {
        setStatus(accountStatus, "error", "Please fill username, email and password.");
        return;
      }

      btnSignup.disabled = true;
      setStatus(accountStatus, "info", "Creating account...");

      try {
        const { res, data } = await jsonFetch("POST", "/auth/signup", { user_name, email, password });
        if (res.ok) {
          setStatus(accountStatus, "success", "Account created. You can now log in.");
        } else {
          setStatus(accountStatus, "error", data.detail || `Signup failed (${res.status})`);
        }
      } catch (err) {
        console.error(err);
        setStatus(accountStatus, "error", "Network error during signup.");
      } finally {
        btnSignup.disabled = false;
      }
    });
  });

  // LOGIN
  onEl("btn-login", (btnLogin) => {
    btnLogin.addEventListener("click", async () => {
      console.log("logging in");
      const email = document.getElementById("login-email")?.value.trim();
      const password = document.getElementById("login-password")?.value;
      const accountStatus = document.getElementById("account-status");

      if (!email || !password) {
        setStatus(accountStatus, "error", "Please fill email and password.");
        return;
      }

      btnLogin.disabled = true;
      setStatus(accountStatus, "info", "Logging in...");

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
          setStatus(accountStatus, "error", data.detail || `Login failed (${res.status})`);
          setCurrentUserChip(null);
        }
      } catch (err) {
        console.error(err);
        setStatus(accountStatus, "error", "Network error during login.");
        setCurrentUserChip(null);
      } finally {
        btnLogin.disabled = false;
      }
    });
  });

  // LOGOUT
  onEl("btn-logout", (btnLogout) => {
    btnLogout.addEventListener("click", async () => {
      const accountStatus = document.getElementById("account-status");
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

  // AUTH /me
  onEl("btn-me", (btnMe) => {
    btnMe.addEventListener("click", async () => {
      const accountStatus = document.getElementById("account-status");
      setStatus(accountStatus, "info", "Fetching profile...");
      try {
        const { res, data } = await jsonFetch("GET", "/auth/me", null);
        if (res.ok) {
          setStatus(accountStatus, "success", "Profile loaded.");
          setCurrentUserChip(data);
        } else {
          setStatus(accountStatus, "error", data.detail || `Failed to load profile (${res.status})`);
          if (res.status === 401) setCurrentUserChip(null);
        }
      } catch (err) {
        console.error(err);
        setStatus(accountStatus, "error", "Network error during /auth/me.");
      }
    });
  });

  // CHECKS (analyze image) — REPLACEMENT
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
          setStatus(detectStatus, "success", "Detection completed. You can now save the image.");
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

  // MY IMAGES
  onEl("btn-my-images", (btnMyImages) => {
    btnMyImages.addEventListener("click", async () => {
      const myImagesStatus = document.getElementById("my-images-status");
      const myImagesList = document.getElementById("my-images-list");
      const filter = document.getElementById("my-images-filter")?.value;

      setStatus(myImagesStatus, "info", "Loading images...");
      let url = "/images";
      if (filter) url += `?is_public=${encodeURIComponent(filter)}`;

      try {
        const { res, data } = await jsonFetch("GET", url, null);
        if (!res.ok) {
          setStatus(myImagesStatus, "error", data.detail || `Failed to load images (${res.status})`);
          if (myImagesList) myImagesList.innerHTML = "";
          return;
        }
        const items = data.items || [];
        setStatus(myImagesStatus, "success", `Loaded ${items.length} image(s).`);
        if (myImagesList) renderImagesList(myImagesList, items);
      } catch (err) {
        console.error(err);
        setStatus(myImagesStatus, "error", "Network error.");
        if (myImagesList) myImagesList.innerHTML = "";
      }
    });
  });

  // COMMUNITY IMAGES
  onEl("btn-community-images", (btnCommunityImages) => {
    btnCommunityImages.addEventListener("click", async () => {
      const communityImagesStatus = document.getElementById("community-images-status");
      const communityImagesList = document.getElementById("community-images-list");

      setStatus(communityImagesStatus, "info", "Loading community images...");
      try {
        const { res, data } = await jsonFetch("GET", "/community/images", null);
        if (!res.ok) {
          setStatus(communityImagesStatus, "error", data.detail || `Failed to load community images (${res.status})`);
          if (communityImagesList) communityImagesList.innerHTML = "";
          return;
        }
        const items = data.items || [];
        setStatus(communityImagesStatus, "success", `Loaded ${items.length} image(s).`);
        if (communityImagesList) renderImagesList(communityImagesList, items);
      } catch (err) {
        console.error(err);
        setStatus(communityImagesStatus, "error", "Network error.");
        if (communityImagesList) communityImagesList.innerHTML = "";
      }
    });
  });

  function renderImagesList(container, items) {
    container.innerHTML = "";
    if (!items.length) {
      const div = document.createElement("div");
      div.className = "muted";
      div.textContent = "No images.";
      container.appendChild(div);
      return;
    }

    for (const img of items) {
      const div = document.createElement("div");
      div.className = "image-item";
      const title = document.createElement("div");
      title.innerHTML = `<strong>${img.image_id || "(no id)"}</strong>`;
      const meta = document.createElement("div");
      meta.innerHTML = `verdict: <strong>${img.verdict}</strong>, label: <strong>${img.label}</strong>, conf: ${img.confidence != null ? img.confidence.toFixed(3) : "?"}`;
      const flags = document.createElement("div");
      flags.className = "muted";
      flags.textContent = `public: ${img.is_public ? "yes" : "no"} · uploaded_at: ${img.uploaded_at || "n/a"}`;
      div.appendChild(title);
      div.appendChild(meta);
      div.appendChild(flags);
      container.appendChild(div);
    }
  }

  // ---------- detection renderer and action wiring (shows uploaded image first) ----------
  let _lastObjectUrl = null; 

  function renderDetection(resp) {
    const card = document.getElementById('detect-card');
    const thumb = document.getElementById('detect-thumb');
    const verdict = document.getElementById('detect-verdict');
    const confLabel = document.getElementById('detect-confidence');
    const rawPre = document.getElementById('detect-result');

    if (!card || !verdict || !confLabel || !rawPre) {
      if (rawPre) {
        rawPre.style.display = '';
        rawPre.textContent = JSON.stringify(resp, null, 2);
      }
      return;
    }

    if (!resp || typeof resp !== 'object') {
      rawPre.style.display = '';
      rawPre.textContent = JSON.stringify(resp, null, 2);
      card.hidden = true;
      return;
    }

    const label = (resp.label || resp.result || 'Unknown').toString();
    const confidence = Number.isFinite(resp.confidence) ? resp.confidence : (resp.score || 0);
    const filename = resp.filename || resp.file || null;
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
      try {
        if (_lastObjectUrl) URL.revokeObjectURL(_lastObjectUrl);
        _lastObjectUrl = URL.createObjectURL(window.lastFile);
        thumb.src = _lastObjectUrl;
        thumb.alt = `Uploaded image preview (${window.lastFile.name})`;
      } catch (e) {
        if (filename) {
          thumb.src = (filename.startsWith('http') || filename.startsWith('/')) ? filename : (`/static/uploads/${filename}`);
        }
      }
    } else if (filename) {
      thumb.src = (filename.startsWith('http') || filename.startsWith('/')) ? filename : (`/static/uploads/${filename}`);
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
    card.latestResponse = resp;
  }

  window.addEventListener('beforeunload', () => {
    if (_lastObjectUrl) URL.revokeObjectURL(_lastObjectUrl);
  });

  (async () => {
    try {
      const { res, data } = await jsonFetch("GET", "/auth/me", null);
      if (res.ok) {
        setCurrentUserChip(data);
        setStatus(document.getElementById("account-status"), "info", "Session restored from cookie.");
      } else {
        setCurrentUserChip(null);
      }
    } catch {}
  })();
});