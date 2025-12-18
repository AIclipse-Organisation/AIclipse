// minimal app.js for imgProcessing.html

// --- helpers ---
function setStatus(el, type, text) {
  if (!el) return;
  el.innerHTML = "";
  if (!text) return;
  const span = document.createElement("span");
  span.textContent = text;
  span.classList.add(
    type === "success" ? "status-success" :
    type === "error"   ? "status-error" :
                         "status-info"
  );
  el.appendChild(span);
}

function setDebug(data) {
  const pre = document.getElementById("debug-output");
  if (!pre) return;
  pre.textContent = JSON.stringify(data, null, 2);
}


async function jsonFetch(method, url, body) {
  const opts = { method, headers: { Accept: "application/json" } };
  if (body != null) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { data = { detail: "Non-JSON response" }; }
  setDebug({ url, status: res.status, body: data });
  return { res, data };
}

// --- DOM wiring for imgProcessing.html ---
window.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("file-input");
  const btnCheck = document.getElementById("btn-check");
  const checkState = document.getElementById("check-state");
  const detectStatus = document.getElementById("detect-status");
  const detectResult = document.getElementById("detect-result");
  const debugOutput = document.getElementById("debug-output");

  // elements inside detect card
  const detectCard = document.getElementById("detect-card");
  const verdictEl = document.getElementById("detect-verdict");
  const confidenceEl = document.getElementById("detect-confidence");
  const realFill = document.querySelector(".real-fill");
  const aiFill = document.querySelector(".ai-fill");

  // state
  window.lastFile = null;
  let lastDetectionToken = null;

  // file chosen -> enable check button
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      window.lastFile = file || null;
      lastDetectionToken = null;

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
  }

  // btnCheck click -> POST /checks with file
  if (btnCheck) {
    btnCheck.addEventListener("click", async () => {
      if (!window.lastFile) {
        setStatus(detectStatus, "error", "No file selected.");
        return;
      }

      btnCheck.disabled = true;
      lastDetectionToken = null;
      setStatus(detectStatus, "info", "Analyzing image...");

      const formData = new FormData();
      formData.append("file", window.lastFile);

      try {
        const res = await fetch("/checks", { method: "POST", body: formData });
        let data = null;
        try { data = await res.json(); } catch { data = { detail: "Non-JSON response" }; }
        setDebug({ url: "/checks", status: res.status, body: data });

        if (res.ok) {
          lastDetectionToken = data.detection_token || null;
          // keep raw JSON for debugging (hidden by default)
          if (detectResult) detectResult.textContent = JSON.stringify(data, null, 2);

          // render verdict/progress bar
          renderDetection(data);

          setStatus(detectStatus, "success", "Detection completed.");
        } else {
          lastDetectionToken = null;
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
  }

  // renderDetection: updates the verdict text, confidence, and two-color bar
  function renderDetection(resp) {
    if (!resp || typeof resp !== "object") {
      if (detectResult) { detectResult.style.display = ""; detectResult.textContent = JSON.stringify(resp, null, 2); }
      if (detectCard) detectCard.hidden = true;
      return;
    }

    const label = (resp.label || resp.result || "Unknown").toString();
    const confidence = Number.isFinite(resp.confidence) ? resp.confidence : (resp.score || 0);

    // compute ai vs real probabilities (mirror your server logic)
    const labelLower = label.toLowerCase();
    const isAi = labelLower.includes("ai");
    const ai_prob = isAi ? confidence : (1 - confidence);
    const real_prob = 1 - ai_prob;

    // decide label class
    let labelClass = "label-neutral";
    if (labelLower.includes("ai")) {
      if (labelLower.includes("most likely")) labelClass = "label-strong-ai";
      else if (labelLower.includes("likely")) labelClass = "label-medium-ai";
      else labelClass = "label-medium-ai";
    } else if (labelLower.includes("real")) {
      if (labelLower.includes("most likely")) labelClass = "label-strong-real";
      else if (labelLower.includes("likely")) labelClass = "label-medium-real";
      else labelClass = "label-medium-real";
    } else if (labelLower.includes("not sure")) {
      labelClass = "label-neutral";
    } else {
      labelClass = "label-neutral";
    }

    // update UI
    if (verdictEl) {
      verdictEl.textContent = label;
      verdictEl.className = `verdict-text ${labelClass}`;
    }
    if (confidenceEl) confidenceEl.textContent = `Confidence: ${(confidence * 100).toFixed(1)}%`;

    if (realFill && aiFill) {
      realFill.style.width = `${(real_prob * 100).toFixed(2)}%`;
      aiFill.style.width = `${(ai_prob * 100).toFixed(2)}%`;
    }

    if (detectResult) detectResult.style.display = "none";
    if (detectCard) detectCard.hidden = false;

    // keep the last response on the card for future actions (if needed)
    if (detectCard) detectCard.latestResponse = resp;
  }

});
