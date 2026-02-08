import { NextResponse } from 'next/server';

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const externalLoginUrl = `http://${host}/`;

  const isPublicPath = pathname === '/healthz' || pathname.startsWith('/_next') || pathname.startsWith('/static') || pathname === '/favicon.ico';
  if (isPublicPath) return NextResponse.next();

  const token = request.cookies.get("access_token")?.value;

  if (!token) {
    const response = NextResponse.redirect(externalLoginUrl);
    response.headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
    return response;
  }


  try {
     const GATEWAY_URI = process.env.GATEWAY_URI
     const res = await fetch(`${GATEWAY_URI}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
     });
     if (!res.ok) throw new Error("Gateway Auth Failed");
     
     return NextResponse.next();
  } catch (err) {
     return NextResponse.redirect(externalLoginUrl);
  }
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|adminBFF).*)',],
};