/**
 * The district export upload form, and what happened to the last one.
 *
 * Spec: Master Technical Buildout section 10.
 *
 * A plain HTML form posting `multipart/form-data`. No JavaScript, no progress bar, no drag
 * target: a business officer on a school network with a locked-down browser can still use it,
 * and a form that works without script is one less thing that can silently do nothing.
 *
 * The outcome arrives as a code in the query string and is looked up here. The route never
 * sends prose for this page to render — a message taken from a URL is content an attacker
 * writes, and this is a page a district officer trusts.
 */

const OUTCOMES: Readonly<Record<string, { readonly tone: 'ok' | 'warn'; readonly text: string }>> =
  {
    stored: {
      tone: 'ok',
      text:
        'Export stored and assessed. The result below was read back out of the database, not ' +
        'recomputed for this page.',
    },
    'signed-out': {
      tone: 'warn',
      text: 'Your session ended before the upload completed. Sign in and try again.',
    },
    'no-file': { tone: 'warn', text: 'No file was attached, so nothing was uploaded.' },
    'too-large': {
      tone: 'warn',
      text:
        'That file is larger than this route accepts. A district fiscal export is a single ' +
        'row of a few dozen columns; a file of that size is not one.',
    },
    'not-connected': {
      tone: 'warn',
      text: 'This deployment has no database configured, so an upload has nowhere to go.',
    },
    'not-permitted': {
      tone: 'warn',
      text:
        'Uploading a district export requires the configure capability. Your access here is ' +
        'read-only.',
    },
    'no-organization': {
      tone: 'warn',
      text:
        'Your account is not scoped to exactly one organization, so which district this export ' +
        'belongs to is not something this page may guess.',
    },
    'not-scanned': {
      tone: 'warn',
      text:
        'No malware scanner is configured for this deployment, so an uploaded file cannot be ' +
        'cleared. Configure one, or set UPLOAD_ACCEPT_UNSCANNED=true to accept unscanned ' +
        'uploads — which is then recorded on the import and shown wherever it is rendered.',
    },
    'already-imported': {
      tone: 'warn',
      text:
        'This exact file has already been imported for your district, so nothing was stored ' +
        'again. The assessment shown is the one made from it.',
    },
    rejected: {
      tone: 'warn',
      text:
        'The file was read but did not produce an assessment. Nothing was inferred from a ' +
        'partial read, and nothing was stored.',
    },
    'content-not-published': {
      tone: 'warn',
      text:
        'The export was stored, but the rule pack it would be assessed against is not published ' +
        'in this database, so no run could be recorded against it. Run ' +
        '`pnpm db:publish:rulepack` and upload again.',
    },
    'broken-provenance': {
      tone: 'warn',
      text:
        'A result could not be traced back to the facts it read, so no run was stored. A ' +
        'finding without that chain must not be creatable.',
    },
  };

export interface UploadExportProps {
  /** The `upload` query parameter, if the browser has just come back from the route. */
  readonly outcome: string | undefined;
  /** The template a file is read through, named so an officer knows what to export. */
  readonly templateId: string;
  readonly templateVersion: string;
}

export function UploadExport({ outcome, templateId, templateVersion }: UploadExportProps) {
  const notice = outcome === undefined ? undefined : OUTCOMES[outcome];

  return (
    <>
      <h2>Upload a district export</h2>

      {/* An unrecognized code is not rendered at all. It can only come from a hand-edited URL,
          and echoing "unknown outcome: <whatever>" would be the reflection this table avoids. */}
      {notice === undefined ? null : (
        <p className={notice.tone === 'ok' ? 'note' : 'note note-warn'}>{notice.text}</p>
      )}

      <form action="/api/district-export" method="post" encType="multipart/form-data">
        <p className="prose">
          A CSV from your finance system, one row per LEA and fiscal year, mapped through{' '}
          <code>{templateId}</code> {templateVersion}. Every figure is stored with the row and
          column it came from, and the file itself is kept so the assessment can be reproduced.
        </p>
        <p>
          <label htmlFor="export">Fiscal export (CSV)</label>{' '}
          <input id="export" name="export" type="file" accept=".csv,text/csv" required />
        </p>
        <p>
          <button type="submit">Upload and assess</button>
        </p>
      </form>
    </>
  );
}
