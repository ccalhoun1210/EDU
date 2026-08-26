/**
 * Sign out.
 *
 * A POST, not a GET, because a link that ends a session is a link a prefetcher or a link
 * scanner will follow — and the user would be signed out by hovering over their own
 * navigation. The same origin check applies: being signed out by a cross-site page is a
 * smaller harm than being signed in as someone else, but it is still not something another
 * site gets to do.
 */

import { NextResponse } from 'next/server';
import { checkSameOrigin } from '@/lib/same-origin';
import { clearSessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const origin = checkSameOrigin(request);
  if (!origin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  await clearSessionCookie();
  return NextResponse.redirect(new URL('/', request.url), 303);
}
