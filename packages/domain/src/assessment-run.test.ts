import { describe, expect, it } from 'vitest';
import {
  ImmutableRunError,
  actualRunsOnly,
  compareFindingSets,
  compareRuns,
  finalizationRefusals,
  finalizeRun,
  findingKey,
  freezeRun,
  isReproducibleSnapshot,
  withDataSnapshot,
  withStatus,
} from './assessment-run.js';
import type {
  AssessmentRun,
  ComparableFinding,
  DataSnapshotRef,
  FinalizeRefusalCode,
  FinalizeResult,
} from './assessment-run.js';
import type { EvaluationStatus } from './evaluation.js';

function run(overrides: Partial<AssessmentRun> = {}): AssessmentRun {
  return freezeRun({
    id: 'run_2028_03_01',
    tenantId: 'ten_01',
    organizationId: 'org_district_7',
    moduleId: 'IDEA_FISCAL',
    scope: { type: 'ORGANIZATION', ids: ['org_district_7'] },
    programYear: { kind: 'FISCAL', label: 'FY2028' },
    rulePackId: 'federal.idea.fiscal',
    rulePackVersion: '3.1.0',
    engineVersion: 'engine@1.4.2',
    dataSnapshotId: 'snap_2028_03_01',
    runTimestamp: '2028-03-01T14:02:11.000Z',
    requestedBy: 'usr_42',
    status: 'COMPLETED',
    kind: 'ACTUAL',
    ...overrides,
  });
}

function snapshot(overrides: Partial<DataSnapshotRef> = {}): DataSnapshotRef {
  return {
    id: 'snap_2028_03_01',
    contentHash: 'sha256:1f0c...',
    factVersions: [{ factType: 'moe_expenditure', factId: 'fct_9001', version: '4' }],
    createdAt: '2028-03-01T13:59:00.000Z',
    ...overrides,
  };
}

function finding(
  ruleId: string,
  subjectId: string,
  systemStatus: EvaluationStatus = 'FAIL',
): ComparableFinding {
  return { ruleId, subject: { type: 'FISCAL_YEAR', id: subjectId }, systemStatus };
}

function refusalCodes(result: FinalizeResult): readonly FinalizeRefusalCode[] {
  return result.ok ? [] : result.refusals.map((refusal) => refusal.code);
}

function finalized(): AssessmentRun {
  const result = finalizeRun(run());
  if (!result.ok) throw new Error(`expected finalization to succeed: ${JSON.stringify(result)}`);
  return result.run;
}

describe('freezeRun', () => {
  it('freezes the run and its nested scope, because readonly does not survive to runtime', () => {
    const frozen = run();

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.scope)).toBe(true);
    expect(Object.isFrozen(frozen.scope.ids)).toBe(true);
    expect(Object.isFrozen(frozen.programYear)).toBe(true);
  });

  it('copies the scope rather than freezing the object the caller passed in', () => {
    const ids = ['org_district_7'];
    const scope = { type: 'ORGANIZATION', ids } as const;
    freezeRun(run({ scope }));

    expect(Object.isFrozen(ids)).toBe(false);
  });
});

describe('assertMutable', () => {
  it('permits changes to a run that has not been finalized', () => {
    expect(() => withStatus(run({ status: 'PENDING' }), 'RUNNING')).not.toThrow();
    expect(() => withStatus(run({ status: 'RUNNING' }), 'COMPLETED')).not.toThrow();
    expect(() => withDataSnapshot(run({ status: 'PENDING' }), snapshot())).not.toThrow();
  });

  it('refuses every change to a FINALIZED run and points the caller at a new run', () => {
    const official = finalized();

    let thrown: unknown;
    try {
      withStatus(official, 'RUNNING');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ImmutableRunError);
    expect((thrown as ImmutableRunError).runId).toBe(official.id);
    expect((thrown as ImmutableRunError).message).toContain('FINALIZED');
    expect((thrown as ImmutableRunError).message).toContain('NEW assessment run');
  });

  it('refuses a change that would be a no-op, because the rule is about the run not the delta', () => {
    expect(() => withStatus(finalized(), 'FINALIZED')).toThrow(ImmutableRunError);
  });

  it('refuses to re-pin the data snapshot of a finalized run', () => {
    expect(() => withDataSnapshot(finalized(), snapshot({ id: 'snap_other' }))).toThrow(
      ImmutableRunError,
    );
  });
});

describe('withStatus', () => {
  it('advances a run through its lifecycle without mutating the previous object', () => {
    const pending = run({ status: 'PENDING' });
    const running = withStatus(pending, 'RUNNING');

    expect(running.status).toBe('RUNNING');
    expect(pending.status).toBe('PENDING');
    expect(Object.isFrozen(running)).toBe(true);
    expect(withStatus(running, 'COMPLETED').status).toBe('COMPLETED');
  });

  it('refuses to move a run backwards', () => {
    expect(() => withStatus(run({ status: 'RUNNING' }), 'PENDING')).toThrow(
      /Illegal assessment run transition RUNNING -> PENDING/,
    );
  });

  it('treats FAILED as terminal, because a failed run is replaced rather than resumed', () => {
    expect(() => withStatus(run({ status: 'FAILED' }), 'RUNNING')).toThrow(/Illegal/);
    expect(() => withStatus(run({ status: 'FAILED' }), 'COMPLETED')).toThrow(/Illegal/);
  });

  it('will not set FINALIZED directly, so finalization preconditions cannot be bypassed', () => {
    // A SCENARIO run that could reach FINALIZED through this door would become an official
    // result without ever passing the section 12.2 check in finalizeRun.
    expect(() => withStatus(run({ status: 'COMPLETED', kind: 'SCENARIO' }), 'FINALIZED')).toThrow(
      /call finalizeRun instead/,
    );
  });
});

describe('withDataSnapshot', () => {
  it('pins a snapshot while the run is still PENDING', () => {
    const pinned = withDataSnapshot(
      run({ status: 'PENDING', dataSnapshotId: undefined }),
      snapshot(),
    );

    expect(pinned.dataSnapshotId).toBe('snap_2028_03_01');
  });

  it('refuses to re-pin once evaluation has started, so inputs and results cannot disagree', () => {
    expect(() => withDataSnapshot(run({ status: 'RUNNING' }), snapshot({ id: 'snap_b' }))).toThrow(
      /the run is RUNNING/,
    );
    expect(() =>
      withDataSnapshot(run({ status: 'COMPLETED' }), snapshot({ id: 'snap_b' })),
    ).toThrow(/the run is COMPLETED/);
  });

  it('refuses a snapshot that pins nothing, because the run could not be reproduced', () => {
    const empty = snapshot({ factVersions: [] });

    expect(isReproducibleSnapshot(empty)).toBe(false);
    expect(() => withDataSnapshot(run({ status: 'PENDING' }), empty)).toThrow(/reproduced/);
  });

  it('refuses a snapshot with no content hash', () => {
    expect(isReproducibleSnapshot(snapshot({ contentHash: '   ' }))).toBe(false);
  });
});

describe('finalizeRun', () => {
  it('finalizes a completed, fully pinned actual run', () => {
    const result = finalizeRun(run());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.status).toBe('FINALIZED');
    expect(Object.isFrozen(result.run)).toBe(true);
  });

  it('returns a new run and leaves the argument untouched (invariant 4)', () => {
    const completed = run();
    const result = finalizeRun(completed);

    expect(completed.status).toBe('COMPLETED');
    expect(result.ok && result.run).not.toBe(completed);
  });

  it('only finalizes from COMPLETED', () => {
    for (const status of ['PENDING', 'RUNNING', 'FAILED'] as const) {
      expect(refusalCodes(finalizeRun(run({ status })))).toContain('NOT_COMPLETED');
    }
  });

  it('refuses to finalize a run twice', () => {
    const result = finalizeRun(finalized());

    expect(refusalCodes(result)).toContain('NOT_COMPLETED');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals.map((refusal) => refusal.message).join(' ')).toContain(
      'already been finalized',
    );
  });

  it('refuses a run with no pinned snapshot, present-but-blank included', () => {
    expect(refusalCodes(finalizeRun(run({ dataSnapshotId: undefined })))).toContain(
      'NO_DATA_SNAPSHOT',
    );
    expect(refusalCodes(finalizeRun(run({ dataSnapshotId: '   ' })))).toContain('NO_DATA_SNAPSHOT');
  });

  it('refuses a run that does not name the rule-pack version or the engine version', () => {
    expect(refusalCodes(finalizeRun(run({ rulePackVersion: '' })))).toContain(
      'NO_RULE_PACK_VERSION',
    );
    expect(refusalCodes(finalizeRun(run({ engineVersion: '' })))).toContain('NO_ENGINE_VERSION');
  });

  it('reports every reason at once rather than the first', () => {
    const codes = refusalCodes(
      finalizeRun(run({ status: 'RUNNING', dataSnapshotId: undefined, rulePackVersion: '' })),
    );

    expect(codes).toEqual(
      expect.arrayContaining(['NOT_COMPLETED', 'NO_DATA_SNAPSHOT', 'NO_RULE_PACK_VERSION']),
    );
  });

  it('never finalizes a SCENARIO run as an official assessment (section 12.2)', () => {
    const scenario = run({ kind: 'SCENARIO' });
    const result = finalizeRun(scenario);

    expect(result.ok).toBe(false);
    expect(refusalCodes(result)).toContain('SCENARIO_RUN');
  });

  it('refuses a scenario run even when it is otherwise perfectly finalizable', () => {
    // Same run, same snapshot, same pack version; the only difference is the kind.
    expect(finalizeRun(run({ kind: 'ACTUAL' })).ok).toBe(true);
    expect(finalizeRun(run({ kind: 'SCENARIO' })).ok).toBe(false);
  });
});

describe('finalizationRefusals', () => {
  it('is empty for a finalizable run, so a screen can ask before it offers the button', () => {
    expect(finalizationRefusals(run())).toEqual([]);
  });

  it('explains each refusal in words a district administrator can act on', () => {
    const refusals = finalizationRefusals(run({ status: 'RUNNING', dataSnapshotId: undefined }));

    expect(refusals.map((refusal) => refusal.message).join(' ')).toContain(
      'no pinned data snapshot',
    );
    expect(refusals.every((refusal) => refusal.message.includes(run().id))).toBe(true);
  });
});

describe('actualRunsOnly', () => {
  it('removes scenario runs from a set bound for compliance reporting', () => {
    const runs = [
      run({ id: 'run_a', kind: 'ACTUAL' }),
      run({ id: 'run_b', kind: 'SCENARIO' }),
      run({ id: 'run_c', kind: 'ACTUAL' }),
    ];

    expect(actualRunsOnly(runs).map((each) => each.id)).toEqual(['run_a', 'run_c']);
  });

  it('returns nothing when every run is a scenario, rather than falling back to all of them', () => {
    expect(actualRunsOnly([run({ kind: 'SCENARIO' })])).toEqual([]);
    expect(actualRunsOnly([])).toEqual([]);
  });
});

describe('findingKey', () => {
  it('is stable across runs for the same rule and subject', () => {
    expect(findingKey(finding('idea.moe.eligibility', 'fy2028', 'FAIL'))).toBe(
      findingKey(finding('idea.moe.eligibility', 'fy2028', 'PASS')),
    );
  });

  it('separates findings whose identifiers contain the delimiter', () => {
    const a: ComparableFinding = {
      ruleId: 'rule',
      subject: { type: 'FEDERAL_AWARD', id: 'x|y' },
      systemStatus: 'FAIL',
    };
    const b: ComparableFinding = {
      ruleId: 'rule',
      subject: { type: 'FEDERAL_AWARD|x', id: 'y' },
      systemStatus: 'FAIL',
    };

    expect(findingKey(a)).not.toBe(findingKey(b));
  });
});

describe('compareFindingSets', () => {
  it('reproduces the section 11 worked example', () => {
    // 11 previous, of which 4 persist and 7 are resolved; 2 new. Current total 6.
    const persisting = [0, 1, 2, 3].map((n) => finding('rule.persist', `subject_${n}`));
    const previous = [
      ...persisting,
      ...[0, 1, 2, 3, 4, 5, 6].map((n) => finding('rule.gone', `subject_${n}`)),
    ];
    const current = [...persisting, ...[0, 1].map((n) => finding('rule.new', `subject_${n}`))];

    const comparison = compareFindingSets(previous, current);

    expect(comparison.counts).toEqual({
      previousTotal: 11,
      currentTotal: 6,
      resolved: 7,
      newlyDetected: 2,
      unchanged: 4,
      statusChanged: 0,
    });
  });

  it('keeps the totals reconcilable: previous = resolved + unchanged, current = new + unchanged', () => {
    const previous = [finding('r.a', 's1'), finding('r.b', 's2'), finding('r.c', 's3')];
    const current = [finding('r.b', 's2'), finding('r.d', 's4'), finding('r.e', 's5')];

    const { counts } = compareFindingSets(previous, current);

    expect(counts.previousTotal).toBe(counts.resolved + counts.unchanged);
    expect(counts.currentTotal).toBe(counts.newlyDetected + counts.unchanged);
  });

  it('counts a status flip as unchanged in existence and changed in status', () => {
    const previous = [finding('idea.moe.eligibility', 'fy2028', 'RISK')];
    const current = [finding('idea.moe.eligibility', 'fy2028', 'FAIL')];

    const comparison = compareFindingSets(previous, current);

    expect(comparison.counts.unchanged).toBe(1);
    expect(comparison.counts.statusChanged).toBe(1);
    expect(comparison.counts.resolved).toBe(0);
    expect(comparison.counts.newlyDetected).toBe(0);
    expect(comparison.statusChanged).toEqual([
      {
        key: findingKey(finding('idea.moe.eligibility', 'fy2028')),
        ruleId: 'idea.moe.eligibility',
        subject: { type: 'FISCAL_YEAR', id: 'fy2028' },
        previousStatus: 'RISK',
        currentStatus: 'FAIL',
      },
    ]);
  });

  it('does not report a status flip as a resolution, even when the flip improves things', () => {
    // A FAIL that becomes INDETERMINATE has not been fixed; the data stopped answering.
    const comparison = compareFindingSets(
      [finding('idea.excess_cost', 'fy2028', 'FAIL')],
      [finding('idea.excess_cost', 'fy2028', 'INDETERMINATE')],
    );

    expect(comparison.counts.resolved).toBe(0);
    expect(comparison.counts.statusChanged).toBe(1);
  });

  it('reports nothing changed when the two runs agree exactly', () => {
    const findings = [finding('r.a', 's1', 'PASS'), finding('r.b', 's2', 'FAIL')];

    const { counts } = compareFindingSets(findings, findings);

    expect(counts).toEqual({
      previousTotal: 2,
      currentTotal: 2,
      resolved: 0,
      newlyDetected: 0,
      unchanged: 2,
      statusChanged: 0,
    });
  });

  it('treats a first run as all new and an emptied run as all resolved', () => {
    const findings = [finding('r.a', 's1'), finding('r.b', 's2')];

    expect(compareFindingSets([], findings).counts.newlyDetected).toBe(2);
    expect(compareFindingSets(findings, []).counts.resolved).toBe(2);
    expect(compareFindingSets([], []).counts.previousTotal).toBe(0);
  });

  it('distinguishes the same rule against different subjects', () => {
    const comparison = compareFindingSets(
      [finding('idea.moe.eligibility', 'fy2027')],
      [finding('idea.moe.eligibility', 'fy2028')],
    );

    expect(comparison.counts.resolved).toBe(1);
    expect(comparison.counts.newlyDetected).toBe(1);
    expect(comparison.counts.unchanged).toBe(0);
  });

  it('carries a previous status and no current status for a resolved finding', () => {
    const comparison = compareFindingSets([finding('r.a', 's1', 'FAIL')], []);

    expect(comparison.resolved).toEqual([
      {
        key: findingKey(finding('r.a', 's1')),
        ruleId: 'r.a',
        subject: { type: 'FISCAL_YEAR', id: 's1' },
        previousStatus: 'FAIL',
        currentStatus: undefined,
      },
    ]);
  });

  it('refuses an ambiguous set rather than silently dropping a duplicate', () => {
    const duplicated = [finding('r.a', 's1', 'FAIL'), finding('r.a', 's1', 'PASS')];

    expect(() => compareFindingSets(duplicated, [])).toThrow(/previous finding set/);
    expect(() => compareFindingSets([], duplicated)).toThrow(/current finding set/);
  });

  it('orders resolved and persisted by the previous run, new by the current run', () => {
    const previous = [finding('r.b', 's2'), finding('r.a', 's1')];
    const current = [finding('r.a', 's1'), finding('r.z', 's9'), finding('r.m', 's5')];

    const comparison = compareFindingSets(previous, current);

    expect(comparison.resolved.map((each) => each.ruleId)).toEqual(['r.b']);
    expect(comparison.newlyDetected.map((each) => each.ruleId)).toEqual(['r.z', 'r.m']);
  });
});

describe('compareRuns', () => {
  const previousRun = run({ id: 'run_jan', status: 'FINALIZED' });
  const currentRun = run({ id: 'run_feb', status: 'COMPLETED' });

  it('names both runs and reports the diff', () => {
    const report = compareRuns(
      { run: previousRun, findings: [finding('r.a', 's1')] },
      { run: currentRun, findings: [finding('r.b', 's2')] },
    );

    expect(report.previousRunId).toBe('run_jan');
    expect(report.currentRunId).toBe('run_feb');
    expect(report.involvesScenario).toBe(false);
    expect(report.counts.resolved).toBe(1);
    expect(report.counts.newlyDetected).toBe(1);
  });

  it('flags a comparison that involves a scenario run so a report cannot present it as actual', () => {
    const report = compareRuns(
      { run: previousRun, findings: [] },
      { run: run({ id: 'run_what_if', kind: 'SCENARIO' }), findings: [] },
    );

    expect(report.involvesScenario).toBe(true);
  });

  it('refuses to compare across tenants, organizations or modules', () => {
    expect(() =>
      compareRuns(
        { run: previousRun, findings: [] },
        { run: run({ tenantId: 'ten_02' }), findings: [] },
      ),
    ).toThrow(/different tenants/);

    expect(() =>
      compareRuns(
        { run: previousRun, findings: [] },
        { run: run({ organizationId: 'org_district_9' }), findings: [] },
      ),
    ).toThrow(/different organizations/);

    expect(() =>
      compareRuns(
        { run: previousRun, findings: [] },
        { run: run({ moduleId: 'DISPROPORTIONALITY' }), findings: [] },
      ),
    ).toThrow(/different modules/);
  });

  it('allows a year-over-year comparison', () => {
    expect(() =>
      compareRuns(
        {
          run: run({ id: 'run_fy27', programYear: { kind: 'FISCAL', label: 'FY2027' } }),
          findings: [],
        },
        { run: currentRun, findings: [] },
      ),
    ).not.toThrow();
  });

  it('refuses a run whose finding set is not a complete answer', () => {
    for (const status of ['PENDING', 'RUNNING', 'FAILED'] as const) {
      expect(() =>
        compareRuns({ run: run({ status }), findings: [] }, { run: currentRun, findings: [] }),
      ).toThrow(/not a complete answer/);
    }
  });
});
