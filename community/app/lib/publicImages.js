function parseGatewayBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildLookupError(status, detail) {
  const error = new Error(detail || `Gateway image lookup failed (${status})`);
  error.status = status;
  return error;
}

function getGatewayLookupUrl() {
  const gatewayBase = String(process.env.GATEWAY_URI || "").trim();
  if (!gatewayBase) {
    throw buildLookupError(500, "Missing GATEWAY_URI");
  }

  return new URL(
    "internal/images/lookup",
    gatewayBase.endsWith("/") ? gatewayBase : `${gatewayBase}/`,
  );
}

function getInternalHeaders() {
  const internalToken = String(process.env.INTERNAL_AUTH_TOKEN || "").trim();
  if (!internalToken) {
    throw buildLookupError(500, "Missing INTERNAL_AUTH_TOKEN");
  }

  return {
    "Content-Type": "application/json",
    "X-Internal-Token": internalToken,
  };
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

export async function fetchPublicImagesByIds(imageIds) {
  const ids = normalizeImageIds(imageIds);
  if (!ids.length) {
    return [];
  }

  const response = await fetch(getGatewayLookupUrl(), {
    method: "POST",
    headers: getInternalHeaders(),
    body: JSON.stringify({ image_ids: ids }),
    cache: "no-store",
  });

  const text = await response.text();
  const payload = parseGatewayBody(text);

  if (!response.ok) {
    throw buildLookupError(response.status, payload?.detail || payload?.error || text);
  }
  if (!Array.isArray(payload?.items)) {
    throw buildLookupError(502, "Invalid JSON from gateway image lookup");
  }

  return payload.items;
}
