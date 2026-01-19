import "../../styles/postBox.css";
import { useEffect, useState } from "react";

export default function PostBox({ image, currentUserId, currentUserName }) {
  const [up, setUp] = useState(Number(image?.up_vote_count ?? 0));
  const [down, setDown] = useState(Number(image?.down_vote_count ?? 0));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsBusy, setCommentsBusy] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentError, setCommentError] = useState("");

  const postId = image?.post_id || null;
  const [isReported, setIsReported] = useState(Boolean(image?.is_reported));

  useEffect(() => {
    setIsReported(Boolean(image?.is_reported));
  }, [image?.is_reported]);

  async function vote(direction) {
    if (!postId) return setError("Missing post_id from feed.");
    if (!currentUserId) return setError("You must be signed in to vote.");
    if (direction !== "up" && direction !== "down") return;

    setError("");
    setBusy(true);

    // Store original counts before optimistic update
    const originalUp = up;
    const originalDown = down;

    // Optimistic UI update
    if (direction === "up") setUp((v) => v + 1);
    else setDown((v) => v + 1);

    try {
      const res = await fetch(`/community/posts/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "include",
        body: JSON.stringify({ post_id: postId, user_id: currentUserId, vote: direction }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Restore original counts on error
        setUp(originalUp);
        setDown(originalDown);
        setError(data.error || data.detail || `Vote failed (${res.status})`);
        return;
      }

      // Update with authoritative counts from server
      setUp(Number(data.up_vote_count ?? 0));
      setDown(Number(data.down_vote_count ?? 0));
    } catch {
      // Restore original counts on network error
      setUp(originalUp);
      setDown(originalDown);
      setError("Network error while voting.");
    } finally {
      setBusy(false);
    }
  }

  async function loadComments() {
    if (!postId) return;

    setCommentsBusy(true);
    setCommentError("");

    try {
      const res = await fetch(
        `/community/posts/comments?post_id=${encodeURIComponent(postId)}`,
        { credentials: "include", headers: { Accept: "application/json" } }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCommentError(data.error || data.detail || `Failed to load comments (${res.status})`);
        return;
      }

      setComments(Array.isArray(data.items) ? data.items : []);
    } catch {
      setCommentError("Network error while loading comments.");
    } finally {
      setCommentsBusy(false);
    }
  }

  function handleClick() {
    if (!postId) return;

    fetch("/community/posts/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ post_id: postId }),
    }).catch(() => {});
  }

  function reportPost() {
    if (!postId) return;

    setIsReported(true);

    fetch("/community/posts/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ post_id: postId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.is_reported === false) setIsReported(false);
      })
      .catch(() => {
        setIsReported(false);
        setError("Failed to report post.");
      });
  }

  async function submitComment() {
    if (!postId) return setCommentError("Missing post_id.");
    if (!currentUserId) return setCommentError("You must be signed in to comment.");
    if (!currentUserName) return setCommentError("Missing user name in session.");

    const text = commentText.trim();
    if (!text) return setCommentError("Write a comment first.");

    setCommentsBusy(true);
    setCommentError("");

    try {
      const res = await fetch(`/community/posts/comments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          post_id: postId,
          user_id: currentUserId,
          user_name: currentUserName,
          text,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCommentError(data.error || data.detail || `Comment failed (${res.status})`);
        return;
      }

      setComments((arr) => [data, ...arr]);
      setCommentText("");
    } catch {
      setCommentError("Network error while posting comment.");
    } finally {
      setCommentsBusy(false);
    }
  }

  useEffect(() => {
    if (showComments) loadComments();
  }, [showComments, postId]);

  return (
    <div className="comm_postBox">
      <div className="comm_topRow">
        <button
          type="button"
          onClick={reportPost}
          disabled={!postId || isReported}
          title={isReported ? "Already reported" : "Report this post"}
        >
          🚩 {isReported ? "(reported)" : "(report)"}
        </button>
      </div>

      <img
        className="comm_postImage"
        src={image?.url}
        alt={image?.label || "Community image"}
        onClick={handleClick}
      />

      <div className="comm_bottomRow">
        <div className="comm_votesCell">
          <button type="button" onClick={() => vote("up")} disabled={busy || !postId}>
            ⬆️
          </button>
          <span>{up}</span>
          <button type="button" onClick={() => vote("down")} disabled={busy || !postId}>
            ⬇️
          </button>
          <span>{down}</span>
        </div>

        <div className="comm_CommentsCell">
          <button type="button" onClick={() => setShowComments((v) => !v)} disabled={!postId}>
            💬
          </button>
        </div>
      </div>

      <div className="comm_poster">
        <strong>Posted by:</strong> {image?.user_name || "Unknown"}
      </div>

      {(image?.result?.verdict || image?.result?.label) && (
        <div className="comm_detection">
          {image?.result?.verdict && (
            <div>
              <strong>Verdict:</strong> {String(image.result.verdict)}
            </div>
          )}
          {image?.result?.label && (
            <div>
              <strong>Label:</strong> {String(image.result.label)}
            </div>
          )}
        </div>
      )}

      {image?.description && <div className="comm_description">{image.description}</div>}

      {showComments && (
        <div className="comm_commentsWrapper">
          <div className="comm_commentsHeader">
            Comments {commentsBusy ? "(loading…)" : `(${comments.length})`}
          </div>

          {!currentUserId && <div className="muted">Sign in to post comments.</div>}
          {commentError && <div className="muted">{commentError}</div>}

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
              onClick={submitComment}
              disabled={!currentUserId || commentsBusy}
            >
              Post comment
            </button>
          </div>

          <div className="comm_commentsList">
            {comments.map((c) => (
              <div key={c.comment_id} className="comm_comment">
                <div className="comm_commentMeta">
                  {c.user_name || "Unknown"} ·{" "}
                  {c.created_at ? new Date(c.created_at).toLocaleString() : ""}
                </div>
                <div className="comm_commentText">{c.text}</div>
              </div>
            ))}

            {!commentsBusy && comments.length === 0 && (
              <div className="muted">No comments yet.</div>
            )}
          </div>
        </div>
      )}

      {error && <div className="muted">{error}</div>}
    </div>
  );
}
