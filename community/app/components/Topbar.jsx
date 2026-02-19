"use client";
import { useState } from "react";

export default function Topbar({ isAdmin, userName = "Not signed in" }) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleMenu = () => setIsOpen(!isOpen);

  const handleLogout = async () => {
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

        <div className="topbar-logo">
          <img src="/static/images/aiclipse_logo_gold.png" alt="Logo" />
        </div>

        <div className="topbar-user">
          <a href="/profile" className="topbar-avatar">
            <img src="/static/images/profile.png" alt="Profile" />
          </a>
          <div id="current-user-chip" className="badge muted">
            {userName}
          </div>
        </div>
      </div>

      <div 
        className="menu-overlay" 
        style={{ display: isOpen ? "block" : "none" }}
        onClick={() => setIsOpen(false)}
      ></div>

      <aside className={`nav-drawer ${isOpen ? "active" : ""}`}>
        <div className="drawer-header">
          <div id="drawer-user-name">Menu</div>
          <button className="close-button" onClick={() => setIsOpen(false)}>&times;</button>
        </div>

        <nav className="drawer-links">
          <a href="/community" onClick={() => setIsOpen(false)}>Home</a>
          <a href="/profile" onClick={() => setIsOpen(false)}>Profile</a>
          <a href="/plan" onClick={() => setIsOpen(false)}>Subscription Plan</a>
          <a href="/contact" onClick={() => setIsOpen(false)}>Contact Us</a>

          <div className="drawer-separator"></div>

          <a href="/dev" onClick={() => setIsOpen(false)}>For Devs</a>

          {isAdmin && (
            <a 
              href="/admin" 
              className="admin-link" 
              style={{ color: "#ff4444", fontWeight: "bold" }}
              onClick={() => setIsOpen(false)}
            >
              Admin Dashboard
            </a>
          )}

          <div className="drawer-separator"></div>
          
          <button 
            className="logout-button" 
            onClick={handleLogout}
            style={{ background: "none", border: "none", textAlign: "left", cursor: "pointer", paddingLeft: "25px", fontSize: "1rem", color: "#f3f3f3" }}
          >
            Logout
          </button>
        </nav>
      </aside>
    </>
  );
}