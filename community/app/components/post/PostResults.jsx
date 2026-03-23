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
            <div className="comm_barTitle" title="AI probability">Aiclipse</div>
            <div className="comm_barVerdict">{analysisBucket.text}</div>
          </div>
          <div className="comm_progressBar">
            <div className="comm_progressFill" style={{ width: setWidthStyle(analysisAiPct) }} />
            <div className="comm_barPercent">{analysisAiPct.toFixed(2)}%</div>
          </div>
        </div>
        
        {/* COMMUNITY BAR */}
        <div className="comm_barBlock comm_communityBar">
          <div className="comm_barHead">
            <div className="comm_barTitle" title="Community AI share">Community</div>
            <div className="comm_barVerdict">{communityBucket?.text || "No community votes"}</div>
          </div>
          <div className="comm_progressBar">
            <div className="comm_progressFill" style={{ width: setWidthStyle(communityAiPct || 0) }} />
            <div className="comm_barPercent">
              {communityAiPct !== null ? communityAiPct.toFixed(2) + "%" : "—"}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}