import { hasTrustedInternalToken, readForwardedTrustedUser } from "./forwardedUser";

function normalizeForwardedUser(user) {
  const user_id = String(user?.user_id || "").trim();
  if (!user_id) {
    throw new Error("Missing forwarded user id");
  }

  return {
    user_id,
    email: user?.email ? String(user.email) : null,
    user_name: user?.user_name ? String(user.user_name) : null,
    is_admin: Boolean(user?.is_admin),
  };
}

export async function getForwardedUser(req) {
  const forwardedUser = readForwardedTrustedUser(
    req?.headers,
    process.env.INTERNAL_AUTH_TOKEN,
  );
  if (!forwardedUser) {
    throw new Error("Missing forwarded user context");
  }
  return normalizeForwardedUser(forwardedUser);
}

export async function getOptionalForwardedUser(req) {
  try {
    return await getForwardedUser(req);
  } catch {
    return null;
  }
}

export async function requireInternalRequest(req) {
  const isTrusted = hasTrustedInternalToken(
    req?.headers,
    process.env.INTERNAL_AUTH_TOKEN,
  );
  if (!isTrusted) {
    throw new Error("Missing internal auth token");
  }
  return true;
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
