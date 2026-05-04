import { NextResponse } from "next/server";
import { getLoginUrlFromHeaders, isHttpsFromHeaders } from "./externalOrigin";
import { applySecurityHeaders } from "./lib/securityHeaders.js";

function isPublicPath(pathname) {
  return (
    pathname === "/healthz" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname === "/favicon.ico"
  );
}

function safeTokenCompare(a, b) {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

function isTrustedInternalRequest(request) {
  const expectedToken = String(process.env.INTERNAL_AUTH_TOKEN || "").trim();
  if (!expectedToken) return false;

  const providedToken = String(request.headers.get("x-internal-token") || "").trim();
  return providedToken !== "" && safeTokenCompare(providedToken, expectedToken);
}

function redirectToLogin(request, reason = "auth_failed") {
  const loginUrl = getLoginUrlFromHeaders(request.headers, request.nextUrl.origin);
  const secure = isHttpsFromHeaders(request.headers);

  console.warn(
    `[community] auth redirect (${reason}) for ${request.method} ${request.nextUrl.pathname}`,
  );

  const res = new NextResponse(null, {
    status: 302,
    headers: {
      Location: loginUrl.toString(),
    },
  });
  res.headers.set("Cache-Control", "no-store, max-age=0, must-revalidate, no-transform");
  res.headers.set("Pragma", "no-cache");

  res.cookies.set("access_token", "", {
    path: "/",
    expires: new Date(0),
    httpOnly: true,
    sameSite: "lax",
    secure,
  });

  return applySecurityHeaders(res);
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) return applySecurityHeaders(NextResponse.next());
  if (isTrustedInternalRequest(request)) return applySecurityHeaders(NextResponse.next());

  const token = request.cookies.get("access_token")?.value;
  if (!token) return redirectToLogin(request, "missing_access_token");
  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|adminBFF).*)"],
};
