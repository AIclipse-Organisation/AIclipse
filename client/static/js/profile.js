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

    // Calculate accuracy based on admin post guesses (ground truth data)
    const adminCorrect = (user.admin_guesses_correct || 0);
    const adminTotal = (user.admin_guesses_total || 0);
    const adminAccuracy = adminTotal > 0 ? (adminCorrect / adminTotal) * 100 : 0;

    let accuracyLevel;

    if (adminAccuracy >= 75) {
      accuracyLevel = "Expert";
    } else if (adminAccuracy >= 50) {
      accuracyLevel = "Advanced";
    } else if (adminAccuracy >= 25) {
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

    // Display streak and score badges next to username
    const currentStreak = user.current_streak || 0;
    const communityScore = user.community_score || 0;

    // Show streak badge if user has any streak
    const streakBadge = document.getElementById("streak-badge");
    const streakValue = document.getElementById("badge-streak-value");
    if (streakBadge && streakValue) {
      if (currentStreak > 0) {
        streakValue.textContent = currentStreak;
        streakBadge.style.display = "inline-flex";

        // Add active class for streaks 3+ days
        if (currentStreak >= 3) {
          streakBadge.classList.add("active");
        }
      }
    }

    // XP bar labels (set immediately; fill animates after container is shown)
    const xpLevel = Math.floor(communityScore / 50) + 1;
    const xpProgress = (communityScore % 50) / 50;
    const profileXpLevelLabel = document.getElementById("profile-xp-level-label");
    const profileXpNextLabel = document.getElementById("profile-xp-next-label");
    if (profileXpLevelLabel) profileXpLevelLabel.textContent = `Lv.${xpLevel}`;
    if (profileXpNextLabel) profileXpNextLabel.textContent = `Lv.${xpLevel + 1}`;

    // Show score badge if user has any score
    const scoreBadge = document.getElementById("score-badge");
    const scoreValue = document.getElementById("badge-score-value");
    if (scoreBadge && scoreValue) {
      if (communityScore > 0) {
        scoreValue.textContent = communityScore;
        scoreBadge.style.display = "inline-flex";

        // Add high-score class for scores 50+
        if (communityScore >= 50) {
          scoreBadge.classList.add("high-score");
        }
      }
    }

    document.getElementById("detail-monthly-usage").textContent =
      user.monthly_usage_count !== undefined ? user.monthly_usage_count : 0;

    // Show container and hide status
    statusEl.textContent = "";
    statusEl.className = "status-message";
    containerEl.style.display = "block";

    // Animate profile XP fill after container is visible (two frames to guarantee transition fires)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const profileXpFill = document.getElementById("profile-xp-fill");
        if (profileXpFill) profileXpFill.style.width = `${xpProgress * 100}%`;
      });
    });
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
