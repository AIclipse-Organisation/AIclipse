"use client";

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
  formatScore,
} from "./postBoxActions";

import { useDisclosure } from "@heroui/react";
import ReportModal from "./ReportModal"; // Import your new component

export default function PostBox({
  image,
  currentUserId,
  currentUserName,
  onVoteUpdate,
  onPostDelete,
}) {
  const [up, setUp] = useState(Number(image?.up_vote_count ?? 0));
  const [down, setDown] = useState(Number(image?.down_vote_count ?? 0));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [userVote, setUserVote] = useState(image?.user_vote || null);
  const userHasVoted = !!userVote;

  const isOfficial = !!(image?.is_admin_post || image?.is_official);
  const groundTruth = image?.ground_truth;

  // MODAL STATE
  const { isOpen, onOpen, onOpenChange } = useDisclosure();

  const isUserCorrect = useMemo(() => {
    if (!userHasVoted || !groundTruth) return null;
    const userGuessedReal = userVote === "up";
    const truthIsReal = groundTruth === "Real";
    return userGuessedReal === truthIsReal;
  }, [userHasVoted, userVote, groundTruth]);

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

  useEffect(() => {
    setUserVote(image?.user_vote || null);
  }, [image?.user_vote]);

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
    return parts.map((p) => p[0]?.toUpperCase()).join("") || "?";
  }, [posterName]);

  async function vote(direction) {
    if (!postId) return setError("Missing post_id from feed.");
    if (!currentUserId) return setError("You must be signed in to vote.");
    if (userHasVoted) return;
    if (direction !== "up" && direction !== "down") return;
    if (busy) return;

    setError("");
    setBusy(true);

    try {
      const result = await voteOnPost(postId, currentUserId, direction);
      setUp(result.up_vote_count);
      setDown(result.down_vote_count);
      setUserVote(result.user_vote);
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

  // UPDATED: Now accepts reason and details directly from the modal component
  const submitReport = async ({ reason, details }) => {
    setBusy(true);
    try {
      await reportPostAPI(postId, { reason, details });
      setIsReported(true);
      onOpenChange(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  async function deletePost() {
    if (!postId) return;
    if (!isOwner) return setError("You can only delete your own posts.");
    if (!confirm("Are you sure you want to delete this post? This action cannot be undone.")) return;

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
    const text = commentText.trim();
    if (!text) return setCommentError("Write a comment first.");

    setCommentsBusy(true);
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
    if (!confirm("Are you sure?")) return;
    setCommentsBusy(true);
    try {
      await deleteCommentAPI(comment_id);
      setComments((arr) => arr.filter((c) => c.comment_id !== comment_id));
    } catch (err) {
      setCommentError(err.message || "Error deleting comment.");
    } finally {
      setCommentsBusy(false);
    }
  }

  useEffect(() => { if (postId) loadComments(); }, [postId]);

  /* Progress Bar Calculations */
  function clamp01(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }
  function cleanLabelText(raw) {
    return String(raw || "Unknown").replace(/^\s*\d+(\.\d+)?%\s*/i, "").trim();
  }
  function isAiLabel(labelLower) {
    return labelLower.includes("ai") || labelLower.includes("fake") || labelLower.includes("deepfake");
  }
  function isRealLabel(labelLower) {
    return labelLower.includes("real") && !isAiLabel(labelLower);
  }
  function computeRealPctFromModel(img) {
    const rawLabel = cleanLabelText(img?.result?.label ?? img?.label ?? img?.result?.verdict ?? img?.verdict ?? "Unknown");
    const labelLower = rawLabel.toLowerCase();
    const confRaw = img?.result?.confidence ?? img?.confidence ?? img?.result?.score ?? img?.score ?? 0;
    const confidence = clamp01(confRaw);
    const realProb = isRealLabel(labelLower) ? confidence : 1 - confidence;
    return Math.max(0, Math.min(100, realProb * 100));
  }
  function bucketFromRealPct(realPct) {
    const r = Math.max(0, Math.min(100, Number(realPct) || 0));
    if (r >= 40 && r <= 60) return { text: "Not sure", type: "neutral" };
    if (r > 60) return { text: r >= 86 ? "Most Likely Real" : "Likely Real", type: "safe" };
    const pctAI = 100 - r;
    return { text: pctAI >= 86 ? "Most Likely AI" : "Likely AI", type: "risk" };
  }
  function setWidthStyle(pct) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    if (p === 0) return "0px";
    return `calc(${p}% - 8px)`;
  }

  const analysisRealPct = computeRealPctFromModel(image);
  const analysisBucket = bucketFromRealPct(analysisRealPct);
  const totalVotes = up + down;
  const communityRealPct = totalVotes > 0 ? (up / totalVotes) * 100 : null;
  const communityBucket = communityRealPct === null ? null : bucketFromRealPct(communityRealPct);

  return (
    <div className={`comm_postBox ${isOfficial && userHasVoted ? "is-revealed-benchmark" : ""}`}>
      {/* HEADER SECTION */}
      <div className="comm_topRow">
        <div className="comm_headerLeft">
          <div className="comm_avatar" aria-hidden="true"><div className="comm_avatarInitials">{initials}</div></div>
          <div className="comm_headerMeta">
            <div className="comm_headerNameLine">
              <div className="comm_headerName">{posterName}</div>
              {isOfficial && userHasVoted && <span className="comm_officialBadge">Official Post</span>}
            </div>
            {timeText && <div className="comm_headerTime">{timeText}</div>}
          </div>
        </div>
        <div className="comm_headerActions">
          {image.isTrending && <div className="trend_div_container_body"><span className="comm_trendingBadge">POPULAR</span></div>}
          <div className="comm_menu">
            <button type="button" className="comm_menuBtn" onClick={() => setMenuOpen((v) => !v)} disabled={!postId}>⋮</button>
            {menuOpen && <div className="comm_menuBackdrop" onClick={closeMenu} />}
            {menuOpen && (
              <div className="comm_menuPanel" role="menu">
                {isOwner && (
                  <button type="button" className="comm_menuItem" onClick={() => { closeMenu(); window.location.href = "/viewscan"; }}>
                    ✏️ Edit description
                  </button>
                )}
                <button type="button" className="comm_menuItem" onClick={() => { onOpen(); closeMenu(); }} disabled={isReported}>
                  🚩 {isReported ? "Reported" : "Report"}
                </button>
                {isOwner && <button type="button" className="comm_menuItem comm_menuItemDanger" onClick={deletePost}>🗑️ Delete</button>}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="comm_body"><div className="comm_description">{description}</div></div>

      {/* MEDIA SECTION */}
      <div className="comm_postImageWrap">
        <img className="comm_postImage" src={image?.url} alt={image?.label || "Community image"} onClick={handleClick} />
        {isOfficial && userHasVoted && (
          <div className={`comm_truthReveal ${isUserCorrect ? "is-correct" : "is-incorrect"}`}>
            <div className="comm_truthIcon">{isUserCorrect ? "✅" : "❌"}</div>
            <div className="comm_truthText">
              <span className="comm_truthTitle">{isUserCorrect ? "Nice Work!" : "Nice Try!"}</span>
              <span className="comm_truthSub">Truth: {groundTruth}</span>
            </div>
          </div>
        )}
      </div>

      {/* RESULT BARS */}
      <div className="comm_bars_wrapper">
        {!userHasVoted && <div className="comm_vote_prompt">Vote to see results</div>}
        <div className={`comm_bars ${!userHasVoted ? "is-hidden" : "is-revealed"}`}>
          <div className={`comm_barBlock is-${analysisBucket.type}`}>
            <div className="comm_barHead"><div className="comm_barTitle">Aiclipse</div><div className="comm_barVerdict">{analysisBucket.text}</div></div>
            <div className="comm_progressBar">
              <div className="comm_progressFill" style={{ width: setWidthStyle(analysisRealPct) }} />
              <div className="comm_barPercent">{analysisRealPct.toFixed(2)}%</div>
            </div>
          </div>
          <div className="comm_barBlock comm_communityBar">
            <div className="comm_barHead"><div className="comm_barTitle">Community</div><div className="comm_barVerdict">{communityBucket?.text || "No votes"}</div></div>
            <div className="comm_progressBar">
              <div className="comm_progressFill" style={{ width: setWidthStyle(communityRealPct || 0) }} />
              <div className="comm_barPercent">{communityRealPct !== null ? communityRealPct.toFixed(2) + "%" : "—"}</div>
            </div>
          </div>
        </div>

        {/* INTERACTION ROW */}
        <div className="comm_bottomRow">
          <div className="comm_actionsLeft">
            <button type="button" onClick={() => vote("up")} disabled={busy || userHasVoted} className="comm_actionBtn comm_voteUp">
              <img className="comm_icon" src="/static/images/upvote.png" alt="" />
              <span className="comm_actionText">Real {userHasVoted ? `(${up})` : ""}</span>
            </button>
            <button type="button" onClick={() => vote("down")} disabled={busy || userHasVoted} className="comm_actionBtn comm_voteDown">
              <img className="comm_icon" src="/static/images/downvote.png" alt="" />
              <span className="comm_actionText">AI {userHasVoted ? `(${down})` : ""}</span>
            </button>
          </div>
          <div className="comm_actionsRight">
            <button type="button" onClick={() => setShowComments((v) => !v)} className="comm_actionBtn comm_commentBtn">
              <img className="comm_icon" src="/static/images/comment.png" alt="" />
              <span className="comm_actionText">({comments.length})</span>
            </button>
          </div>
        </div>

        {/* COMMENTS SECTION */}
        {showComments && (
          <div className="comm_commentsWrapper">
            <div className="comm_commentInputWrapper">
              <input className="comm_commentInput" value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder={currentUserId ? "Write a comment…" : "Sign in to comment"} disabled={!currentUserId || commentsBusy} />
              <button className="comm_commentButton" type="button" onClick={submitComment} disabled={!currentUserId || commentsBusy}>Post</button>
            </div>
            <div className="comm_commentsList">
              {comments.map((c) => (
                <div key={c.comment_id} className="comm_comment">
                  <div className="comm_commentMeta">
                    {c.user_name} · {c.created_at ? new Date(c.created_at).toLocaleDateString() : ""}
                    {currentUserId && c.user_id === currentUserId && (
                      <button onClick={() => deleteComment(c.comment_id)} className="comm_deleteCommentButton">🗑️</button>
                    )}
                  </div>
                  <div className="comm_commentText">{c.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {error && <div className="muted">{error}</div>}
      </div>

      <ReportModal
        isOpen={isOpen}
        onClose={() => onOpenChange(false)}
        onSubmit={submitReport}
        isSubmitting={busy}
      />
    </div>
  );
}