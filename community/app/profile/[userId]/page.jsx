import ProfilePostsGrid from "./ProfilePostsGrid";
import "./profile.css";

const GATEWAY_URI = process.env.GATEWAY_URI;

function getLevel(score) {
  return Math.floor(score / 50) + 1;
}

function getXpProgress(score) {
  return (score % 50) / 50;
}

function getAccuracyLabel(correct, total) {
  if (total === 0) return "—";
  const pct = (correct / total) * 100;
  if (pct >= 75) return "Expert";
  if (pct >= 50) return "Advanced";
  if (pct >= 25) return "Intermediate";
  return "Novice";
}


async function fetchUser(userId) {
  try {
    const res = await fetch(`${GATEWAY_URI}/auth/public/user/${userId}`, {
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Status ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

export default async function ProfilePage({ params }) {
  const { userId } = await params;
  const user = await fetchUser(userId);

  if (!user) {
    return (
      <div className="pub-profileScreen">
        <p className="pub-profile-notFound">User not found.</p>
      </div>
    );
  }

  const score = user.community_score ?? 0;
  const streak = user.current_streak ?? 0;
  const correct = user.admin_guesses_correct ?? 0;
  const total = user.admin_guesses_total ?? 0;
  const accuracyPct = total > 0 ? ((correct / total) * 100).toFixed(0) + "%" : "—";

  const level = getLevel(score);
  const xpProgress = getXpProgress(score);
  const accuracyLabel = getAccuracyLabel(correct, total);

  return (
    <div className="pub-profileScreen">

      {/* ── SUMMARY ── */}
      <section className="pub-profile-summary">
        <div className="pub-profile-avatar">
          <img src="/static/images/profile.png" alt="" className="pub-profile-avatar-img" aria-hidden="true" />
        </div>
        <div className="pub-profile-identity">
          <div className="pub-profile-name-row">
            <span className="pub-profile-username">{user.user_name}</span>
            <span className="pub-profile-badge">Lv.{level}</span>
          </div>
          {user.created_at && (
            <div className="pub-profile-meta-row">
              Member since <span>{new Date(user.created_at).toLocaleDateString()}</span>
            </div>
          )}
        </div>
      </section>

      {/* ── STATS + XP ── */}
      <div className="pub-stats-xp-wrapper">
        <div className="pub-user-details-container">

          <div className="pub-user-detail-item">
            <div className="pub-detail-text">
              <span className="pub-detail-value">{accuracyLabel}</span>
              <span className="pub-detail-label">Level</span>
            </div>
          </div>

          <div className="pub-user-detail-item">
            <img src="/static/images/flame-black.png" alt="" className="pub-detail-icon" aria-hidden="true" />
            <div className="pub-detail-text">
              <span className="pub-detail-value">{streak}</span>
              <span className="pub-detail-label">Streak</span>
            </div>
          </div>

          <div className="pub-user-detail-item">
            <img src="/static/images/star-black.png" alt="" className="pub-detail-icon" aria-hidden="true" />
            <div className="pub-detail-text">
              <span className="pub-detail-value">{score}</span>
              <span className="pub-detail-label">Score</span>
            </div>
          </div>

          <div className="pub-user-detail-item">
            <img src="/static/images/accuracy-black.png" alt="" className="pub-detail-icon" aria-hidden="true" />
            <div className="pub-detail-text">
              <span className="pub-detail-value">{accuracyPct}</span>
              <span className="pub-detail-label">Accuracy</span>
            </div>
          </div>

        </div>

        <div className="pub-profile-xp-bar">
          <span className="pub-profile-xp-label">Lv.{level}</span>
          <div className="pub-profile-xp-track">
            <div className="pub-profile-xp-fill" style={{ width: `${xpProgress * 100}%` }} />
          </div>
          <span className="pub-profile-xp-label">Lv.{level + 1}</span>
        </div>
      </div>

      {/* ── POSTS ── */}
      <ProfilePostsGrid userId={userId} />
    </div>
  );
}
