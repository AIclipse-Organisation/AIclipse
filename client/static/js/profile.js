// Load user details and setup logout handler
window.addEventListener("DOMContentLoaded", async () => {
  const statusEl = document.getElementById("user-details-status");
  const containerEl = document.getElementById("user-details-container");

  try {
    statusEl.textContent = "Loading user details...";
    statusEl.className = "status-message loading";

    const response = await fetch("/auth/me", {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Failed to fetch user details");
    }

    const user = await response.json();

    const aiAccuracy =
      user.acc_guessing_ai != null ? user.acc_guessing_ai * 100 : 0;
    const realAccuracy =
      user.acc_guessing_real != null ? user.acc_guessing_real * 100 : 0;

    const avgAcc = (aiAccuracy + realAccuracy) / 2;

    let accuracyLevel = "Novice";

    if (avgAcc >= 75) {
      accuracyLevel = "Expert";
    } else if (avgAcc >= 50) {
      accuracyLevel = "Advanced";
    } else if (avgAcc >= 25) {
      accuracyLevel = "Intermediate";
    } else {
      accuracyLevel = "Novice";
    }
    document.getElementById("detail-accuracy-level").textContent =
      accuracyLevel;

    // Update UI with user details
    document.getElementById("detail-username").textContent =
      user.user_name || "-";
    document.getElementById("detail-email").textContent = user.email || "-";
    document.getElementById("detail-plan").textContent =
      user.plan !== undefined && user.plan !== null && user.plan === 0
        ? "Free Trial"
        : user.plan;

    document.getElementById("detail-created").textContent = user.created_at
      ? new Date(user.created_at).toLocaleDateString()
      : "-";

    document.getElementById("detail-total-guesses").textContent =
      user.total_guesses !== undefined ? user.total_guesses : 0;

    // document.getElementById("detail-total-correct").textContent =
    //   user.total_correct !== undefined ? user.total_correct : 0;

    // document.getElementById('detail-acc-ai').textContent =
    //   (user.acc_guessing_ai !== undefined && user.acc_guessing_ai !== null)
    //     ? (user.acc_guessing_ai * 100).toFixed(1) + '%'
    //     : '0.0%';

    // document.getElementById('detail-acc-real').textContent =
    //   (user.acc_guessing_real !== undefined && user.acc_guessing_real !== null)
    //     ? (user.acc_guessing_real * 100).toFixed(1) + '%'
    //     : '0.0%';

    document.getElementById("detail-monthly-usage").textContent =
      user.monthly_usage_count !== undefined ? user.monthly_usage_count : 0;

    // Show container and hide status
    statusEl.textContent = "";
    statusEl.className = "status-message";
    containerEl.style.display = "block";
  } catch (error) {
    console.error("Error loading user details:", error);
    statusEl.textContent = "Failed to load user details. Please log in.";
    statusEl.className = "status-message error";
  }

  // =========================
  // Logout confirm modal logic
  // =========================
  const btnLogout = document.getElementById("btn-logout");
  const logoutModal = document.getElementById("logout-modal");
  const cancelLogout = document.getElementById("cancel-logout");
  const confirmLogout = document.getElementById("confirm-logout");

  const openLogoutModal = () => {
    if (logoutModal) logoutModal.hidden = false;
  };

  const closeLogoutModal = () => {
    if (logoutModal) logoutModal.hidden = true;
  };

  // If modal elements exist, use modal confirmation flow.
  // Otherwise, fallback to the old direct logout behavior.
  if (btnLogout) {
    if (logoutModal && cancelLogout && confirmLogout) {
      // Ensure modal starts closed
      logoutModal.hidden = true;

      // Open modal on logout click
      btnLogout.addEventListener("click", (e) => {
        e.preventDefault();
        openLogoutModal();
      });

      // Cancel closes modal
      cancelLogout.addEventListener("click", (e) => {
        e.preventDefault();
        closeLogoutModal();
      });

      // Click outside modal closes it (nice UX)
      logoutModal.addEventListener("click", (e) => {
        if (e.target === logoutModal) closeLogoutModal();
      });

      // Esc closes modal
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && logoutModal && !logoutModal.hidden) {
          closeLogoutModal();
        }
      });

      // Confirm logout performs the logout request
      confirmLogout.addEventListener("click", async (e) => {
        e.preventDefault();

        try {
          const response = await fetch("/logout", {
            method: "POST",
            headers: { Accept: "application/json" },
            credentials: "include",
          });

          if (response.ok) {
            window.location.href = "/";
          } else {
            alert("Logout failed. Please try again.");
            closeLogoutModal();
          }
        } catch (error) {
          console.error("Error during logout:", error);
          alert("Network error during logout.");
          closeLogoutModal();
        }
      });
    } else {
      // Fallback: old direct logout behavior (in case modal isn't in HTML yet)
      btnLogout.addEventListener("click", async () => {
        try {
          const response = await fetch("/logout", {
            method: "POST",
            headers: { Accept: "application/json" },
            credentials: "include",
          });

          if (response.ok) {
            window.location.href = "/";
          } else {
            alert("Logout failed. Please try again.");
          }
        } catch (error) {
          console.error("Error during logout:", error);
          alert("Network error during logout.");
        }
      });
    }
  }
});
