/**
 * A district's own assessment, read back out of the database.
 *
 * Spec: Master Technical Buildout sections 11 and 24.
 *
 * The counterpart to the worked example, and deliberately a different component rather than
 * one with a flag. What can be said about a stored run is not what can be said about one just
 * computed: there is no warning list, no calculation trace and no reconciliation summary in
 * `evaluation_results` — only what was concluded, the rule and authority it was concluded
 * under, and the snapshot it was concluded from.
 *
 * A single component covering both would have to render the absent halves as blanks, and a
 * blank on a compliance screen reads as "nothing outstanding" rather than "not recorded".
 * Two components, each saying only what its source actually holds.
 */

import Link from 'next/link';
import { rollUpStatus } from '@complianceos/domain';
import type { StoredResult, StoredRunSummary } from '@complianceos/db';
import { StatusBadge } from '@/components/status-badge';
import { byAttention, rollUpSentence } from '@/lib/summary';

export interface StoredAssessmentProps {
  readonly run: StoredRunSummary;
  readonly results: readonly StoredResult[];
  readonly organizationName: string;
}

export function StoredAssessment({ run, results, organizationName }: StoredAssessmentProps) {
  // Recomputed from the stored results rather than stored beside them. A roll-up column would
  // be a second copy of a conclusion the results already determine, and the day the two
  // disagreed there would be no way to tell which was right (section 8.6, invariant 9).
  const status = rollUpStatus(results.map((result) => result.status));
  const rows = byAttention(results);

  return (
    <>
      <h1>{organizationName}</h1>
      <p className="sub">
        {run.programYearLabel} · assessed against <code>{run.rulePackId}</code>{' '}
        {run.rulePackVersion} · engine {run.engineVersion}
      </p>

      <h2>Result</h2>
      <p className="headline">
        <StatusBadge status={status} />
      </p>
      <p className="prose">{rollUpSentence(results, status)}</p>

      {run.finalized ? null : (
        <p className="note note-warn">
          <strong>Advisory, not a determination.</strong> This run is <code>{run.status}</code> and
          has not been finalized, because every rule in the pack it cites is at <code>DRAFT</code>{' '}
          and no cited regulatory text has been retrieved and hashed in this environment. Nothing
          here may be shown to a state monitor as a finding. Re-running it once the content has been
          through review produces a new run; this one is not edited.
        </p>
      )}

      <h2>Requirements</h2>
      <div className="table-wrap">
        <table>
          <caption>
            Each row is a stored result: the rule version applied, the authority it cites, and what
            it concluded from the snapshot named below.
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
            {rows.map((result) => (
              <tr key={result.ruleId}>
                <th scope="row">
                  <Link href={`/assessment/finding/${encodeURIComponent(result.ruleId)}`}>
                    {result.ruleTitle}
                  </Link>
                  <br />
                  <code className="muted">{result.ruleId}</code>
                </th>
                <td>
                  {result.authorityUrl === null ? (
                    result.authorityCitation
                  ) : (
                    <a href={result.authorityUrl} rel="noreferrer">
                      {result.authorityCitation}
                    </a>
                  )}
                </td>
                <td>
                  <StatusBadge status={result.status} />
                </td>
                <td>
                  <span className="tag">{result.severity}</span>
                </td>
                {/* The stored reason, verbatim. An INDETERMINATE result carries one by CHECK
                    constraint, so this cell is empty exactly when the rule concluded. */}
                <td>{result.indeterminateReason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>The data this rests on</h2>
      <dl className="definition-list">
        <dt>Assessment run</dt>
        <dd>
          <code>{run.assessmentRunId}</code>
        </dd>
        <dt>Completed</dt>
        <dd>{run.completedAt === null ? 'Not recorded' : run.completedAt.toISOString()}</dd>
        <dt>Data snapshot</dt>
        <dd>
          <code>{run.dataSnapshotId}</code>
        </dd>
        <dt>Snapshot content hash</dt>
        <dd>
          <code className="hash">{run.snapshotContentHash}</code>
        </dd>
        <dt>Facts sealed</dt>
        <dd>{run.factCount}</dd>
      </dl>
      <p className="note">
        The snapshot is what makes this reproducible. Re-evaluating the same rule-pack version
        against the same snapshot yields the same evaluation hash on every result, which is the
        claim a district would need to defend the figures years from now.
      </p>
    </>
  );
}
