"use client";

import "../../styles/postBox.css";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  voteOnPost,
  fetchComments,
  trackPostClick,
  reportPostAPI,
  deletePostAPI,
  submitCommentAPI,
  deleteCommentAPI,
} from "./postBoxActions";

import { useDisclosure } from "@heroui/react";
import ReportModal from "../modals/ReportModal";
import { useXp } from "../../lib/xpContext";
import { useXpFloat, XpFloatLayer } from "../common/XpFloat";

import PostHeader from "./PostHeader";
import PostMedia from "./PostMedia";
import PostResults from "./PostResults";
import PostControls from "./PostControls";
// import PostComments from "./PostComments";
import PostCommentsDrawer from "./PostCommentsDrawer";
import {timeAgo} from "./utils/timeAgo.js"

export default function PostBox({
  image,
  currentUserId,
  currentUserName,
  onVoteUpdate,
  onPostDelete,
}) {
  // --- STATE ---
  const [up, setUp] = useState(Number(image?.up_vote_count ?? 0));
  const [down, setDown] = useState(Number(image?.down_vote_count ?? 0));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [userVote, setUserVote] = useState(image?.user_vote || null);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsBusy, setCommentsBusy] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [isReported, setIsReported] = useState(Boolean(image?.is_reported));

const { isOpen, onOpen, onOpenChange } = useDisclosure();

const { 
    isOpen: isCommentsOpen, 
    onOpen: onCommentsOpen, 
    onOpenChange: onCommentsChange 
  } = useDisclosure();

  const xp = useXp();
  const { triggerFloat, floats } = useXpFloat();
  
  const voteUpRef = useRef(null);
  const voteDownRef = useRef(null);
  const commentBtnRef = useRef(null);

  const postId = image?.post_id || null;
  const userHasVoted = !!userVote;
  const groundTruth = image?.ground_truth;
  const isOfficial = !!(image?.is_admin_post || image?.is_official);
  const isOwner = currentUserId && image?.user_id === currentUserId;

  const [revealPhase, setRevealPhase] = useState(() => {
    if (!isOfficial) return "idle";
    if (image?.user_vote) return "pre-existing";
    return "idle";
  });

  // --- MEMOS & EFFECTS ---
  const isUserCorrect = useMemo(() => {
    if (!userHasVoted || !groundTruth) return null;
    return (userVote === "up") === (groundTruth === "Real");
  }, [userHasVoted, userVote, groundTruth]);

  const posterName = image?.user_name || "Unknown";
const timeText = useMemo(() => {
    const rawDate = image?.created_at || image?.uploaded_at;
    return timeAgo(rawDate);
  }, [image?.created_at, image?.uploaded_at]);

  const initials = useMemo(() => {
    const s = String(posterName || "").trim();
    if (!s) return "?";
    return s.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
  }, [posterName]);

  useEffect(() => { setMenuOpen(false); }, [postId]);
  useEffect(() => { setIsReported(Boolean(image?.is_reported)); }, [image?.is_reported]);
  useEffect(() => {
    setUp(Number(image?.up_vote_count ?? 0));
    setDown(Number(image?.down_vote_count ?? 0));
  }, [image?.up_vote_count, image?.down_vote_count]);
  useEffect(() => { setUserVote(image?.user_vote || null); }, [image?.user_vote]);

  useEffect(() => {
    if (!isOfficial) return;
    setRevealPhase((prev) => (prev === "idle" && image?.user_vote ? "pre-existing" : prev));
  }, [image?.user_vote, isOfficial]);

 useEffect(() => {
    if (postId && isCommentsOpen && comments.length === 0) {
      loadComments();
    }
  }, [postId, isCommentsOpen]);

  // --- HANDLERS ---
  function startRevealAnimation() {
    setRevealPhase("showing");
    setTimeout(() => setRevealPhase("text-fading"), 2500);
    setTimeout(() => setRevealPhase("icon-moving"), 3050);
    setTimeout(() => setRevealPhase("settled"), 3700);
  }

  async function vote(direction) {
    if (!postId || !currentUserId || userHasVoted || busy) return;
    setError("");
    setBusy(true);
    try {
      const result = await voteOnPost(postId, currentUserId, direction);
      setUp(result.up_vote_count);
      setDown(result.down_vote_count);
      setUserVote(result.user_vote);
      xp?.addXp(result.points_awarded);
      triggerFloat(direction === "up" ? voteUpRef : voteDownRef, result.points_awarded);
      if (isOfficial) startRevealAnimation();
      if (onVoteUpdate) onVoteUpdate(postId, result.up_vote_count, result.down_vote_count);
    } catch (err) {
      setError(err.message || "Network error while voting.");
    } finally {
      setBusy(false);
    }
  }

  async function loadComments() {
    setCommentsBusy(true);
    try {
      setComments(await fetchComments(postId));
    } catch (err) {
      setError(err.message || "Failed to load comments.");
    } finally {
      setCommentsBusy(false);
    }
  }

  async function submitComment() {
    if (!postId || !currentUserId || !commentText.trim()) return;
    setCommentsBusy(true);
    try {
      const data = await submitCommentAPI(postId, currentUserId, currentUserName, commentText.trim());
      setComments((arr) => [data, ...arr]);
      setCommentText("");
      xp?.addXp(1);
      triggerFloat(commentBtnRef, 1);
    } catch (err) {
      setError(err.message || "Error posting comment.");
    } finally {
      setCommentsBusy(false);
    }
  }

  async function deleteComment(comment_id) {
    if (!confirm("Are you sure?")) return;
    setCommentsBusy(true);
    try {
      await deleteCommentAPI(comment_id);
      setComments((arr) => arr.filter((c) => c.comment_id !== comment_id));
    } catch (err) {
      setError(err.message || "Error deleting comment.");
    } finally {
      setCommentsBusy(false);
    }
  }

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
    if (!isOwner || !confirm("Delete this post? This cannot be undone.")) return;
    setBusy(true);
    try {
      await deletePostAPI(postId);
      if (onPostDelete) onPostDelete(postId);
    } catch (err) {
      setError(err.message || "Error deleting post.");
      setBusy(false);
    }
  }

  // --- MATH/UI HELPERS ---
  function clamp01(n) { return Math.max(0, Math.min(1, Number(n) || 0)); }
  function isAiLabel(lbl) { return lbl.includes("ai") || lbl.includes("fake") || lbl.includes("deepfake"); }
  function isRealLabel(lbl) { return lbl.includes("real") && !isAiLabel(lbl); }
  function computeRealPctFromModel(img) {
    const rawLabel = String(img?.result?.label ?? img?.label ?? img?.result?.verdict ?? img?.verdict ?? "Unknown").toLowerCase();
    const conf = clamp01(img?.result?.confidence ?? img?.confidence ?? img?.result?.score ?? img?.score ?? 0);
    const realProb = isRealLabel(rawLabel) ? conf : 1 - conf;
    return Math.max(0, Math.min(100, realProb * 100));
  }
  function bucketFromRealPct(r) {
    r = Math.max(0, Math.min(100, Number(r) || 0));
    if (r >= 40 && r <= 60) return { text: "Not sure", type: "neutral" };
    if (r > 60) return { text: r >= 86 ? "Highly Unlikely Fake" : "Unlikely Fake", type: "safe" };
    return { text: (100 - r) >= 86 ? "Highly Likely Fake" : "Likely Fake", type: "risk" };
  }
  function setWidthStyle(pct) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    return p === 0 ? "0px" : `calc(${p}% - 8px)`;
  }

  const analysisRealPct = computeRealPctFromModel(image);
  const analysisBucket = bucketFromRealPct(analysisRealPct);
  const totalVotes = up + down;
  const communityRealPct = totalVotes > 0 ? (up / totalVotes) * 100 : null;
  const communityBucket = communityRealPct === null ? null : bucketFromRealPct(communityRealPct);

  return (
    <div className={`comm_postBox ${isOfficial && userHasVoted ? "is-revealed-benchmark" : ""}`}>
      
      <PostHeader
        initials={initials}
        posterName={posterName}
        isOfficial={isOfficial}
        userHasVoted={userHasVoted}
        timeText={timeText}
        isTrending={image?.isTrending}
        postId={postId}
        isOwner={isOwner}
        isReported={isReported}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        closeMenu={() => setMenuOpen(false)}
        onEdit={() => { setMenuOpen(false); window.location.href = "/viewscan"; }}
        onOpenReport={() => { onOpen(); setMenuOpen(false); }}
        onDelete={deletePost}
      />

      <div className="comm_body">
        <div className="comm_description">{image?.description || ""}</div>
      </div>

      <PostMedia
        url={image?.url}
        label={image?.label}
        onClick={() => trackPostClick(postId)}
        revealPhase={revealPhase}
        isUserCorrect={isUserCorrect}
        groundTruth={groundTruth}
      />

      <PostResults
        userHasVoted={userHasVoted}
        analysisBucket={analysisBucket}
        analysisAiPct={100 - analysisRealPct}
        communityBucket={communityBucket}
        communityAiPct={communityRealPct !== null ? 100 - communityRealPct : null}
        setWidthStyle={setWidthStyle}
      />

      <PostControls
        voteUpRef={voteUpRef}
        voteDownRef={voteDownRef}
        commentBtnRef={commentBtnRef}
        onVoteUp={() => vote("up")}
        onVoteDown={() => vote("down")}
        onToggleComments={onCommentsOpen}
        userHasVoted={userHasVoted}
        busy={busy}
        upCount={up}
        downCount={down}
        commentCount={comments.length}
      />

      <PostCommentsDrawer
        isOpen={isCommentsOpen}
        onOpenChange={onCommentsChange}
        comments={comments}
        currentUserId={currentUserId}
        commentsBusy={commentsBusy}
        commentText={commentText}
        setCommentText={setCommentText}
        onSubmit={submitComment}
        onDelete={deleteComment}
      />

      {error && <div className="muted mt-2">{error}</div>}

      <ReportModal isOpen={isOpen} onClose={() => onOpenChange(false)} onSubmit={submitReport} isSubmitting={busy} />
      <XpFloatLayer floats={floats} />
    </div>
  );
}