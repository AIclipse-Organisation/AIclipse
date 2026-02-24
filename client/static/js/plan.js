async function jsonFetch(method, url, body) {
  const opts = { method, headers: { Accept: "application/json" } };
  if (body != null) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  opts.credentials = "include";

  const res = await fetch(url, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { detail: "Non-JSON response" };
  }
  return { res, data };
}

function showMessage(type, message) {
  const statusDiv = document.getElementById("status-message");
  if (!statusDiv) return;

  statusDiv.innerHTML = `<div class="status-message status-${type}">${message}</div>`;
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    statusDiv.innerHTML = "";
  }, 5000);
}

function hideLoaderSafely() {
  if (window.AppLoader && typeof window.AppLoader.hide === "function") {
    window.AppLoader.hide();
  }
}

async function loadUserData() {
  try {
    const { res, data } = await jsonFetch("GET", "/auth/me");
    
    if (!res.ok) {
      console.error("Failed to load user data");
      return null;
    }

    return data;
  } catch (err) {
    console.error("Error loading user data:", err);
    return null;
  }
}

async function loadUsageData() {
  try {
    const { res, data } = await jsonFetch("POST", "/api/usage/check");
    
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
  const limit = Number(usageData.limit ?? usageData.monthly_limit ?? 10) || 10;
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
      window.AppLoader.show("Redirecting , please wait...");
      loaderShown = true;
    }

    // Get user data
    const { res: meRes, data: userData } = await jsonFetch("GET", "/auth/me");
    
    if (!meRes.ok) {
      if (loaderShown && window.AppLoader && typeof window.AppLoader.hide === "function") {
        window.AppLoader.hide();
      }
      showMessage("error", "Failed to load user information");
      return;
    }

    // Create checkout session
    const { res, data } = await jsonFetch("POST", "/api/billing/create-checkout-session", {
      user_id: userData.user_id,
      plan_id: planId,
      email: userData.email,
    });

    if (!res.ok) {
      if (loaderShown && window.AppLoader && typeof window.AppLoader.hide === "function") {
        window.AppLoader.hide();
      }
      showMessage("error", data.detail || "Failed to create checkout session");
      return;
    }

    // Redirect to Stripe Checkout
    if (data.checkout_url) {
      window.location.href = data.checkout_url;
    } else {
      if (loaderShown && window.AppLoader && typeof window.AppLoader.hide === "function") {
        window.AppLoader.hide();
      }
      console.error("No checkout URL returned by billing service");
      showMessage("error", "No checkout URL returned");
    }
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

  // Load user and usage data
  const userData = await loadUserData();
  const usageData = await loadUsageData();

  if (userData) {
    const currentPlan = userData.plan || 0;
    updatePlanUI(currentPlan);
  }

  if (usageData) {
    updateUsageUI(usageData);
  } else if (userData) {
    const fallbackPlan = Number(userData.plan ?? 0);
    if (fallbackPlan === 0) {
      const fallbackUsed = Number(userData.monthly_usage_count ?? userData.monthly_usage ?? 0);
      const fallbackLimit = 10;
      updateUsageUI({
        plan: fallbackPlan,
        unlimited: false,
        monthly_usage: fallbackUsed,
        limit: fallbackLimit,
        remaining: Math.max(0, fallbackLimit - fallbackUsed),
      });
    } else {
      updateUsageUI({ plan: fallbackPlan, unlimited: true });
    }
  }

  // Set up upgrade button handlers
  const btnPlan1 = document.getElementById("btn-plan-1");
  
  if (btnPlan1) {
    btnPlan1.addEventListener("click", () => {
      if (userData) {
        handleUpgrade(1);
      } else {
        console.error("No user data - user not logged in");
        alert("Please sign in to upgrade your plan. Redirecting to login page...");
        window.location.href = "/login";
      }
    });
  }

  // Set up Premium (plan 2) button handler
  const btnPlan2 = document.getElementById("btn-plan-2");
  
  if (btnPlan2) {
    btnPlan2.addEventListener("click", () => {
      if (userData) {
        handleUpgrade(2);
      } else {
        console.error("No user data - user not logged in");
        alert("Please sign in to upgrade your plan. Redirecting to login page...");
        window.location.href = "/login";
      }
    });
  }
});

window.addEventListener("pageshow", () => {
  hideLoaderSafely();
});
