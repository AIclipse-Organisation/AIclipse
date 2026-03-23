export default function PostComments({
  comments,
  currentUserId,
  commentsBusy,
  commentText,
  setCommentText,
  onSubmit,
  onDelete,
}) {
  return (
    <div className="comm_commentsWrapper">
      <div className="comm_commentInputWrapper">
        <input
          className="comm_commentInput"
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder={currentUserId ? "Write a comment…" : "Sign in to comment"}
          disabled={!currentUserId || commentsBusy}
        />
        <button
          className="comm_commentButton"
          type="button"
          onClick={onSubmit}
          disabled={!currentUserId || commentsBusy || !commentText.trim()}
        >
          Post
        </button>
      </div>
      <div className="comm_commentsList">
        {comments.map((c) => (
          <div key={c.comment_id} className="comm_comment">
            <div className="comm_commentMeta">
              {c.user_name} · {c.created_at ? new Date(c.created_at).toLocaleDateString() : ""}
              {currentUserId && c.user_id === currentUserId && (
                <button onClick={() => onDelete(c.comment_id)} className="comm_deleteCommentButton">
                  🗑️
                </button>
              )}
            </div>
            <div className="comm_commentText">{c.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}