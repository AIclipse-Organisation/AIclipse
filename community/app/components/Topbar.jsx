export default function Topbar() {
  return (
    <div className="topbar">
      <button className="menu-button" type="button" aria-label="Menu">
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
          raphy · plan 0
        </div>
      </div>
    </div>
  );
}
