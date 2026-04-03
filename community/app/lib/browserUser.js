import { getBrowserAccessToken } from "./browserAccessToken";

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

async function getAccessToken(req) {
  return getBrowserAccessToken(req);
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

export async function getBrowserUser(req) {
  const accessToken = await getAccessToken(req);
  return fetchGatewayUser(accessToken);
}

export async function getOptionalBrowserUser(req) {
  try {
    return await getBrowserUser(req);
  } catch {
    return null;
  }
}

export async function getBrowserUserForAppShell() {
  return getBrowserUser();
}
