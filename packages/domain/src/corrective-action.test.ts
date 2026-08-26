/**
 * Behavioural tests for corrective action management.
 *
 * Spec: Master Technical Buildout section 16. These defend the shape of the machine as much
 * as its behaviour: that VERIFIED is only ever reached through review, that CLOSED is the
 * end, that a guard which stops an action advancing without evidence cannot be quietly
 * dropped from the table, and that the dashboard depends on nothing but its arguments.
 */

import { describe, expect, it } from 'vitest';
import {
  CORRECTIVE_ACTION_STATES,
  CORRECTIVE_ACTION_TRANSITIONS,
  DUE_SOON_WINDOW_DAYS,
  TRANSITION_GUARD_IDS,
  canTransition,
  isTerminal,
  permittedTransitionsFrom,
  summarizeCorrectiveActions,
  transition,
  withRemediationScope,
} from './corrective-action.js';
import type { CorrectiveAction, CorrectiveActionState } from './corrective-action.js';

const OWNER = { userId: 'user-owner', displayName: 'D. Owner' } as const;
const REVIEWER = { userId: 'user-reviewer', displayName: 'R. Reviewer' } as const;

/** A DRAFT with nothing supplied yet — the state every action starts in. */
const BARE_DRAFT: CorrectiveAction = {
  id: 'ca-1',
  tenantId: 'tenant-1',
  state: 'DRAFT',
  remediation: { scope: 'SYSTEMIC', practice: 'Excess cost worksheet', population: 'All schools' },
  target: { kind: 'FINDING', findingId: 'finding-1' },
  severity: 'HIGH',
  requestedEvidence: [{ id: 'req-1', description: 'Signed worksheet for FY2026' }],
  progressNotes: [],
  submittedEvidenceIds: [],
};

function action(overrides: Partial<CorrectiveAction>): CorrectiveAction {
  return { ...BARE_DRAFT, ...overrides };
}

/** Fails the test rather than returning a union, so the assertions below stay readable. */
function moved(result: ReturnType<typeof transition>): CorrectiveAction {
  if (result.outcome !== 'MOVED') {
    throw new Error(
      `expected the move to be allowed, but it was refused: ${result.refusal.message}`,
    );
  }
  return result.action;
}

function refusal(result: ReturnType<typeof transition>) {
  if (result.outcome !== 'REFUSED') {
    throw new Error(
      `expected the move to be refused, but the action reached ${result.action.state}`,
    );
  }
  return result.refusal;
}

describe('the transition table', () => {
  it('only ever names declared states', () => {
    const declared = new Set<string>(CORRECTIVE_ACTION_STATES);
    for (const edge of CORRECTIVE_ACTION_TRANSITIONS) {
      expect(declared.has(edge.from)).toBe(true);
      expect(declared.has(edge.to)).toBe(true);
    }
  });

  it('declares each move once, so no reader has to reconcile two rows', () => {
    const keys = CORRECTIVE_ACTION_TRANSITIONS.map((edge) => `${edge.from}->${edge.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('makes VERIFIED reachable only from REVIEW', () => {
    // Verification is a reviewer's act on submitted evidence. If a second path to VERIFIED
    // is ever added, this is where it has to be argued for.
    const intoVerified = CORRECTIVE_ACTION_TRANSITIONS.filter((edge) => edge.to === 'VERIFIED');
    expect(intoVerified).toHaveLength(1);
    expect(intoVerified[0]?.from).toBe('REVIEW');
    for (const state of CORRECTIVE_ACTION_STATES) {
      expect(canTransition(state, 'VERIFIED')).toBe(state === 'REVIEW');
    }
  });

  it('makes CLOSED the only terminal state', () => {
    for (const state of CORRECTIVE_ACTION_STATES) {
      expect(isTerminal(state)).toBe(state === 'CLOSED');
    }
    expect(permittedTransitionsFrom('CLOSED')).toHaveLength(0);
  });

  it('reaches every state from DRAFT', () => {
    // A state nobody can get to is a state that should not be in the enum.
    const seen = new Set<CorrectiveActionState>(['DRAFT']);
    const queue: CorrectiveActionState[] = ['DRAFT'];
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      for (const edge of permittedTransitionsFrom(next)) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
    expect([...seen].sort()).toEqual([...CORRECTIVE_ACTION_STATES].sort());
  });

  it('uses every declared guard, so a dead guard cannot masquerade as a control', () => {
    const used = new Set(
      CORRECTIVE_ACTION_TRANSITIONS.flatMap((edge) => edge.guards.map((guard) => guard.id)),
    );
    expect([...used].sort()).toEqual([...TRANSITION_GUARD_IDS].sort());
  });
});

describe('canTransition', () => {
  it('answers the shape of the machine, not whether a given action may move', () => {
    // The UI asks which buttons exist; guards decide whether pressing one works.
    expect(canTransition('DRAFT', 'ASSIGNED')).toBe(true);
    expect(canTransition('REVIEW', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('DRAFT', 'CLOSED')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'VERIFIED')).toBe(false);
    expect(canTransition('DRAFT', 'DRAFT')).toBe(false);
  });
});

describe('leaving DRAFT', () => {
  it('refuses an action with no owner and no due date, naming both requirements', () => {
    const result = transition(BARE_DRAFT, 'ASSIGNED');
    const refused = refusal(result);
    expect(refused.reason).toBe('GUARD_NOT_SATISFIED');
    expect(refused.unsatisfiedGuards).toEqual(['OWNER_NAMED', 'DUE_DATE_SET']);
    expect(refused.message).toContain('an owner is named');
    expect(refused.message).toContain('a due date is set');
  });

  it('still refuses when only one of the two is supplied', () => {
    expect(refusal(transition(action({ owner: OWNER }), 'ASSIGNED')).unsatisfiedGuards).toEqual([
      'DUE_DATE_SET',
    ]);
    expect(
      refusal(transition(action({ dueDate: '2026-09-30' }), 'ASSIGNED')).unsatisfiedGuards,
    ).toEqual(['OWNER_NAMED']);
  });

  it('allows the move once the action is owned and due', () => {
    const assigned = moved(transition(action({ owner: OWNER, dueDate: '2026-09-30' }), 'ASSIGNED'));
    expect(assigned.state).toBe('ASSIGNED');
  });
});

describe('submitting evidence', () => {
  const inProgress = action({ state: 'IN_PROGRESS', owner: OWNER, dueDate: '2026-09-30' });

  it('refuses EVIDENCE_SUBMITTED when nothing has been submitted', () => {
    const refused = refusal(transition(inProgress, 'EVIDENCE_SUBMITTED'));
    expect(refused.unsatisfiedGuards).toEqual(['EVIDENCE_SUBMITTED']);
  });

  it('does not accept a request for evidence as evidence', () => {
    // requestedEvidence is what was asked for; only submittedEvidenceIds is proof.
    expect(inProgress.requestedEvidence.length).toBeGreaterThan(0);
    expect(refusal(transition(inProgress, 'EVIDENCE_SUBMITTED')).reason).toBe(
      'GUARD_NOT_SATISFIED',
    );
  });

  it('allows the move once an evidence id is attached', () => {
    const submitted = moved(
      transition({ ...inProgress, submittedEvidenceIds: ['evidence-1'] }, 'EVIDENCE_SUBMITTED'),
    );
    expect(submitted.state).toBe('EVIDENCE_SUBMITTED');
  });

  it('requires a reviewer before the submission can enter REVIEW', () => {
    const submitted = action({
      state: 'EVIDENCE_SUBMITTED',
      owner: OWNER,
      dueDate: '2026-09-30',
      submittedEvidenceIds: ['evidence-1'],
    });
    expect(refusal(transition(submitted, 'REVIEW')).unsatisfiedGuards).toEqual(['REVIEWER_NAMED']);
    expect(moved(transition({ ...submitted, reviewer: REVIEWER }, 'REVIEW')).state).toBe('REVIEW');
  });
});

describe('review', () => {
  const inReview = action({
    state: 'REVIEW',
    owner: OWNER,
    dueDate: '2026-09-30',
    submittedEvidenceIds: ['evidence-1'],
    reviewer: REVIEWER,
  });

  it('refuses VERIFIED with no verification result on file', () => {
    expect(refusal(transition(inReview, 'VERIFIED')).unsatisfiedGuards).toEqual([
      'CORRECTION_VERIFIED',
    ]);
  });

  it('refuses VERIFIED with no reviewer, even when a result somehow exists', () => {
    const unreviewed = action({
      state: 'REVIEW',
      owner: OWNER,
      dueDate: '2026-09-30',
      submittedEvidenceIds: ['evidence-1'],
      verification: { outcome: 'CORRECTED', decidedOn: '2026-08-01', narrative: 'Worksheet ok' },
    });
    expect(refusal(transition(unreviewed, 'VERIFIED')).unsatisfiedGuards).toEqual([
      'REVIEWER_NAMED',
    ]);
  });

  it('refuses VERIFIED when the reviewer concluded the correction was not made', () => {
    // The guard reads the outcome, not merely the presence of a verification record: a
    // rejected submission must never be able to close as corrected.
    const rejected = {
      ...inReview,
      verification: {
        outcome: 'NOT_CORRECTED',
        decidedOn: '2026-08-01',
        narrative: 'Worksheet unsigned',
      },
    } as const;
    expect(refusal(transition(rejected, 'VERIFIED')).unsatisfiedGuards).toEqual([
      'CORRECTION_VERIFIED',
    ]);
  });

  it('sends a rejected submission back to IN_PROGRESS — a backward move is normal', () => {
    const rejected = {
      ...inReview,
      verification: {
        outcome: 'NOT_CORRECTED',
        decidedOn: '2026-08-01',
        narrative: 'Worksheet unsigned',
      },
    } as const;
    expect(moved(transition(rejected, 'IN_PROGRESS')).state).toBe('IN_PROGRESS');
  });

  it('will not send an action back to IN_PROGRESS without recording why', () => {
    expect(refusal(transition(inReview, 'IN_PROGRESS')).unsatisfiedGuards).toEqual([
      'CORRECTION_REJECTED',
    ]);
  });

  it('verifies when the reviewer recorded a correction', () => {
    const accepted = {
      ...inReview,
      verification: {
        outcome: 'CORRECTED',
        decidedOn: '2026-08-01',
        narrative: 'Signed worksheet received',
      },
    } as const;
    expect(moved(transition(accepted, 'VERIFIED')).state).toBe('VERIFIED');
  });
});

describe('closing', () => {
  const verified = action({
    state: 'VERIFIED',
    owner: OWNER,
    dueDate: '2026-09-30',
    submittedEvidenceIds: ['evidence-1'],
    reviewer: REVIEWER,
    verification: { outcome: 'CORRECTED', decidedOn: '2026-08-01', narrative: 'Received' },
  });

  it('requires a closure date', () => {
    expect(refusal(transition(verified, 'CLOSED')).unsatisfiedGuards).toEqual(['CLOSURE_DATE_SET']);
  });

  it('closes with one', () => {
    expect(moved(transition({ ...verified, closureDate: '2026-08-05' }, 'CLOSED')).state).toBe(
      'CLOSED',
    );
  });

  it('is terminal: no state, including CLOSED itself, can be reached from CLOSED', () => {
    const closed = { ...verified, state: 'CLOSED', closureDate: '2026-08-05' } as const;
    for (const state of CORRECTIVE_ACTION_STATES) {
      const refused = refusal(transition(closed, state));
      expect(refused.reason).toBe('TERMINAL_STATE');
      expect(refused.message).toContain('a further correction is a new action');
    }
  });
});

describe('transition refusals in general', () => {
  it('distinguishes an unreachable move from an unmet requirement', () => {
    const draft = action({ owner: OWNER, dueDate: '2026-09-30' });
    const refused = refusal(transition(draft, 'VERIFIED'));
    expect(refused.reason).toBe('TRANSITION_NOT_PERMITTED');
    expect(refused.unsatisfiedGuards).toEqual([]);
    expect(refused.from).toBe('DRAFT');
    expect(refused.to).toBe('VERIFIED');
  });

  it('reports a move to the current state as SAME_STATE, not as a failure to satisfy guards', () => {
    // A re-posted request should be recognisable as a no-op by the caller.
    const refused = refusal(transition(BARE_DRAFT, 'DRAFT'));
    expect(refused.reason).toBe('SAME_STATE');
  });

  it('leaves the input untouched on success (finalized state is never rewritten in place)', () => {
    const draft = action({ owner: OWNER, dueDate: '2026-09-30' });
    const result = moved(transition(draft, 'ASSIGNED'));
    expect(draft.state).toBe('DRAFT');
    expect(result).not.toBe(draft);
    expect(result.owner).toBe(OWNER);
  });
});

describe('remediation scope', () => {
  const childSpecific = action({
    id: 'ca-child',
    remediation: { scope: 'CHILD_SPECIFIC', caseReference: 'case-7f3a' },
  });

  it('separates systemic correction from child-specific correction', () => {
    const all = [BARE_DRAFT, childSpecific];
    expect(withRemediationScope(all, 'SYSTEMIC').map((a) => a.id)).toEqual(['ca-1']);
    expect(withRemediationScope(all, 'CHILD_SPECIFIC').map((a) => a.id)).toEqual(['ca-child']);
  });

  it('identifies a child-specific case by pseudonymous reference only', () => {
    // Invariant 10. The field exists to point at a case record, not to name a child.
    expect(childSpecific.remediation).toEqual({
      scope: 'CHILD_SPECIFIC',
      caseReference: 'case-7f3a',
    });
  });
});

describe('summarizeCorrectiveActions', () => {
  const AS_OF = '2026-06-30';

  function dated(
    id: string,
    state: CorrectiveActionState,
    dueDate: string | undefined,
    severity: CorrectiveAction['severity'] = 'MEDIUM',
  ): CorrectiveAction {
    const base = action({ id, state, owner: OWNER, severity });
    return dueDate === undefined ? base : { ...base, dueDate };
  }

  it('counts nothing for an empty list', () => {
    expect(summarizeCorrectiveActions([], AS_OF)).toEqual({
      open: 0,
      critical: 0,
      dueWithin30Days: 0,
      awaitingVerification: 0,
      pastDue: 0,
    });
  });

  it('produces the section 16 panel', () => {
    const actions = [
      dated('a', 'IN_PROGRESS', '2026-07-15', 'CRITICAL'),
      dated('b', 'ASSIGNED', '2026-06-01'),
      dated('c', 'EVIDENCE_SUBMITTED', '2026-08-31', 'CRITICAL'),
      dated('d', 'REVIEW', '2026-07-30'),
      dated('e', 'VERIFIED', undefined),
      dated('f', 'CLOSED', '2026-05-01', 'CRITICAL'),
    ];
    expect(summarizeCorrectiveActions(actions, AS_OF)).toEqual({
      open: 5,
      critical: 2,
      dueWithin30Days: 2,
      awaitingVerification: 2,
      pastDue: 1,
    });
  });

  it('excludes closed actions from every count, including critical', () => {
    const closed = dated('closed', 'CLOSED', '2026-01-01', 'CRITICAL');
    expect(summarizeCorrectiveActions([closed], AS_OF)).toEqual({
      open: 0,
      critical: 0,
      dueWithin30Days: 0,
      awaitingVerification: 0,
      pastDue: 0,
    });
  });

  it('counts an overdue action as past due only, never also as due soon', () => {
    const summary = summarizeCorrectiveActions([dated('a', 'IN_PROGRESS', '2026-06-29')], AS_OF);
    expect(summary.pastDue).toBe(1);
    expect(summary.dueWithin30Days).toBe(0);
  });

  it('treats the window as inclusive at both ends', () => {
    expect(DUE_SOON_WINDOW_DAYS).toBe(30);
    // Due today is due within thirty days; day thirty has not slipped; day thirty-one is
    // outside the panel entirely.
    const summary = summarizeCorrectiveActions(
      [
        dated('today', 'IN_PROGRESS', '2026-06-30'),
        dated('day-30', 'IN_PROGRESS', '2026-07-30'),
        dated('day-31', 'IN_PROGRESS', '2026-07-31'),
      ],
      AS_OF,
    );
    expect(summary.dueWithin30Days).toBe(2);
    expect(summary.open).toBe(3);
    expect(summary.pastDue).toBe(0);
  });

  it('counts calendar days exactly across a daylight-saving boundary', () => {
    // A deadline is a date, not 30 * 24 hours (invariant 6). Local-time arithmetic across
    // a spring-forward would make the thirty-first day look like the thirtieth.
    const summary = summarizeCorrectiveActions(
      [dated('day-30', 'IN_PROGRESS', '2026-04-07'), dated('day-31', 'IN_PROGRESS', '2026-04-08')],
      '2026-03-08',
    );
    expect(summary.dueWithin30Days).toBe(1);
  });

  it('counts an undated open action as open but never as due or overdue', () => {
    const summary = summarizeCorrectiveActions([dated('a', 'DRAFT', undefined)], AS_OF);
    expect(summary).toEqual({
      open: 1,
      critical: 0,
      dueWithin30Days: 0,
      awaitingVerification: 0,
      pastDue: 0,
    });
  });

  it('treats EVIDENCE_SUBMITTED and REVIEW as awaiting verification, and nothing else', () => {
    for (const state of CORRECTIVE_ACTION_STATES) {
      const summary = summarizeCorrectiveActions([dated('a', state, undefined)], AS_OF);
      const awaiting = state === 'EVIDENCE_SUBMITTED' || state === 'REVIEW';
      expect(summary.awaitingVerification).toBe(awaiting ? 1 : 0);
    }
  });

  it('depends on nothing but its arguments', () => {
    // Same inputs, same panel — the property that makes a monitoring packet reproducible.
    const actions = [
      dated('a', 'IN_PROGRESS', '2026-07-15', 'CRITICAL'),
      dated('b', 'REVIEW', '2026-05-15'),
    ];
    expect(summarizeCorrectiveActions(actions, AS_OF)).toEqual(
      summarizeCorrectiveActions(actions, AS_OF),
    );
    // And a different reference date is a different panel, not a different clock reading.
    expect(summarizeCorrectiveActions(actions, '2026-08-01').pastDue).toBe(2);
  });

  it('rejects a malformed reference date rather than producing a plausible panel', () => {
    expect(() => summarizeCorrectiveActions([], '30/06/2026')).toThrow(/calendar date/);
    expect(() => summarizeCorrectiveActions([], '2026-06-30T00:00:00Z')).toThrow(/calendar date/);
    // Two digits would silently mean 1926 through Date.UTC; four digits are required and
    // the round-trip check catches the rest.
    expect(() => summarizeCorrectiveActions([], '0026-06-30')).toThrow(/outside the range/);
  });

  it('rejects an impossible due date rather than shifting it into March', () => {
    expect(() => summarizeCorrectiveActions([dated('a', 'DRAFT', '2026-02-30')], AS_OF)).toThrow(
      /does not exist/,
    );
  });
});
