/**
 * A per-request Content-Security-Policy nonce.
 *
 * Spec: Master Technical Buildout section 19.
 *
 * ## Why this is not a static header
 *
 * The policy used to be declared as a constant in `next.config.ts`, with a comment saying no
 * inline script was used so it could be strict from the start. That was wrong about the
 * framework. The App Router streams its server-rendered payload to the client through inline
 * `<script>` tags — nine of them on a page of this size — and `script-src 'self'` blocks every
 * one, so React never hydrated. Nothing on these pages needs hydration today, which is exactly
 * why it went unnoticed: the symptom was console errors and a policy stricter than intended,
 * not a broken screen. The first interactive control would have found it the hard way.
 *
 * The fix is the nonce Next is built for. Each request gets a fresh one; the CSP is set on the
 * *request* headers so the renderer stamps it onto the scripts it emits, and on the response so
 * the browser enforces it. `strict-dynamic` then lets those nonced scripts load the chunks they
 * need without the policy having to enumerate them.
 *
 * ## Why the smoke test asserts this
 *
 * A CSP that is declared and never checked is how the previous one came to be silently wrong,
 * twice — first living in a `vercel.json` the deployment did not read, then blocking the
 * framework's own scripts. `scripts/smoke-web.mjs` fetches a page and fails if the header is
 * missing, if it carries no nonce, or if the served HTML's inline scripts do not carry that
 * same nonce. The control is not trusted; it is tested.
 */

import { NextResponse, type NextRequest } from 'next/server';

/**
 * Directives that do not depend on the nonce.
 *
 * `style-src` keeps `'unsafe-inline'`: Next inlines critical CSS, and a style nonce would have
 * to be threaded through every stylesheet link the framework emits. Inline style is a far
 * weaker vector than inline script, and narrowing it is a separate piece of work.
 */
const BASE_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
];

export function middleware(request: NextRequest) {
  // `crypto` is the Web Crypto global in the Edge runtime; there is no Node `Buffer` here.
  const nonce = btoa(crypto.randomUUID());

  const policy = [
    // `strict-dynamic` makes browsers that understand it ignore the host allow-list and trust
    // only what a nonced script loads. `'self'` stays for the ones that do not.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    ...BASE_DIRECTIVES,
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  // Read by the renderer. Without this the response carries a nonce that nothing was stamped
  // with, which is worse than no policy: every script is blocked and the header looks correct.
  requestHeaders.set('content-security-policy', policy);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', policy);
  return response;
}

export const config = {
  /*
   * Documents only. A CSP header on a JavaScript chunk or an image does nothing, and running
   * middleware for every static asset is invocation cost for no control.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
