import { cookies } from "next/headers";

function cleanToken(value) {
  if (!value) return "";
  return String(value).replace(/^Bearer\s+/i, "").replace(/"/g, "").trim();
}

function normalizeGatewayUser(user) {
  const user_id = String(user?.user_id || "").trim();
  if (!user_id) {
    throw new Error("Missing gateway user id");
  }

  return {
    user_id,
    email: user?.email ? String(user.email) : null,
    user_name: user?.user_name ? String(user.user_name) : null,
    is_admin: Boolean(user?.is_admin),
  };
}

function getTokenFromRequest(req) {
  const authHeader = req?.headers?.get?.("authorization");
  const bearerToken = cleanToken(authHeader);
  if (bearerToken) {
    return bearerToken;
  }

  const cookieToken = req?.cookies?.get?.("access_token")?.value;
  return cleanToken(cookieToken);
}

async function getTokenFromServerCookies() {
  const cookieStore = await cookies();
  return cleanToken(cookieStore.get("access_token")?.value);
}

async function getAccessToken(req) {
  const requestToken = getTokenFromRequest(req);
  if (requestToken) {
    return requestToken;
  }
  return getTokenFromServerCookies();
}

async function fetchGatewayUser(accessToken) {
  const gateway = String(process.env.GATEWAY_URI || "").trim();
  if (!gateway) {
    throw new Error("Missing GATEWAY_URI");
  }
  if (!accessToken) {
    throw new Error("Missing access token");
  }

  let response;
  try {
    response = await fetch(`${gateway}/auth/me`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });
  } catch {
    throw new Error("Gateway auth/me unreachable");
  }

  if (!response.ok) {
    throw new Error(`Gateway auth/me ${response.status}`);
  }

  return normalizeGatewayUser(await response.json());
}

async function resolveTrustedUser(req) {
  const accessToken = await getAccessToken(req);
  return fetchGatewayUser(accessToken);
}

export async function getTrustedUser(req) {
  return resolveTrustedUser(req);
}

export async function getOptionalTrustedUser(req) {
  try {
    return await resolveTrustedUser(req);
  } catch {
    return null;
  }
}

export async function getTrustedUserForAppShell() {
  return resolveTrustedUser();
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
