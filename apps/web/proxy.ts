import { NextResponse, type NextRequest } from 'next/server';

// Mirrors SESSION_COOKIE_NAMES in packages/auth/src/mcp-session.ts.
// Cookie presence is a fast gate only — page-level getSession() remains
// authoritative for whether the session is valid.
const SESSION_COOKIES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
];

const APP_PREFIXES = [
  '/dashboard',
  '/skills',
  '/connections',
  '/observability',
  '/ee',
  '/profile',
];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const isAppRoute = APP_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isAppRoute) return NextResponse.next();

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) return NextResponse.next();

  const signInUrl = new URL('/sign-in', request.url);
  signInUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ['/((?!_next/|api/|.*\\..*).*)'],
};
