/**
 * The assessment surface.
 *
 * Spec: Master Technical Buildout sections 11, 24 and 36.
 *
 * One subject, one run, and the question the product exists to answer: if this district were
 * monitored today, what appears satisfied, what is at risk, and what evidence supports that.
 * Each requirement links to its own "Why" screen, which is where section 40's transparency
 * requirement is actually discharged.
 */

import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import { byAttention, outstanding, rollUpSentence } from '@/lib/summary';
import { currentSession } from '@/lib/session';
import { SUBJECT, UPLOAD, workedExample } from '@/lib/worked-example';

// Recomputed per request so a deployment missing its regulatory content fails here, visibly,
// rather than serving a value baked in at build time. See `worked-example.ts`.
export const dynamic = 'force-dynamic';

export default async function AssessmentPage() {
  const session = await currentSession();
  const { outcome, pack } = await workedExample();
  const { assessment, snapshot } = outcome;

  if (assessment === undefined || snapshot === undefined) {
    // Not a defensive branch that cannot happen: a rejected virus scan or an unparseable file
    // ends here, and a district is owed the reason rather than an empty page.
    return (
      <>
        <h1>Import did not complete</h1>
        <p className="sub">
          The upload was rejected at the <code>{outcome.import.kind}</code> stage, so no assessment
          was produced. Nothing was inferred from a partial read.
        </p>
        <ul className="issue-list">
          {outcome.import.issues.map((issue) => (
            <li key={`${issue.code}-${issue.sourceRow ?? 0}-${issue.targetField ?? ''}`}>
              <strong>{issue.message}</strong>
              {issue.resolution === undefined ? null : <span> {issue.resolution}</span>}
            </li>
          ))}
        </ul>
      </>
    );
  }

  const rows = byAttention(assessment.results);

  const originCounts = new Map<string, number>();
  for (const fact of snapshot.facts) {
    originCounts.set(fact.origin, (originCounts.get(fact.origin) ?? 0) + 1);
  }
  const reconciliation = outcome.import.reconciliation;

  return (
    <>
      <h1>{SUBJECT.displayName}</h1>
      <p className="sub">
        {SUBJECT.fiscalYear} · <code>{SUBJECT.organizationId}</code> · assessed against{' '}
        <code>{pack.manifest.packId}</code> {pack.manifest.version}
      </p>

      {/* The reason this is a worked example differs by deployment, and saying the wrong one
          is worse than saying none. An unconnected build genuinely has nowhere to read a
          district from; a signed-in officer on a connected one has somewhere, and is owed the
          more specific sentence — that this is not their district and why. */}
      <p className="note note-warn">
        <strong>Synthetic data.</strong> Northfield Consolidated is invented and every figure below
        is made up.{' '}
        {session.signedIn ? (
          <>
            You are signed in as <strong>{session.principal.displayName}</strong>, but no district
            export has been uploaded for your organization yet, so there is no assessment run of
            your own to show and this worked example stands in its place.
          </>
        ) : (
          'This deployment has no district export to read for you, because nobody is signed in.'
        )}{' '}
        What runs here is the real path — the bytes are parsed, mapped through a versioned template,
        sealed into a content-hashed snapshot, and evaluated by the engine against the rule pack
        that shipped with this build.
      </p>

      <h2>Result</h2>
      <p className="headline">
        <StatusBadge status={assessment.status} />
      </p>
      <p className="prose">{rollUpSentence(assessment.results, assessment.status)}</p>
      <p className="note note-warn">
        <strong>Not a determination.</strong> Every rule in this pack is at <code>DRAFT</code> and
        no cited regulatory text has been retrieved and hashed in this environment, so the run
        reports <code>official: {String(assessment.official)}</code>. Nothing here may be shown to a
        district or a state monitor as a finding.
      </p>

      <h2>Requirements</h2>
      <div className="table-wrap">
        <table>
          <caption>
            Each requirement links to the calculation behind it: the rule applied, the figures it
            read, and the file and row each figure came from.
          </caption>
          <thead>
            <tr>
              <th scope="col">Requirement</th>
              <th scope="col">Authority</th>
              <th scope="col">Result</th>
              <th scope="col">If not satisfied</th>
              <th scope="col">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((result) => {
              const blocked = outstanding(result);
              return (
                <tr key={result.ruleId}>
                  <th scope="row">
                    <Link href={`/assessment/finding/${encodeURIComponent(result.ruleId)}`}>
                      {result.ruleTitle}
                    </Link>
                    <br />
                    <code className="muted">{result.ruleId}</code>
                  </th>
                  <td>
                    {result.authority.url === undefined ? (
                      result.authority.citation
                    ) : (
                      <a href={result.authority.url} rel="noreferrer">
                        {result.authority.citation}
                      </a>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={result.status} />
                  </td>
                  <td>
                    <span className="tag">{result.severityOnFailure}</span>
                  </td>
                  <td>{blocked ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {assessment.skippedByLifecycle.length === 0 ? null : (
        <p className="note">
          {assessment.skippedByLifecycle.length} rule(s) in this pack were resolved but not
          evaluated because their review stage was excluded from this run:{' '}
          {assessment.skippedByLifecycle.join(', ')}.
        </p>
      )}

      <h2>The data this rests on</h2>
      <dl className="definition-list">
        <dt>Uploaded file</dt>
        <dd>{UPLOAD.originalFilename}</dd>
        <dt>Upload SHA-256</dt>
        <dd>
          <code className="hash">{UPLOAD.sourceHash}</code>
        </dd>
        <dt>Uploaded by</dt>
        <dd>
          {UPLOAD.uploadedBy} on {UPLOAD.uploadedAt}
        </dd>
        <dt>Rows received</dt>
        <dd>{reconciliation?.rowsReceived ?? '—'}</dd>
        <dt>Rows accepted</dt>
        <dd>{reconciliation?.rowsAccepted ?? '—'}</dd>
        <dt>Rows quarantined</dt>
        <dd>{reconciliation?.rowsQuarantined ?? '—'}</dd>
        <dt>Columns not mapped</dt>
        <dd>
          {reconciliation === undefined || reconciliation.unmappedColumns.length === 0
            ? 'None'
            : reconciliation.unmappedColumns.join(', ')}
        </dd>
        <dt>Data snapshot</dt>
        <dd>
          <code>{snapshot.snapshotId}</code>
        </dd>
        <dt>Snapshot content hash</dt>
        <dd>
          <code className="hash">{snapshot.contentHash}</code>
        </dd>
        <dt>Facts sealed</dt>
        <dd>
          {snapshot.facts.length} —{' '}
          {[...originCounts.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([origin, count]) => `${count} ${origin}`)
            .join(', ')}
        </dd>
        <dt>Assessment run</dt>
        <dd>
          <code>{assessment.context.assessmentRunId}</code>
        </dd>
        <dt>Evaluated at</dt>
        <dd>{assessment.context.evaluatedAt}</dd>
      </dl>
      <p className="note">
        Two fact origins appear above because they must. Most of what a maintenance-of-effort
        determination needs is the district&rsquo;s own books and arrives in the export; the
        prior-year compliance determinations do not, and an upload that tried to assert one is
        refused at projection — a district able to state its own prior-year status could declare a
        failing year compliant and lower the bar the next year is measured against.
      </p>

      <h2>What this deployment does not do</h2>
      <div className="prose">
        <p>
          Stated rather than implied by an empty screen. Each of these is a module the buildout
          describes and this build does not contain:
        </p>
        <ul>
          <li>
            <strong>District onboarding and sign-in.</strong> No tenant can be created and no file
            can be uploaded, so the assessment above is the only one that exists.
          </li>
          <li>
            <strong>Persistence.</strong> The schema, its row-level security and its isolation tests
            exist in <code>packages/db</code>; the application does not yet connect to a database,
            so nothing is stored between requests.
          </li>
          <li>
            <strong>Evidence.</strong> A finding cannot yet be linked to a document, so section
            24&rsquo;s &ldquo;what evidence is required&rdquo; has no answer to render.
          </li>
          <li>
            <strong>Corrective action and disposition.</strong> No reviewer can accept an exception
            or own a remediation, so every result here is the system&rsquo;s unreviewed output and
            is labelled as such on its finding page.
          </li>
        </ul>
      </div>
    </>
  );
}
