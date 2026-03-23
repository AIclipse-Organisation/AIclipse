"use client";

import Link from "next/link";
import "../../styles/postBox.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
import ReportModal from "../modals/ReportModal";
import { useXp } from "../../lib/xpContext";
import { timeAgo } from "../../lib/timeAgo";
import { useXpFloat, XpFloatLayer } from "../common/XpFloat";

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

  // 'idle' | 'showing' | 'text-fading' | 'icon-moving' | 'settled' | 'pre-existing'
  const [revealPhase, setRevealPhase] = useState(() => {
    if (!(image?.is_admin_post || image?.is_official)) return 'idle';
    if (image?.user_vote) return 'pre-existing';
    return 'idle';
  });
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

  const xp = useXp();
  const { triggerFloat, floats } = useXpFloat();
  const voteUpRef = useRef(null);
  const voteDownRef = useRef(null);
  const commentBtnRef = useRef(null);

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

  // Sync reveal phase when post changes (e.g. feed reload)
  useEffect(() => {
    const official = !!(image?.is_admin_post || image?.is_official);
    if (!official) return;
    setRevealPhase(prev => {
      if (prev === 'idle' && image?.user_vote) return 'pre-existing';
      return prev;
    });
  }, [image?.user_vote]);

  function startRevealAnimation() {
    setRevealPhase('showing');
    setTimeout(() => setRevealPhase('text-fading'), 2500);
    setTimeout(() => setRevealPhase('icon-moving'), 3050);
    setTimeout(() => setRevealPhase('settled'), 3700);
  }

  const posterName = image?.user_name || "Unknown";

  const timeText = useMemo(() => {
    return timeAgo(image?.uploaded_at);
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
      xp?.addXp(result.points_awarded);
      const ref = direction === "up" ? voteUpRef : voteDownRef;
      triggerFloat(ref, result.points_awarded);
      if (isOfficial) startRevealAnimation();
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
      xp?.addXp(1);
      triggerFloat(commentBtnRef, 1);
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
    if (r > 60) return { text: r >= 86 ? "Highly Unlikely Fake" : "Unlikely Fake", type: "safe" };
    const pctAI = 100 - r;
    return { text: pctAI >= 86 ? "Highly Likely Fake" : "Likely Fake", type: "risk" };
  }
  function setWidthStyle(pct) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    if (p === 0) return "0px";
    return `calc(${p}% - 8px)`;
  }

  const analysisRealPct = computeRealPctFromModel(image);
  const analysisBucket = bucketFromRealPct(analysisRealPct);

  const analysisAiPct = 100 - analysisRealPct;

  const totalVotes = up + down;
  const communityRealPct = totalVotes > 0 ? (up / totalVotes) * 100 : null;
  const communityBucket = communityRealPct === null ? null : bucketFromRealPct(communityRealPct);

  const communityAiPct = communityRealPct !== null ? 100 - communityRealPct : null;

  return (
    <div className={`comm_postBox ${isOfficial && userHasVoted ? "is-revealed-benchmark" : ""}`}>
      {/* HEADER SECTION */}
      <div className="comm_topRow">
        <div className="comm_headerLeft">
          <div className="comm_avatar" aria-hidden="true"><div className="comm_avatarInitials">{initials}</div></div>
          <div className="comm_headerMeta">
            <div className="comm_headerNameLine">
              <Link href={`/profile/${image.user_id}`} className="comm_headerName comm_headerNameLink">{posterName}</Link>
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

        {/* Full overlay — visible during 'showing' and 'text-fading' phases */}
        <AnimatePresence>
          {(revealPhase === 'showing' || revealPhase === 'text-fading') && (
            <div className="comm_truthOverlayWrap">
            <motion.div
              className="comm_truthOverlay"
              initial={{ opacity: 0, scale: 0.78, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.28 } }}
              transition={{ type: 'spring', stiffness: 360, damping: 26 }}
            >
              <div className={`comm_truthOverlayIcon ${isUserCorrect ? 'is-correct' : 'is-incorrect'}`}>
                {isUserCorrect ? (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                )}
              </div>
              <motion.div
                className="comm_truthOverlayText"
                animate={{ opacity: revealPhase === 'text-fading' ? 0 : 1 }}
                transition={{ duration: 0.38 }}
              >
                <span className={`comm_truthTitle ${isUserCorrect ? 'is-correct' : 'is-incorrect'}`}>
                  {isUserCorrect ? 'Correct!' : 'Nice Try!'}
                </span>
                <span className="comm_truthSub">This was {groundTruth}</span>
              </motion.div>
            </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Truth label — fades in after badge settles, or already visible for pre-existing */}
        <AnimatePresence>
          {(revealPhase === 'settled' || revealPhase === 'pre-existing') && (
            <motion.div
              className={`comm_truthLabel ${groundTruth === 'Real' ? 'is-real' : 'is-fake'}`}
              initial={revealPhase === 'pre-existing' ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.55, ease: 'easeIn' }}
            >
              {groundTruth === 'Real' ? 'REAL' : 'FAKE'}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Corner badge — appears after overlay, or immediately for pre-existing votes */}
        <AnimatePresence>
          {(revealPhase === 'icon-moving' || revealPhase === 'settled' || revealPhase === 'pre-existing') && (
            <motion.div
              className={`comm_truthCornerBadge ${isUserCorrect ? 'is-correct' : 'is-incorrect'}`}
              initial={revealPhase === 'pre-existing'
                ? false
                : { opacity: 0, scale: 2.4, x: -62, y: -52 }
              }
              animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              transition={{ type: 'spring', stiffness: 80, damping: 18 }}
            >
              {isUserCorrect ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* RESULT BARS */}
      {/* RESULT BARS */}
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
              {/* UPDATED to use AiPct */}
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
              {/* UPDATED to use AiPct and handle the empty state with a dash */}
              <div className="comm_progressFill" style={{ width: setWidthStyle(communityAiPct || 0) }} />
              <div className="comm_barPercent">
                {communityAiPct !== null ? communityAiPct.toFixed(2) + "%" : "—"}
              </div>
            </div>
          </div>

        </div>

        {/* INTERACTION ROW */}
        <div className="comm_bottomRow">
          <div className="comm_actionsLeft">
            <button ref={voteUpRef} type="button" onClick={() => vote("up")} disabled={busy || userHasVoted} className="comm_actionBtn comm_voteUp">
              <img className="comm_icon" src="/static/images/upvote.png" alt="" />
              <span className="comm_actionText">Real {userHasVoted ? `(${up})` : ""}</span>
            </button>
            <button ref={voteDownRef} type="button" onClick={() => vote("down")} disabled={busy || userHasVoted} className="comm_actionBtn comm_voteDown">
              <img className="comm_icon" src="/static/images/downvote.png" alt="" />
              <span className="comm_actionText">AI {userHasVoted ? `(${down})` : ""}</span>
            </button>
          </div>
          <div className="comm_actionsRight">
            <button ref={commentBtnRef} type="button" onClick={() => setShowComments((v) => !v)} className="comm_actionBtn comm_commentBtn">
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
                    <Link href={`/profile/${c.user_id}`} className="comm_headerNameLink">{c.user_name}</Link> · {c.created_at ? timeAgo(c.created_at) : ""}
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
      <XpFloatLayer floats={floats} />
    </div>
  );
}