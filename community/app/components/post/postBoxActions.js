/**
 * Business logic functions for PostBox component
 * Handles API calls and data operations
 */

/**
 * Vote on a post
 */
export async function voteOnPost(postId, userId, direction) {
  const res = await fetch(`/community/posts/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "include",
    body: JSON.stringify({ post_id: postId, user_id: userId, vote: direction }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || data.detail || `Vote failed (${res.status})`);
  }

  return {
    up_vote_count: Number(data.up_vote_count ?? 0),
    down_vote_count: Number(data.down_vote_count ?? 0),
  };
}

/**
 * Load comments for a post
 */
export async function fetchComments(postId) {
  const res = await fetch(
    `/community/posts/comments?post_id=${encodeURIComponent(postId)}`,
    { credentials: "include", headers: { Accept: "application/json" } }
  );

  const data = await res.json().catch(() => ({}));
  
  if (!res.ok) {
    throw new Error(data.error || data.detail || `Failed to load comments (${res.status})`);
  }

  return Array.isArray(data.items) ? data.items : [];
}

/**
 * Track post click
 */
export function trackPostClick(postId) {
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

/**
 * Report a post
 */
export async function reportPostAPI(postId) {
  const res = await fetch("/community/posts/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ post_id: postId }),
  });

  const data = await res.json();
  return data?.is_reported !== false;
}

/**
 * Delete a post
 */
export async function deletePostAPI(postId) {
  const res = await fetch(`/community/posts?post_id=${encodeURIComponent(postId)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || data.detail || `Failed to delete post (${res.status})`);
  }

  return data;
}

/**
 * Submit a comment
 */
export async function submitCommentAPI(postId, userId, userName, text) {
  const res = await fetch(`/community/posts/comments`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      post_id: postId,
      user_id: userId,
      user_name: userName,
      text,
    }),
  });

  const data = await res.json().catch(() => ({}));
  
  if (!res.ok) {
    throw new Error(data.error || data.detail || `Comment failed (${res.status})`);
  }

  return data;
}

/**
 * Delete a comment
 */
export async function deleteCommentAPI(commentId) {
  const res = await fetch(`/community/posts/comments?comment_id=${encodeURIComponent(commentId)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || data.detail || `Failed to delete comment (${res.status})`);
  }

  return data;
}

/**
 * Format score value
 */
export function formatScore(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(6);
}
