/**
 * The finding-detail screen — the "Why".
 *
 * Spec: Master Technical Buildout sections 24 and 40. CLAUDE.md invariants 1 and 3.
 *
 * Section 40 states the product principle this page exists to satisfy: a school administrator
 * should never be forced to trust a black box. Everything below is read off the stored
 * evaluation result and the snapshot it was computed from — nothing is recomputed for display
 * and nothing is described in wording invented here.
 *
 * The page answers section 24's questions in its order: what the result is, why, which rule
 * was applied, which values drove it, and where each value came from. The last three —
 * evidence, next step, owner — need modules this build does not contain, and the page says so
 * plainly at the bottom rather than leaving three empty panels.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CalculationStep, CalculatorValue } from '@complianceos/calculators';
import type { FactOrigin } from '@complianceos/domain';
import { describeProvenance, sourceFileFor, type DataSnapshot } from '@complianceos/ingest';
import { ABSENT, formatStepValue, renderValue } from '@complianceos/rules-engine';
import { StatusBadge } from '../../../components/status-badge.js';
import { humanizeKey } from '../../../lib/display.js';
import { inputSpecs } from '../../../lib/inputs.js';
import { SUBJECT, workedExample } from '../../../lib/worked-example.js';

export const dynamic = 'force-dynamic';

/** Origins whose provenance genuinely points at a row in an uploaded file. */
const FROM_A_FILE: ReadonlySet<FactOrigin> = new Set<FactOrigin>([
  'DISTRICT_EXPORT',
  'DISTRICT_ATTESTATION',
]);

interface Sourced {
  readonly origin: FactOrigin | undefined;
  readonly where: string;
}

/**
 * Where one value came from, in a sentence a business officer can act on.
 *
 * A row-and-column citation is only meaningful for a fact that arrived in a row. A prior-year
 * determination carried forward from a finalized run has a `sourceRow` because
 * `FactProvenance` was shaped for a spreadsheet, and printing "row 1, column
 * comparison_year_moe_status" would send a district looking for a cell that does not exist.
 * Until provenance gains a determination-shaped variant, the origin decides which sentence is
 * honest.
 */
function sourceOf(snapshot: DataSnapshot, field: string): Sourced {
  const fact = snapshot.facts.find(
    (candidate) =>
      candidate.subjectType === SUBJECT.subjectType &&
      candidate.subjectId === SUBJECT.subjectId &&
      candidate.field === field,
  );
  if (fact === undefined) return { origin: undefined, where: 'Not supplied.' };

  if (FROM_A_FILE.has(fact.origin)) {
    return {
      origin: fact.origin,
      where: describeProvenance(
        fact.provenance,
        sourceFileFor(snapshot, fact.provenance.sourceFileId),
      ),
    };
  }
  return { origin: fact.origin, where: `${fact.provenance.transformation}.` };
}

/** A calculator output value. Nested records become their own small table. */
function OutputValue({ value }: { value: CalculatorValue }) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return <>{ABSENT}</>;
    return (
      <dl className="definition-list nested">
        {entries.map(([key, nested]) => (
          <div key={key} className="nested-row">
            <dt>{humanizeKey(key)}</dt>
            <dd>
              <OutputValue value={nested} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <>{renderValue(value)}</>;
}

function StepRow({ step }: { step: CalculationStep }) {
  return (
    <tr>
      <th scope="row">
        {step.label}
        {step.citation === undefined ? null : (
          <>
            <br />
            <span className="muted">{step.citation}</span>
          </>
        )}
      </th>
      <td>{step.detail ?? ABSENT}</td>
      <td className="num">{formatStepValue(step)}</td>
    </tr>
  );
}

export default async function FindingPage({ params }: { params: Promise<{ ruleId: string }> }) {
  const { ruleId } = await params;
  const { outcome, pack } = await workedExample();
  const { assessment, snapshot } = outcome;

  const result = assessment?.results.find((candidate) => candidate.ruleId === ruleId);
  if (result === undefined || snapshot === undefined) notFound();

  const rule = pack.rules.find((candidate) => candidate.ruleId === result.ruleId);
  const specs = inputSpecs(rule?.calculator);

  const supplied = Object.entries(result.computedInputs).filter(([, value]) => value !== null);
  const absent = Object.entries(result.computedInputs).filter(([, value]) => value === null);
  const outputEntries = Object.entries(result.output);

  // A rule whose calculator is unwritten reached INDETERMINATE without reading anything. Saying
  // "none of these changed the result" there would be true and misleading in the same breath: a
  // reader would take it as reassurance that the absent figures did not matter, when in fact
  // nothing was weighed at all.
  const neverRan = result.warnings.some((warning) => warning.severity === 'BLOCKING');

  return (
    <>
      <p className="breadcrumb">
        <Link href="/">{SUBJECT.displayName}</Link> · {SUBJECT.fiscalYear}
      </p>

      <h1>{result.ruleTitle}</h1>
      <p className="headline">
        <StatusBadge status={result.status} />
      </p>

      <h2>System result</h2>
      <dl className="definition-list">
        <dt>Requirement</dt>
        <dd>
          <code>{result.ruleId}</code>
        </dd>
        <dt>Authority</dt>
        <dd>
          {result.authority.url === undefined ? (
            result.authority.citation
          ) : (
            <a href={result.authority.url} rel="noreferrer">
              {result.authority.citation}
            </a>
          )}{' '}
          <span className="muted">
            (source <code>{result.authority.sourceId}</code>)
          </span>
        </dd>
        <dt>Severity if not satisfied</dt>
        <dd>{result.severityOnFailure}</dd>
        <dt>Rule pack</dt>
        <dd>
          <code>{result.pack.packId}</code> {result.pack.version} ({result.pack.layer})
        </dd>
        {result.supersedes === undefined ? null : (
          <>
            <dt>Supersedes</dt>
            <dd>
              <code>{result.supersedes.packId}</code> {result.supersedes.version}
            </dd>
          </>
        )}
        <dt>Review stage</dt>
        <dd>
          <span className="tag">{result.ruleLifecycle}</span>
        </dd>
        <dt>Data snapshot</dt>
        <dd>
          <code>{result.dataSnapshotId}</code>{' '}
          <span className="muted">
            content hash <code className="hash">{snapshot.contentHash}</code>
          </span>
        </dd>
        <dt>Engine</dt>
        <dd>{result.engineVersion}</dd>
        <dt>Evaluated at</dt>
        <dd>{result.evaluatedAt}</dd>
        <dt>Evaluation hash</dt>
        <dd>
          <code className="hash">{result.evaluationHash}</code>
        </dd>
      </dl>
      <p className="note">
        The evaluation hash covers the computation and not the event of running it — not the
        timestamp, not the run id. Re-running this rule against this snapshot on this engine must
        produce the same hash, which is how &ldquo;what did the platform conclude on that
        date&rdquo; is answered by recomputation rather than by trusting a stored row.
      </p>

      <h2>Why</h2>
      <div className="prose">
        {result.missingInputs.length > 0 ? (
          <>
            <p>
              This could not be determined. The calculation depends on data the platform does not
              hold, and a missing figure yields no conclusion rather than an assumed one:
            </p>
            <ul>
              {result.missingInputs.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                  {specs.get(name) === undefined ? null : <> — {specs.get(name)?.definition}</>}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {result.warnings.map((warning) => (
          <p
            key={warning.code}
            className={warning.severity === 'BLOCKING' ? 'note note-warn' : 'note'}
          >
            <strong>{warning.severity === 'BLOCKING' ? 'Blocking. ' : ''}</strong>
            {warning.message}
            {warning.citation === undefined ? null : <> [{warning.citation}]</>}
          </p>
        ))}

        {result.missingInputs.length === 0 && result.warnings.length === 0 ? (
          <p>
            The calculation ran on complete data with nothing to flag. Every figure it used and
            every operation it performed is below.
          </p>
        ) : null}

        <details>
          <summary>The explanation stored with this result</summary>
          <p className="muted">
            The text that travels with the result into a report or an export, generated by the
            engine from the same steps shown below.
          </p>
          <pre className="explanation">{result.explanation}</pre>
        </details>
      </div>

      {result.steps.length === 0 ? null : (
        <>
          <h2>How this was calculated</h2>
          <div className="table-wrap">
            <table>
              <caption>
                Every line the calculator produced, in the order it produced them, each carrying the
                provision it derives from.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Step</th>
                  <th scope="col">Working</th>
                  <th scope="col" className="num">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.steps.map((step) => (
                  <StepRow key={step.key} step={step} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {outputEntries.length === 0 ? null : (
        <>
          <h2>What the rule concluded</h2>
          <dl className="definition-list">
            {outputEntries.map(([key, value]) => (
              <div key={key} className="nested-row">
                <dt>{humanizeKey(key)}</dt>
                <dd>
                  <OutputValue value={value} />
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <h2>The figures this used, and where they came from</h2>
      <div className="table-wrap">
        <table>
          <caption>
            Only the inputs this rule declares. A calculator is never handed a fact its rule did not
            ask for, so this list is everything the decision rested on.
          </caption>
          <thead>
            <tr>
              <th scope="col">Input</th>
              <th scope="col">Value</th>
              <th scope="col">Asserted by</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {supplied.map(([name, value]) => {
              const sourced = sourceOf(snapshot, name);
              return (
                <tr key={name}>
                  <th scope="row">
                    <code>{name}</code>
                    {specs.get(name) === undefined ? null : (
                      <>
                        <br />
                        <span className="muted">{specs.get(name)?.definition}</span>
                      </>
                    )}
                  </th>
                  <td>{renderValue(value)}</td>
                  <td>
                    <span className="tag">{sourced.origin ?? 'UNKNOWN'}</span>
                  </td>
                  <td>{sourced.where}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {absent.length === 0 ? null : (
        <>
          <h2>Declared inputs that were not supplied</h2>
          <div className="table-wrap">
            <table>
              <caption>
                Recorded rather than omitted. The engine looked for each of these and found nothing;
                that is a different statement from never having asked.{' '}
                {neverRan
                  ? 'The calculation never ran, so none of these were weighed. Whether any of ' +
                    'them would have decided the result is unknown until the arithmetic exists.'
                  : result.missingInputs.length === 0
                    ? 'None of them changed the result — the calculation did not depend on any.'
                    : 'The ones the result depended on are named under “Why” above.'}
                {specs.size === 0
                  ? ' An input’s definition comes from the calculator that reads it, and this ' +
                    'requirement has none written, so only the names are available.'
                  : ''}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Input</th>
                  <th scope="col">What it is</th>
                  <th scope="col">Decided the result</th>
                </tr>
              </thead>
              <tbody>
                {absent.map(([name]) => (
                  <tr key={name}>
                    <th scope="row">
                      <code>{name}</code>
                    </th>
                    <td>{specs.get(name)?.definition ?? ABSENT}</td>
                    <td>
                      {neverRan ? 'Not run' : result.missingInputs.includes(name) ? 'Yes' : 'No'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Disposition</h2>
      <dl className="definition-list">
        <dt>System result</dt>
        <dd>
          <StatusBadge status={result.status} />
        </dd>
        <dt>Human disposition</dt>
        <dd>
          None. This build has no reviewer workflow, so nothing above has been accepted, disputed or
          annotated by a person — and because the rule is at <code>{result.ruleLifecycle}</code>{' '}
          against an unretrieved citation, it is not a determination in any case.
        </dd>
      </dl>

      <h2>What this screen cannot yet answer</h2>
      <div className="prose">
        <p>
          Section 24 asks a finding page for eight things. Five are above. The remaining three need
          modules this build does not contain, and are named here rather than shown as empty panels:
        </p>
        <ul>
          <li>
            <strong>What evidence is required.</strong> The evidence vault does not exist, so a
            finding cannot yet be linked to a document.
          </li>
          <li>
            <strong>What the district should do next.</strong> Remediation guidance belongs to
            corrective-action management, which is not built.
          </li>
          <li>
            <strong>Who owns remediation.</strong> There are no users, so there is nobody to assign.
          </li>
        </ul>
      </div>
    </>
  );
}
