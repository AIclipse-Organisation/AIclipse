import { useState, useEffect } from 'react';

const GRADIENT_AICLIPSE = "#cfb87c 0%, #cfb87c 40%, #e07043 60%, #cc2222 100%";
const GRADIENT_COMMUNITY = "#c9a3e0 0%, #c9a3e0 40%, #af83c9 60%, #8a4fb5 100%";
const GRADIENT_COMMUNITY_FAKE = "#e8916d 0%, #e8916d 30%, #cc2222 100%";

// Scrambling number animation hook
function useScrambledNumber(finalValue, shouldAnimate, delay = 0) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (!shouldAnimate) {
      setDisplayValue(finalValue);
      return;
    }

    const startTime = Date.now() + delay;
    const duration = 1500; // 1.5 seconds of scrambling
    const scrambleDuration = 1200; // Scramble for first 1.2 seconds

    const animate = () => {
      const elapsed = Date.now() - startTime;

      if (elapsed < 0) {
        // Still in delay period
        setDisplayValue(0);
        requestAnimationFrame(animate);
        return;
      }

      if (elapsed < scrambleDuration) {
        // Scrambling phase - show random numbers
        const randomValue = Math.floor(Math.random() * 100);
        setDisplayValue(randomValue);
        requestAnimationFrame(animate);
      } else if (elapsed < duration) {
        // Settling phase - ease towards final value
        const settleProgress = (elapsed - scrambleDuration) / (duration - scrambleDuration);
        const eased = 1 - Math.pow(1 - settleProgress, 3); // Ease out cubic
        const currentValue = Math.round(eased * finalValue);
        setDisplayValue(currentValue);
        requestAnimationFrame(animate);
      } else {
        // Animation complete
        setDisplayValue(finalValue);
      }
    };

    requestAnimationFrame(animate);
  }, [finalValue, shouldAnimate, delay]);

  return displayValue;
}

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
  communityAiPct,
  setWidthStyle,
  upCount,
  downCount,
}) {
  const analysisActive = activeZone(analysisAiPct);

  const communityRealPct = communityAiPct !== null ? 100 - communityAiPct : 0;
  const communityFakePct = communityAiPct !== null ? communityAiPct : 0;

  // Scrambled number animations
  const scrambledAiPct = useScrambledNumber(Math.round(analysisAiPct), userHasVoted, 250);
  const scrambledRealPct = useScrambledNumber(Math.round(communityRealPct), userHasVoted, 250);
  const scrambledFakePct = useScrambledNumber(Math.round(communityFakePct), userHasVoted, 250);

  return (
    <div className="comm_bars_wrapper">
      {!userHasVoted && <div className="comm_vote_prompt">Vote to see results</div>}
      <div className={`comm_bars ${!userHasVoted ? "is-hidden" : "is-revealed"}`}>

        {/* AICLIPSE BAR */}
        <div className={`comm_barBlock is-${analysisBucket.type}`}>
          <div className="comm_barTrackWrap">
            <div className="comm_barIconCol">
              <img src="/static/images/aiclipse_moon.png" alt="" className="comm_resultIcon" />
            </div>
            {zoneLabel("safe", analysisActive, "20%", "Real")}
            {zoneLabel("neutral", analysisActive, "50%", "Suspicious")}
            {zoneLabel("risk", analysisActive, "80%", "Fake")}
            <div className="comm_progressPanel">
              <div className="comm_progressBar">
                <div
                  className="comm_progressFill"
                  style={{
                    width: userHasVoted ? setWidthStyle(analysisAiPct) : "0%",
                    ...fillStyle(analysisAiPct, GRADIENT_AICLIPSE),
                  }}
                />
                <div className="comm_barMarker" style={{ left: "38%" }} />
                <div className="comm_barMarker" style={{ left: "62%" }} />
                <div className="comm_barPercent">{scrambledAiPct}%</div>
              </div>
            </div>
            <div className="comm_voteSummary comm_voteSummary--row">
              <span>AIclipse's Estimate</span>
              <span>Probability of Fakeness</span>
            </div>
          </div>
        </div>

        {/* COMMUNITY BARS */}
        <div className="comm_barBlock comm_communityBar">
          <div className="comm_communityVote">
            <div className="comm_communityIconCol">
              <svg viewBox="0 0 24 24" fill="currentColor" className="comm_communityIconSvg">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
              </svg>
            </div>
            <div className="comm_voteBars">
              <div className="comm_voteRow">
                <div className="comm_voteRowHead">
                  <span className="comm_voteLabel comm_voteLabel--real">Real</span>
                  <span className="comm_voteCount">{upCount} {upCount === 1 ? "vote" : "votes"}</span>
                </div>
                <div className="comm_voteTrack">
                  <div className="comm_voteFill comm_voteFill--real" style={{ width: userHasVoted ? setWidthStyle(communityRealPct) : "0%", ...fillStyle(communityRealPct, GRADIENT_COMMUNITY) }} />
                  <span className="comm_votePct">{scrambledRealPct}%</span>
                </div>
              </div>

              <div className="comm_voteRow">
                <div className="comm_voteRowHead">
                  <span className="comm_voteLabel comm_voteLabel--fake">Fake</span>
                  <span className="comm_voteCount">{downCount} {downCount === 1 ? "vote" : "votes"}</span>
                </div>
                <div className="comm_voteTrack">
                  <div className="comm_voteFill comm_voteFill--fake" style={{ width: userHasVoted ? setWidthStyle(communityFakePct) : "0%", ...fillStyle(communityFakePct, GRADIENT_COMMUNITY_FAKE) }} />
                  <span className="comm_votePct">{scrambledFakePct}%</span>
                </div>
              </div>

              {(upCount + downCount) > 0 && (
                <p className="comm_voteSummary">
                  Community votes · {upCount + downCount} total · verdict: {" "}
                  <span className={communityRealPct > communityFakePct ? "comm_voteSummary--real" : communityFakePct > communityRealPct ? "comm_voteSummary--fake" : "comm_voteSummary--split"}>
                    {communityRealPct > communityFakePct ? "Real" : communityFakePct > communityRealPct ? "Fake" : "Split"}
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}