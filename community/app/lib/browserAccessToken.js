import { cookies } from "next/headers";

export function cleanBearerToken(value) {
  if (!value) return "";
  return String(value).replace(/^Bearer\s+/i, "").replace(/"/g, "").trim();
}

export function getTokenFromRequest(req) {
  const authHeader = req?.headers?.get?.("authorization");
  const bearerToken = cleanBearerToken(authHeader);
  if (bearerToken) {
    return bearerToken;
  }

  const cookieToken = req?.cookies?.get?.("access_token")?.value;
  return cleanBearerToken(cookieToken);
}

export async function getTokenFromServerCookies() {
  const cookieStore = await cookies();
  return cleanBearerToken(cookieStore.get("access_token")?.value);
}

export async function getBrowserAccessToken(req) {
  const requestToken = getTokenFromRequest(req);
  if (requestToken) {
    return requestToken;
  }
  return getTokenFromServerCookies();
}
