import { NextRequest, NextResponse } from 'next/server';

// Next.js reads the request CSP and adds this nonce to its generated script tags.
// Each HTML response is rendered dynamically; no reusable nonce is cached.
export function middleware(request: NextRequest) {
  // Supabase permits explicit callback URLs. Keep signup on one stable origin
  // instead of sending each immutable preview host through the OAuth allowlist.
  const host = request.nextUrl.hostname;
  if (request.nextUrl.pathname === '/onboarding' &&
      host.startsWith('meera-onboarding-staging-') && host.endsWith('.vercel.app')) {
    const canonical = new URL('https://meera-onboarding-staging.vercel.app');
    canonical.pathname = request.nextUrl.pathname;
    canonical.search = request.nextUrl.search;
    return NextResponse.redirect(canonical, 307);
  }
  const nonce = btoa(crypto.randomUUID());
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "img-src 'self' data:",
    "worker-src 'self' blob:",
    "media-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] };
