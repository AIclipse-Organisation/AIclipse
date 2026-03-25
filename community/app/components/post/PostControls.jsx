export default function PostControls({
  voteUpRef,
  voteDownRef,
  commentBtnRef,
  onVoteUp,
  onVoteDown,
  onToggleComments,
  userHasVoted,
  busy,
  commentCount,
}) {
  return (
    <div className="comm_voteButtonRow">
      <button
        ref={voteUpRef}
        type="button"
        onClick={onVoteUp}
        disabled={busy || userHasVoted}
        className="comm_voteMainBtn comm_voteMainUp"
      >
        <img className="comm_icon" src="/static/images/upvote.png" alt="" />
        <span>Real</span>
      </button>
      <button
        ref={voteDownRef}
        type="button"
        onClick={onVoteDown}
        disabled={busy || userHasVoted}
        className="comm_voteMainBtn comm_voteMainDown"
      >
        <img className="comm_icon" src="/static/images/downvote.png" alt="" />
        <span>Fake</span>
      </button>
      <button
        ref={commentBtnRef}
        type="button"
        onClick={onToggleComments}
        className="comm_commentIconBtn"
      >
        <img className="comm_icon" src="/static/images/comment.png" alt="" />
        {commentCount > 0 && <span className="comm_actionCount">{commentCount}</span>}
      </button>
    </div>
  );
}