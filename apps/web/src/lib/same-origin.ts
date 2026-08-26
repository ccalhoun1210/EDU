/**
 * The cross-site request forgery check, written out rather than inherited.
 *
 * No `server-only` guard, unlike `config.ts` and `session.ts`. That marker exists to stop a
 * module holding secrets or server state from reaching the browser bundle, and this module
 * holds neither: it is a pure function from a `Request` to a verdict. Marking it would buy
 * nothing and would cost the ability to unit-test it, which for a control of this kind is
 * the wrong trade.
 *
 * Spec: Master Technical Buildout section 19.
 *
 * Next's Server Actions carry an origin check of their own, and using them would have meant
 * relying on it. These endpoints are plain route handlers instead, for two reasons: a form
 * that posts to a URL works without client JavaScript and can be driven by a plain HTTP
 * client, which is what lets the connected sign-in path be tested end to end in CI; and a
 * compliance product should be able to point at the control that stops a forged sign-in
 * rather than at a framework's documentation.
 *
 * ## What is checked
 *
 * `Origin` must be present and must equal this request's own origin. Every browser sends
 * `Origin` on a cross-origin form POST, and every current browser sends it on a same-origin
 * one too, so "absent" is not a case worth admitting on a state-changing endpoint — the
 * clients that omit it are not browsers, and a sign-in endpoint has no non-browser callers.
 *
 * The origin is compared against the forwarded host rather than a configured base URL,
 * because this application is deployed to preview URLs that change per commit and a fixed
 * expected origin would either be wrong there or would have to be relaxed to a pattern.
 *
 * ## Why the host header is trusted here, and only here
 *
 * `Host` is attacker-controllable in general. It is safe for *this* comparison because the
 * check is an equality between two values the attacker would have to control simultaneously
 * from a cross-site context, and `Origin` is set by the browser and cannot be forged by
 * page script. An attacker who can already set arbitrary request headers is not doing CSRF;
 * they have a direct channel and this control was never the thing standing in their way.
 */

/** Why a state-changing request was refused before it was allowed to change anything. */
export type OriginRejection = 'MISSING_ORIGIN' | 'CROSS_ORIGIN';

export type OriginCheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: OriginRejection };

/**
 * Compare the request's `Origin` against the host it was addressed to.
 *
 * `x-forwarded-host` and `x-forwarded-proto` are consulted first because the application
 * runs behind Vercel's proxy, where `Host` is the internal name and the forwarded pair is
 * what the browser actually saw. On a direct connection they are absent and `Host` is right.
 */
export function checkSameOrigin(request: Request): OriginCheck {
  const origin = request.headers.get('origin');
  if (origin === null || origin.length === 0) return { ok: false, reason: 'MISSING_ORIGIN' };

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host === null || host.length === 0) return { ok: false, reason: 'CROSS_ORIGIN' };

  const proto =
    request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');

  // Parsed rather than string-compared, so that a trailing slash, a default port written
  // out, or a difference in case cannot be the thing that decides a security question.
  let presented: URL;
  try {
    presented = new URL(origin);
  } catch {
    return { ok: false, reason: 'CROSS_ORIGIN' };
  }

  let expected: URL;
  try {
    expected = new URL(`${proto}://${host}`);
  } catch {
    return { ok: false, reason: 'CROSS_ORIGIN' };
  }

  if (presented.host !== expected.host) return { ok: false, reason: 'CROSS_ORIGIN' };
  if (presented.protocol !== expected.protocol) return { ok: false, reason: 'CROSS_ORIGIN' };

  return { ok: true };
}
