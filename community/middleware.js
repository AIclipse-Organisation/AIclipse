import { NextResponse } from "next/server";
import { getLoginUrlFromHeaders, isHttpsFromHeaders } from "./externalOrigin";

function isPublicPath(pathname) {
  return (
    pathname === "/healthz" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname === "/favicon.ico"
  );
}

async function isTokenValid(token) {
  const gateway = process.env.GATEWAY_URI;
  if (!gateway) return null;

  try {
    const res = await fetch(`${gateway}/auth/me`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function redirectToLogin(request) {
  const loginUrl = getLoginUrlFromHeaders(request.headers, request.nextUrl.origin);
  const secure = isHttpsFromHeaders(request.headers);

  const res = NextResponse.redirect(loginUrl, 302);
  res.headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
  res.headers.set("Pragma", "no-cache");

  res.cookies.set("access_token", "", {
    path: "/",
    expires: new Date(0),
    httpOnly: true,
    sameSite: "lax",
    secure,
  });

  return res;
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) return NextResponse.next();

  const token = request.cookies.get("access_token")?.value;
  if (!token) return redirectToLogin(request);

  const user = await isTokenValid(token);
  if (!user?.user_id) return redirectToLogin(request);

  const forwardedHeaders = new Headers(request.headers);
  const internalToken = String(process.env.INTERNAL_AUTH_TOKEN || "").trim();
  if (internalToken) {
    forwardedHeaders.set("x-internal-token", internalToken);
  }
  forwardedHeaders.set("x-user-id", String(user.user_id));
  forwardedHeaders.set("x-user-is-admin", user.is_admin ? "true" : "false");
  if (user.email) {
    forwardedHeaders.set("x-user-email", String(user.email));
  }
  if (user.user_name) {
    forwardedHeaders.set("x-user-name", String(user.user_name));
  }

  return NextResponse.next({
    request: {
      headers: forwardedHeaders,
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|adminBFF).*)"],
};
