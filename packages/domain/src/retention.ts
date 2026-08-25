/**
 * Retention engine.
 *
 * Spec: Master Technical Buildout section 20 — "Retention engine" and "Deletion workflow".
 * This is also the section 37 mitigation for the threat "deleted required evidence": the
 * evidence that proves a district was compliant is worth nothing if a routine purge job can
 * remove it while a monitor is still asking about it.
 *
 * Section 20 opens with the constraint that shapes the whole module: **do not hard-code one
 * retention period**. A retention obligation is the product of the record type, the federal
 * or state program the record is pertinent to, the tenant's own policy, the contract, any
 * audit or legal hold, and what the source system itself requires. Those authorities do not
 * agree, and they do not have to: each states a minimum, and the district must satisfy all
 * of them at once. So the resolved period is the **longest** applicable one, never the first
 * matched and never the shortest. That single choice is what makes a tenant policy incapable
 * of shortening a federal floor — see `resolveRetention`.
 *
 * Two further rules follow from the same reasoning.
 *
 * A hold outranks an expired period. 2 CFR 200.334(a) is explicit that where litigation, a
 * claim, or an audit starts before the retention period expires, the records are kept until
 * that matter is resolved and final action is taken. `canDelete` therefore consults holds
 * before it consults the calendar, and a released hold is only released the day *after* the
 * release date — the fail-closed reading of an inclusive window.
 *
 * Everything here fails closed. An applicable policy whose anchor event has not happened yet
 * (or was never captured) yields INDETERMINATE rather than being skipped, per CLAUDE.md
 * invariant 9, and a record no policy governs is NOT_GOVERNED rather than free to delete.
 * Deleting a record because we could not work out how long to keep it is the exact failure
 * this module exists to prevent.
 *
 * CLAUDE.md invariant 6 — every date here is a calendar date. `retain_until` is a square on
 * a wall calendar, not an instant. The arithmetic below is integer arithmetic over
 * (year, month, day) triples: no `Date`, no UTC round trip, no time zone anywhere. A
 * retention date that shifts by a day depending on where the server runs is a date that can
 * authorise a deletion one day early.
 *
 * Nothing here reads the clock. Every function that needs "now" takes it as `asOf`, so a
 * deletion scope preview shown to a district is reproducible and testable.
 */

import {
  CalendarDateError,
  addYears,
  compareCalendarDates,
  parseCalendarDate,
  type CalendarDate,
} from './calendar.js';

/* ----------------------------------------------------------------- calendar dates -- */

export class RetentionError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'RetentionError';
  }
}

/**
 * Validate a date, reporting it as a retention problem rather than a bare parse failure.
 *
 * The arithmetic itself is `./calendar.js` — pure integer maths on (year, month, day), shared
 * with every other date in the platform. What this adds is the label, so a district reading
 * "anchor date \"2027-02-30\" is not a usable calendar date" knows which of the several dates
 * on a retention record is the broken one.
 */
function requireDate(raw: string, label: string): string {
  try {
    parseCalendarDate(raw);
    return raw;
  } catch (error) {
    throw new RetentionError(
      `${label} ${error instanceof CalendarDateError ? error.message : String(error)}`,
    );
  }
}

function compareDates(a: CalendarDate, b: CalendarDate): number {
  return compareCalendarDates(requireDate(a, 'date'), requireDate(b, 'date'));
}

/* --------------------------------------------------------------- retention policy -- */

/**
 * Where an obligation comes from. Used to break ties deterministically and, more
 * importantly, to name the authority in the explanation a district reads.
 */
export const RETENTION_AUTHORITIES = [
  'FEDERAL',
  'STATE',
  'CONTRACT',
  'SOURCE_SYSTEM',
  'TENANT_POLICY',
] as const;

export type RetentionAuthority = (typeof RETENTION_AUTHORITIES)[number];

/**
 * Precedence for equal periods only. It never overrides the longest-period rule: a tenant
 * policy that runs longer than the federal floor still governs, because the district has
 * promised itself more than the government asked for and that promise is also an
 * obligation.
 */
const AUTHORITY_PRECEDENCE: readonly RetentionAuthority[] = [
  'FEDERAL',
  'STATE',
  'CONTRACT',
  'SOURCE_SYSTEM',
  'TENANT_POLICY',
];

/**
 * The event a retention period runs from.
 *
 * This is a field rather than an assumption because the governing rule says so. 2 CFR
 * 200.334 requires records pertinent to a federal award to be retained for three years
 * **from the date of submission of the final expenditure report** — not from the date the
 * record was created, and not from the end of the fiscal year in which it was created. A
 * purchase order written in July 2025 against a grant whose final expenditure report is
 * filed in December 2027 is retained into December 2030. Hard-coding "three years from
 * creation" would authorise its deletion two and a half years early.
 */
export const RETENTION_ANCHORS = [
  'RECORD_CREATED',
  'FISCAL_YEAR_END',
  'FINAL_EXPENDITURE_REPORT',
  'GRANT_PERIOD_END',
  'SERVICE_END',
  'CONTRACT_END',
] as const;

export type RetentionAnchor = (typeof RETENTION_ANCHORS)[number];

/** A policy with this record type applies to every record type. */
export const ANY_RECORD_TYPE = '*';

/**
 * One retention obligation from one authority.
 *
 * `baseYears` is whole years because that is how every schedule this platform has met is
 * written — "three years", "five years", "permanently" (which is not expressible here and
 * is deliberately left to a hold or a separate never-delete classification). Omitting
 * `program` makes the policy program-agnostic, which is how a tenant-wide or state-wide
 * schedule is expressed.
 */
export interface RetentionPolicy {
  readonly policyId: string;
  readonly authority: RetentionAuthority;
  /** A canonical record type, or `ANY_RECORD_TYPE` for a schedule that covers everything. */
  readonly recordType: string;
  /** Program identifier, e.g. `IDEA_PART_B`. Omit for a policy that is not program-scoped. */
  readonly program?: string;
  readonly baseYears: number;
  readonly anchor: RetentionAnchor;
  /** The CFR section, state regulation, or contract clause. Shown with the result. */
  readonly citation: string;
}

/** A record considered for retention. Holds no student PII — an id and its anchor dates. */
export interface RetainableRecord {
  readonly recordId: string;
  readonly tenantId: string;
  readonly recordType: string;
  readonly program?: string;
  /**
   * The dates of the events this record's anchors could run from. An anchor absent from
   * this map has not happened yet or was never captured, and either way the period that
   * depends on it cannot be computed.
   */
  readonly anchorDates: Readonly<Partial<Record<RetentionAnchor, CalendarDate>>>;
}

/**
 * Whether a policy speaks to this record.
 *
 * A program-scoped policy does not reach a record whose program is unknown. That is
 * deliberate: it would be guessing, and the resulting NOT_GOVERNED outcome blocks deletion
 * anyway, so the fail-closed path is also the honest one.
 */
export function policyApplies(policy: RetentionPolicy, record: RetainableRecord): boolean {
  if (policy.recordType !== ANY_RECORD_TYPE && policy.recordType !== record.recordType) {
    return false;
  }
  if (policy.program !== undefined && policy.program !== record.program) return false;
  return true;
}

/* ------------------------------------------------------------------- retain_until -- */

/**
 * The last calendar date a record must be kept, inclusive.
 *
 * Whole-year arithmetic on the (year, month, day) triple, clamped to the end of the target
 * month. A 29 February anchor plus three years is 28 February: in a common year the last
 * day of February *is* the anniversary of 29 February, and clamping forward to 1 March
 * would put the boundary in the wrong month. The result is inclusive — a record whose
 * `retain_until` is today is still required today and becomes deletable tomorrow — so the
 * clamp does not shorten the obligation in any way that matters.
 */
export function retainUntil(anchorDate: CalendarDate, years: number): CalendarDate {
  if (!Number.isInteger(years) || years < 0) {
    throw new RetentionError(
      `retention period must be a whole number of years, not ${String(years)}`,
    );
  }
  return addYears(requireDate(anchorDate, 'anchor date'), years);
}

/* --------------------------------------------------------------------- resolution -- */

/** A policy that applied and could be computed. */
export interface RetentionCandidate {
  readonly policy: RetentionPolicy;
  readonly anchorDate: CalendarDate;
  readonly retainUntil: CalendarDate;
}

/** A policy that applied and could not be computed, because its anchor event is unknown. */
export interface UnresolvedRetention {
  readonly policy: RetentionPolicy;
  readonly missingAnchor: RetentionAnchor;
}

export const RETENTION_OUTCOMES = ['RETAIN', 'INDETERMINATE', 'NOT_GOVERNED'] as const;

export type RetentionOutcome = (typeof RETENTION_OUTCOMES)[number];

/**
 * The resolved obligation, with the reasoning kept alongside it.
 *
 * `considered` and `unresolved` are part of the result rather than a debug aid: section 20's
 * deletion workflow shows a scope preview to a district before anything is destroyed, and
 * "why is this record blocked" has to be answerable from the value itself.
 *
 * `retainUntil` is present whenever at least one policy resolved, even when the outcome is
 * INDETERMINATE — in that case it is a known floor rather than the answer, and deletion
 * stays blocked because an unresolved policy could reach past it.
 */
export interface RetentionResolution {
  readonly outcome: RetentionOutcome;
  readonly retainUntil?: CalendarDate;
  readonly governing?: RetentionCandidate;
  readonly considered: readonly RetentionCandidate[];
  readonly unresolved: readonly UnresolvedRetention[];
  readonly explanation: string;
}

function authorityRank(authority: RetentionAuthority): number {
  const index = AUTHORITY_PRECEDENCE.indexOf(authority);
  return index === -1 ? AUTHORITY_PRECEDENCE.length : index;
}

/**
 * Later date wins. Equal dates fall back to authority, then to policy id.
 *
 * The tie-breaks exist so the governing citation is stable: the same inputs must produce the
 * same explanation on every run, including after a caller reorders its policy list.
 */
function longer(a: RetentionCandidate, b: RetentionCandidate): RetentionCandidate {
  const byDate = compareDates(a.retainUntil, b.retainUntil);
  if (byDate !== 0) return byDate > 0 ? a : b;
  const byAuthority = authorityRank(a.policy.authority) - authorityRank(b.policy.authority);
  if (byAuthority !== 0) return byAuthority < 0 ? a : b;
  return a.policy.policyId <= b.policy.policyId ? a : b;
}

function describe(candidate: RetentionCandidate): string {
  const { policy } = candidate;
  return (
    `${policy.policyId} (${policy.authority}, ${policy.citation}): ${policy.baseYears} ` +
    `year(s) from ${policy.anchor} ${candidate.anchorDate} — retain until ${candidate.retainUntil}`
  );
}

/**
 * Select the governing retention obligation for a record.
 *
 * The longest applicable period wins. Not the first match: policy order is an accident of
 * how the caller loaded its rows. Not the shortest: when two authorities both apply, the
 * longer obligation is the one that has to be satisfied, and satisfying it satisfies the
 * other. This is why a tenant override cannot shorten a federal floor — it is simply
 * another candidate in the same maximum, and a two-year tenant schedule loses to the
 * three-year 2 CFR 200.334 period every time.
 *
 * Comparison is on the computed dates, never on `baseYears`, because the periods run from
 * different anchors. A three-year period from a final expenditure report routinely outlasts
 * a five-year period from record creation, and comparing the year counts would pick the
 * wrong one.
 */
export function resolveRetention(
  record: RetainableRecord,
  policies: readonly RetentionPolicy[],
  tenantOverride?: RetentionPolicy,
): RetentionResolution {
  const applicable = [
    ...policies,
    ...(tenantOverride === undefined ? [] : [tenantOverride]),
  ].filter((policy) => policyApplies(policy, record));

  const considered: RetentionCandidate[] = [];
  const unresolved: UnresolvedRetention[] = [];

  for (const policy of applicable) {
    const anchorDate = record.anchorDates[policy.anchor];
    if (anchorDate === undefined) {
      unresolved.push({ policy, missingAnchor: policy.anchor });
      continue;
    }
    considered.push({ policy, anchorDate, retainUntil: retainUntil(anchorDate, policy.baseYears) });
  }

  const governing = considered.reduce<RetentionCandidate | undefined>(
    (longest, candidate) => (longest === undefined ? candidate : longer(longest, candidate)),
    undefined,
  );

  if (applicable.length === 0) {
    return {
      outcome: 'NOT_GOVERNED',
      considered,
      unresolved,
      explanation:
        `No retention policy covers record type "${record.recordType}"` +
        `${record.program === undefined ? '' : ` under program "${record.program}"`}. ` +
        'Deletion is blocked until a schedule is declared.',
    };
  }

  if (unresolved.length > 0) {
    // Invariant 9: the anchor event has not been recorded, so the period is unknown. An
    // unknown period is not a short one.
    const missing = unresolved
      .map((entry) => `${entry.policy.policyId} awaits ${entry.missingAnchor}`)
      .join('; ');
    return {
      outcome: 'INDETERMINATE',
      ...(governing === undefined ? {} : { retainUntil: governing.retainUntil, governing }),
      considered,
      unresolved,
      explanation: `Retention cannot be computed: ${missing}.`,
    };
  }

  if (governing === undefined) {
    // Unreachable while `applicable` is non-empty and every policy either resolves or is
    // recorded as unresolved; kept so the type is honoured without a non-null assertion.
    return {
      outcome: 'INDETERMINATE',
      considered,
      unresolved,
      explanation: 'Retention cannot be computed: no applicable policy produced a date.',
    };
  }

  return {
    outcome: 'RETAIN',
    retainUntil: governing.retainUntil,
    governing,
    considered,
    unresolved,
    explanation: `Longest of ${considered.length} applicable obligation(s): ${describe(governing)}`,
  };
}

/* -------------------------------------------------------------------------- holds -- */

export const HOLD_KINDS = ['LEGAL', 'LITIGATION', 'AUDIT', 'STATE_MONITORING'] as const;

export type HoldKind = (typeof HOLD_KINDS)[number];

/**
 * A hold placed on a record or a set of records.
 *
 * `releasedOn` is inclusive: a hold released on 30 June is still in force on 30 June and
 * lifts on 1 July. Where the two readings differ, the one that keeps the record is correct.
 */
export interface RetentionHold {
  readonly holdId: string;
  readonly tenantId: string;
  readonly kind: HoldKind;
  readonly placedOn: CalendarDate;
  readonly releasedOn?: CalendarDate;
  /** Free text shown to the district — "OSEP monitoring letter of 2 March 2026". */
  readonly reason: string;
}

/** Holds in force on `asOf`. A future-dated hold is not yet in force. */
export function activeHolds(
  holds: readonly RetentionHold[],
  asOf: CalendarDate,
): readonly RetentionHold[] {
  return holds.filter(
    (hold) =>
      compareDates(hold.placedOn, asOf) <= 0 &&
      (hold.releasedOn === undefined || compareDates(asOf, hold.releasedOn) <= 0),
  );
}

/* ---------------------------------------------------------------------- deletion  -- */

/**
 * Everything needed to decide one record's fate: the record, the schedules that could reach
 * it, the tenant's own override, and its holds.
 */
export interface RetentionSubject {
  readonly record: RetainableRecord;
  readonly policies: readonly RetentionPolicy[];
  readonly tenantOverride?: RetentionPolicy;
  readonly holds: readonly RetentionHold[];
}

export const DELETION_BLOCK_KINDS = [
  'HOLD',
  'RETENTION_PERIOD',
  'INDETERMINATE_RETENTION',
  'NOT_GOVERNED',
] as const;

export type DeletionBlockKind = (typeof DELETION_BLOCK_KINDS)[number];

/** One reason a record cannot be deleted. A record may have several. */
export interface DeletionBlock {
  readonly kind: DeletionBlockKind;
  readonly explanation: string;
  readonly holdId?: string;
  readonly policyId?: string;
}

export interface DeletionAssessment {
  readonly recordId: string;
  readonly deletable: boolean;
  readonly retention: RetentionResolution;
  readonly holdsInForce: readonly RetentionHold[];
  /** Empty exactly when `deletable` is true. */
  readonly blocks: readonly DeletionBlock[];
}

/**
 * Assess one record against the calendar and its holds.
 *
 * Every blocking reason is collected rather than short-circuited on the first: a district
 * that clears a hold needs to know whether the record then becomes deletable or whether the
 * retention period still has two years to run.
 */
export function assessDeletion(subject: RetentionSubject, asOf: CalendarDate): DeletionAssessment {
  const { record } = subject;
  const retention = resolveRetention(record, subject.policies, subject.tenantOverride);
  const holdsInForce = activeHolds(subject.holds, asOf);
  const blocks: DeletionBlock[] = [];

  // Holds first, and unconditionally. 2 CFR 200.334(a): a matter opened before the period
  // expires keeps the records until it is resolved and final action is taken. An expired
  // retention period does not release a record under hold.
  for (const hold of holdsInForce) {
    blocks.push({
      kind: 'HOLD',
      holdId: hold.holdId,
      explanation: `${hold.kind} hold ${hold.holdId} placed ${hold.placedOn}: ${hold.reason}`,
    });
  }

  if (retention.outcome === 'NOT_GOVERNED') {
    blocks.push({ kind: 'NOT_GOVERNED', explanation: retention.explanation });
  } else if (retention.outcome === 'INDETERMINATE') {
    blocks.push({ kind: 'INDETERMINATE_RETENTION', explanation: retention.explanation });
  } else if (
    retention.retainUntil !== undefined &&
    compareDates(asOf, retention.retainUntil) <= 0
  ) {
    // Inclusive: the record is still required on its retain_until date.
    blocks.push({
      kind: 'RETENTION_PERIOD',
      ...(retention.governing === undefined
        ? {}
        : { policyId: retention.governing.policy.policyId }),
      explanation: `Retention runs to ${retention.retainUntil}. ${retention.explanation}`,
    });
  }

  return {
    recordId: record.recordId,
    deletable: blocks.length === 0,
    retention,
    holdsInForce,
    blocks,
  };
}

/**
 * Whether a record may be destroyed on `asOf`.
 *
 * False while any hold is in force, whatever the calendar says, and false whenever the
 * obligation could not be resolved. True only when a policy governs the record, its period
 * has run out, and nothing is holding it.
 */
export function canDelete(subject: RetentionSubject, asOf: CalendarDate): boolean {
  return assessDeletion(subject, asOf).deletable;
}

/* --------------------------------------------------------------- scope preview  ---- */

/** The `scope preview -> hold check` step of the section 20 deletion workflow. */
export interface DeletionScopeRequest {
  readonly requestId: string;
  readonly tenantId: string;
  readonly asOf: CalendarDate;
  readonly subjects: readonly RetentionSubject[];
}

/**
 * What a district is shown before it authorises anything: what would be deleted, what is
 * blocked, and why.
 */
export interface DeletionScopePreview {
  readonly requestId: string;
  readonly tenantId: string;
  readonly asOf: CalendarDate;
  readonly deletable: readonly DeletionAssessment[];
  readonly blocked: readonly DeletionAssessment[];
  /** Distinct holds responsible for at least one blocked record, for the hold-check step. */
  readonly holdsInForce: readonly RetentionHold[];
}

/**
 * Build the preview.
 *
 * A request that reaches across tenants throws rather than filtering: under invariant 7 a
 * deletion scope is a tenant-scoped operation, and a caller that assembled records from two
 * tenants has a bug that must not be papered over by silently dropping rows.
 */
export function previewDeletionScope(request: DeletionScopeRequest): DeletionScopePreview {
  const deletable: DeletionAssessment[] = [];
  const blocked: DeletionAssessment[] = [];
  const holdsInForce = new Map<string, RetentionHold>();

  for (const subject of request.subjects) {
    if (subject.record.tenantId !== request.tenantId) {
      throw new RetentionError(
        `record ${subject.record.recordId} belongs to tenant ${subject.record.tenantId}, ` +
          `not to requesting tenant ${request.tenantId}`,
      );
    }
    const assessment = assessDeletion(subject, request.asOf);
    if (assessment.deletable) {
      deletable.push(assessment);
      continue;
    }
    blocked.push(assessment);
    for (const hold of assessment.holdsInForce) holdsInForce.set(hold.holdId, hold);
  }

  return {
    requestId: request.requestId,
    tenantId: request.tenantId,
    asOf: request.asOf,
    deletable,
    blocked,
    holdsInForce: [...holdsInForce.values()],
  };
}
