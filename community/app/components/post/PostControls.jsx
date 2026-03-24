export default function PostControls({
  voteUpRef,
  voteDownRef,
  commentBtnRef,
  onVoteUp,
  onVoteDown,
  onToggleComments,
  userHasVoted,
  busy,
  upCount,
  downCount,
  commentCount,
}) {
  return (
    <div className="comm_bottomRow">
      <div className="comm_actionsLeft">
        <button ref={voteUpRef} type="button" onClick={onVoteUp} disabled={busy || userHasVoted} className="comm_actionBtn comm_voteUp">
          <img className="comm_icon" src="/static/images/upvote.png" alt="" />
          <span className="comm_actionText">REAL</span>
          {userHasVoted && <span className="comm_actionCount">{upCount}</span>}
        </button>
        <button ref={voteDownRef} type="button" onClick={onVoteDown} disabled={busy || userHasVoted} className="comm_actionBtn comm_voteDown">
          <img className="comm_icon" src="/static/images/downvote.png" alt="" />
          <span className="comm_actionText">FAKE</span>
          {userHasVoted && <span className="comm_actionCount">{downCount}</span>}
        </button>
      </div>
      <div className="comm_actionsRight">
        <button ref={commentBtnRef} type="button" onClick={onToggleComments} className="comm_actionBtn comm_commentBtn">
          <img className="comm_icon" src="/static/images/comment.png" alt="" />
          {commentCount > 0 && <span className="comm_actionCount">{commentCount}</span>}
        </button>
      </div>
    </div>
  );
}