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
  if (!gateway) return false;

  try {
    const res = await fetch(`${gateway}/auth/me`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
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

  const ok = await isTokenValid(token);
  if (!ok) return redirectToLogin(request);

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|adminBFF).*)"],
};