// Simple helper: show text in status area with a type ("info" | "success" | "error")
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

// Debug output
function setDebug(data) {
  const pre = document.getElementById("debug-output");
  if (!pre) return;
  pre.textContent = JSON.stringify(data, null, 2);
}

// Update current user chip in header
function setCurrentUserChip(user) {
  const chip = document.getElementById("current-user-chip");
  if (!chip) return;

  if (!user) {
    chip.textContent = "Not signed in";
    chip.classList.remove("success");
    return;
  }

  chip.textContent = `${user.user_name || user.email || "User"} · plan ${
    user.plan ?? "?"
  }`;
}

// Basic fetch wrapper for JSON endpoints
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

  // same-origin cookies (HttpOnly) will be sent automatically
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

window.addEventListener("DOMContentLoaded", () => {
  const btnSignup = document.getElementById("btn-signup");
  const btnLogin = document.getElementById("btn-login");
  const btnLogout = document.getElementById("btn-logout");
  const btnMe = document.getElementById("btn-me");

  const accountStatus = document.getElementById("account-status");

  const btnCheck = document.getElementById("btn-check");
  // const btnSave = document.getElementById("btn-save");
  const fileInput = document.getElementById("file-input");
  const detectStatus = document.getElementById("detect-status");
  const detectResult = document.getElementById("detect-result");
  const checkState = document.getElementById("check-state");
  const checkboxPublic = document.getElementById("checkbox-public");

  const btnMyImages = document.getElementById("btn-my-images");
  const myImagesFilter = document.getElementById("my-images-filter");
  const myImagesStatus = document.getElementById("my-images-status");
  const myImagesList = document.getElementById("my-images-list");

  const btnCommunityImages = document.getElementById("btn-community-images");
  const communityImagesStatus = document.getElementById(
    "community-images-status"
  );
  const communityImagesList = document.getElementById("community-images-list");

  let lastDetectionToken = null;
  let lastFile = null; // File object to send the same bytes to /upload/image

  // Enable/disable buttons based on file selection
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    lastFile = file || null;
    lastDetectionToken = null;
    // btnSave.disabled = true;

    if (file) {
      btnCheck.disabled = false;
      checkState.textContent = `Selected: ${file.name} (${Math.round(
        file.size / 1024
      )} KB)`;
      detectResult.textContent = "No detection yet for this file.";
    } else {
      btnCheck.disabled = true;
      checkState.textContent = "Select a file to enable detection.";
      detectResult.textContent = "No detection yet.";
    }
  });

  // SIGNUP
  btnSignup.addEventListener("click", async () => {
    const user_name = document
      .getElementById("signup-username")
      .value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value;

    if (!user_name || !email || !password) {
      setStatus(
        accountStatus,
        "error",
        "Please fill username, email and password."
      );
      return;
    }

    btnSignup.disabled = true;
    setStatus(accountStatus, "info", "Creating account...");

    try {
      const { res, data } = await jsonFetch("POST", "/auth/signup", {
        user_name,
        email,
        password,
      });

      if (res.ok) {
        setStatus(
          accountStatus,
          "success",
          "Account created. You can now log in."
        );
      } else {
        setStatus(
          accountStatus,
          "error",
          data.detail || `Signup failed (${res.status})`
        );
      }
    } catch (err) {
      console.error(err);
      setStatus(accountStatus, "error", "Network error during signup.");
    } finally {
      btnSignup.disabled = false;
    }
  });

  // LOGIN
  btnLogin.addEventListener("click", async () => {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    if (!email || !password) {
      setStatus(
        accountStatus,
        "error",
        "Please fill email and password."
      );
      return;
    }

    btnLogin.disabled = true;
    setStatus(accountStatus, "info", "Logging in...");

    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
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
        window.location.href = "/imgProcessing";


      } else {
        setStatus(
          accountStatus,
          "error",
          data.detail || `Login failed (${res.status})`
        );
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

  // LOGOUT
  btnLogout.addEventListener("click", async () => {
    setStatus(accountStatus, "info", "Logging out...");

    try {
      const { res, data } = await jsonFetch("POST", "/logout", null);
      if (res.ok) {
        setStatus(accountStatus, "success", "Logged out.");
      } else {
        setStatus(
          accountStatus,
          "error",
          data.detail || `Logout failed (${res.status})`
        );
      }
    } catch (err) {
      console.error(err);
      setStatus(accountStatus, "error", "Network error during logout.");
    } finally {
      setCurrentUserChip(null);
    }
  });

  // AUTH /me
  btnMe.addEventListener("click", async () => {
    setStatus(accountStatus, "info", "Fetching profile...");

    try {
      const { res, data } = await jsonFetch("GET", "/auth/me", null);
      if (res.ok) {
        setStatus(accountStatus, "success", "Profile loaded.");
        setCurrentUserChip(data);
      } else {
        setStatus(
          accountStatus,
          "error",
          data.detail || `Failed to load profile (${res.status})`
        );
        if (res.status === 401) {
          setCurrentUserChip(null);
        }
      }
    } catch (err) {
      console.error(err);
      setStatus(
        accountStatus,
        "error",
        "Network error during /auth/me."
      );
    }
  });

  // CHECKS (analyze image)
// CHECKS (analyze image) — REPLACEMENT
btnCheck.addEventListener("click", async () => {
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
    const res = await fetch("/checks", {
      method: "POST",
      body: formData,
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = { detail: "Non-JSON response" };
    }

    // visible debug
    setDebug({ url: "/checks", status: res.status, body: data });

    if (res.ok) {
      lastDetectionToken = data.detection_token || null;
      // show the raw debug JSON in the existing hidden debug area (keeps your old behaviour)
      detectResult.textContent = JSON.stringify(data, null, 2);

      // NEW: render a friendly detection card if the server returned result fields
      renderDetection(data);

      setStatus(
        detectStatus,
        "success",
        "Detection completed. You can now save the image."
      );
      // btnSave.disabled = !lastDetectionToken;
    } else {
      lastDetectionToken = null;
      detectResult.textContent = JSON.stringify(data, null, 2);
      setStatus(
        detectStatus,
        "error",
        data.detail || `Detection failed (${res.status})`
      );
    }
  } catch (err) {
    console.error(err);
    setStatus(
      detectStatus,
      "error",
      "Network error during detection."
    );
  } finally {
    btnCheck.disabled = false;
  }
});


  // UPLOAD IMAGE (save result)
  // btnSave.addEventListener("click", async () => {
  //   if (!lastFile) {
  //     setStatus(detectStatus, "error", "No file selected.");
  //     return;
  //   }
  //   if (!lastDetectionToken) {
  //     setStatus(
  //       detectStatus,
  //       "error",
  //       "No detection_token. Run detection first."
  //     );
  //     return;
  //   }

  //   btnSave.disabled = true;
  //   setStatus(detectStatus, "info", "Saving image...");

  //   const formData = new FormData();
  //   formData.append("file", lastFile);
  //   formData.append("detection_token", lastDetectionToken);
  //   if (checkboxPublic.checked) {
  //     formData.append("is_public", "true");
  //   }

  //   try {
  //     const res = await fetch("/upload/image", {
  //       method: "POST",
  //       body: formData,
  //     });

  //     let data = null;
  //     try {
  //       data = await res.json();
  //     } catch {
  //       data = { detail: "Non-JSON response" };
  //     }
  //     setDebug({
  //       url: "/upload/image",
  //       status: res.status,
  //       body: data,
  //     });

  //     if (res.ok || res.status === 201) {
  //       setStatus(detectStatus, "success", "Image saved.");
  //     } else {
  //       setStatus(
  //         detectStatus,
  //         "error",
  //         data.detail || `Failed to save image (${res.status})`
  //       );
  //     }
  //   } catch (err) {
  //     console.error(err);
  //     setStatus(detectStatus, "error", "Network error during save.");
  //   } finally {
  //     btnSave.disabled = false;
  //   }
  // });

  // MY IMAGES
  btnMyImages.addEventListener("click", async () => {
    setStatus(myImagesStatus, "info", "Loading images...");

    const filter = myImagesFilter.value;
    let url = "/images";
    if (filter) {
      url += `?is_public=${encodeURIComponent(filter)}`;
    }

    try {
      const { res, data } = await jsonFetch("GET", url, null);
      if (!res.ok) {
        setStatus(
          myImagesStatus,
          "error",
          data.detail || `Failed to load images (${res.status})`
        );
        myImagesList.innerHTML = "";
        return;
      }

      const items = data.items || [];
      setStatus(
        myImagesStatus,
        "success",
        `Loaded ${items.length} image(s).`
      );
      renderImagesList(myImagesList, items);
    } catch (err) {
      console.error(err);
      setStatus(myImagesStatus, "error", "Network error.");
      myImagesList.innerHTML = "";
    }
  });

  // COMMUNITY IMAGES
  btnCommunityImages.addEventListener("click", async () => {
    setStatus(
      communityImagesStatus,
      "info",
      "Loading community images..."
    );

    try {
      const { res, data } = await jsonFetch(
        "GET",
        "/community/images",
        null
      );
      if (!res.ok) {
        setStatus(
          communityImagesStatus,
          "error",
          data.detail ||
            `Failed to load community images (${res.status})`
        );
        communityImagesList.innerHTML = "";
        return;
      }

      const items = data.items || [];
      setStatus(
        communityImagesStatus,
        "success",
        `Loaded ${items.length} image(s).`
      );
      renderImagesList(communityImagesList, items);
    } catch (err) {
      console.error(err);
      setStatus(
        communityImagesStatus,
        "error",
        "Network error."
      );
      communityImagesList.innerHTML = "";
    }
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
      title.innerHTML = `<strong>${
        img.image_id || "(no id)"
      }</strong>`;

      const meta = document.createElement("div");
      meta.innerHTML = `
        verdict: <strong>${img.verdict}</strong>,
        label: <strong>${img.label}</strong>,
        conf: ${
          img.confidence != null ? img.confidence.toFixed(3) : "?"
        }
      `;

      const flags = document.createElement("div");
      flags.className = "muted";
      flags.textContent = `public: ${
        img.is_public ? "yes" : "no"
      } · uploaded_at: ${img.uploaded_at || "n/a"}`;

      div.appendChild(title);
      div.appendChild(meta);
      div.appendChild(flags);
      container.appendChild(div);
    }
  }

// ---------- detection renderer and action wiring (shows uploaded image first) ----------
let _lastObjectUrl = null; // remember and revoke previous object URL

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
    if (labelLower.includes('most likely')) labelClass = 'label-strong-ai';
    else if (labelLower.includes('likely')) labelClass = 'label-medium-ai';
    else labelClass = 'label-medium-ai';
  } else if (labelLower.includes('real')) {
    if (labelLower.includes('most likely')) labelClass = 'label-strong-real';
    else if (labelLower.includes('likely')) labelClass = 'label-medium-real';
    else labelClass = 'label-medium-real';
  } else if (labelLower.includes('not sure')) {
    labelClass = 'label-neutral';
  } else {
    labelClass = 'label-neutral';
  }

  // ---------- Image display preference ----------
  // 1) If user just uploaded a file (lastFile), show that (local preview).
  // 2) Else, if server returned a filename/URL, use it.
  // 3) Else show empty alt.
  if (window.lastFile) {
    try {
      // revoke previous object URL if any
      if (_lastObjectUrl) {
        URL.revokeObjectURL(_lastObjectUrl);
        _lastObjectUrl = null;
      }
      _lastObjectUrl = URL.createObjectURL(window.lastFile);
      thumb.src = _lastObjectUrl;
      thumb.alt = `Uploaded image preview (${window.lastFile.name})`;
    } catch (e) {
      if (filename) {
        const src = (filename.startsWith('http') || filename.startsWith('/')) ? filename : (`/static/uploads/${filename}`);
        thumb.src = src;
        thumb.alt = `Scan of ${filename}`;
      } else {
        thumb.src = '';
        thumb.alt = 'No image available';
      }
    }
  } else if (filename) {
    const src = (filename.startsWith('http') || filename.startsWith('/')) ? filename : (`/static/uploads/${filename}`);
    thumb.src = src;
    thumb.alt = `Scan of ${filename}`;
  } else {
    thumb.src = '';
    thumb.alt = 'No image available';
  }

  verdict.textContent = label;
  verdict.className = `verdict-text ${labelClass}`;

  confLabel.textContent = `Confidence: ${(confidence * 100).toFixed(1)}%`;

  const realFill = document.querySelector('.real-fill');
  const aiFill = document.querySelector('.ai-fill');
  if (realFill && aiFill) {
    realFill.style.width = `${(real_prob * 100).toFixed(2)}%`;
    aiFill.style.width = `${(ai_prob * 100).toFixed(2)}%`;
  }

  rawPre.style.display = 'none';
  card.hidden = false;

  card.latestResponse = resp;
}



window.addEventListener('beforeunload', () => {
  if (_lastObjectUrl) {
    try { URL.revokeObjectURL(_lastObjectUrl); } catch (e) {}
  }
});







  // On first load, try to get /auth/me to sync header chip
  (async () => {
    try {
      const { res, data } = await jsonFetch("GET", "/auth/me", null);
      if (res.ok) {
        setCurrentUserChip(data);
        setStatus(
          accountStatus,
          "info",
          "Session restored from cookie."
        );
      } else {
        setCurrentUserChip(null);
      }
    } catch {
      // ignore
    }
  })();
});

