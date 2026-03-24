"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Topbar({ isAdmin, showBack }) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  const toggleMenu = () => setIsOpen((prev) => !prev);
  const closeMenu = () => setIsOpen(false);

  const handleLogout = async () => {
    closeMenu();

    try {
      const res = await fetch("/logout", { method: "POST" });
      if (res.ok) window.location.href = "/";
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
      <div className="topbar">
        {showBack ? (
          <button
            className="topbar-back-btn"
            type="button"
            aria-label="Go back"
            onClick={() => router.back()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        ) : (
          <button
            className="menu-button"
            type="button"
            aria-label="Menu"
            onClick={toggleMenu}
          >
            <span className="hamburger-line"></span>
            <span className="hamburger-line"></span>
            <span className="hamburger-line"></span>
          </button>
        )}

        <div className="topbar-center">
          <span className="topbar-screen-name">Community</span>
        </div>

        <div className="topbar-logo">
          <img src="/static/images/aiclipse_logo_gold.png" alt="Logo" />
        </div>
      </div>

      <div
        className="menu-overlay"
        style={{ display: isOpen ? "block" : "none" }}
        onClick={closeMenu}
      ></div>

      <aside className={`nav-drawer ${isOpen ? "active" : ""}`}>
        <div className="drawer-header">
          <div id="drawer-user-name">Menu</div>
          <button
            className="close-button"
            type="button"
            aria-label="Close menu"
            onClick={closeMenu}
          >
            &times;
          </button>
        </div>

        <nav className="drawer-links">
          <a href="/community" onClick={closeMenu}>
            <span className="drawer-link-icon" aria-hidden="true">
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
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            </span>
            <span>Home</span>
          </a>

          <a href="/profile" onClick={closeMenu}>
            <span className="drawer-link-icon" aria-hidden="true">
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
            </span>
            <span>Profile</span>
          </a>

          <a href="/upload" onClick={closeMenu}>
            <span className="drawer-link-icon" aria-hidden="true">
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
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="12" y1="8" x2="12" y2="16"></line>
                <line x1="8" y1="12" x2="16" y2="12"></line>
              </svg>
            </span>
            <span>Upload</span>
          </a>

          <a href="/notification" onClick={closeMenu}>
            <span className="drawer-link-icon" aria-hidden="true">
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
            </span>
            <span>Notifications</span>
          </a>

          <a href="/plan" onClick={closeMenu}>
            <span className="drawer-link-icon" aria-hidden="true">
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
            </span>
            <span>Subscription Plan</span>
          </a>

          <div className="drawer-separator"></div>
          
          <button
            className="logout-button"
            type="button"
            onClick={() => {
              closeMenu();
              setTimeout(() => {
                window.AIclipseTutorial?.openCenter?.();
              }, 0);
            }}
          >
            <span className="drawer-link-icon" aria-hidden="true">
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
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M9.09 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3"></path>
                <path d="M12 17h.01"></path>
              </svg>
            </span>
            <span>Tutorial</span>
          </button>

          <a href="/contact" onClick={closeMenu}>
            <span className="drawer-link-icon" aria-hidden="true">
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
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
            </span>
            <span>Contact Us</span>
          </a>

          <a href="/dev" onClick={closeMenu}>
            <span className="drawer-link-icon" aria-hidden="true">
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
                <polyline points="16 18 22 12 16 6"></polyline>
                <polyline points="8 6 2 12 8 18"></polyline>
              </svg>
            </span>
            <span>For Devs</span>
          </a>

          {isAdmin && (
            <a href="/admin" className="admin-link" onClick={closeMenu}>
              <span className="drawer-link-icon" aria-hidden="true">
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
                  <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z"></path>
                  <path d="M9 12l2 2 4-4"></path>
                </svg>
              </span>
              <span>Admin Dashboard</span>
            </a>
          )}

          <div className="drawer-separator"></div>

          <button
            className="logout-button"
            type="button"
            onClick={handleLogout}
          >
            <span className="drawer-link-icon" aria-hidden="true">
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
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
            </span>
            <span>Logout</span>
          </button>
        </nav>
      </aside>
    </>
  );
}