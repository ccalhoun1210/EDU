/**
 * Corrective action management.
 *
 * Spec: Master Technical Buildout section 16. A corrective action is the unit of work that
 * answers a finding, and monitoring turns on being able to say exactly where each one
 * stands and why it is allowed to be there. So the lifecycle is a transition table rather
 * than a status string: the permitted moves, and the conditions attached to each move, are
 * data a reader can take in at once and a test can assert over.
 *
 * Three invariants shape the design.
 *
 * CLAUDE.md invariant 4 — nothing here mutates. `transition` returns a new action; the
 * caller persists it. An action's history is an append-only sequence of these values.
 *
 * CLAUDE.md invariant 6 — the due date and the closure date are calendar dates. A statutory
 * deadline is a date on a calendar, not an instant, and it never round-trips through a UTC
 * timestamp.
 *
 * CLAUDE.md invariant 10 — child-specific remediation carries a pseudonymous case
 * reference, never a student name. Corrective action tracking needs to know *which* case
 * was corrected; it does not need to know who the child is.
 *
 * The dashboard helper takes the reference date as a parameter. Domain code never reads the
 * clock: a count that changes with wall time cannot be reproduced in a monitoring packet,
 * and cannot be tested at all.
 */

// Calendar arithmetic lives in one place (./calendar.js) and is pure integer maths on
// (year, month, day). Three separate implementations of "add 30 days" in one package is
// how two screens come to disagree about a due date.
import { diffDays, type CalendarDate } from './calendar.js';

import type { Severity } from './evaluation.js';

/* ------------------------------------------------------------------------- the state -- */

/**
 * Section 16's lifecycle, in order. The order is presentational only — what a state may
 * move to is defined by CORRECTIVE_ACTION_TRANSITIONS below, nowhere else.
 */
export const CORRECTIVE_ACTION_STATES = [
  'DRAFT',
  'ASSIGNED',
  'IN_PROGRESS',
  'EVIDENCE_SUBMITTED',
  'REVIEW',
  'VERIFIED',
  'CLOSED',
] as const;

export type CorrectiveActionState = (typeof CORRECTIVE_ACTION_STATES)[number];

/**
 * Section 16 requires both child-specific and systemic remediation to be trackable. They
 * are separate variants rather than a flag because they carry different evidence: a
 * child-specific action corrects one case, a systemic action changes a policy or practice
 * and must be shown to reach a population. A district asked to demonstrate systemic
 * correction — the harder of the two questions — can then answer it from the model.
 */
export const REMEDIATION_SCOPES = ['CHILD_SPECIFIC', 'SYSTEMIC'] as const;

export type RemediationScope = (typeof REMEDIATION_SCOPES)[number];

export type Remediation =
  | {
      readonly scope: 'CHILD_SPECIFIC';
      /**
       * Pseudonymous case reference. Invariant 10: this identifies the case record inside
       * the platform, and is never a student name or a district student number.
       */
      readonly caseReference: string;
    }
  | {
      readonly scope: 'SYSTEMIC';
      /** The policy, procedure or practice being corrected. */
      readonly practice: string;
      /** Who the corrected practice reaches — the claim a monitor will test. */
      readonly population: string;
    };

/**
 * What the action answers. Section 16 allows either: a finding produced by a run, or a
 * requirement a district is correcting ahead of being cited for it.
 */
export type RemediationTarget =
  | { readonly kind: 'FINDING'; readonly findingId: string }
  | {
      readonly kind: 'REQUIREMENT';
      readonly requirementId: string;
      /** Cite the authority. A requirement without a citation is not actionable. */
      readonly citation: string;
    };

/** A named participant. Used for both the owner and the reviewer — the shape is the same. */
export interface Assignee {
  readonly userId: string;
  readonly displayName: string;
}

/** Evidence the district has been asked to produce, so submissions can be matched to it. */
export interface EvidenceRequest {
  readonly id: string;
  readonly description: string;
}

export interface ProgressNote {
  readonly recordedOn: CalendarDate;
  readonly authorUserId: string;
  readonly note: string;
}

export const VERIFICATION_OUTCOMES = ['CORRECTED', 'NOT_CORRECTED'] as const;

export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];

/**
 * A reviewer's conclusion about submitted evidence. NOT_CORRECTED is not a failure of the
 * workflow — it is the normal way an action returns to IN_PROGRESS for more work.
 */
export interface VerificationResult {
  readonly outcome: VerificationOutcome;
  readonly decidedOn: CalendarDate;
  /** Why. This text is what a monitor reads next to the closed action. */
  readonly narrative: string;
}

/**
 * Section 16's action record.
 *
 * Optional fields are genuinely absent early in the lifecycle: a DRAFT has no owner yet, a
 * pre-review action has no verification result. The transition guards below are what stop
 * an action from advancing while a field the next state depends on is still missing.
 */
export interface CorrectiveAction {
  readonly id: string;
  readonly tenantId: string;
  readonly state: CorrectiveActionState;
  /** What is being corrected, and at what scope. */
  readonly remediation: Remediation;
  /** The finding or requirement this action answers. */
  readonly target: RemediationTarget;
  /** Inherited from the finding. Drives the dashboard's critical count. */
  readonly severity: Severity;
  readonly owner?: Assignee;
  readonly dueDate?: CalendarDate;
  readonly requestedEvidence: readonly EvidenceRequest[];
  readonly actionPlan?: string;
  readonly progressNotes: readonly ProgressNote[];
  /** Ids of evidence records in the evidence store. The documents live elsewhere. */
  readonly submittedEvidenceIds: readonly string[];
  readonly reviewer?: Assignee;
  readonly verification?: VerificationResult;
  readonly closureDate?: CalendarDate;
}

/* ------------------------------------------------------------------------- the guards -- */

export const TRANSITION_GUARD_IDS = [
  'OWNER_NAMED',
  'DUE_DATE_SET',
  'EVIDENCE_SUBMITTED',
  'REVIEWER_NAMED',
  'CORRECTION_VERIFIED',
  'CORRECTION_REJECTED',
  'CLOSURE_DATE_SET',
] as const;

export type TransitionGuardId = (typeof TRANSITION_GUARD_IDS)[number];

/**
 * A precondition on a move.
 *
 * `requirement` is phrased as the condition that must hold, so a refusal can be shown to a
 * district user unedited: they need to know what to supply, not that a predicate returned
 * false.
 */
export interface TransitionGuard {
  readonly id: TransitionGuardId;
  readonly requirement: string;
  readonly isSatisfied: (action: CorrectiveAction) => boolean;
}

const GUARDS: Readonly<Record<TransitionGuardId, TransitionGuard>> = {
  OWNER_NAMED: {
    id: 'OWNER_NAMED',
    requirement: 'an owner is named',
    isSatisfied: (action) => action.owner !== undefined,
  },
  DUE_DATE_SET: {
    id: 'DUE_DATE_SET',
    requirement: 'a due date is set',
    isSatisfied: (action) => action.dueDate !== undefined,
  },
  EVIDENCE_SUBMITTED: {
    id: 'EVIDENCE_SUBMITTED',
    requirement: 'at least one piece of evidence has been submitted',
    isSatisfied: (action) => action.submittedEvidenceIds.length > 0,
  },
  REVIEWER_NAMED: {
    id: 'REVIEWER_NAMED',
    requirement: 'a reviewer is named',
    isSatisfied: (action) => action.reviewer !== undefined,
  },
  CORRECTION_VERIFIED: {
    id: 'CORRECTION_VERIFIED',
    requirement: 'a verification result recording correction is on file',
    isSatisfied: (action) => action.verification?.outcome === 'CORRECTED',
  },
  CORRECTION_REJECTED: {
    id: 'CORRECTION_REJECTED',
    requirement: 'a verification result recording that correction was not demonstrated is on file',
    isSatisfied: (action) => action.verification?.outcome === 'NOT_CORRECTED',
  },
  CLOSURE_DATE_SET: {
    id: 'CLOSURE_DATE_SET',
    requirement: 'a closure date is set',
    isSatisfied: (action) => action.closureDate !== undefined,
  },
};

/* -------------------------------------------------------------------------- the table -- */

export interface CorrectiveActionTransition {
  readonly from: CorrectiveActionState;
  readonly to: CorrectiveActionState;
  /** Why this move exists. Read by whoever next proposes changing the machine. */
  readonly rationale: string;
  readonly guards: readonly TransitionGuard[];
}

/**
 * The whole machine.
 *
 * Backward moves are first-class, not error handling. Review rejecting evidence is the
 * ordinary case in state monitoring, and an action that has been sent back twice is a fact
 * the district and the state both need to see — not a status that was quietly overwritten.
 *
 * VERIFIED appears exactly once as a destination, and only from REVIEW. That is the whole
 * point of the state: verification is a reviewer's act on submitted evidence, so there is
 * no path that reaches it from work the district did on its own.
 */
export const CORRECTIVE_ACTION_TRANSITIONS: readonly CorrectiveActionTransition[] = [
  {
    from: 'DRAFT',
    to: 'ASSIGNED',
    rationale: 'A drafted action becomes real work once somebody owns it and it is due.',
    guards: [GUARDS.OWNER_NAMED, GUARDS.DUE_DATE_SET],
  },
  {
    from: 'ASSIGNED',
    to: 'DRAFT',
    rationale: 'An action assigned to the wrong owner returns to drafting to be re-scoped.',
    guards: [],
  },
  {
    from: 'ASSIGNED',
    to: 'IN_PROGRESS',
    rationale: 'The owner has started the work.',
    guards: [],
  },
  {
    from: 'IN_PROGRESS',
    to: 'EVIDENCE_SUBMITTED',
    rationale: 'The district asserts the correction is done and has attached proof.',
    guards: [GUARDS.EVIDENCE_SUBMITTED],
  },
  {
    from: 'EVIDENCE_SUBMITTED',
    to: 'IN_PROGRESS',
    rationale:
      'The district withdraws its submission before review — a self-correction, distinct ' +
      'from a rejection, and it leaves no verification result on the record.',
    guards: [],
  },
  {
    from: 'EVIDENCE_SUBMITTED',
    to: 'REVIEW',
    rationale: 'Submitted evidence is picked up by the named reviewer.',
    guards: [GUARDS.EVIDENCE_SUBMITTED, GUARDS.REVIEWER_NAMED],
  },
  {
    from: 'REVIEW',
    to: 'IN_PROGRESS',
    rationale:
      'The reviewer rejected the evidence. The action goes back to the owner with the ' +
      'reason recorded, which is why a NOT_CORRECTED result is required to make the move.',
    guards: [GUARDS.REVIEWER_NAMED, GUARDS.CORRECTION_REJECTED],
  },
  {
    from: 'REVIEW',
    to: 'VERIFIED',
    rationale: 'The reviewer accepted the evidence and recorded that correction occurred.',
    guards: [GUARDS.REVIEWER_NAMED, GUARDS.CORRECTION_VERIFIED],
  },
  {
    from: 'VERIFIED',
    to: 'CLOSED',
    rationale: 'Verified correction is closed out on a stated date, and stays closed.',
    guards: [GUARDS.CLOSURE_DATE_SET],
  },
];

const TRANSITIONS_BY_ORIGIN: ReadonlyMap<
  CorrectiveActionState,
  readonly CorrectiveActionTransition[]
> = new Map(
  CORRECTIVE_ACTION_STATES.map((state) => [
    state,
    CORRECTIVE_ACTION_TRANSITIONS.filter((candidate) => candidate.from === state),
  ]),
);

/** Every move permitted out of a state, guards included. */
export function permittedTransitionsFrom(
  state: CorrectiveActionState,
): readonly CorrectiveActionTransition[] {
  return TRANSITIONS_BY_ORIGIN.get(state) ?? [];
}

/**
 * Whether the shape of the machine allows this move at all, ignoring guards.
 *
 * Shape only, on purpose. A user interface asks this to decide which buttons exist; whether
 * a particular action may take the move right now is `transition`'s answer, because that
 * depends on the action's data.
 */
export function canTransition(from: CorrectiveActionState, to: CorrectiveActionState): boolean {
  return permittedTransitionsFrom(from).some((candidate) => candidate.to === to);
}

/** A state with no outgoing move. Derived from the table so the table stays authoritative. */
export function isTerminal(state: CorrectiveActionState): boolean {
  return permittedTransitionsFrom(state).length === 0;
}

/* ------------------------------------------------------------------- moving an action -- */

export const TRANSITION_REFUSAL_REASONS = [
  'SAME_STATE',
  'TERMINAL_STATE',
  'TRANSITION_NOT_PERMITTED',
  'GUARD_NOT_SATISFIED',
] as const;

export type TransitionRefusalReason = (typeof TRANSITION_REFUSAL_REASONS)[number];

export interface TransitionRefusal {
  readonly reason: TransitionRefusalReason;
  readonly from: CorrectiveActionState;
  readonly to: CorrectiveActionState;
  /** The guards that failed. Empty unless the reason is GUARD_NOT_SATISFIED. */
  readonly unsatisfiedGuards: readonly TransitionGuardId[];
  /** Plain language, safe to show the person who attempted the move. */
  readonly message: string;
}

/**
 * Success carries the new action; refusal carries the reason it was refused.
 *
 * A discriminated union rather than a thrown error or a null: refusing a move is an
 * ordinary, expected answer, and the caller has to render *why* to a district user.
 */
export type TransitionResult =
  | { readonly outcome: 'MOVED'; readonly action: CorrectiveAction }
  | { readonly outcome: 'REFUSED'; readonly refusal: TransitionRefusal };

function refuse(
  reason: TransitionRefusalReason,
  from: CorrectiveActionState,
  to: CorrectiveActionState,
  unsatisfiedGuards: readonly TransitionGuardId[],
  message: string,
): TransitionResult {
  return { outcome: 'REFUSED', refusal: { reason, from, to, unsatisfiedGuards, message } };
}

/**
 * Attempt to move an action to `to`.
 *
 * On success the input is left untouched and a new action is returned (invariant 4). The
 * caller supplies the fields a move needs — owner, evidence ids, verification result,
 * closure date — before attempting it; this function decides whether the move is allowed,
 * it does not fill anything in.
 *
 * A terminal state is checked before anything else, so an attempt to re-close a closed
 * action is reported as the terminal-state problem it is rather than as a no-op.
 */
export function transition(action: CorrectiveAction, to: CorrectiveActionState): TransitionResult {
  const from = action.state;

  if (isTerminal(from)) {
    return refuse(
      'TERMINAL_STATE',
      from,
      to,
      [],
      `A corrective action in ${from} is closed for good; a further correction is a new action.`,
    );
  }

  if (from === to) {
    return refuse('SAME_STATE', from, to, [], `The corrective action is already in ${from}.`);
  }

  const permitted = permittedTransitionsFrom(from).find((candidate) => candidate.to === to);
  if (permitted === undefined) {
    return refuse(
      'TRANSITION_NOT_PERMITTED',
      from,
      to,
      [],
      `A corrective action cannot move from ${from} to ${to}.`,
    );
  }

  const unsatisfied = permitted.guards.filter((guard) => !guard.isSatisfied(action));
  if (unsatisfied.length > 0) {
    return refuse(
      'GUARD_NOT_SATISFIED',
      from,
      to,
      unsatisfied.map((guard) => guard.id),
      `A corrective action cannot move from ${from} to ${to} until ` +
        `${unsatisfied.map((guard) => guard.requirement).join(', and ')}.`,
    );
  }

  return { outcome: 'MOVED', action: { ...action, state: to } };
}

/* ---------------------------------------------------------------------- the dashboard -- */

/** Section 16's "due within 30 days" panel line. Named so the window is not a magic number. */
export const DUE_SOON_WINDOW_DAYS = 30;

/** States in which the district has handed work back and is waiting on a reviewer. */
const AWAITING_VERIFICATION: ReadonlySet<CorrectiveActionState> = new Set<CorrectiveActionState>([
  'EVIDENCE_SUBMITTED',
  'REVIEW',
]);

/**
 * The section 16 dashboard counts.
 *
 * Every count is over *open* actions, because the panel is a work queue: a closed action is
 * not outstanding work, and a district that closed a critical action last term should not
 * still see it counted as critical.
 */
export interface CorrectiveActionSummary {
  readonly open: number;
  readonly critical: number;
  readonly dueWithin30Days: number;
  readonly awaitingVerification: number;
  readonly pastDue: number;
}

function isOpen(action: CorrectiveAction): boolean {
  return action.state !== 'CLOSED';
}

/**
 * Count open corrective actions as of a given calendar date.
 *
 * `asOf` is a parameter and never `new Date()`. A monitoring packet states the date it was
 * produced for and must produce the same numbers when regenerated a year later; a dashboard
 * that reads the clock can do neither, and cannot be tested.
 *
 * `dueWithin30Days` and `pastDue` are disjoint — an overdue action is counted once, as
 * overdue — so the panel's lines can be read side by side without double counting. The
 * window is inclusive at both ends: an action due today is due within thirty days, and an
 * action due on day thirty has not yet slipped.
 *
 * The buildout's sample panel labels its first line "open findings". This counts actions,
 * since one finding may carry several; a finding-level count is a roll-up over the distinct
 * targets of these actions and belongs to the caller that holds the findings.
 */
export function summarizeCorrectiveActions(
  actions: readonly CorrectiveAction[],
  asOf: CalendarDate,
): CorrectiveActionSummary {
  // Validate the reference date once, so an empty or all-undated list cannot let a
  // malformed `asOf` through unnoticed and produce a plausible-looking zeroed panel.
  diffDays(asOf, asOf);

  let open = 0;
  let critical = 0;
  let dueWithin30Days = 0;
  let awaitingVerification = 0;
  let pastDue = 0;

  for (const action of actions) {
    if (!isOpen(action)) continue;
    open += 1;
    if (action.severity === 'CRITICAL') critical += 1;
    if (AWAITING_VERIFICATION.has(action.state)) awaitingVerification += 1;

    const dueDate = action.dueDate;
    if (dueDate === undefined) continue;
    const daysRemaining = diffDays(asOf, dueDate);
    if (daysRemaining < 0) pastDue += 1;
    else if (daysRemaining <= DUE_SOON_WINDOW_DAYS) dueWithin30Days += 1;
  }

  return { open, critical, dueWithin30Days, awaitingVerification, pastDue };
}

/**
 * Actions at one remediation scope.
 *
 * Exists because "we corrected the individual cases" and "we corrected the practice that
 * produced them" are separate assurances, and a district asked for the second one must be
 * able to produce it without the first drowning it out.
 */
export function withRemediationScope(
  actions: readonly CorrectiveAction[],
  scope: RemediationScope,
): readonly CorrectiveAction[] {
  return actions.filter((action) => action.remediation.scope === scope);
}
