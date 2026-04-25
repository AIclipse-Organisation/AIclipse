function buildGatewayError(status, detail) {
  const error = new Error(detail || `Gateway request failed (${status})`);
  error.status = status;
  return error;
}

export function buildInternalGatewayUrl(path) {
  const gatewayBase = String(process.env.GATEWAY_URI || "").trim();
  if (!gatewayBase) {
    throw buildGatewayError(500, "Missing GATEWAY_URI");
  }

  return new URL(
    path.replace(/^\//, ""),
    gatewayBase.endsWith("/") ? gatewayBase : `${gatewayBase}/`,
  );
}

export function buildInternalGatewayHeaders(extraHeaders = {}) {
  const internalToken = String(process.env.INTERNAL_AUTH_TOKEN || "").trim();
  if (!internalToken) {
    throw buildGatewayError(500, "Missing INTERNAL_AUTH_TOKEN");
  }

  return {
    "Content-Type": "application/json",
    "X-Internal-Token": internalToken,
    ...extraHeaders,
  };
}
