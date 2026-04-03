const FEED_OVERSCAN_MULTIPLIER = 4;
const FEED_MAX_CANDIDATES = 96;

function safePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

export function buildFeedCandidateWindow(page, limit) {
  const safePage = safePositiveInt(page, 1);
  const safeLimit = safePositiveInt(limit, 1);
  const pageOffset = (safePage - 1) * safeLimit;
  const requiredItems = pageOffset + safeLimit;
  const candidateLimit = Math.min(
    Math.max(requiredItems * FEED_OVERSCAN_MULTIPLIER, requiredItems + 12),
    FEED_MAX_CANDIDATES,
  );

  return {
    pageOffset,
    candidateLimit,
    fetchLimit: candidateLimit + 1,
  };
}

export function mergeFeedItems(existingItems, incomingItems) {
  const mergedById = new Map();
  const orderedIds = [];

  for (const item of Array.isArray(existingItems) ? existingItems : []) {
    const postId = String(item?.post_id || "").trim();
    if (!postId || mergedById.has(postId)) {
      continue;
    }
    mergedById.set(postId, item);
    orderedIds.push(postId);
  }

  for (const item of Array.isArray(incomingItems) ? incomingItems : []) {
    const postId = String(item?.post_id || "").trim();
    if (!postId) {
      continue;
    }
    if (!mergedById.has(postId)) {
      orderedIds.push(postId);
    }
    mergedById.set(postId, item);
  }

  return orderedIds.map((postId) => mergedById.get(postId)).filter(Boolean);
}
