/**
 * A determination carried into the next year has to be the one that was made.
 *
 * These are attacks, not edge cases. 34 CFR 300.203(c) exists so that a year in which an LEA
 * failed to maintain effort cannot lower the following year's bar; the carry-forward is the
 * mechanism by which the platform applies it, and every test here is a way of getting a
 * favourable prior year into a run that never happened.
 */

import { describe, expect, it } from 'vitest';
import { isDeterminationProvenance } from '@complianceos/ingest';
import { computeEvaluationHash, type EvaluationResult } from '@complianceos/rules-engine';
import { carryForward, CarryForwardError, verifyCarriedForward } from './carry-forward.js';

function priorResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  const withoutHash = {
    tenantId: 'tenant_a',
    organizationId: 'LEA-1',
    subjectType: 'lea_fiscal_year',
    subjectId: 'LEA-1:2025',
    dataSnapshotId: 'snap_2025',
    engineVersion: '0.1.0',
    ruleId: 'IDEA-MOE-COMPLIANCE-001',
    ruleTitle: 'Maintenance of effort',
    ruleLifecycle: 'ACTIVE',
    pack: { packId: 'US-FED-IDEA-B-2026', version: '0.1.0', layer: 'FEDERAL' as const },
    authority: { citation: '34 CFR 300.203(b)', sourceId: 'src' },
    computedInputs: { current_actual_local: '4900000.00' },
    status: 'PASS' as const,
    severityOnFailure: 'CRITICAL' as const,
    output: { moeStatus: 'MET', qualifyingMethods: ['LOCAL_ONLY'] },
    steps: [],
    warnings: [],
    missingInputs: [],
    notes: [],
    explanation: 'Result: PASS.',
    ...overrides,
  };
  return {
    ...withoutHash,
    assessmentRunId: 'RUN-2025-0001',
    evaluatedAt: '2025-09-15T00:00:00.000Z',
    evaluationHash: computeEvaluationHash(withoutHash),
  };
}

const SUBJECT = {
  subjectType: 'lea_fiscal_year',
  subjectId: 'LEA-1:2026',
  classification: 'CONFIDENTIAL',
} as const;

describe('carryForward', () => {
  it('takes the value from the determination rather than from the caller', () => {
    const result = priorResult();
    const fact = carryForward({
      ...SUBJECT,
      result,
      field: 'comparison_year_moe_status',
      derivedFrom: 'output.moeStatus',
    });

    // There is no parameter for the value. That is the whole design: a fact cannot claim a
    // status the run it cites did not reach.
    expect(fact.value).toBe('MET');
    expect(fact.origin).toBe('PLATFORM_DETERMINATION');
  });

  it('stamps the prior computation’s own identity onto the fact', () => {
    const result = priorResult();
    const fact = carryForward({
      ...SUBJECT,
      result,
      field: 'comparison_year_moe_status',
      derivedFrom: 'output.moeStatus',
    });

    if (!isDeterminationProvenance(fact.provenance)) throw new Error('wrong provenance shape');
    expect(fact.provenance.assessmentRunId).toBe('RUN-2025-0001');
    expect(fact.provenance.evaluationHash).toBe(result.evaluationHash);
    expect(fact.provenance.dataSnapshotId).toBe('snap_2025');
    expect(fact.provenance.derivedFrom).toBe('output.moeStatus');
    // No spreadsheet fields, because there is no spreadsheet.
    expect(Object.keys(fact.provenance)).not.toContain('sourceRow');
  });

  it('carries a list output whole', () => {
    const fact = carryForward({
      ...SUBJECT,
      result: priorResult(),
      field: 'comparison_year_methods_met',
      derivedFrom: 'output.qualifyingMethods',
    });
    expect(fact.value).toEqual(['LOCAL_ONLY']);
  });

  it('carries the run status itself', () => {
    const fact = carryForward({
      ...SUBJECT,
      result: priorResult(),
      field: 'prior_status',
      derivedFrom: 'status',
    });
    expect(fact.value).toBe('PASS');
  });

  it('refuses a path that reads nothing', () => {
    expect(() =>
      carryForward({
        ...SUBJECT,
        result: priorResult(),
        field: 'comparison_year_moe_status',
        derivedFrom: 'output.notAThing',
      }),
    ).toThrow(CarryForwardError);
  });

  it('refuses to reach outside the conclusion', () => {
    // An input is how the rule reached its answer, not the answer. Carrying one forward would
    // let a later year treat an intermediate figure as a determination of record.
    for (const path of ['computedInputs.current_actual_local', 'steps.0.value', 'evaluationHash']) {
      expect(
        () => carryForward({ ...SUBJECT, result: priorResult(), field: 'x', derivedFrom: path }),
        path,
      ).toThrow(CarryForwardError);
    }
  });

  it('does not walk the prototype chain', () => {
    // `output.constructor` resolves on any object. Sealed into a snapshot it would be a
    // regulatory fact whose value is an engine internal.
    expect(() =>
      carryForward({
        ...SUBJECT,
        result: priorResult(),
        field: 'x',
        derivedFrom: 'output.constructor',
      }),
    ).toThrow(CarryForwardError);
  });

  it('refuses to record a determination under a district origin', () => {
    expect(() =>
      carryForward({
        ...SUBJECT,
        result: priorResult(),
        field: 'comparison_year_moe_status',
        derivedFrom: 'output.moeStatus',
        origin: 'DISTRICT_EXPORT',
      }),
    ).toThrow(CarryForwardError);
  });
});

describe('verifyCarriedForward', () => {
  const result = priorResult();
  const fact = carryForward({
    ...SUBJECT,
    result,
    field: 'comparison_year_moe_status',
    derivedFrom: 'output.moeStatus',
  });

  it('accepts a fact that matches the determination it names', () => {
    expect(verifyCarriedForward(fact, [result])).toEqual({ ok: true });
  });

  it('catches a value edited after the fact was built', () => {
    // The plain attack: a failing prior year rewritten as a passing one. The hash still names
    // the real run, and the value no longer matches what that run concluded.
    const verdict = verifyCarriedForward({ ...fact, value: 'NOT_MET' }, [result]);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/NOT_MET/);
  });

  it('catches a fact pointed at a determination that was never made', () => {
    const verdict = verifyCarriedForward(fact, []);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/not among the finalized results/);
  });

  it('catches a run whose conclusion has since changed', () => {
    // Same run id, different computation. Without the hash the chain would look intact and a
    // district would be measured against a bar from a determination that no longer exists.
    const rerun = priorResult({ output: { moeStatus: 'NOT_MET', qualifyingMethods: [] } });
    const verdict = verifyCarriedForward(fact, [rerun]);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/is not the one that was made/);
  });

  it('refuses a fact that is not a carried-forward determination at all', () => {
    const verdict = verifyCarriedForward(
      {
        ...fact,
        provenance: {
          kind: 'FILE_ROW',
          importJobId: 'job',
          sourceFileId: 'file',
          sourceHash: 'a'.repeat(64),
          sourceRow: 1,
          sourceLine: 2,
          sourceFields: ['STATUS'],
          sourceValues: ['MET'],
          mappingTemplateId: 'tpl',
          mappingVersion: '1.0.0',
          transformation: 'trim',
        },
      },
      [result],
    );
    expect(verdict.ok).toBe(false);
  });

  it('is unmoved by a re-run that reached the same conclusion under a new run id', () => {
    // The hash deliberately excludes the run id and the timestamp, so reproducing a prior year
    // does not invalidate every fact carried forward from it.
    const rerun: EvaluationResult = {
      ...result,
      assessmentRunId: 'RUN-2025-0001',
      evaluatedAt: '2027-01-01T00:00:00.000Z',
    };
    expect(verifyCarriedForward(fact, [rerun])).toEqual({ ok: true });
  });
});
