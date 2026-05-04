"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export default function AdminTopbar({ isAdmin }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastScrollY = useRef(0);
  const router = useRouter();

  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY;
      if (currentY > lastScrollY.current && currentY > 50) {
        setHidden(true);
      } else {
        setHidden(false);
      }
      lastScrollY.current = currentY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

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
      <div className={`topbar${hidden ? " topbar--hidden" : ""}`}>
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

        <div className="topbar-center">
          <span className="topbar-screen-name">Admin</span>
        </div>

        <div className="topbar-logo">
          <img src="/static/images/aiclipse_logo_gold.png" alt="Logo" />
        </div>
      </div>

      <div
        className="admin-menu-overlay"
        style={{ display: isOpen ? "block" : "none" }}
        onClick={closeMenu}
      ></div>

      <aside className={`admin-nav-drawer ${isOpen ? "active" : ""}`}>
        <div className="drawer-header">
          <div id="drawer-user-name">Admin Menu</div>
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
          <a href="/community/admin" onClick={closeMenu}>
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
            <span>Community</span>
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

          <div className="drawer-footer-cta">
            <a
              href="https://www.gofundme.com/f/aiclipse-dkit-expo-2026"
              target="_blank"
              rel="noopener noreferrer"
              className="coffee-link"
            >
              <div className="coffee-icon-bg">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#222"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
                  <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
                  <line x1="6" y1="1" x2="6" y2="4"></line>
                  <line x1="10" y1="1" x2="10" y2="4"></line>
                  <line x1="14" y1="1" x2="14" y2="4"></line>
                </svg>
              </div>
              <div className="coffee-text">
                <span className="coffee-title">Buy us a coffee</span>
                <span className="coffee-subtitle">
                  Support AIclipse development
                </span>
              </div>
            </a>
          </div>

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
