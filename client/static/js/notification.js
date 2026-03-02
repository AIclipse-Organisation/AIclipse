const listEl = document.getElementById("notification-list");
const statusEl = document.getElementById("notification-status");

function fmtDate(value) {
  // Return an empty string when date input is missing or invalid.
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";

  // Compacts the date format to shorter display e.g "28 Feb".
  return dt.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

function buildActionLine(item) {
  // Event count may be aggregated by backend; enforce a minimum of 1.
  const eventCount = Math.max(1, Number(item?.event_count || 1));
  const suffix = eventCount > 1 ? ` (${eventCount}x)` : "";

  // Build text based on notification type and vote payload.
  if (item?.type === "vote") {
    const vote = String(item?.vote_value || "").toLowerCase() === "real" ? "real" : "ai";
    return `voted ${vote} on your post${suffix}.`;
  }

  return `commented on your post${suffix}.`;
}

function initialsFromName(name) {
  // Create avatar initials from first and last name fragments to be used in the PFP icon next to a notification.
  const safe = String(name || "").trim();
  if (!safe) return "U";
  const parts = safe.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "U";
}

function makeNotificationCard(item) {
  // Turns the card wrapper into a clickable element with appropriate which redirects the user to the related post.
  const row = document.createElement("article");
  row.className = `notification-item${item?.is_read ? "" : " unread"}`;
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", "Open related post");

  // Open related post on click.
  row.addEventListener("click", () => openPostFromNotification(item));
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPostFromNotification(item);
    }
  });

 // Avatar icon with user initials fallback when name is missing.
  const avatarWrap = document.createElement("div");
  avatarWrap.className = "notification-avatar";
  const avatarInitials = document.createElement("span");
  avatarInitials.className = "notification-avatar-initials";
  avatarInitials.textContent = initialsFromName(item?.actor_user_name || "Someone");
  avatarWrap.appendChild(avatarInitials);

  // Main text content line (user who interacted with post + action + date).
  const content = document.createElement("div");
  content.className = "notification-content";

  const summary = document.createElement("p");
  summary.className = "notification-summary";
  const actorName = item?.actor_user_name || "Someone";
  const actorStrong = document.createElement("strong");
  actorStrong.textContent = actorName;
  summary.appendChild(actorStrong);
  summary.appendChild(
    document.createTextNode(`, ${buildActionLine(item)} ${fmtDate(item?.created_at)}.`),
  );
  content.appendChild(summary);

  // Right-side icon indicates action type.
  const iconWrap = document.createElement("div");
  iconWrap.className = "notification-icon-wrap";

  const icon = document.createElement("img");
  icon.className = "notification-action-icon";
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");

  // Vote notifications show up/down icon; comments show comment icon.
  if (item?.type === "vote") {
    const vote = String(item?.vote_value || "").toLowerCase();
    if (vote === "real") {
      icon.src = "/static/images/upvote.png";
    } else {
      icon.src = "/static/images/downvote.png";
    }
  } else {
    icon.src = "/static/images/comment.png";
  }

  iconWrap.appendChild(icon);

  row.appendChild(avatarWrap);
  row.appendChild(content);
  row.appendChild(iconWrap);

  // Return a complete, interactive card node.
  return row;
}

async function markAllNotificationsRead() {
  // Visiting notifications page marks all unread notifications as read.
  await fetch("/community/notifications/read", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ mark_all: true }),
  }).catch(() => null);

  // Notify shared UI (badge) to refresh unread state.
  window.dispatchEvent(new Event("notifications:updated"));
}

async function openPostFromNotification(item) {
  // Links notifications to their related post.
  const imageId = item?.image_id || "";

  // Fallback when no image target is available.
  if (!imageId) {
    window.location.href = "/scans";
    return;
  }

  try {
    // Fetch scan details to preload the view page state.
    const res = await fetch(`/image/${encodeURIComponent(imageId)}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const scan = data?.item || data || {};

      // Persist selected scan for `/viewscan` page consumption.
      if (scan && typeof scan === "object") {
        sessionStorage.setItem("selectedScan", JSON.stringify(scan));
      }
      window.location.href = "/viewscan";
      return;
    }
  } catch {
    // Ignore fetch errors and use fallback route below.
  }

  // Fallback destination when image lookup fails.
  window.location.href = "/scans";
}

function renderList(items) {
  // Clear existing list before rendering latest data.
  listEl.innerHTML = "";

  // Show empty-state card when there are no notifications.
  if (!Array.isArray(items) || items.length === 0) {
    statusEl.textContent = "";

    const emptyWrap = document.createElement("div");
    emptyWrap.className = "notification-empty-state";

    const emptyCard = document.createElement("div");
    emptyCard.className = "notification-empty-card";

    const emptyIcon = document.createElement("img");
    emptyIcon.className = "notification-empty-icon";
    emptyIcon.src = "/static/images/no_notifications.png";
    emptyIcon.alt = "Notifications";

    const emptyText = document.createElement("p");
    emptyText.className = "notification-empty-text";
    emptyText.textContent = "No notifications yet.";

    emptyCard.appendChild(emptyIcon);
    emptyCard.appendChild(emptyText);
    emptyWrap.appendChild(emptyCard);
    listEl.appendChild(emptyWrap);
    return;
  }

  // Render cards and clear transient status message.
  statusEl.textContent = "";
  items.forEach((item) => listEl.appendChild(makeNotificationCard(item)));
}

async function loadNotifications() {
  if (!listEl || !statusEl) return;

  // Show loading feedback while data request is in progress.
  statusEl.textContent = "Loading...";

  try {
    // Load notifications for current user session.
    const res = await fetch("/community/notifications", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      statusEl.textContent = "Failed to load notifications.";
      return;
    }

    // Parse payload safely and normalize to array.
    const data = await res.json().catch(() => ({}));
    const items = Array.isArray(data?.items) ? data.items : [];

    // Render with server read/unread state.
    renderList(items);

    // Mark as read only after successfully fetching and rendering the list.
    await markAllNotificationsRead();

    // Trigger global refresh for notification badge indicators.
    window.dispatchEvent(new Event("notifications:updated"));
  } catch {
    // Network or unexpected failure fallback message.
    statusEl.textContent = "Network error while loading notifications.";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  // Bootstrap notifications page on initial load.
  loadNotifications();
});
