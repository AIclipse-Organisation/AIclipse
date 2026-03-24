export default function PostResults({
  userHasVoted,
  analysisBucket,
  analysisAiPct,
  communityBucket,
  communityAiPct,
  setWidthStyle,
}) {
  return (
    <div className="comm_bars_wrapper">
      {!userHasVoted && <div className="comm_vote_prompt">Vote to see results</div>}
      <div className={`comm_bars ${!userHasVoted ? "is-hidden" : "is-revealed"}`}>
        
        {/* AICLIPSE BAR */}
        <div className={`comm_barBlock is-${analysisBucket.type}`}>
          <div className="comm_barHead">
            <div className="comm_resultAvatar">
              <img src="/static/images/aiclipse_logo_gold.png" alt="" className="comm_resultIcon" />
            </div>
            <div className="comm_barVerdict">{analysisBucket.text}</div>
          </div>
          {/* ADDED MISSING WRAPPER HERE */}
          <div className="comm_progressPanel">
            <div className="comm_progressBar">
              <div className="comm_progressFill" style={{ width: setWidthStyle(analysisAiPct) }} />
              <div className="comm_barPercent">{Math.round(analysisAiPct)}%</div>
            </div>
          </div>
        </div>
        
        {/* COMMUNITY BAR */}
        <div className="comm_barBlock comm_communityBar">
          <div className="comm_barHead">
           <div className="comm_resultAvatar_icon">
              <svg className="comm_resultIcon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
              </svg>
            </div>
            <div className="comm_barVerdict">{communityBucket?.text || "No community votes"}</div>
          </div>
          {/* ADDED MISSING WRAPPER HERE */}
          <div className="comm_progressPanel">
            <div className="comm_progressBar">
              <div className="comm_progressFill" style={{ width: setWidthStyle(communityAiPct || 0) }} />
              <div className="comm_barPercent">
                {communityAiPct !== null ? Math.round(communityAiPct) + "%" : "—"}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}