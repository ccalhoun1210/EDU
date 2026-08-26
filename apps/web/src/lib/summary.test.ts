/**
 * The sentences the assessment page says, and the order it says things in.
 *
 * These are claims about a district's compliance posture. A wrong one is not a cosmetic bug:
 * "1 satisfied" over a run that failed, or an empty Outstanding cell on a requirement that is
 * blocked, tells a business officer they are fine when they are not.
 */

import { describe, expect, it } from 'vitest';
import type { EvaluationStatus } from '@complianceos/domain';
import type { EvaluationResult } from '@complianceos/rules-engine';
import { byAttention, outstanding, rollUpSentence, statusLabel } from './summary.js';

function result(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    tenantId: 't',
    organizationId: 'LEA-1',
    subjectType: 'lea_fiscal_year',
    subjectId: 'LEA-1:2026',
    assessmentRunId: 'run',
    dataSnapshotId: 'snap',
    engineVersion: '0.1.0',
    ruleId: 'RULE-001',
    ruleTitle: 'A requirement',
    ruleLifecycle: 'DRAFT',
    pack: { packId: 'P', version: '1.0.0', layer: 'FEDERAL' },
    authority: { citation: '34 CFR 300.203', sourceId: 'src' },
    computedInputs: {},
    status: 'PASS',
    severityOnFailure: 'HIGH',
    output: {},
    steps: [],
    warnings: [],
    missingInputs: [],
    notes: [],
    explanation: '',
    evaluatedAt: '2026-08-01T00:00:00.000Z',
    evaluationHash: 'hash',
    ...overrides,
  };
}

describe('statusLabel', () => {
  it('does not leave INDETERMINATE as a bare word', () => {
    // A district reading "INDETERMINATE" concludes either that it failed or that the platform
    // is broken. Neither is what the status means.
    expect(statusLabel('INDETERMINATE')).toBe('Not determined');
  });

  it('has a label for every status in the vocabulary', () => {
    for (const status of [
      'PASS',
      'FAIL',
      'RISK',
      'INDETERMINATE',
      'MANUAL_REVIEW',
      'NOT_APPLICABLE',
    ] satisfies EvaluationStatus[]) {
      expect(statusLabel(status).length, status).toBeGreaterThan(0);
    }
  });
});

describe('rollUpSentence', () => {
  it('counts every result and says why an unanswered question outranks a satisfied one', () => {
    const sentence = rollUpSentence(
      [result(), result({ status: 'INDETERMINATE' }), result({ status: 'INDETERMINATE' })],
      'INDETERMINATE',
    );
    expect(sentence).toContain('3 requirements evaluated');
    expect(sentence).toContain('1 satisfied');
    expect(sentence).toContain('2 not determined');
    expect(sentence).toContain('never reported as compliance');
  });

  it('does not reorder its breakdown when the rules resolve in a different order', () => {
    const a = result({ status: 'INDETERMINATE', ruleId: 'A' });
    const b = result({ status: 'PASS', ruleId: 'B' });
    expect(rollUpSentence([a, b], 'INDETERMINATE')).toBe(rollUpSentence([b, a], 'INDETERMINATE'));
  });

  it('attributes a failing roll-up to the failure rather than to the count', () => {
    const sentence = rollUpSentence([result({ status: 'FAIL' }), result()], 'FAIL');
    expect(sentence).toContain('decides the assessment on its own');
  });

  it('agrees with itself on a single requirement', () => {
    expect(rollUpSentence([result()], 'PASS')).toContain('1 requirement evaluated');
  });
});

describe('outstanding', () => {
  it('says nothing about a requirement that concluded', () => {
    expect(outstanding(result())).toBeUndefined();
  });

  it('leads with the blocking warning and marks that it was cut short', () => {
    const line = outstanding(
      result({
        status: 'INDETERMINATE',
        warnings: [
          {
            code: 'CALCULATOR_NOT_IMPLEMENTED',
            severity: 'BLOCKING',
            message: 'The arithmetic is not implemented. This is a gap in the platform.',
          },
        ],
      }),
    );
    expect(line).toBe('The arithmetic is not implemented. …');
  });

  it('does not append an ellipsis to a warning that was one sentence already', () => {
    const line = outstanding(
      result({
        warnings: [{ code: 'X', severity: 'BLOCKING', message: 'One sentence only.' }],
      }),
    );
    expect(line).toBe('One sentence only.');
  });

  it('prefers a blocking warning over a missing-input count', () => {
    // Both are true, and only one is the reason. A district told "waiting on 3 inputs" when the
    // real problem is unwritten arithmetic will go looking for data that would not help.
    const line = outstanding(
      result({
        missingInputs: ['a', 'b', 'c'],
        warnings: [{ code: 'X', severity: 'BLOCKING', message: 'Arithmetic missing.' }],
      }),
    );
    expect(line).toBe('Arithmetic missing.');
  });

  it('ignores a warning that is not blocking', () => {
    expect(
      outstanding(result({ warnings: [{ code: 'X', severity: 'INFO', message: 'Noted.' }] })),
    ).toBeUndefined();
  });

  it('counts missing inputs, singular and plural', () => {
    expect(outstanding(result({ missingInputs: ['a'] }))).toContain('1 input the platform');
    expect(outstanding(result({ missingInputs: ['a', 'b'] }))).toContain('2 inputs the platform');
  });
});

describe('byAttention', () => {
  it('puts what still needs attention above what is settled', () => {
    const order = byAttention([
      result({ ruleId: 'A-PASS', status: 'PASS' }),
      result({ ruleId: 'Z-FAIL', status: 'FAIL' }),
      result({ ruleId: 'M-NA', status: 'NOT_APPLICABLE' }),
      result({ ruleId: 'B-INDET', status: 'INDETERMINATE' }),
    ]).map((each) => each.ruleId);

    expect(order).toEqual(['B-INDET', 'Z-FAIL', 'A-PASS', 'M-NA']);
  });

  it('is stable, so two runs of the same pack compare like with like', () => {
    const results = [
      result({ ruleId: 'B', status: 'PASS' }),
      result({ ruleId: 'A', status: 'PASS' }),
    ];
    expect(byAttention(results).map((each) => each.ruleId)).toEqual(
      byAttention([...results].reverse()).map((each) => each.ruleId),
    );
  });

  it('does not mutate what it was given', () => {
    const results = [result({ ruleId: 'B', status: 'PASS' }), result({ ruleId: 'A' })];
    byAttention(results);
    expect(results.map((each) => each.ruleId)).toEqual(['B', 'A']);
  });
});
