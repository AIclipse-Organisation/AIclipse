import { fetchGatewayJson } from "./gatewayFetch.js";
import { buildInternalGatewayHeaders, buildInternalGatewayUrl } from "./internalGateway.js";

function buildLookupError(status, detail) {
  const error = new Error(detail || `Gateway image lookup failed (${status})`);
  error.status = status;
  return error;
}

function getGatewayLookupUrl() {
  try {
    return buildInternalGatewayUrl("internal/images/lookup");
  } catch (error) {
    throw buildLookupError(error?.status || 500, error?.message || "Missing GATEWAY_URI");
  }
}

function normalizeExternalProto(value) {
  const proto = String(value || "")
    .split(",", 1)[0]
    .trim()
    .toLowerCase();
  if (proto === "http" || proto === "https") {
    return proto;
  }
  return null;
}

function normalizeImageIds(imageIds) {
  const seen = new Set();
  const ids = [];

  for (const rawId of imageIds || []) {
    const imageId = String(rawId || "").trim();
    if (!imageId || seen.has(imageId)) {
      continue;
    }
    seen.add(imageId);
    ids.push(imageId);
  }

  return ids;
}

export function resolveRenderableItemsWithPublicImages(items, imageItems) {
  const imageMap = new Map(
    (Array.isArray(imageItems) ? imageItems : [])
      .filter((item) => item && item.image_id)
      .map((item) => [item.image_id, item]),
  );

  const renderableItems = [];
  const missingImageIds = [];

  for (const item of Array.isArray(items) ? items : []) {
    const imageId = String(item?.image_id || "").trim();
    if (!imageId) {
      missingImageIds.push("");
      continue;
    }

    const image = imageMap.get(imageId);
    if (!image) {
      missingImageIds.push(imageId);
      continue;
    }

    renderableItems.push({ ...image, ...item });
  }

  return {
    items: renderableItems,
    missingImageIds,
  };
}

export async function fetchPublicImagesByIds(imageIds, options = {}) {
  const ids = normalizeImageIds(imageIds);
  if (!ids.length) {
    return [];
  }

  let headers;
  try {
    headers = buildInternalGatewayHeaders();
  } catch (error) {
    throw buildLookupError(error?.status || 500, error?.message || "Missing INTERNAL_AUTH_TOKEN");
  }
  const externalProto = normalizeExternalProto(options.externalProto);
  if (externalProto) {
    headers["X-External-Proto"] = externalProto;
  }

  const payload = await fetchGatewayJson(
    getGatewayLookupUrl(),
    {
      method: "POST",
      headers,
      body: JSON.stringify({ image_ids: ids }),
    },
    {
      timeoutMs: 5000,
      errorPrefix: "Gateway image lookup",
    },
  ).catch((error) => {
    throw buildLookupError(error?.status || 502, error?.message || "Gateway image lookup failed");
  });

  if (!Array.isArray(payload?.items)) {
    throw buildLookupError(502, "Invalid JSON from gateway image lookup");
  }

  return payload.items;
}
