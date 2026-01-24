import "../../styles/postBox.css";
import { useEffect, useState } from "react";

export default function PostBox({ image, currentUserId, currentUserName, onVoteUpdate, onPostDelete }) {
  const [up, setUp] = useState(Number(image?.up_vote_count ?? 0));
  const [down, setDown] = useState(Number(image?.down_vote_count ?? 0));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsBusy, setCommentsBusy] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentError, setCommentError] = useState("");

  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescription, setEditedDescription] = useState(image?.description || "");
  const [description, setDescription] = useState(image?.description || "");

  const postId = image?.post_id || null;
  const [isReported, setIsReported] = useState(Boolean(image?.is_reported));

  const isOwner = currentUserId && image?.user_id === currentUserId;
  
  const [myVote, setMyVote] = useState(image?.user_vote ?? null);

  useEffect(() => {
    setMyVote(image?.user_vote ?? null);
  }, [image?.user_vote]);



  useEffect(() => {
    setIsReported(Boolean(image?.is_reported));
  }, [image?.is_reported]);

  // Sync description when image prop changes
  useEffect(() => {
    setDescription(image?.description || "");
    setEditedDescription(image?.description || "");
  }, [image?.description]);

  // Sync vote counts when image prop changes
  useEffect(() => {
    setUp(Number(image?.up_vote_count ?? 0));
    setDown(Number(image?.down_vote_count ?? 0));
  }, [image?.up_vote_count, image?.down_vote_count]);

  async function vote(direction) {
    if (!postId) return setError("Missing post_id from feed.");
    if (!currentUserId) return setError("You must be signed in to vote.");
    if (direction !== "up" && direction !== "down") return;
    
    // Prevent multiple simultaneous votes
    if (busy) return;

    setError("");
    setBusy(true);

    try {
      const res = await fetch(`/community/posts/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "include",
        body: JSON.stringify({ post_id: postId, user_id: currentUserId, vote: direction }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || data.detail || `Vote failed (${res.status})`);
        return;
      }

      // Update with authoritative counts from server (this is the source of truth)
      const newUp = Number(data.up_vote_count ?? 0);
      const newDown = Number(data.down_vote_count ?? 0);
      setUp(newUp);
      setDown(newDown);
      
      // Notify parent component of the vote count change
      if (onVoteUpdate) {
        onVoteUpdate(postId, newUp, newDown);
      }
    } catch (err) {
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
    }).catch((err) => {
      // Click tracking is non-critical; errors are ignored in production
      if (process.env.NODE_ENV === "development") {
        console.error("Failed to record post click:", err);
      }
    });
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

  async function deletePost() {
    if (!postId) return;
    if (!isOwner) return setError("You can only delete your own posts.");

    // Confirm before deleting
    if (!confirm("Are you sure you want to delete this post? This action cannot be undone.")) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const res = await fetch(`/community/posts?post_id=${encodeURIComponent(postId)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || data.detail || `Failed to delete post (${res.status})`);
        return;
      }

      // Notify parent component to remove this post from the list
      if (onPostDelete) {
        onPostDelete(postId);
      }
    } catch (err) {
      setError("Network error while deleting post.");
    } finally {
      setBusy(false);
    }
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

  async function deleteComment(comment_id) {
    if (!comment_id) return;

    // Confirm before deleting
    if (!confirm("Are you sure you want to delete this comment?")) {
      return;
    }

    setCommentsBusy(true);
    setCommentError("");

    try {
      const res = await fetch(`/community/posts/comments?comment_id=${encodeURIComponent(comment_id)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setCommentError(data.error || data.detail || `Failed to delete comment (${res.status})`);
        return;
      }

      // Remove the deleted comment from the list
      setComments((arr) => arr.filter(c => c.comment_id !== comment_id));
    } catch (err) {
      setCommentError("Network error while deleting comment.");
    } finally {
      setCommentsBusy(false);
    }
  }

  async function updateDescription() {
    if (!postId) return;
    if (!isOwner) return setError("You can only edit your own posts.");

    const trimmed = editedDescription.trim();
    if (!trimmed) return setError("Description cannot be empty.");

    setBusy(true);
    setError("");

    try {
      const res = await fetch(`/community/posts?post_id=${encodeURIComponent(postId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ description: trimmed }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || data.detail || `Failed to update post (${res.status})`);
        return;
      }

      // Update the description
      setDescription(trimmed);
      setIsEditingDescription(false);
    } catch (err) {
      setError("Network error while updating post.");
    } finally {
      setBusy(false);
    }
  }

  function cancelEdit() {
    setEditedDescription(description);
    setIsEditingDescription(false);
    setError("");
  }

  useEffect(() => {
    if (showComments) loadComments();
  }, [showComments, postId]);


  function formatScore(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return "—";
    // 4 decimals is usually enough to see differences
    return n.toFixed(6);
  }



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
        
        {isOwner && (
          <button
            type="button"
            onClick={deletePost}
            disabled={!postId || busy}
            title="Delete this post"
            aria-label="Delete this post"
            style={{ marginLeft: "8px", color: "#dc3545" }}
          >
            <span aria-hidden="true">🗑️</span> Delete
          </button>
        )}
      </div>

      <img
        className="comm_postImage"
        src={image?.url}
        alt={image?.label || "Community image"}
        onClick={handleClick}
      />

      <div className="comm_bottomRow">
        <div className="comm_votesCell">
          <button 
            type="button" 
            onClick={() => vote("up")} 
            disabled={busy || !postId}
            title="Upvote"
          >
            ⬆️
          </button>
          <span>{up}</span>
          <button 
            type="button" 
            onClick={() => vote("down")} 
            disabled={busy || !postId}
            title="Downvote"
          >
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

      
      {/* DEV: ranking score */}
      <div className="comm_score">
        <strong>Score:</strong> {formatScore(image?.score)}
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

      {isEditingDescription ? (
        <div className="comm_description">
          <textarea
            value={editedDescription}
            onChange={(e) => setEditedDescription(e.target.value)}
            disabled={busy}
            maxLength={1000}
            style={{ width: "100%", minHeight: "60px", padding: "8px", fontSize: "0.95em" }}
          />
          <div style={{ marginTop: "8px" }}>
            <button
              type="button"
              onClick={updateDescription}
              disabled={busy}
              style={{ marginRight: "8px", padding: "4px 12px", cursor: "pointer" }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={busy}
              style={{ padding: "4px 12px", cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="comm_description">
          {description}
          {isOwner && (
            <button
              type="button"
              onClick={() => setIsEditingDescription(true)}
              disabled={busy}
              title="Edit description"
              aria-label="Edit description"
              style={{ marginLeft: "8px", fontSize: "0.85em", cursor: "pointer", background: "none", border: "none", padding: "0" }}
            >
              <span aria-hidden="true">✏️</span>
            </button>
          )}
        </div>
      )}

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
            {comments.map((c) => {
              const isCommentOwner = currentUserId && c.user_id === currentUserId;
              return (
                <div key={c.comment_id} className="comm_comment">
                  <div className="comm_commentMeta">
                    {c.user_name || "Unknown"} ·{" "}
                    {c.created_at ? new Date(c.created_at).toLocaleString() : ""}
                    {isCommentOwner && (
                      <button
                        type="button"
                        onClick={() => deleteComment(c.comment_id)}
                        disabled={commentsBusy}
                        title="Delete this comment"
                        aria-label="Delete comment"
                        style={{ marginLeft: "8px", color: "#dc3545", fontSize: "0.85em", cursor: "pointer", background: "none", border: "none", padding: "0" }}
                      >
                        <span aria-hidden="true">🗑️</span>
                      </button>
                    )}
                  </div>
                  <div className="comm_commentText">{c.text}</div>
                </div>
              );
            })}

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
