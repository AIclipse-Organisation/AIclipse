function parseGatewayBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildGatewayImageError(status, detail) {
  const error = new Error(detail || `Gateway image mutation failed (${status})`);
  error.status = status;
  return error;
}

function buildGatewayImageUrl(imageId) {
  const safeImageId = String(imageId || "").trim();
  if (!safeImageId) {
    throw buildGatewayImageError(500, "Missing image_id");
  }

  const gatewayBase = String(process.env.GATEWAY_URI || "").trim();
  if (!gatewayBase) {
    throw buildGatewayImageError(500, "Missing GATEWAY_URI");
  }

  return new URL(
    `image/${safeImageId}`,
    gatewayBase.endsWith("/") ? gatewayBase : `${gatewayBase}/`,
  );
}

async function requestGatewayImageMutation({
  imageId,
  method,
  body,
  user,
  buildGatewayIdentityHeaders,
}) {
  const response = await fetch(buildGatewayImageUrl(imageId), {
    method,
    headers: buildGatewayIdentityHeaders(user),
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  if (response.ok) {
    return;
  }

  const text = await response.text();
  const payload = parseGatewayBody(text);
  throw buildGatewayImageError(
    response.status,
    payload?.detail || payload?.error || text || `Gateway image mutation failed (${response.status})`,
  );
}

export async function setImageVisibilityOrThrow({
  imageId,
  isPublic,
  user,
  buildGatewayIdentityHeaders,
}) {
  await requestGatewayImageMutation({
    imageId,
    method: "PATCH",
    body: { is_public: isPublic },
    user,
    buildGatewayIdentityHeaders,
  });
}

export async function deleteImageOrThrow({
  imageId,
  user,
  buildGatewayIdentityHeaders,
}) {
  await requestGatewayImageMutation({
    imageId,
    method: "DELETE",
    user,
    buildGatewayIdentityHeaders,
  });
}
