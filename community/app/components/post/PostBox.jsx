import "../../styles/postBox.css";
import { useEffect, useState } from "react";
import {
  voteOnPost,
  fetchComments,
  trackPostClick,
  reportPostAPI,
  deletePostAPI,
  submitCommentAPI,
  deleteCommentAPI,
  formatScore
} from "./postBoxActions";

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

  const [description, setDescription] = useState(image?.description || "");

  const postId = image?.post_id || null;
  const [isReported, setIsReported] = useState(Boolean(image?.is_reported));

  const isOwner = currentUserId && image?.user_id === currentUserId;

  useEffect(() => {
    setIsReported(Boolean(image?.is_reported));
  }, [image?.is_reported]);

  // Sync description when image prop changes
  useEffect(() => {
    setDescription(image?.description || "");
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
      const result = await voteOnPost(postId, currentUserId, direction);
      
      setUp(result.up_vote_count);
      setDown(result.down_vote_count);
      
      // Notify parent component of the vote count change
      if (onVoteUpdate) {
        onVoteUpdate(postId, result.up_vote_count, result.down_vote_count);
      }
    } catch (err) {
      setError(err.message || "Network error while voting.");
    } finally {
      setBusy(false);
    }
  }

  async function loadComments() {
    if (!postId) return;

    setCommentsBusy(true);
    setCommentError("");

    try {
      const items = await fetchComments(postId);
      setComments(items);
    } catch (err) {
      setCommentError(err.message || "Network error while loading comments.");
    } finally {
      setCommentsBusy(false);
    }
  }

  function handleClick() {
    trackPostClick(postId);
  }

  function reportPost() {
    if (!postId) return;

    setIsReported(true);

    reportPostAPI(postId)
      .then((isReported) => {
        setIsReported(isReported);
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
      await deletePostAPI(postId);
      
      // Notify parent component to remove this post from the list
      if (onPostDelete) {
        onPostDelete(postId);
      }
    } catch (err) {
      setError(err.message || "Network error while deleting post.");
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
      const data = await submitCommentAPI(postId, currentUserId, currentUserName, text);
      setComments((arr) => [data, ...arr]);
      setCommentText("");
    } catch (err) {
      setCommentError(err.message || "Network error while posting comment.");
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
      await deleteCommentAPI(comment_id);
      
      // Remove the deleted comment from the list
      setComments((arr) => arr.filter(c => c.comment_id !== comment_id));
    } catch (err) {
      setCommentError(err.message || "Network error while deleting comment.");
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
        
        {isOwner && (
          <button
            type="button"
            onClick={deletePost}
            disabled={!postId || busy}
            title="Delete this post"
            aria-label="Delete this post"
            className="comm_deleteButton"
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

      <div className="comm_description">
        {description}
        {isOwner && (
          <button
            type="button"
            onClick={() => {
              // Only store minimal data needed for editing
              try {
                const editData = {
                  post_id: image.post_id,
                  image_id: image.image_id,
                  description: description,
                  url: image.url,
                  uploaded_at: image.uploaded_at,
                  label: image.label,
                  verdict: image.verdict,
                  confidence: image.confidence,
                  is_public: image.is_public
                };
                sessionStorage.setItem("selectedScan", JSON.stringify(editData));
                sessionStorage.setItem("selectedScanTitle", `Edit Post`);
                window.location.href = "/viewscan";
              } catch (err) {
                console.error("Failed to store scan data:", err);
              }
            }}
            disabled={busy}
            title="Edit description"
            aria-label="Edit description"
            className="comm_editButton"
          >
            <span aria-hidden="true">✏️</span>
          </button>
        )}
      </div>

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
                        className="comm_deleteCommentButton"
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
