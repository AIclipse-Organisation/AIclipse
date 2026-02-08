import { NextResponse } from 'next/server';

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  
  // PROD SAFE: Dynamically get the domain (e.g., aiclipse.online)
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const externalLoginUrl = `http://${host}/`;

  // Public Paths
  const isPublicPath = pathname === '/healthz' || pathname.startsWith('/_next') || pathname.startsWith('/static') || pathname === '/favicon.ico';
  if (isPublicPath) return NextResponse.next();

  // Token Check
  const token = request.cookies.get("access_token")?.value;

  if (!token) {
    // Return a standard redirect. The React Client will now handle the enforcement.
    const response = NextResponse.redirect(externalLoginUrl);
    response.headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
    return response;
  }

  // ... (Your existing gateway check logic) ...
  // Keep the rest of your file exactly as it was
  try {
     const GATEWAY_URI = process.env.GATEWAY_URI || "http://gateway-srv:3000";
     const res = await fetch(`${GATEWAY_URI}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
     });
     if (!res.ok) throw new Error("Gateway Auth Failed");
     
     // Admin check...
     return NextResponse.next();
  } catch (err) {
     return NextResponse.redirect(externalLoginUrl);
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};