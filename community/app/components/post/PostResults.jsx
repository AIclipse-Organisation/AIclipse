const GRADIENT_AICLIPSE  = "#cfb87c 0%, #cfb87c 40%, #e07043 60%, #cc2222 100%";
const GRADIENT_COMMUNITY = "#af83c9 0%, #af83c9 40%, #d06bb0 60%, #cc2222 100%";

// Zone gradient anchored to bar width + a sheen overlay that spans the fill
// for visual progression as the bar grows.
function fillStyle(aiPct, gradient) {
  const pct = Math.max(aiPct, 0.1);
  const zoneSize = `${(10000 / pct).toFixed(2)}%`;
  return {
    background: `
      linear-gradient(to right, rgba(0,0,0,0.28), transparent) left / 100% 100% no-repeat,
      linear-gradient(to right, ${gradient}) left / ${zoneSize} 100% no-repeat
    `,
  };
}

function activeZone(aiPct) {
  if (aiPct < 40) return "safe";
  if (aiPct <= 60) return "neutral";
  return "risk";
}

function zoneLabel(type, active, position, text) {
  const isActive = type === active;
  return (
    <span
      className={`comm_zoneLabel comm_zoneLabel--${type}${isActive ? " comm_zoneLabel--active" : ""}`}
      style={{ left: position }}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}

export default function PostResults({
  userHasVoted,
  analysisBucket,
  analysisAiPct,
  communityBucket,
  communityAiPct,
  setWidthStyle,
}) {
  const analysisActive = activeZone(analysisAiPct);
  const communityActive = activeZone(communityAiPct ?? 0);

  return (
    <div className="comm_bars_wrapper">
      {!userHasVoted && <div className="comm_vote_prompt">Vote to see results</div>}
      <div className={`comm_bars ${!userHasVoted ? "is-hidden" : "is-revealed"}`}>

        {/* AICLIPSE BAR */}
        <div className={`comm_barBlock is-${analysisBucket.type}`}>
          <div className="comm_barHead">
            <div className="comm_barSourceLabel">
              <div className="comm_resultAvatar">
                <img src="/static/images/aiclipse_moon.png" alt="" className="comm_resultIcon" />
              </div>
              <span>AIclipse</span>
            </div>
          </div>

          <div className="comm_barTrackWrap">
            {zoneLabel("safe", analysisActive, "20%", "Real")}
            {zoneLabel("neutral", analysisActive, "50%", "Suspicious")}
            {zoneLabel("risk", analysisActive, "80%", "Fake")}
            <div className="comm_progressPanel">
              <div className="comm_progressBar">
                <div
                  className="comm_progressFill"
                  style={{
                    width: setWidthStyle(analysisAiPct),
                    ...fillStyle(analysisAiPct, GRADIENT_AICLIPSE),
                  }}
                />
                <div className="comm_barMarker" style={{ left: "40%" }} />
                <div className="comm_barMarker" style={{ left: "60%" }} />
                <div className="comm_barPercent">{Math.round(analysisAiPct)}%</div>
              </div>
            </div>
          </div>
        </div>

        {/* COMMUNITY BAR */}
        <div className="comm_barBlock comm_communityBar">
          <div className="comm_barHead">
            <div className="comm_barSourceLabel">
              <div className="comm_resultAvatar_icon">
                <svg className="comm_resultIcon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                </svg>
              </div>
              <span>Community</span>
            </div>
          </div>

          <div className="comm_barTrackWrap">
            {zoneLabel("safe", communityActive, "20%", "Real")}
            {zoneLabel("neutral", communityActive, "50%", "Suspicious")}
            {zoneLabel("risk", communityActive, "80%", "Fake")}
            <div className="comm_progressPanel">
              <div className="comm_progressBar">
                <div
                  className="comm_progressFill"
                  style={{
                    width: setWidthStyle(communityAiPct || 0),
                    ...fillStyle(communityAiPct || 0, GRADIENT_COMMUNITY),
                  }}
                />
                <div className="comm_barMarker" style={{ left: "40%" }} />
                <div className="comm_barMarker" style={{ left: "60%" }} />
                <div className="comm_barPercent">
                  {communityAiPct !== null ? Math.round(communityAiPct) + "%" : "—"}
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}