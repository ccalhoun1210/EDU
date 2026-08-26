/**
 * Findings and the human dispositions recorded against them.
 *
 * Spec: Master Technical Buildout section 6 (`findings`, `finding_dispositions`) and
 * section 24 (the finding detail screen). CLAUDE.md invariants 3, 4, 6 and 7.
 *
 * The organising idea comes from section 24: **the system result and the human disposition
 * are two separate facts, and neither overwrites the other.** The engine says FAIL; a
 * reviewer may record ACCEPTED_EXCEPTION with a reason and evidence; the screen shows both
 * lines. Nothing here mutates an evaluation result — `resolveEffectiveStatus` returns the
 * system status alongside the effective one precisely so that a caller cannot accidentally
 * lose the distinction on its way to a page component.
 *
 * This module is also where invariant 3 is enforced in code rather than in prose. A finding
 * is the end of a chain — finding → rule → rule version → regulatory authority → input fact
 * → source record → transformation → data snapshot — and a finding that cannot name its
 * link in that chain is not a compliance statement, it is an opinion. `createFinding` is
 * the only way to obtain a `Finding`, and it refuses to build one whose provenance is
 * incomplete.
 *
 * Both validators return a typed result rather than throwing, so the API layer (section 23)
 * can turn a rejection into a 422 with per-field messages instead of a 500.
 */

import { EVALUATION_STATUSES, SEVERITIES } from './evaluation.js';
import type { EvaluationStatus, Severity } from './evaluation.js';

/**
 * A calendar date, `YYYY-MM-DD` (invariant 6). Deliberately not a `Date`: a statutory
 * deadline round-tripped through a UTC timestamp is a deadline that can move by a day.
 * Kept module-local so a later shared date module can own the exported name.
 */
type CalendarDate = string;

const CALENDAR_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date that is both well-shaped and real. `2027-02-30` passes the regex and is not a day;
 * JavaScript would roll it silently into March, which in a fiscal finding is a defect.
 */
function isCalendarDate(value: string | undefined): value is CalendarDate {
  if (value === undefined || !CALENDAR_DATE_SHAPE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
  );
}

/**
 * What a finding is about. A reference, never a copy: for SPECIAL_ED_CASE this is the
 * pseudonymous case id from the analytic record, never a student name (invariant 10).
 */
export const FINDING_SUBJECT_TYPES = [
  'ORGANIZATION',
  'SCHOOL_SITE',
  'FISCAL_YEAR',
  'FEDERAL_AWARD',
  'SPECIAL_ED_CASE',
] as const;

export type FindingSubjectType = (typeof FINDING_SUBJECT_TYPES)[number];

export interface FindingSubject {
  readonly type: FindingSubjectType;
  readonly id: string;
}

/** The regulatory hook for a result. Both halves are required — see "Cite the authority". */
export interface AuthorityReference {
  /** Human-readable provision, e.g. `34 CFR 300.203(b)(2)`. */
  readonly citation: string;
  /** The `regulatory_sources` row the citation was read from, for reproducibility. */
  readonly sourceId: string;
}

/**
 * The handle that ties a finding back to the run that produced it (sections 8.7 and 11).
 *
 * `evaluationHash` and `dataSnapshotId` together are what make a finding re-derivable years
 * later during monitoring: the snapshot pins the facts, the hash proves the result presented
 * today is the result the engine actually computed.
 */
export interface FindingProvenance {
  readonly evaluationResultId: string;
  readonly dataSnapshotId: string;
  readonly engineVersion: string;
  readonly evaluationHash: string;
  readonly authorities: readonly AuthorityReference[];
}

export interface Finding {
  readonly id: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly assessmentRunId: string;
  readonly ruleId: string;
  readonly ruleVersionId: string;
  /**
   * The deterministic engine's answer. Immutable for the life of the finding: corrected
   * data or a corrected rule produces a new run and a new finding (invariant 4).
   */
  readonly systemStatus: EvaluationStatus;
  readonly severity: Severity;
  readonly subject: FindingSubject;
  readonly provenance: FindingProvenance;
  /** The date of the assessment run that produced this finding. */
  readonly detectedOn: CalendarDate;
}

/**
 * What arrives at the API boundary, before anything is known to be true about it.
 *
 * Every field is optional on purpose. The draft models untrusted input — a parsed request
 * body, a row from a queue message — and the whole job of `createFinding` is to reject the
 * incomplete ones. A draft that required the provenance fields would push the check out to
 * the caller, which is exactly where invariant 3 stops being enforceable.
 */
export interface AuthorityReferenceDraft {
  readonly citation?: string | undefined;
  readonly sourceId?: string | undefined;
}

export interface FindingProvenanceDraft {
  readonly evaluationResultId?: string | undefined;
  readonly dataSnapshotId?: string | undefined;
  readonly engineVersion?: string | undefined;
  readonly evaluationHash?: string | undefined;
  readonly authorities?: readonly AuthorityReferenceDraft[] | undefined;
}

export interface FindingSubjectDraft {
  readonly type?: string | undefined;
  readonly id?: string | undefined;
}

export interface FindingDraft {
  readonly id?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly organizationId?: string | undefined;
  readonly assessmentRunId?: string | undefined;
  readonly ruleId?: string | undefined;
  readonly ruleVersionId?: string | undefined;
  readonly systemStatus?: string | undefined;
  readonly severity?: string | undefined;
  readonly subject?: FindingSubjectDraft | undefined;
  readonly provenance?: FindingProvenanceDraft | undefined;
  readonly detectedOn?: string | undefined;
}

export interface FindingValidationIssue {
  /** Dotted path into the draft, so the API layer can attach it to a 422 body. */
  readonly field: string;
  readonly message: string;
}

export type FindingValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly FindingValidationIssue[] };

/**
 * Narrow an untrusted string to a member of a closed vocabulary, without a type assertion:
 * the value that comes back is one of the constants, not the caller's string relabelled.
 */
function memberOf<T extends string>(
  allowed: readonly T[],
  candidate: string | undefined,
): T | undefined {
  return allowed.find((value) => value === candidate);
}

/**
 * Collects issues while reading a draft. Every problem is reported, not just the first:
 * a district administrator fixing an upload should see the whole list once.
 */
function issueCollector(): {
  readonly issues: FindingValidationIssue[];
  readonly id: (value: string | undefined, field: string) => string;
  readonly add: (field: string, message: string) => void;
} {
  const issues: FindingValidationIssue[] = [];
  return {
    issues,
    add(field, message) {
      issues.push({ field, message });
    },
    // A whitespace-only identifier is a missing identifier. Treating it as present is how a
    // provenance chain ends up with a link that points nowhere.
    id(value, field) {
      const trimmed = value === undefined ? '' : value.trim();
      if (trimmed === '') issues.push({ field, message: `${field} is required` });
      return trimmed;
    },
  };
}

/**
 * Build a finding, or explain why it cannot exist (invariant 3).
 *
 * There is no partial success and no "provisional" finding: the fields below are the
 * provenance chain, and a finding missing any link of it must not be creatable.
 */
export function createFinding(draft: FindingDraft): FindingValidationResult<Finding> {
  const { issues, id, add } = issueCollector();

  const identity = {
    id: id(draft.id, 'id'),
    tenantId: id(draft.tenantId, 'tenantId'),
    organizationId: id(draft.organizationId, 'organizationId'),
    assessmentRunId: id(draft.assessmentRunId, 'assessmentRunId'),
    ruleId: id(draft.ruleId, 'ruleId'),
    ruleVersionId: id(draft.ruleVersionId, 'ruleVersionId'),
  };

  const provenanceDraft = draft.provenance ?? {};
  const authorities: AuthorityReference[] = (provenanceDraft.authorities ?? []).map(
    (authority, index) => ({
      citation: id(authority.citation, `provenance.authorities[${index}].citation`),
      sourceId: id(authority.sourceId, `provenance.authorities[${index}].sourceId`),
    }),
  );
  if (authorities.length === 0) {
    add('provenance.authorities', 'at least one regulatory authority reference is required');
  }

  const provenance: FindingProvenance = {
    evaluationResultId: id(provenanceDraft.evaluationResultId, 'provenance.evaluationResultId'),
    dataSnapshotId: id(provenanceDraft.dataSnapshotId, 'provenance.dataSnapshotId'),
    engineVersion: id(provenanceDraft.engineVersion, 'provenance.engineVersion'),
    evaluationHash: id(provenanceDraft.evaluationHash, 'provenance.evaluationHash'),
    authorities,
  };

  const systemStatus = memberOf(EVALUATION_STATUSES, draft.systemStatus);
  if (systemStatus === undefined) {
    add('systemStatus', `must be one of ${EVALUATION_STATUSES.join(', ')}`);
  }

  const severity = memberOf(SEVERITIES, draft.severity);
  if (severity === undefined) {
    add('severity', `must be one of ${SEVERITIES.join(', ')}`);
  }

  const subjectDraft = draft.subject ?? {};
  const subjectId = id(subjectDraft.id, 'subject.id');
  const subjectType = memberOf(FINDING_SUBJECT_TYPES, subjectDraft.type);
  if (subjectType === undefined) {
    add('subject.type', `must be one of ${FINDING_SUBJECT_TYPES.join(', ')}`);
  }

  const detectedOn = draft.detectedOn;
  if (!isCalendarDate(detectedOn)) {
    add('detectedOn', 'must be a real calendar date in YYYY-MM-DD form');
  }

  // The `undefined` checks below are for the type-checker, not for control flow: each one
  // has already pushed an issue, so `issues.length > 0` covers the same cases at runtime.
  if (
    issues.length === 0 &&
    systemStatus !== undefined &&
    severity !== undefined &&
    subjectType !== undefined &&
    detectedOn !== undefined
  ) {
    return {
      ok: true,
      value: {
        ...identity,
        systemStatus,
        severity,
        subject: { type: subjectType, id: subjectId },
        provenance,
        detectedOn,
      },
    };
  }
  return { ok: false, issues };
}

/**
 * The reviewer's act (section 24). A disposition records what a human decided about a
 * finding; it is a separate row and a separate fact from the evaluation result, and
 * recording one never edits the result.
 */
export const FINDING_DISPOSITION_KINDS = [
  'ACKNOWLEDGED',
  'ACCEPTED_EXCEPTION',
  'DISPUTED',
  'REMEDIATION_PLANNED',
  'RESOLVED',
  'FALSE_POSITIVE',
] as const;

export type FindingDispositionKind = (typeof FINDING_DISPOSITION_KINDS)[number];

export interface FindingDisposition {
  readonly id: string;
  readonly tenantId: string;
  readonly findingId: string;
  readonly kind: FindingDispositionKind;
  readonly reviewerId: string;
  /**
   * Stored, not looked up at render time. The section 24 screen shows the reviewer who made
   * the call, and that attribution has to survive the reviewer leaving the district.
   */
  readonly reviewerName: string;
  readonly recordedOn: CalendarDate;
  readonly reason: string;
  /** Evidence supporting the disposition. Empty for kinds that do not require any. */
  readonly evidenceItemIds: readonly string[];
}

export interface FindingDispositionDraft {
  readonly id?: string | undefined;
  readonly kind?: string | undefined;
  readonly reviewerId?: string | undefined;
  readonly reviewerName?: string | undefined;
  readonly recordedOn?: string | undefined;
  readonly reason?: string | undefined;
  readonly evidenceItemIds?: readonly string[] | undefined;
}

/**
 * Kinds that excuse a deterministic result rather than merely annotate it. These are the
 * two a state monitor will ask about, so they carry the heavier evidentiary burden:
 * ACCEPTED_EXCEPTION asserts the district is entitled to the deviation, and FALSE_POSITIVE
 * asserts the engine is wrong.
 */
const EXCUSING_KINDS: ReadonlySet<FindingDispositionKind> = new Set<FindingDispositionKind>([
  'ACCEPTED_EXCEPTION',
  'FALSE_POSITIVE',
]);

/**
 * Record a reviewer's disposition against a finding.
 *
 * Tenant and finding id come from the finding, never from the draft: a tenant id that
 * arrived in a browser request is not trusted (invariant 7), and a disposition can only
 * ever belong to the finding it is being recorded against.
 *
 * Note that a non-blank reason is required for *every* kind, which is stricter than the
 * evidentiary rule for the two excusing kinds. There is no kind for which an unexplained
 * human override of a deterministic result is acceptable in an audit file.
 */
export function recordDisposition(
  finding: Finding,
  draft: FindingDispositionDraft,
): FindingValidationResult<FindingDisposition> {
  const { issues, id, add } = issueCollector();

  const dispositionId = id(draft.id, 'id');
  const reviewerId = id(draft.reviewerId, 'reviewerId');
  const reviewerName = id(draft.reviewerName, 'reviewerName');

  const kind = memberOf(FINDING_DISPOSITION_KINDS, draft.kind);
  if (kind === undefined) {
    add('kind', `must be one of ${FINDING_DISPOSITION_KINDS.join(', ')}`);
  }

  const recordedOn = draft.recordedOn;
  if (!isCalendarDate(recordedOn)) {
    add('recordedOn', 'must be a real calendar date in YYYY-MM-DD form');
  }

  const reason = (draft.reason ?? '').trim();
  if (reason === '') {
    add(
      'reason',
      kind !== undefined && EXCUSING_KINDS.has(kind)
        ? `a ${kind} disposition requires a written reason`
        : 'reason is required',
    );
  }

  const evidenceItemIds = draft.evidenceItemIds ?? [];
  const evidence = evidenceItemIds.map((item, index) => id(item, `evidenceItemIds[${index}]`));
  if (kind === 'ACCEPTED_EXCEPTION' && evidence.length === 0) {
    add('evidenceItemIds', 'an ACCEPTED_EXCEPTION disposition requires at least one evidence item');
  }

  if (issues.length === 0 && kind !== undefined && recordedOn !== undefined) {
    return {
      ok: true,
      value: {
        id: dispositionId,
        tenantId: finding.tenantId,
        findingId: finding.id,
        kind,
        reviewerId,
        reviewerName,
        recordedOn,
        reason,
        evidenceItemIds: evidence,
      },
    };
  }
  return { ok: false, issues };
}

/**
 * The disposition that governs today.
 *
 * Dispositions are append-only history — a reviewer who changes their mind adds a row, and
 * the earlier act stays readable in the audit log (section 21). "Current" therefore means
 * the most recent by calendar date; where two share a date, the later entry in the sequence
 * wins, since the store returns them in insertion order. Lexicographic comparison of
 * `YYYY-MM-DD` is chronological, which is one of the reasons invariant 6 stores dates that
 * way.
 */
export function latestDisposition(
  dispositions: readonly FindingDisposition[],
): FindingDisposition | undefined {
  let latest: FindingDisposition | undefined;
  for (const disposition of dispositions) {
    if (latest === undefined || disposition.recordedOn >= latest.recordedOn) {
      latest = disposition;
    }
  }
  return latest;
}

/**
 * The two statuses a finding detail screen shows side by side (section 24).
 *
 * `effectiveStatus` is a **presentation** value: what the district should act on today. It
 * is derived on read and never written back to `evaluation_results`. The deterministic
 * result is carried alongside it in `systemStatus` so that any surface showing one can show
 * the other, and so that a report built from this object can still state what the engine
 * concluded.
 */
export interface EffectiveFindingStatus {
  /** The engine's result, unchanged by anything in this module. */
  readonly systemStatus: EvaluationStatus;
  /** What the district should act on. Derived for display; never persisted as a result. */
  readonly effectiveStatus: EvaluationStatus;
  /** The disposition that produced the effective status, if any. */
  readonly disposition: FindingDispositionKind | undefined;
  /** One line, written for the finding detail screen. */
  readonly rationale: string;
}

/**
 * Resolve what a district should act on, given the system status and the latest disposition.
 *
 * No branch here can produce PASS. A FAIL is cleared by a new assessment run against
 * corrected data (invariant 4), never by a reviewer asserting that it is fixed — which is
 * why RESOLVED and REMEDIATION_PLANNED leave the status where the engine left it. The two
 * excusing kinds resolve to NOT_APPLICABLE, meaning "no district action outstanding", and
 * NOT_APPLICABLE is chosen rather than PASS because nothing has been shown to satisfy the
 * requirement — a human has taken responsibility for it not applying.
 */
export function resolveEffectiveStatus(
  systemStatus: EvaluationStatus,
  disposition: FindingDisposition | undefined,
): EffectiveFindingStatus {
  if (disposition === undefined) {
    return {
      systemStatus,
      effectiveStatus: systemStatus,
      disposition: undefined,
      rationale: 'No human disposition recorded; the system result stands.',
    };
  }

  const kind = disposition.kind;
  const by = disposition.reviewerName;

  switch (kind) {
    case 'ACCEPTED_EXCEPTION':
      return {
        systemStatus,
        effectiveStatus: 'NOT_APPLICABLE',
        disposition: kind,
        rationale: `Accepted as an exception by ${by}; the system result remains ${systemStatus}.`,
      };
    case 'FALSE_POSITIVE':
      return {
        systemStatus,
        effectiveStatus: 'NOT_APPLICABLE',
        disposition: kind,
        rationale:
          `Reported as a false positive by ${by}; the system result remains ${systemStatus} ` +
          'pending review of the rule version that produced it.',
      };
    case 'DISPUTED':
      return {
        systemStatus,
        effectiveStatus: 'MANUAL_REVIEW',
        disposition: kind,
        rationale: `Disputed by ${by}; awaiting adjudication. The system result remains ${systemStatus}.`,
      };
    case 'ACKNOWLEDGED':
      return {
        systemStatus,
        effectiveStatus: systemStatus,
        disposition: kind,
        rationale: `Acknowledged by ${by}. The result still requires action.`,
      };
    case 'REMEDIATION_PLANNED':
      return {
        systemStatus,
        effectiveStatus: systemStatus,
        disposition: kind,
        rationale: `Remediation planned by ${by}. The result stands until corrected data is assessed.`,
      };
    case 'RESOLVED':
      return {
        systemStatus,
        effectiveStatus: systemStatus,
        disposition: kind,
        rationale:
          `Reported resolved by ${by}. Only a new assessment run against corrected data ` +
          'can change the system result.',
      };
  }

  // Adding a disposition kind without deciding what it means for a district must not compile.
  const unhandled: never = kind;
  throw new Error(`Unhandled disposition kind: ${String(unhandled)}`);
}
