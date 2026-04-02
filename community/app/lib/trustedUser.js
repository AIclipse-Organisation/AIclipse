const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function normalizedHeader(headersLike, name) {
  if (!headersLike || typeof headersLike.get !== "function") return "";
  return String(headersLike.get(name) || "").trim();
}

function parseBooleanHeader(value) {
  return TRUE_VALUES.has(String(value || "").trim().toLowerCase());
}

function requireTrustedHeaders(headersLike) {
  const expectedToken = String(process.env.INTERNAL_AUTH_TOKEN || "").trim();
  const actualToken = normalizedHeader(headersLike, "x-internal-token");
  if (!expectedToken || actualToken !== expectedToken) {
    throw new Error("Missing or invalid trusted request token");
  }

  const user_id = normalizedHeader(headersLike, "x-user-id");
  if (!user_id) {
    throw new Error("Missing forwarded user id");
  }

  return {
    user_id,
    email: normalizedHeader(headersLike, "x-user-email") || null,
    user_name: normalizedHeader(headersLike, "x-user-name") || null,
    is_admin: parseBooleanHeader(normalizedHeader(headersLike, "x-user-is-admin")),
  };
}

export function getTrustedUser(req) {
  return requireTrustedHeaders(req?.headers);
}

export function getOptionalTrustedUser(req) {
  try {
    return requireTrustedHeaders(req?.headers);
  } catch {
    return null;
  }
}

export function getTrustedUserFromHeaderStore(headerStore) {
  return requireTrustedHeaders(headerStore);
}

export function buildGatewayIdentityHeaders(user) {
  const internalToken = String(process.env.INTERNAL_AUTH_TOKEN || "").trim();
  if (!internalToken) {
    throw new Error("Missing INTERNAL_AUTH_TOKEN");
  }

  const userId = String(user?.user_id || "").trim();
  if (!userId) {
    throw new Error("Missing forwarded user id");
  }

  const headers = {
    "Content-Type": "application/json",
    "X-Internal-Token": internalToken,
    "X-User-Id": userId,
    "X-User-Is-Admin": user?.is_admin ? "true" : "false",
  };

  if (user?.email) {
    headers["X-User-Email"] = String(user.email);
  }
  if (user?.user_name) {
    headers["X-User-Name"] = String(user.user_name);
  }

  return headers;
}
