/**
 * Upload a district fiscal export.
 *
 * Spec: Master Technical Buildout sections 10 and 11. CLAUDE.md invariants 3 and 7.
 *
 * A POST that reads the file, evaluates it and stores both, then redirects back to the
 * assessment. A redirect rather than JSON because the caller is a plain HTML form: this
 * page works without JavaScript, which for a district business officer on a locked-down
 * school-network browser is not a hypothetical.
 *
 * The outcome travels back in the query string as a short code — never as prose the client
 * supplies. A message rendered from a URL parameter is a reflected-content hole; a code the
 * page looks up in a table it owns is not.
 */

import { NextResponse } from 'next/server';
import { checkSameOrigin } from '@/lib/same-origin';
import { currentSession } from '@/lib/session';
import { ingestDistrictExport, type UploadRefusal } from '@/lib/district';

export const dynamic = 'force-dynamic';

/**
 * The largest export this route will read.
 *
 * A district fiscal export is one row of a few dozen columns. Eight megabytes is far beyond
 * anything legitimate and still small enough that reading it into memory is not itself the
 * denial of service — the point of the limit.
 */
const MAX_BYTES = 8 * 1024 * 1024;

function back(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL('/assessment', request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request): Promise<NextResponse> {
  const origin = checkSameOrigin(request);
  if (!origin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const session = await currentSession();
  if (!session.signedIn) return back(request, { upload: 'signed-out' });

  const form = await request.formData();
  const file = form.get('export');
  if (!(file instanceof File) || file.size === 0) {
    return back(request, { upload: 'no-file' });
  }
  if (file.size > MAX_BYTES) return back(request, { upload: 'too-large' });

  const bytes = Buffer.from(await file.arrayBuffer());

  // Supplied here rather than read inside the pipeline, which never touches a clock so that
  // a run reproduces. `asOf` is the calendar date the rules are resolved as of — invariant 6,
  // a date and not a timestamp, so a deadline cannot shift by a day through a UTC round trip.
  const now = new Date();
  const uploadedAt = now.toISOString();
  const asOf = uploadedAt.slice(0, 10);

  const result = await ingestDistrictExport({
    principal: session.principal,
    fileName: file.name,
    bytes,
    uploadedAt,
    asOf,
  });

  if (result.ok) return back(request, { upload: 'stored', run: result.assessmentRunId });
  return back(request, { upload: codeFor(result.refusal) });
}

/** The refusal, as a code the assessment page renders from its own copy. */
function codeFor(refusal: UploadRefusal): string {
  switch (refusal.kind) {
    case 'NOT_CONNECTED':
      return 'not-connected';
    case 'NOT_PERMITTED':
      return 'not-permitted';
    case 'NO_ORGANIZATION':
      return 'no-organization';
    case 'NOT_SCANNED':
      return 'not-scanned';
    case 'ALREADY_IMPORTED':
      return 'already-imported';
    case 'REJECTED':
      return 'rejected';
    case 'CONTENT_NOT_PUBLISHED':
      return 'content-not-published';
    case 'BROKEN_PROVENANCE':
      return 'broken-provenance';
  }
}
