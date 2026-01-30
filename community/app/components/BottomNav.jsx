"use client";

export default function BottomNav() {
  const path =
    typeof window !== "undefined" ? window.location.pathname : "";

  const linkClass = (href) => (path === href ? "active" : "");

  return (
    <nav className="navbar" id="bottom-nav" aria-label="Bottom navigation">
      <a className="active" href="/community">Home</a>
      <a href="/scans">Scans</a>
      <a href="/imgProcessing">Upload</a>
      <a href="/notification">Notification</a>
      <a href="/plan">Plan</a>
      <a href="/dev">For Devs</a>
    </nav>
  );
}
