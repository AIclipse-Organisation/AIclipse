"use client";

import { useEffect, useState } from "react";

export default function BottomNav() {
  const [showNotifDot, setShowNotifDot] = useState(false);

  useEffect(() => {
    let alive = true;

    async function loadUnread() {
      try {
        const res = await fetch("/community/notifications/unread-count", {
          credentials: "include",
          headers: { Accept: "application/json" },
        });

        if (!res.ok) {
          if (alive) setShowNotifDot(false);
          return;
        }

        const data = await res.json().catch(() => ({}));
        const unread = Number(data?.unread_count || 0);
        if (alive) setShowNotifDot(unread > 0);
      } catch {
        if (alive) setShowNotifDot(false);
      }
    }

    loadUnread();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <nav className="navbar" id="bottom-nav" aria-label="Bottom navigation">
      <a href="/community" aria-label="Home" className="active">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#CFB87C"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="home_tab_bottomNav"
        >
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
      </a>

      <a href="/profile" aria-label="Profile">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </a>

      <a href="/upload" aria-label="Upload">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="12" y1="8" x2="12" y2="16"></line>
          <line x1="8" y1="12" x2="16" y2="12"></line>
        </svg>
      </a>

      <a href="/notification" aria-label="Notifications">
        <span className="nav-icon-wrap" style={{ position: "relative", display: "inline-block" }}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path>
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path>
          </svg>
          <span className="notif-dot" hidden={!showNotifDot} />
        </span>
      </a>

      <a href="/plan" aria-label="Premium Plan">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 3h12l4 6-10 13L2 9Z"></path>
          <path d="M2 9h20"></path>
        </svg>
      </a>
    </nav>
  );
}