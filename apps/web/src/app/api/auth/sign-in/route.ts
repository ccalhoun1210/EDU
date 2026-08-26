/**
 * The sign-in exchange.
 *
 * Spec: Master Technical Buildout section 18. CLAUDE.md invariant 7.
 *
 * A route handler taking a form POST, so the sign-in page works with client JavaScript
 * disabled and so the connected path can be driven by an HTTP client in CI. The forgery
 * control is explicit and lives in `same-origin.ts`.
 *
 * This handler is deliberately incurious about what the browser sent. It reads one field,
 * `handle`, and everything else about the resulting session — which tenant, which user —
 * comes from the roster row that handle selected and then from the database. There is no
 * path here by which a form field becomes a tenant id.
 */

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { establishPrincipal } from '@complianceos/identity';
import { connected, demoProviderFor, demoRoster } from '@/lib/roster';
import { checkSameOrigin } from '@/lib/same-origin';
import { setSessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Failure sends the browser back to the form with a coarse reason.
 *
 * Two values, and neither says which account exists. The resolver distinguishes
 * NOT_PROVISIONED from SUSPENDED from NO_ACTIVE_MEMBERSHIP because an operator needs to,
 * but an unauthenticated visitor does not get to enumerate a district's users by reading
 * the error. That detail belongs in the audit log.
 *
 * 303 rather than 302, so the browser follows with GET. A 302 after a POST leaves some
 * clients re-posting the form on refresh.
 */
function back(request: Request, error: 'unavailable' | 'refused'): NextResponse {
  return NextResponse.redirect(new URL(`/sign-in?error=${error}`, request.url), 303);
}

export async function POST(request: Request): Promise<NextResponse> {
  const origin = checkSameOrigin(request);
  if (!origin.ok) {
    // Not a redirect: a forged cross-site post should get a flat refusal rather than a
    // helpful bounce to a page that tells the attacker what to fix.
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const config = connected();
  if (config === null) return back(request, 'unavailable');

  const roster = await demoRoster();
  if (roster === null || roster.length === 0) return back(request, 'unavailable');

  const form = await request.formData();
  const handle = form.get('handle');
  if (typeof handle !== 'string') return back(request, 'refused');

  const outcome = await demoProviderFor(roster).authenticate({ handle });
  if (!outcome.ok) return back(request, 'refused');

  // Minted before the principal is resolved so the same id can be carried on the principal
  // and, later, on every audit event this session produces.
  const sessionId = randomUUID();
  const resolved = await establishPrincipal(config.database, outcome.claim, sessionId);
  if (!resolved.ok) return back(request, 'refused');

  await setSessionCookie(
    config.sealer.seal({
      tenantId: resolved.principal.tenantId,
      userId: resolved.principal.userId,
      subjectId: resolved.principal.subjectId,
      sessionId,
    }).token,
  );

  return NextResponse.redirect(new URL('/assessment', request.url), 303);
}
