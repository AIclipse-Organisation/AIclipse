import "../../styles/postBox.css";
import { useEffect, useMemo, useState } from "react";
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

  const [menuOpen, setMenuOpen] = useState(false);

  function closeMenu() {
    setMenuOpen(false);
  }

  useEffect(() => {
    setMenuOpen(false);
  }, [postId]);

  useEffect(() => {
    setIsReported(Boolean(image?.is_reported));
  }, [image?.is_reported]);

  useEffect(() => {
    setDescription(image?.description || "");
  }, [image?.description]);

  useEffect(() => {
    setUp(Number(image?.up_vote_count ?? 0));
    setDown(Number(image?.down_vote_count ?? 0));
  }, [image?.up_vote_count, image?.down_vote_count]);

  const posterName = image?.user_name || "Unknown";

  const timeText = useMemo(() => {
    const d = image?.uploaded_at ? new Date(image.uploaded_at) : null;
    if (!d || Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  }, [image?.uploaded_at]);

  const initials = useMemo(() => {
    const s = String(posterName || "").trim();
    if (!s) return "?";
    const parts = s.split(/\s+/).slice(0, 2);
    return parts.map(p => p[0]?.toUpperCase()).join("") || "?";
  }, [posterName]);

  async function vote(direction) {
    if (!postId) return setError("Missing post_id from feed.");
    if (!currentUserId) return setError("You must be signed in to vote.");
    if (direction !== "up" && direction !== "down") return;
    if (busy) return;

    setError("");
    setBusy(true);

    try {
      const result = await voteOnPost(postId, currentUserId, direction);
      setUp(result.up_vote_count);
      setDown(result.down_vote_count);

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

    if (!confirm("Are you sure you want to delete this post? This action cannot be undone.")) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await deletePostAPI(postId);
      if (onPostDelete) onPostDelete(postId);
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

    if (!confirm("Are you sure you want to delete this comment?")) {
      return;
    }

    setCommentsBusy(true);
    setCommentError("");

    try {
      await deleteCommentAPI(comment_id);
      setComments((arr) => arr.filter(c => c.comment_id !== comment_id));
    } catch (err) {
      setCommentError(err.message || "Network error while deleting comment.");
    } finally {
      setCommentsBusy(false);
    }
  }

  useEffect(() => {
    if (showComments) loadComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showComments, postId]);

  /* =========================
     ✅ ADDED: bar helpers + derived values
     ========================= */

  function toPercentNumber01(conf) {
    const n = Number(conf);
    if (!Number.isFinite(n)) return 0;
    const clamped = Math.max(0, Math.min(1, n));
    return clamped * 100; // float 0..100
  }

  function verdictTypeFrom(img) {
    const v = String(img?.result?.verdict ?? img?.verdict ?? "").toLowerCase();
    const l = String(img?.result?.label ?? img?.label ?? "").toLowerCase();

    if (v.includes("real") || v === "safe" || l.includes("real")) return "safe";
    if (v.includes("ai") || v.includes("fake") || v.includes("deepfake")) return "risk";
    if (l.includes("ai") || l.includes("fake") || l.includes("deepfake")) return "risk";

    return "risk";
  }

  function getVoteBucketFromPctReal(pctReal) {
    if (pctReal >= 40 && pctReal <= 60) return { text: "Not sure", type: "neutral" };

    if (pctReal > 60) {
      if (pctReal >= 86) return { text: "Most Likely Real", type: "safe" };
      return { text: "Likely Real", type: "safe" };
    }

    const pctAI = 100 - pctReal;
    if (pctAI >= 86) return { text: "Most Likely AI", type: "risk" };
    return { text: "Likely AI", type: "risk" };
  }

  const analysisConfidence = image?.result?.confidence ?? image?.confidence ?? 0;
  const analysisPct = toPercentNumber01(analysisConfidence);
  const analysisType = verdictTypeFrom(image); // safe | risk

  const totalVotes = up + down;
  const pctReal = totalVotes > 0 ? (up / totalVotes) * 100 : null; // 0..100
  const voteBucket = pctReal === null ? null : getVoteBucketFromPctReal(pctReal);
  const pctAI = pctReal === null ? null : 100 - pctReal;

  const communityDisplayPct =
    pctReal === null
      ? null
      : voteBucket?.type === "risk"
        ? pctAI
        : pctReal;

  return (
    <div className="comm_postBox">
      <div className="comm_topRow">
        <div className="comm_headerLeft">
          <div className="comm_avatar" aria-hidden="true">
            {/* If you ever have an avatar URL later, drop an <img> here */}
            <div className="comm_avatarInitials">{initials}</div>
          </div>

          <div className="comm_headerMeta">
            <div className="comm_headerNameLine">
              <div className="comm_headerName">{posterName}</div>
            </div>
            {timeText && <div className="comm_headerTime">{timeText}</div>}
          </div>
        </div>

        <div className="comm_headerActions">
          <div className="comm_menu">
            <button
              type="button"
              className="comm_menuBtn"
              onClick={() => setMenuOpen((v) => !v)}
              disabled={!postId}
              aria-haspopup="menu"
              aria-expanded={menuOpen ? "true" : "false"}
              title="Post actions"
            >
              ⋮
            </button>

            {menuOpen && <div className="comm_menuBackdrop" onClick={closeMenu} />}

            {menuOpen && (
              <div className="comm_menuPanel" role="menu">
                {isOwner && (
                  <button
                    type="button"
                    className="comm_menuItem"
                    role="menuitem"
                    onClick={() => {
                      closeMenu();
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
                  >
                    <span aria-hidden="true">✏️</span> Edit description
                  </button>
                )}

                <button
                  type="button"
                  className="comm_menuItem"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    reportPost();
                  }}
                  disabled={!postId || isReported}
                  title={isReported ? "Already reported" : "Report this post"}
                >
                  <span aria-hidden="true">🚩</span> {isReported ? "Reported" : "Report"}
                </button>

                {isOwner && (
                  <button
                    type="button"
                    className="comm_menuItem comm_menuItemDanger"
                    role="menuitem"
                    onClick={() => {
                      closeMenu();
                      deletePost();
                    }}
                    disabled={!postId || busy}
                    title="Delete this post"
                    aria-label="Delete this post"
                  >
                    <span aria-hidden="true">🗑️</span> Delete
                  </button>
                )}

                {!isOwner && isReported && (
                  <div className="comm_menuItem comm_menuItemMuted" role="presentation">
                    Already reported
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* BODY TEXT (description FIRST like YouTube) */}
      <div className="comm_body">
        <div className="comm_description">{description}</div>
      </div>

      {/* IMAGE */}
      <div className="comm_postImageWrap">
        <img
          className="comm_postImage"
          src={image?.url}
          alt={image?.label || "Community image"}
          onClick={handleClick}
        />
      </div>

      {/* bars above image */}
      <div className="comm_bars">
        {/* Analysis / model bar */}
        <div className="comm_barBlock" aria-label="Analysis result">
          <div className={`comm_barLine ${analysisType === "safe" ? "is-safe" : "is-risk"}`}>
            {image?.result?.label
              ? String(image.result.label)
              : `${analysisPct.toFixed(0)}% ${analysisType === "safe" ? "Likely Real" : "Likely AI"}`}
          </div>

          <div
            className={`comm_barTrack ${analysisType === "risk" ? "is-risk" : ""}`}
            role="img"
            aria-label={`Confidence ${analysisPct.toFixed(0)}%`}
          >
            <div
              className={`comm_barFill ${analysisType === "risk" ? "is-risk" : ""}`}
              style={{ width: `${Math.max(0, Math.min(100, analysisPct))}%` }}
            />
          </div>
        </div>

        {/* Community votes bar */}
        <div className="comm_barBlock" aria-label="Community result">
          {pctReal === null ? (
            <>
              <div className="comm_barLine is-neutral">No community votes</div>
              <div className="comm_barTrack is-neutral" role="img" aria-label="No community votes">
                <div className="comm_barFill is-neutral" style={{ width: "100%" }} />
              </div>
            </>
          ) : (
            <>
              <div
                className={`comm_barLine ${voteBucket.type === "safe"
                  ? "is-safe"
                  : voteBucket.type === "risk"
                    ? "is-risk"
                    : "is-neutral"
                  }`}
              >
                {`${communityDisplayPct.toFixed(0)}% ${voteBucket.text} (Community)`}
              </div>

              <div
                className="comm_barTrack"
                role="img"
                aria-label={
                  voteBucket.type === "risk"
                    ? `Vote confidence ${pctAI.toFixed(0)}% AI`
                    : `Vote confidence ${pctReal.toFixed(0)}% real`
                }
              >
                <div
                  className="comm_barFill"
                  style={{ width: `${Math.max(0, Math.min(100, pctReal))}%` }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ACTIONS (like/dislike/comment) */}
      <div className="comm_bottomRow">
        {/* LEFT: votes */}
        <div className="comm_actionsLeft">
          <button
            type="button"
            onClick={() => vote("up")}
            disabled={busy || !postId}
            title="Vote Real"
            aria-label="Vote Real"
            className="comm_actionBtn comm_voteUp"
          >
            <img className="comm_icon" src="/static/images/upvote.png" alt="" aria-hidden="true" />
            <span className="comm_actionText">Real ({up})</span>
          </button>

          <button
            type="button"
            onClick={() => vote("down")}
            disabled={busy || !postId}
            title="Vote AI"
            aria-label="Vote AI"
            className="comm_actionBtn comm_voteDown"
          >
            <img className="comm_icon" src="/static/images/downvote.png" alt="" aria-hidden="true" />
            <span className="comm_actionText">AI ({down})</span>
          </button>
        </div>

        {/* RIGHT: comments */}
        <div className="comm_actionsRight">
          <button
            type="button"
            onClick={() => setShowComments((v) => !v)}
            disabled={!postId}
            title="Comments"
            aria-label="Toggle comments"
            className="comm_actionBtn comm_commentBtn"
          >
            <img className="comm_icon" src="/static/images/comment.png" alt="" aria-hidden="true" />
            <span className="comm_actionText">Comments ({comments.length})</span>
          </button>
        </div>
      </div>

      {/* COMMENTS */}
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
