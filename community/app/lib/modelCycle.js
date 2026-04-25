import { fetchGatewayJson } from "./gatewayFetch.js";
import { buildInternalGatewayHeaders, buildInternalGatewayUrl } from "./internalGateway.js";

function normalizeVotes(votes) {
  return (Array.isArray(votes) ? votes : [])
    .map((vote) => {
      const userId = String(vote?.user_id || vote?.userId || "").trim();
      const rawVote = String(vote?.vote || "").trim().toLowerCase();
      if (!userId || (rawVote !== "up" && rawVote !== "down")) {
        return null;
      }
      return {
        userId,
        isAiVote: rawVote === "down",
      };
    })
    .filter(Boolean);
}

export async function evaluateCommunityVotes({
  postId,
  mediaImageId,
  s3Key,
  label,
  modelConfidence,
  modelVersion,
  votes,
}) {
  const normalizedPostId = String(postId || "").trim();
  const normalizedImageId = String(mediaImageId || "").trim();
  const normalizedS3Key = String(s3Key || "").trim();
  const normalizedLabel = String(label || "").trim().toLowerCase();
  const normalizedModelVersion = String(modelVersion || "").trim();
  const normalizedVotes = normalizeVotes(votes);

  if (!normalizedPostId || !normalizedImageId || !normalizedS3Key || !normalizedModelVersion) {
    throw new Error("Model cycle evaluation payload is incomplete");
  }

  return fetchGatewayJson(
    buildInternalGatewayUrl("/internal/model-cycle/imageconfidence/evaluate"),
    {
      method: "POST",
      headers: buildInternalGatewayHeaders(),
      body: JSON.stringify({
        postId: normalizedPostId,
        mediaImageId: normalizedImageId,
        s3Key: normalizedS3Key,
        label: normalizedLabel || "unknown",
        modelConfidence: Number(modelConfidence || 0),
        modelVersion: normalizedModelVersion,
        votes: normalizedVotes,
      }),
    },
    {
      timeoutMs: 5000,
      errorPrefix: "Model cycle evaluation",
    },
  );
}
