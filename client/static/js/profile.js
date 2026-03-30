// Load user details and setup logout handler
window.addEventListener("DOMContentLoaded", async () => {
  const statusEl = document.getElementById("user-details-status");
  const containerEl = document.getElementById("user-details-container");
  let currentUserPlan = 0;

  function formatDateDMY(value) {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

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
    currentUserPlan = Number(user.plan ?? 0);
    document.getElementById("detail-plan").textContent =
      currentUserPlan === 0 ? "Free" : "Premium";

    document.getElementById("detail-created").textContent = formatDateDMY(user.created_at);

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
  const btnCancelSubscription = document.getElementById("btn-cancel-subscription");
  const subscriptionStatusHint = document.getElementById("subscription-status-hint");
  const subscriptionStatusBanner = document.getElementById("subscription-status-banner");

  const cancelSubModal = document.getElementById("cancel-subscription-modal");
  const cancelReasonSelect = document.getElementById("cancel-reason-select");
  const cancelSubCloseBtn = document.getElementById("cancel-subscription-close");
  const confirmCancelSubBtn = document.getElementById("confirm-cancel-subscription");

  const cancelSuccessModal = document.getElementById("cancel-subscription-success-modal");
  const cancelSuccessCloseBtn = document.getElementById("cancel-success-close");
  const cancelSuccessText = document.getElementById("cancel-success-text");

  let cancellationAlreadyScheduled = false;

  function isDateClose(dateValue) {
    if (!dateValue) return false;
    const nowMs = Date.now();
    const thenMs = dateValue.getTime();
    const msUntil = thenMs - nowMs;
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    return msUntil >= 0 && msUntil <= threeDaysMs;
  }

  function normalizeStatusLabel(rawStatus) {
    const status = String(rawStatus || "none").toLowerCase();
    if (status === "cancel_scheduled") return "Canceled";
    if (status === "canceled") return "Canceled";
    if (status === "active") return "Active";
    return "None";
  }

  async function loadSubscriptionStatus() {
    try {
      const response = await fetch("/billing/subscription/status", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
      });

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      cancellationAlreadyScheduled = Boolean(data.cancel_at_period_end);
      const rawStatus = String(data.status || "none").toLowerCase();
      const periodEndDate = data.billing_period_end ? new Date(data.billing_period_end) : null;
      const closeToDate = periodEndDate ? isDateClose(periodEndDate) : false;

      if (btnCancelSubscription) {
        const isPaidPlan = Number(data.plan ?? currentUserPlan ?? 0) > 0;
        btnCancelSubscription.hidden = !isPaidPlan;
        btnCancelSubscription.disabled = cancellationAlreadyScheduled;
        if (cancellationAlreadyScheduled) {
          btnCancelSubscription.textContent = "Subscription already canceled";
        } else {
          btnCancelSubscription.textContent = "Cancel subscription";
        }
      }

      if (subscriptionStatusHint) {
        if (cancellationAlreadyScheduled && data.billing_period_end) {
          const endDate = formatDateDMY(periodEndDate);
          subscriptionStatusHint.textContent = `Cancellation scheduled. Active until ${endDate}.`;
          subscriptionStatusHint.hidden = false;
        } else if (data.status === "active" && data.billing_period_end) {
          const nextPaymentDate = formatDateDMY(periodEndDate);
          subscriptionStatusHint.textContent = `Next payment on ${nextPaymentDate}.`;
          subscriptionStatusHint.hidden = false;
        } else {
          subscriptionStatusHint.hidden = true;
        }
      }

      if (subscriptionStatusBanner) {
        const statusLabel = normalizeStatusLabel(rawStatus);
        if (rawStatus === "active" && periodEndDate) {
          subscriptionStatusBanner.textContent = `Subscription: ${statusLabel} · Next payment ${formatDateDMY(periodEndDate)}`;
          subscriptionStatusBanner.hidden = false;
        } else if ((rawStatus === "cancel_scheduled" || rawStatus === "canceled") && periodEndDate) {
          subscriptionStatusBanner.textContent = `Subscription: ${statusLabel} · Expires ${formatDateDMY(periodEndDate)}`;
          subscriptionStatusBanner.hidden = false;
        } else {
          subscriptionStatusBanner.textContent = `Subscription: ${statusLabel}`;
          subscriptionStatusBanner.hidden = false;
        }

        subscriptionStatusBanner.classList.remove(
          "status-active",
          "status-cancel-scheduled",
          "status-canceled",
          "status-none",
          "status-warning"
        );

        if (rawStatus === "active") {
          subscriptionStatusBanner.classList.add("status-active");
        } else if (rawStatus === "cancel_scheduled") {
          subscriptionStatusBanner.classList.add("status-cancel-scheduled");
        } else if (rawStatus === "canceled") {
          subscriptionStatusBanner.classList.add("status-canceled");
        } else {
          subscriptionStatusBanner.classList.add("status-none");
        }

        if (closeToDate && (rawStatus === "active" || rawStatus === "cancel_scheduled" || rawStatus === "canceled")) {
          subscriptionStatusBanner.classList.add("status-warning");
        }
      }
    } catch (err) {
      console.error("Failed to load subscription status:", err);
    }
  }

  function openSheet() {
    settingsOverlay.hidden = false;
    settingsOverlay.setAttribute('aria-hidden', 'false');
  }
  function closeSheet() {
    settingsOverlay.hidden = true;
    settingsOverlay.setAttribute('aria-hidden', 'true');
  }

  function openCancelSubModal() {
    if (!cancelSubModal) return;
    cancelSubModal.hidden = false;
    cancelSubModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }

  function closeCancelSubModal() {
    if (!cancelSubModal) return;
    cancelSubModal.hidden = true;
    cancelSubModal.setAttribute("aria-hidden", "true");
    if (cancelReasonSelect) {
      cancelReasonSelect.value = "";
    }
    if (confirmCancelSubBtn) {
      confirmCancelSubBtn.disabled = false;
    }
    document.body.classList.remove("modal-open");
  }

  function openCancelSuccessModal(message) {
    if (!cancelSuccessModal) return;
    if (cancelSuccessText && message) {
      cancelSuccessText.textContent = message;
    }
    cancelSuccessModal.hidden = false;
    cancelSuccessModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }

  function closeCancelSuccessModal() {
    if (!cancelSuccessModal) return;
    cancelSuccessModal.hidden = true;
    cancelSuccessModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }

  btnSettings?.addEventListener('click', openSheet);
  document.getElementById('btn-close-settings')?.addEventListener('click', closeSheet);
  settingsOverlay?.addEventListener('click', e => {
    if (e.target === settingsOverlay) closeSheet();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && settingsOverlay && !settingsOverlay.hidden) closeSheet();
  });

  if (btnCancelSubscription) {
    btnCancelSubscription.addEventListener("click", (e) => {
      e.preventDefault();
      if (cancellationAlreadyScheduled) {
        return;
      }
      openCancelSubModal();
    });
  }

  cancelSubCloseBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    closeCancelSubModal();
  });

  cancelSubModal?.addEventListener("click", (e) => {
    if (e.target === cancelSubModal) {
      closeCancelSubModal();
    }
  });

  cancelSuccessCloseBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    closeCancelSuccessModal();
  });

  cancelSuccessModal?.addEventListener("click", (e) => {
    if (e.target === cancelSuccessModal) {
      closeCancelSuccessModal();
    }
  });

  confirmCancelSubBtn?.addEventListener("click", async (e) => {
    e.preventDefault();

    const selectedReason = cancelReasonSelect?.value || "";
    if (!selectedReason) {
      alert("Please select a reason for cancellation.");
      return;
    }

    confirmCancelSubBtn.disabled = true;
    try {
      const response = await fetch("/billing/subscription/cancel-at-period-end", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ reason: selectedReason }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = data.detail || "Unable to cancel subscription right now.";
        alert(msg);
        confirmCancelSubBtn.disabled = false;
        return;
      }

      closeCancelSubModal();
      closeSheet();

      const end = data.plan_active_until ? formatDateDMY(data.plan_active_until) : null;
      const successMessage = end
        ? `Your subscription remains active until ${end}.`
        : "Your subscription remains active until the end of your current billing period.";

      openCancelSuccessModal(successMessage);
      cancellationAlreadyScheduled = true;
      await loadSubscriptionStatus();
    } catch (err) {
      console.error("Error cancelling subscription:", err);
      alert("Network error while cancelling subscription.");
      confirmCancelSubBtn.disabled = false;
    }
  });

  await loadSubscriptionStatus();

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
