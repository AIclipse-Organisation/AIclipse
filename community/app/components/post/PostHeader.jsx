import Link from "next/link"; // kept for profile links

export default function PostHeader({
  initials,
  posterName,
  userId,
  isOfficial,
  userHasVoted,
  timeText,
  isTrending,
  postId,
  isOwner,
  isReported,
  menuOpen,
  setMenuOpen,
  closeMenu,
  onOpenReport,
  onViewScan,
}) {
  const hasBadges = (isOfficial && userHasVoted) || isTrending;

  return (
    <div className="comm_topRow">
      <div className="comm_headerLeft">
        <div className="comm_avatar" aria-hidden="true">
          <div className="comm_avatarInitials">{initials}</div>
        </div>
        <div className="comm_headerMeta">
          <div className="comm_headerNameLine">
            {userId ? (
              <Link href={`/profile/${userId}`} className="comm_headerName comm_headerNameLink">{posterName}</Link>
            ) : (
              <div className="comm_headerName">{posterName}</div>
            )}
          </div>
          {timeText && <div className="comm_headerTime">{timeText}</div>}
        </div>
      </div>
      <div className="comm_headerActions">
        {hasBadges && (
          <div className="comm_badgeRow">
            {isOfficial && userHasVoted && (
              <span className="comm_badge comm_badge--official">Official</span>
            )}
            {isTrending && (
              <span className="comm_badge comm_badge--popular">Popular</span>
            )}
          </div>
        )}
        <div className="comm_menu">
          <button
            type="button"
            className="comm_menuBtn"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={!postId}
          >
            ⋮
          </button>
          {menuOpen && <div className="comm_menuBackdrop" onClick={closeMenu} />}
          {menuOpen && (
            <div className="comm_menuPanel" role="menu">
              {isOwner && (
                <button
                  type="button"
                  className="comm_menuItem"
                  onClick={() => { closeMenu(); onViewScan?.(); }}
                >
                  View Scan
                </button>
              )}
              <button
                type="button"
                className="comm_menuItem"
                onClick={onOpenReport}
                disabled={isReported}
              >
                {isReported ? "Reported" : "Report"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}