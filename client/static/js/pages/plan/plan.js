const { jsonFetch } = window.AIclipseHttp;

function showMessage(type, message) {
  const statusDiv = document.getElementById("status-message");
  if (!statusDiv) return;

  statusDiv.innerHTML = "";

  const el = document.createElement("div");
  el.className = `status-message status-${type}`;
  el.textContent = String(message ?? "");
  statusDiv.appendChild(el);

  setTimeout(() => {
    statusDiv.innerHTML = "";
  }, 5000);
}

function hideLoaderSafely() {
  if (window.AppLoader && typeof window.AppLoader.hide === "function") {
    window.AppLoader.hide();
  }
}

async function loadUsageData() {
  try {
    const { res, data } = await jsonFetch("POST", "/usage/check");

    if (!res.ok) {
      console.error("Failed to load usage data");
      return null;
    }

    return data;
  } catch (err) {
    console.error("Error loading usage data:", err);
    return null;
  }
}

function updatePlanUI(currentPlan) {
  // Highlight current plan
  for (let i = 0; i <= 2; i++) {
    const card = document.getElementById(`plan-${i}`);
    const btn = document.getElementById(`btn-plan-${i}`);
    
    if (card && btn) {
      if (i === currentPlan) {
        card.classList.add("current");
        btn.textContent = "Current Plan";
        btn.disabled = true;
      } else {
        card.classList.remove("current");
        if (i === 0) {
          btn.textContent = "Choose this Plan";
          btn.disabled = currentPlan === 0;
        } else if (i === 1) {
          btn.textContent = currentPlan > 1 ? "Choose this Plan" : "Upgrade Now";
          btn.disabled = false;
        } else if (i === 2) {
          btn.textContent = "Coming Soon";
          btn.disabled = true;
        }
      }
    }
  }
}

function updateUsageUI(usageData) {
  const usageInfoDiv = document.getElementById("usage-info");
  const usageText = document.getElementById("usage-text");
  const usageFill = document.getElementById("usage-fill");
  const usageLabel = document.getElementById("usage-label");

  if (!usageInfoDiv) return;

  const planRaw = usageData && usageData.plan;
  const plan = Number(planRaw ?? 0);
  const unlimitedFlag =
    usageData &&
    (usageData.unlimited === true ||
      usageData.unlimited === "true" ||
      usageData.is_unlimited === true ||
      usageData.is_unlimited === "true");
  const isUnlimited = unlimitedFlag || plan > 0;

  if (!usageData || isUnlimited) {
    // Hide usage info for unlimited plans
    usageInfoDiv.style.display = "none";
    return;
  }

  // Show usage info for free plan
  usageInfoDiv.style.display = "block";

  const used = Number(
    usageData.monthly_usage ?? usageData.monthly_usage_count ?? usageData.usage ?? 0
  );
  const limitRaw = Number(usageData.limit ?? usageData.monthly_limit ?? 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 10;
  const remaining =
    usageData.remaining !== undefined && usageData.remaining !== null
      ? Number(usageData.remaining)
      : Math.max(0, limit - used);
  const percentage = Math.max(0, Math.min(100, Math.round((used / limit) * 100)));

  if (usageLabel) {
    usageLabel.textContent = `${percentage}%`;
  }

  if (usageText) {
    usageText.textContent = `You've used ${used} out of ${limit} free scans this month. ${remaining} remaining.`;
  }

  if (usageFill) {
    usageFill.style.width = `${percentage}%`;
  
    
    // Change color based on usage
    if (percentage >= 90) {
      usageFill.style.background = "linear-gradient(90deg, #f44336, #d32f2f)";
    } else if (percentage >= 70) {
      usageFill.style.background = "linear-gradient(90deg, #ff9800, #f57c00)";
    } else {
      usageFill.style.background = "linear-gradient(90deg, #CFB87C, #bda669)";
    }
  }
}

async function handleUpgrade(planId) {
  let loaderShown = false;
  try {
    showMessage("info", "Redirecting to checkout...");
    if (window.AppLoader && typeof window.AppLoader.show === "function") {
      window.AppLoader.show("Redirecting, please wait...");
      loaderShown = true;
    }

    const { res, data } = await jsonFetch("POST", "/billing/create-checkout-session", {
      plan_id: planId,
    });

    if (!res.ok) {
      if (loaderShown && window.AppLoader && typeof window.AppLoader.hide === "function") {
        window.AppLoader.hide();
      }
      showMessage("error", (data && data.detail) || `Failed to create checkout session (${res.status})`);
      return;
    }

    if (data && data.checkout_url) {
      window.location.href = data.checkout_url;
      return;
    }

    if (loaderShown && window.AppLoader && typeof window.AppLoader.hide === "function") {
      window.AppLoader.hide();
    }
    showMessage("error", "No checkout URL returned");
  } catch (err) {
    if (loaderShown && window.AppLoader && typeof window.AppLoader.hide === "function") {
      window.AppLoader.hide();
    }
    console.error("Upgrade error:", err);
    showMessage("error", "An error occurred. Please try again.");
  }
}

// Initialize page
window.addEventListener("DOMContentLoaded", async () => {
  hideLoaderSafely();

  // Check for success/cancel query params
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("success") === "true") {
    showMessage("success", "✓ Successfully upgraded! Your new plan is now active.");
    // Clear the URL params
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (urlParams.get("canceled") === "true") {
    showMessage("error", "Checkout canceled. You can try again anytime.");
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const usageData = await loadUsageData();

  const currentPlan = Number((usageData && usageData.plan) ?? 0);
  updatePlanUI(currentPlan);

  if (usageData) {
    updateUsageUI(usageData);
  } else {
    updateUsageUI(null);
  }

  const btnPlan1 = document.getElementById("btn-plan-1");
  if (btnPlan1) {
    btnPlan1.addEventListener("click", () => handleUpgrade(1));
  }

  const btnPlan2 = document.getElementById("btn-plan-2");
  if (btnPlan2) {
    btnPlan2.addEventListener("click", () => handleUpgrade(2));
  }
});

window.addEventListener("pageshow", () => {
  hideLoaderSafely();
});
