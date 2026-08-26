import 'server-only';

/**
 * Reading the session cookie, on the server, and turning it into a principal.
 *
 * Spec: Master Technical Buildout section 18. CLAUDE.md invariant 7.
 *
 * This is the only place in the application that touches the session cookie, and the only
 * place a tenant id enters the system for a browser request. Everything downstream receives
 * a `Principal` or nothing — no page reads `tid` from anywhere, and there is no function
 * here that accepts a tenant id as an argument, because such a function is exactly the hole
 * invariant 7 describes.
 *
 * `import 'server-only'` is load-bearing rather than decorative: it makes importing this
 * from a client component a build error. A session reader that got bundled into the browser
 * would ship the verification logic and the shape of the token to every visitor.
 */

import { cookies } from 'next/headers';
import {
  SESSION_COOKIE_NAME,
  loadPrincipal,
  sessionCookieOptions,
  type Principal,
  type PrincipalRefusal,
  type SessionRejection,
} from '@complianceos/identity';
import { appConfig } from './config.js';

/**
 * Why there is no principal for this request.
 *
 * `NOT_CONFIGURED` is not a failure: it is an unconnected deployment, where signing in is
 * not offered because there is nothing to sign in to. It is kept distinct from the rejection
 * reasons so the assessment page can tell a district officer whose session expired from a
 * visitor to a demonstration deployment — two very different sentences.
 */
export type NoPrincipal =
  | { readonly kind: 'NOT_CONFIGURED' }
  | { readonly kind: 'NO_SESSION' }
  | { readonly kind: 'SESSION_REJECTED'; readonly reason: SessionRejection }
  | { readonly kind: 'REFUSED'; readonly reason: PrincipalRefusal };

export type SessionState =
  | { readonly signedIn: true; readonly principal: Principal }
  | { readonly signedIn: false; readonly why: NoPrincipal };

/**
 * The acting principal for this request, or why there is none.
 *
 * Not cached across requests, and deliberately not memoized per request either: the whole
 * reason `session.ts` keeps authority out of the token is that a revoked membership should
 * stop working on the next request, and a cache with the wrong lifetime would put that
 * window back. Within one render React's own request-scoped deduplication is welcome, but
 * it is not this module's job to invent it.
 */
export async function currentSession(): Promise<SessionState> {
  const config = appConfig();
  if (config.kind === 'UNCONNECTED') {
    return { signedIn: false, why: { kind: 'NOT_CONFIGURED' } };
  }

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (token === undefined || token.length === 0) {
    return { signedIn: false, why: { kind: 'NO_SESSION' } };
  }

  const verified = config.sealer.verify(token);
  if (!verified.ok) {
    return { signedIn: false, why: { kind: 'SESSION_REJECTED', reason: verified.reason } };
  }

  // Verified means "this process sealed it", which makes the ids trustworthy as
  // identifiers and nothing more. What the user may do is read from the database, now.
  const resolved = await loadPrincipal(config.database, verified.payload);
  if (!resolved.ok) {
    return { signedIn: false, why: { kind: 'REFUSED', reason: resolved.reason } };
  }

  return { signedIn: true, principal: resolved.principal };
}

/**
 * The principal, or null. For pages that only need to know whether to show district data.
 *
 * Named so that the null case reads as ordinary at the call site, because it is: most of
 * this product's surfaces are public, and a signed-out visitor is a visitor, not an error.
 */
export async function currentPrincipal(): Promise<Principal | null> {
  const state = await currentSession();
  return state.signedIn ? state.principal : null;
}

/**
 * Attach a freshly sealed session to the response.
 *
 * Takes the token rather than the identity, so that minting — which requires the sealer and
 * belongs with the sign-in exchange and its audit record — cannot accidentally happen here,
 * in a helper that any route could call.
 */
export async function setSessionCookie(token: string): Promise<void> {
  const config = appConfig();
  if (config.kind === 'UNCONNECTED') {
    throw new Error('Cannot set a session cookie on a deployment with no database.');
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(config.sessionTtlSeconds));
}

/**
 * Sign out.
 *
 * Overwrites with an empty value at `maxAge: 0` rather than only deleting, because a bare
 * delete on a `__Host-` cookie must match the original attributes to take effect in every
 * browser, and an expired empty value is unambiguous in all of them.
 */
export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
