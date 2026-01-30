"use client";

export default function BottomNav() {
  const path =
    typeof window !== "undefined" ? window.location.pathname : "";

  const linkClass = (href) => (path === href ? "active" : "");

  return (
    <nav className="navbar" id="bottom-nav" aria-label="Bottom navigation">
      <a className={linkClass("/home")} href="/community">Home</a>
      <a className={linkClass("/scans")} href="/scans">Scans</a>
      <a className={linkClass("/imgProcessing")} href="/imgProcessing">Upload</a>
      <a className={linkClass("/notification")} href="/notification">Notification</a>
      <a className={linkClass("/plan")} href="/plan">Plan</a>
      <a className={linkClass("/dev")} href="/dev">For Devs</a>
    </nav>
  );
}
