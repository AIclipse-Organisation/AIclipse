// Load user details and setup logout handler
window.addEventListener("DOMContentLoaded", async () => {
  const statusEl = document.getElementById("user-details-status");
  const containerEl = document.getElementById("user-details-container");

  try {
    statusEl.textContent = "";
    statusEl.className = "status-message";

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

    const currentStreak = user.current_streak || 0;
    const communityScore = user.community_score || 0;

    // Populate new stat elements
    const el = id => document.getElementById(id);
    if (el('detail-streak')) el('detail-streak').textContent = currentStreak;
    if (el('detail-score'))  el('detail-score').textContent  = communityScore;
    if (el('detail-accuracy')) el('detail-accuracy').textContent = adminTotal > 0
      ? adminAccuracy.toFixed(0) + '%' : '—';

    // XP bar labels (set immediately; fill animates after container is shown)
    const xpLevel = Math.floor(communityScore / 50) + 1;
    const xpProgress = (communityScore % 50) / 50;
    const profileXpLevelLabel = document.getElementById("profile-xp-level-label");
    const profileXpNextLabel = document.getElementById("profile-xp-next-label");
    if (profileXpLevelLabel) profileXpLevelLabel.textContent = `Lv.${xpLevel}`;
    if (profileXpNextLabel) profileXpNextLabel.textContent = `Lv.${xpLevel + 1}`;

    document.getElementById("detail-monthly-usage").textContent =
      user.monthly_usage_count !== undefined ? user.monthly_usage_count : 0;

    // Show container and hide status
    statusEl.textContent = "";
    statusEl.className = "status-message";
    containerEl.style.visibility = "visible";

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

  // =========================
  // Settings bottom sheet
  // =========================
  const btnSettings     = document.getElementById('btn-settings');
  const settingsOverlay = document.getElementById('settings-sheet-overlay');

  function openSheet() {
    settingsOverlay.hidden = false;
    settingsOverlay.setAttribute('aria-hidden', 'false');
  }
  function closeSheet() {
    settingsOverlay.hidden = true;
    settingsOverlay.setAttribute('aria-hidden', 'true');
  }

  btnSettings?.addEventListener('click', openSheet);
  document.getElementById('btn-close-settings')?.addEventListener('click', closeSheet);
  settingsOverlay?.addEventListener('click', e => {
    if (e.target === settingsOverlay) closeSheet();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && settingsOverlay && !settingsOverlay.hidden) closeSheet();
  });

  // =========================
  // Delete account confirm modal logic
  // =========================
  const btnDeleteAccount = document.getElementById("btn-delete-account");
  const deleteAccountModal = document.getElementById("delete-account-modal");
  const cancelDeleteAccount = document.getElementById("cancel-delete-account");
  const confirmDeleteAccount = document.getElementById("confirm-delete-account");
  const deleteModalCard = deleteAccountModal?.querySelector(".delete-modal");

  const openDeleteAccountModal = () => {
    if (!deleteAccountModal) return;
    deleteAccountModal.hidden = false;
    deleteAccountModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  };

  const closeDeleteAccountModal = () => {
    if (!deleteAccountModal) return;
    deleteAccountModal.hidden = true;
    deleteAccountModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    confirmDeleteAccount.disabled = false;
  };

  if (btnDeleteAccount && deleteAccountModal && cancelDeleteAccount && confirmDeleteAccount) {
    deleteAccountModal.hidden = true;
    deleteAccountModal.setAttribute("aria-hidden", "true");

    btnDeleteAccount.addEventListener("click", (e) => {
      e.preventDefault();
      closeSheet();
      openDeleteAccountModal();
    });

    cancelDeleteAccount.addEventListener("click", (e) => {
      e.preventDefault();
      closeDeleteAccountModal();
    });

    deleteAccountModal.addEventListener("click", (e) => {
      if (e.target === deleteAccountModal) {
        closeDeleteAccountModal();
      }
    });

    if (deleteModalCard) {
      deleteModalCard.addEventListener("click", (e) => {
        e.stopPropagation();
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !deleteAccountModal.hidden) {
        closeDeleteAccountModal();
      }
    });

    confirmDeleteAccount.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      confirmDeleteAccount.disabled = true;

      try {
        const response = await fetch("/auth/me", {
          method: "DELETE",
          headers: { Accept: "application/json" },
          credentials: "include",
        });

        let data = null;
        try {
          data = await response.json();
        } catch (_) {
          data = null;
        }

        if (response.ok) {
          window.location.href = "/";
          return;
        }

        const message =
          data?.detail ||
          data?.message ||
          "Failed to delete account. Please try again.";

        alert(message);
        closeDeleteAccountModal();
      } catch (error) {
        console.error("Error deleting account:", error);
        alert("Network error during account deletion.");
        closeDeleteAccountModal();
      }
    });
  }
});
