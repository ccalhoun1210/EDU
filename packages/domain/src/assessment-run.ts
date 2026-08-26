/**
 * Assessment runs, data snapshots and run comparison.
 *
 * Spec: Master Technical Buildout section 11, with the scenario rule from section 12.2.
 * CLAUDE.md invariant 4.
 *
 * Section 11 opens with the whole reason this module exists: *a compliance assessment
 * should never execute against a moving target*. A run therefore pins its inputs — a data
 * snapshot naming the exact fact versions it read — and pins the logic that read them —
 * a rule-pack version and an engine version. Those three pins are what make a finding
 * re-derivable years later when a state monitor asks how a number was reached.
 *
 * Everything here is built around invariant 4: **a finalized run is never rewritten**.
 * Corrected data does not edit last month's result; it produces a new run, and the two runs
 * are *compared*. That is why the mutators below go through `assertMutable`, why `finalizeRun`
 * returns a new frozen object rather than updating in place, and why the comparison model
 * is a first-class part of this module rather than a report-layer detail.
 *
 * Two error conventions are deliberately mixed here, and the split is meaningful:
 *
 * - `finalizeRun` returns a result union. Finalizing is a *user* action, and "you cannot
 *   finalize this yet, here is every reason" is a 409 the API layer (section 23) renders,
 *   not a crash.
 * - `assertMutable`, `withStatus` and `withDataSnapshot` throw. Nothing user-supplied
 *   reaches them; an illegal transition or a write to a finalized run is a defect in the
 *   run orchestrator, and a defect that silently returns a rejection object is a defect
 *   that ships.
 */

import type { EvaluationStatus } from './evaluation.js';

/**
 * An ISO-8601 instant, e.g. `2028-03-01T14:02:11.000Z`.
 *
 * A run timestamp is an event instant, not a regulatory date, so invariant 6 does not apply
 * to it — that invariant governs statutory deadlines, and the regulatory period a run
 * assesses is carried separately in `ProgramYear`.
 */
type Timestamp = string;

export const ASSESSMENT_RUN_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'FINALIZED',
] as const;

export type AssessmentRunStatus = (typeof ASSESSMENT_RUN_STATUSES)[number];

/**
 * Whether a run is a real assessment or a what-if (section 12.2).
 *
 * Scenario runs share the whole machinery — same rules, same engine, a cloned snapshot with
 * adjusted planned expenditures — and that is exactly why the kind has to travel on the run
 * itself. Section 12.2 requires that scenario results are never mixed into actual compliance
 * results, and a flag that lives only in the UI is a flag that eventually is not consulted.
 */
export const ASSESSMENT_RUN_KINDS = ['ACTUAL', 'SCENARIO'] as const;

export type AssessmentRunKind = (typeof ASSESSMENT_RUN_KINDS)[number];

export const ASSESSMENT_SCOPE_TYPES = ['ORGANIZATION', 'SCHOOL_SITE', 'FEDERAL_AWARD'] as const;

export type AssessmentScopeType = (typeof ASSESSMENT_SCOPE_TYPES)[number];

/** What population the run covered. */
export interface AssessmentScope {
  readonly type: AssessmentScopeType;
  /** Empty means every subject of `type` belonging to the run's organization. */
  readonly ids: readonly string[];
}

export const PROGRAM_YEAR_KINDS = ['FISCAL', 'ACADEMIC'] as const;

export type ProgramYearKind = (typeof PROGRAM_YEAR_KINDS)[number];

/**
 * The regulatory period under assessment (section 11's "fiscal/academic year").
 *
 * The label is stored as the state writes it — `FY2028`, `2027-2028` — rather than reduced
 * to a start date, because a fiscal year boundary is state-defined and a report that renames
 * a district's year is a report a business officer stops trusting.
 */
export interface ProgramYear {
  readonly kind: ProgramYearKind;
  readonly label: string;
}

/** One normalized fact, at the version the snapshot froze. */
export interface PinnedFactVersion {
  readonly factType: string;
  readonly factId: string;
  readonly version: string;
}

/**
 * A reference to the frozen input set of a run (section 11).
 *
 * `contentHash` is over the pinned fact versions, so two runs can be shown to have read
 * literally the same inputs — which is how "nothing changed, so nothing could have changed"
 * is proved rather than asserted.
 */
export interface DataSnapshotRef {
  readonly id: string;
  readonly contentHash: string;
  readonly factVersions: readonly PinnedFactVersion[];
  readonly createdAt: Timestamp;
}

/**
 * A snapshot that could be replayed. A snapshot with no pinned fact versions names no
 * inputs, so a run against it cannot be reproduced and must never back a finalized result.
 */
export function isReproducibleSnapshot(snapshot: DataSnapshotRef): boolean {
  return snapshot.contentHash.trim() !== '' && snapshot.factVersions.length > 0;
}

/**
 * Everything section 11 says a run binds, plus its lifecycle status and its kind.
 *
 * `dataSnapshotId` is `string | undefined` and required-in-shape rather than optional: a run
 * exists before its snapshot is built, and forcing every construction site to say so is
 * better than letting a missing pin look like an oversight. `finalizeRun` is where the
 * absence becomes fatal.
 *
 * `moduleId` is the module identifier declared in `MODULE_DATA_CONTRACTS` (section 2.6).
 */
export interface AssessmentRun {
  readonly id: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly moduleId: string;
  readonly scope: AssessmentScope;
  readonly programYear: ProgramYear;
  readonly rulePackId: string;
  readonly rulePackVersion: string;
  readonly engineVersion: string;
  readonly dataSnapshotId: string | undefined;
  readonly runTimestamp: Timestamp;
  readonly requestedBy: string;
  readonly status: AssessmentRunStatus;
  readonly kind: AssessmentRunKind;
}

/**
 * Freeze a run and the objects hanging off it.
 *
 * `readonly` is erased at compile time and buys nothing against a page component or a test
 * helper that reaches in at runtime. Invariant 4 deserves an enforcement that survives to
 * runtime, so every run this module hands back is frozen, and the nested scope is copied
 * before freezing so that freezing a derived run never mutates the caller's object.
 */
export function freezeRun(run: AssessmentRun): AssessmentRun {
  return Object.freeze({
    ...run,
    scope: Object.freeze({ type: run.scope.type, ids: Object.freeze([...run.scope.ids]) }),
    programYear: Object.freeze({ ...run.programYear }),
  });
}

/** Thrown on any attempt to change a finalized run. Carries the run id for the audit log. */
export class ImmutableRunError extends Error {
  readonly runId: string;
  readonly attemptedChange: string;

  constructor(runId: string, attemptedChange: string) {
    super(
      `Assessment run ${runId} is FINALIZED and cannot be modified (attempted: ` +
        `${attemptedChange}). A finalized run is the record of what the engine concluded ` +
        'from the data and rules it was given. Correct the data or supersede the rule ' +
        'version, start a NEW assessment run, and compare the two runs.',
    );
    this.name = 'ImmutableRunError';
    this.runId = runId;
    this.attemptedChange = attemptedChange;
  }
}

/**
 * Guard every write to a run (invariant 4).
 *
 * `attemptedChange` is required rather than optional because the message an auditor or an
 * on-call engineer reads should say what was being attempted, not merely that something was.
 */
export function assertMutable(run: AssessmentRun, attemptedChange: string): void {
  if (run.status === 'FINALIZED') {
    throw new ImmutableRunError(run.id, attemptedChange);
  }
}

/**
 * The run lifecycle. FINALIZED is deliberately absent from every target list: it is reachable
 * only through `finalizeRun`, so the preconditions below cannot be bypassed by setting a
 * status directly.
 *
 * FAILED is terminal. A failed run is not resumed — its partial results were computed against
 * an unproven input set, so the honest recovery is a new run.
 */
const ALLOWED_TRANSITIONS: ReadonlyMap<AssessmentRunStatus, readonly AssessmentRunStatus[]> =
  new Map<AssessmentRunStatus, readonly AssessmentRunStatus[]>([
    ['PENDING', ['RUNNING', 'FAILED']],
    ['RUNNING', ['COMPLETED', 'FAILED']],
    ['COMPLETED', []],
    ['FAILED', []],
    ['FINALIZED', []],
  ]);

/** Advance a run's lifecycle status, returning a new frozen run. */
export function withStatus(run: AssessmentRun, status: AssessmentRunStatus): AssessmentRun {
  assertMutable(run, `set status to ${status}`);

  const allowed = ALLOWED_TRANSITIONS.get(run.status) ?? [];
  if (!allowed.includes(status)) {
    const hint =
      status === 'FINALIZED'
        ? ' Finalization has preconditions; call finalizeRun instead of setting the status.'
        : '';
    throw new Error(
      `Illegal assessment run transition ${run.status} -> ${status} for run ${run.id}.${hint}`,
    );
  }

  return freezeRun({ ...run, status });
}

/**
 * Pin the input set the run will read.
 *
 * Only permitted while the run is PENDING. Re-pinning a running or completed run would leave
 * its results and its declared inputs describing different data, which is precisely the
 * "moving target" section 11 forbids.
 */
export function withDataSnapshot(run: AssessmentRun, snapshot: DataSnapshotRef): AssessmentRun {
  assertMutable(run, `pin data snapshot ${snapshot.id}`);

  if (run.status !== 'PENDING') {
    throw new Error(
      `Cannot pin data snapshot ${snapshot.id} to run ${run.id}: the run is ${run.status}. ` +
        'A snapshot is pinned before evaluation begins so that results and inputs cannot ' +
        'disagree.',
    );
  }
  if (!isReproducibleSnapshot(snapshot)) {
    throw new Error(
      `Data snapshot ${snapshot.id} pins no fact versions or has no content hash, so a run ` +
        'against it could not be reproduced.',
    );
  }

  return freezeRun({ ...run, dataSnapshotId: snapshot.id });
}

export const FINALIZE_REFUSAL_CODES = [
  'NOT_COMPLETED',
  'NO_DATA_SNAPSHOT',
  'NO_RULE_PACK_VERSION',
  'NO_ENGINE_VERSION',
  'SCENARIO_RUN',
] as const;

export type FinalizeRefusalCode = (typeof FINALIZE_REFUSAL_CODES)[number];

export interface FinalizeRefusal {
  readonly code: FinalizeRefusalCode;
  readonly message: string;
}

export type FinalizeResult =
  | { readonly ok: true; readonly run: AssessmentRun }
  | { readonly ok: false; readonly refusals: readonly FinalizeRefusal[] };

/** Blank-but-present is absent. A whitespace rule-pack version pins nothing. */
function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

/**
 * Every reason this run cannot become an official assessment. Empty means it can.
 *
 * All reasons are collected rather than the first returned: an administrator who has to
 * chase a missing snapshot and then discovers the pack version is also missing has been
 * failed twice by the same screen.
 */
export function finalizationRefusals(run: AssessmentRun): readonly FinalizeRefusal[] {
  const refusals: FinalizeRefusal[] = [];

  // Section 12.2 — scenario results are never mixed with actual compliance results, and
  // finalization is the act that makes a result official. A what-if must not acquire that
  // standing at any price; the modelled change is applied for real and assessed for real.
  if (run.kind === 'SCENARIO') {
    refusals.push({
      code: 'SCENARIO_RUN',
      message:
        `Run ${run.id} is a SCENARIO run and cannot be finalized as an official assessment. ` +
        'Scenario results are never mixed with actual compliance results.',
    });
  }

  if (run.status !== 'COMPLETED') {
    refusals.push({
      code: 'NOT_COMPLETED',
      message:
        `Only a COMPLETED run can be finalized; run ${run.id} is ${run.status}.` +
        (run.status === 'FINALIZED' ? ' It has already been finalized.' : ''),
    });
  }

  if (isBlank(run.dataSnapshotId)) {
    refusals.push({
      code: 'NO_DATA_SNAPSHOT',
      message:
        `Run ${run.id} has no pinned data snapshot. Without one the result cannot be ` +
        'reproduced, so it cannot become the record of a compliance position.',
    });
  }

  if (isBlank(run.rulePackVersion)) {
    refusals.push({
      code: 'NO_RULE_PACK_VERSION',
      message: `Run ${run.id} does not name the rule-pack version that produced its results.`,
    });
  }

  // Not named in section 11's finalization prose, but the section 8.7 reproducibility
  // requirement needs all three pins: same inputs, same rules, same engine.
  if (isBlank(run.engineVersion)) {
    refusals.push({
      code: 'NO_ENGINE_VERSION',
      message: `Run ${run.id} does not name the engine version that produced its results.`,
    });
  }

  return refusals;
}

/**
 * Make a run official, or explain why it cannot be (invariant 4).
 *
 * Returns a *new* frozen run; the argument is never touched. From this point the only way
 * to change the compliance picture is another run.
 */
export function finalizeRun(run: AssessmentRun): FinalizeResult {
  const refusals = finalizationRefusals(run);
  if (refusals.length > 0) return { ok: false, refusals };
  return { ok: true, run: freezeRun({ ...run, status: 'FINALIZED' }) };
}

export function isScenarioRun(run: AssessmentRun): boolean {
  return run.kind === 'SCENARIO';
}

/**
 * Drop scenario runs from a set bound for compliance reporting (section 12.2).
 *
 * Every reporting path — dashboard tiles, the fiscal report pack, an export to a state
 * monitor — filters through this rather than writing its own `kind === 'ACTUAL'` check, so
 * that adding a reporting surface cannot quietly omit the rule. Input order is preserved.
 */
export function actualRunsOnly(runs: readonly AssessmentRun[]): readonly AssessmentRun[] {
  return runs.filter((run) => run.kind === 'ACTUAL');
}

/**
 * The minimum a comparison needs from a finding. `Finding` from `finding.ts` satisfies it
 * structurally, and so does a projection selected straight from the database, which keeps a
 * run-over-run diff from having to hydrate whole findings with their provenance chains.
 */
export interface ComparableFinding {
  readonly ruleId: string;
  readonly subject: { readonly type: string; readonly id: string };
  readonly systemStatus: EvaluationStatus;
}

/**
 * Escape a key component so two different findings can never collide into one key.
 *
 * A naive `join('|')` makes rule `a` / subject `b|c` indistinguishable from rule `a|b` /
 * subject `c`, and the symptom would be a finding reported as unchanged when it is actually
 * two different findings — the exact silent-miscount failure this comparison exists to avoid.
 */
function escapeKeyPart(part: string): string {
  return part.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/** The stable identity of a finding across runs: the rule, and what it was evaluated against. */
export function findingKey(finding: ComparableFinding): string {
  return [finding.ruleId, finding.subject.type, finding.subject.id].map(escapeKeyPart).join('|');
}

/** One finding's fate between two runs. A missing status means absent from that run. */
export interface ComparedFinding {
  readonly key: string;
  readonly ruleId: string;
  readonly subject: { readonly type: string; readonly id: string };
  readonly previousStatus: EvaluationStatus | undefined;
  readonly currentStatus: EvaluationStatus | undefined;
}

/**
 * The section 11 report lines, as numbers.
 *
 * `unchanged` means **unchanged in existence** — the finding is present in both runs. It does
 * not mean the status held. A finding that moved from RISK to FAIL is counted in `unchanged`
 * *and* in `statusChanged`, because "6 findings, 7 resolved, 2 new" that quietly swallows a
 * RISK becoming a FAIL is a report that understates a district's exposure.
 */
export interface RunComparisonCounts {
  readonly previousTotal: number;
  readonly currentTotal: number;
  readonly resolved: number;
  readonly newlyDetected: number;
  readonly unchanged: number;
  readonly statusChanged: number;
}

export interface RunComparison {
  readonly counts: RunComparisonCounts;
  /** In the previous run, gone from the current one. */
  readonly resolved: readonly ComparedFinding[];
  /** In the current run only. */
  readonly newlyDetected: readonly ComparedFinding[];
  /** In both runs, whatever their statuses. Counted as `unchanged`. */
  readonly persisted: readonly ComparedFinding[];
  /** The subset of `persisted` whose status moved. Never silently folded away. */
  readonly statusChanged: readonly ComparedFinding[];
}

function compared(
  key: string,
  source: ComparableFinding,
  previousStatus: EvaluationStatus | undefined,
  currentStatus: EvaluationStatus | undefined,
): ComparedFinding {
  return {
    key,
    ruleId: source.ruleId,
    subject: { type: source.subject.type, id: source.subject.id },
    previousStatus,
    currentStatus,
  };
}

/**
 * Index one run's findings by key, refusing duplicates.
 *
 * A run holds one evaluation result per rule per subject, so a duplicate key is a defect
 * upstream. Silently keeping one of the pair would make the totals disagree with the input
 * and there is no correct choice between them, so this is loud.
 */
function indexByKey(
  findings: readonly ComparableFinding[],
  side: 'previous' | 'current',
): ReadonlyMap<string, ComparableFinding> {
  const byKey = new Map<string, ComparableFinding>();
  for (const finding of findings) {
    const key = findingKey(finding);
    if (byKey.has(key)) {
      throw new Error(
        `The ${side} finding set contains two findings for rule ${finding.ruleId} against ` +
          `${finding.subject.type} ${finding.subject.id}. A run holds one result per rule ` +
          'per subject; a run-over-run comparison of an ambiguous set would miscount.',
      );
    }
    byKey.set(key, finding);
  }
  return byKey;
}

/**
 * Compare two runs' findings (section 11).
 *
 * Deterministic in its ordering: resolved and persisted follow the previous run's order,
 * newly detected follows the current run's, so the same two inputs always render the same
 * report.
 */
export function compareFindingSets(
  previousFindings: readonly ComparableFinding[],
  currentFindings: readonly ComparableFinding[],
): RunComparison {
  const previousByKey = indexByKey(previousFindings, 'previous');
  const currentByKey = indexByKey(currentFindings, 'current');

  const resolved: ComparedFinding[] = [];
  const persisted: ComparedFinding[] = [];
  const statusChanged: ComparedFinding[] = [];
  const newlyDetected: ComparedFinding[] = [];

  for (const [key, before] of previousByKey) {
    const after = currentByKey.get(key);
    if (after === undefined) {
      resolved.push(compared(key, before, before.systemStatus, undefined));
      continue;
    }
    const entry = compared(key, after, before.systemStatus, after.systemStatus);
    persisted.push(entry);
    if (before.systemStatus !== after.systemStatus) statusChanged.push(entry);
  }

  for (const [key, after] of currentByKey) {
    if (!previousByKey.has(key)) {
      newlyDetected.push(compared(key, after, undefined, after.systemStatus));
    }
  }

  return {
    counts: {
      previousTotal: previousByKey.size,
      currentTotal: currentByKey.size,
      resolved: resolved.length,
      newlyDetected: newlyDetected.length,
      unchanged: persisted.length,
      statusChanged: statusChanged.length,
    },
    resolved,
    newlyDetected,
    persisted,
    statusChanged,
  };
}

/** A run and the findings it produced. */
export interface RunFindings {
  readonly run: AssessmentRun;
  readonly findings: readonly ComparableFinding[];
}

export interface RunComparisonReport extends RunComparison {
  readonly previousRunId: string;
  readonly currentRunId: string;
  /**
   * True when either side is a SCENARIO run. Comparing a scenario against today's actuals is
   * the point of scenario modeling, so it is allowed — but any surface rendering this report
   * must label it, because these numbers are a projection and not a compliance position
   * (section 12.2).
   */
  readonly involvesScenario: boolean;
}

/** Statuses for which a run's finding set is a complete, meaningful answer. */
const COMPARABLE_STATUSES: ReadonlySet<AssessmentRunStatus> = new Set<AssessmentRunStatus>([
  'COMPLETED',
  'FINALIZED',
]);

/**
 * The section 11 "uploaded corrected data, run a new assessment and compare" flow.
 *
 * Refuses to compare runs from different tenants, organizations or modules: those numbers
 * would be arithmetic rather than meaning, and a cross-tenant one would also breach
 * invariant 7. Different program years are allowed on purpose — year-over-year is a
 * legitimate view.
 */
export function compareRuns(previous: RunFindings, current: RunFindings): RunComparisonReport {
  const before = previous.run;
  const after = current.run;

  for (const [field, left, right] of [
    ['tenant', before.tenantId, after.tenantId],
    ['organization', before.organizationId, after.organizationId],
    ['module', before.moduleId, after.moduleId],
  ] as const) {
    if (left !== right) {
      throw new Error(
        `Cannot compare assessment runs ${before.id} and ${after.id}: they are for different ` +
          `${field}s (${left} vs ${right}).`,
      );
    }
  }

  for (const run of [before, after]) {
    if (!COMPARABLE_STATUSES.has(run.status)) {
      throw new Error(
        `Cannot compare assessment run ${run.id}: it is ${run.status}, so its finding set is ` +
          'not a complete answer. Only a COMPLETED or FINALIZED run can be compared.',
      );
    }
  }

  return {
    ...compareFindingSets(previous.findings, current.findings),
    previousRunId: before.id,
    currentRunId: after.id,
    involvesScenario: isScenarioRun(before) || isScenarioRun(after),
  };
}
