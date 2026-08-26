import { describe, expect, it } from 'vitest';
import type { EvaluationStatus } from './evaluation.js';
import {
  FINDING_DISPOSITION_KINDS,
  createFinding,
  latestDisposition,
  recordDisposition,
  resolveEffectiveStatus,
} from './finding.js';
import type {
  Finding,
  FindingDisposition,
  FindingDispositionDraft,
  FindingDraft,
  FindingValidationResult,
} from './finding.js';

/** A draft with every link of the provenance chain present. Tests remove one at a time. */
function completeDraft(overrides: Partial<FindingDraft> = {}): FindingDraft {
  return {
    id: 'fnd_01',
    tenantId: 'ten_01',
    organizationId: 'org_district_7',
    assessmentRunId: 'run_2028_q1',
    ruleId: 'idea.moe.eligibility',
    ruleVersionId: 'idea.moe.eligibility@3.1.0',
    systemStatus: 'FAIL',
    severity: 'HIGH',
    subject: { type: 'FISCAL_YEAR', id: 'fy2028' },
    provenance: {
      evaluationResultId: 'evr_9001',
      dataSnapshotId: 'snap_2028_03_01',
      engineVersion: 'engine@1.4.2',
      evaluationHash: 'sha256:8c1f...',
      authorities: [{ citation: '34 CFR 300.203(b)(2)', sourceId: 'src_ecfr_300_203' }],
    },
    detectedOn: '2028-03-01',
    ...overrides,
  };
}

function expectOk<T>(result: FindingValidationResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a valid result, got issues: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

function fieldsRejected<T>(result: FindingValidationResult<T>): readonly string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.field);
}

const finding: Finding = expectOk(createFinding(completeDraft()));

function disposition(overrides: Partial<FindingDispositionDraft> = {}): FindingDisposition {
  return expectOk(
    recordDisposition(finding, {
      id: 'dsp_01',
      kind: 'ACKNOWLEDGED',
      reviewerId: 'usr_42',
      reviewerName: 'Jane Smith',
      recordedOn: '2028-03-04',
      reason: 'Reviewed with the business office.',
      ...overrides,
    }),
  );
}

describe('createFinding', () => {
  it('builds a finding when the whole provenance chain is present', () => {
    const value = expectOk(createFinding(completeDraft()));
    expect(value.systemStatus).toBe('FAIL');
    expect(value.subject).toEqual({ type: 'FISCAL_YEAR', id: 'fy2028' });
    expect(value.provenance.dataSnapshotId).toBe('snap_2028_03_01');
    expect(value.provenance.authorities).toHaveLength(1);
  });

  // CLAUDE.md invariant 3: finding -> rule -> rule version -> authority -> ... -> snapshot.
  it('refuses a finding that cannot name the rule version it came from', () => {
    const result = createFinding(completeDraft({ ruleVersionId: undefined }));
    expect(result.ok).toBe(false);
    expect(fieldsRejected(result)).toContain('ruleVersionId');
  });

  it('refuses a finding that cannot name the data snapshot it was computed against', () => {
    const draft = completeDraft();
    const result = createFinding({
      ...draft,
      provenance: { ...draft.provenance, dataSnapshotId: undefined },
    });
    expect(result.ok).toBe(false);
    expect(fieldsRejected(result)).toContain('provenance.dataSnapshotId');
  });

  it('refuses a finding with no regulatory authority behind it', () => {
    const draft = completeDraft();
    const result = createFinding({
      ...draft,
      provenance: { ...draft.provenance, authorities: [] },
    });
    expect(fieldsRejected(result)).toContain('provenance.authorities');
  });

  it('refuses an authority reference that cites a provision but no source record', () => {
    const draft = completeDraft();
    const result = createFinding({
      ...draft,
      provenance: {
        ...draft.provenance,
        authorities: [{ citation: '34 CFR 300.203(b)(2)' }],
      },
    });
    expect(fieldsRejected(result)).toContain('provenance.authorities[0].sourceId');
  });

  it('treats a whitespace-only identifier as a missing one', () => {
    const result = createFinding(completeDraft({ assessmentRunId: '   ' }));
    expect(fieldsRejected(result)).toContain('assessmentRunId');
  });

  it('reports every broken link at once so a 422 can list them together', () => {
    const result = createFinding({ systemStatus: 'FAIL' });
    expect(fieldsRejected(result)).toEqual(
      expect.arrayContaining([
        'tenantId',
        'organizationId',
        'ruleId',
        'ruleVersionId',
        'provenance.evaluationResultId',
        'provenance.dataSnapshotId',
        'provenance.evaluationHash',
        'provenance.authorities',
        'subject.type',
        'severity',
        'detectedOn',
      ]),
    );
  });

  it('refuses a status or severity outside the closed vocabulary', () => {
    const result = createFinding(completeDraft({ systemStatus: 'FAILED', severity: 'URGENT' }));
    expect(fieldsRejected(result)).toEqual(expect.arrayContaining(['systemStatus', 'severity']));
  });

  // Invariant 6: a statutory date is a calendar date, not a timestamp.
  it('refuses a detection date that is a timestamp or a non-ISO format', () => {
    expect(
      fieldsRejected(createFinding(completeDraft({ detectedOn: '2028-03-01T00:00:00Z' }))),
    ).toContain('detectedOn');
    expect(fieldsRejected(createFinding(completeDraft({ detectedOn: '03/01/2028' })))).toContain(
      'detectedOn',
    );
  });

  it('refuses a date that is well-shaped but never happened', () => {
    expect(fieldsRejected(createFinding(completeDraft({ detectedOn: '2028-02-30' })))).toContain(
      'detectedOn',
    );
    expect(fieldsRejected(createFinding(completeDraft({ detectedOn: '2027-02-29' })))).toContain(
      'detectedOn',
    );
    expect(createFinding(completeDraft({ detectedOn: '2028-02-29' })).ok).toBe(true);
  });
});

describe('recordDisposition', () => {
  it('records the reviewer, the date and the reason as stated', () => {
    const value = disposition({ kind: 'DISPUTED', reason: 'Child count restated by the state.' });
    expect(value.kind).toBe('DISPUTED');
    expect(value.reviewerName).toBe('Jane Smith');
    expect(value.recordedOn).toBe('2028-03-04');
    expect(value.evidenceItemIds).toEqual([]);
  });

  // Invariant 7: the tenant of an act is never taken from the request body.
  it('binds the disposition to the finding it was recorded against, not to caller-supplied ids', () => {
    const value = disposition();
    expect(value.tenantId).toBe(finding.tenantId);
    expect(value.findingId).toBe(finding.id);
  });

  it('refuses an ACCEPTED_EXCEPTION with no evidence behind it', () => {
    const result = recordDisposition(finding, {
      id: 'dsp_02',
      kind: 'ACCEPTED_EXCEPTION',
      reviewerId: 'usr_42',
      reviewerName: 'Jane Smith',
      recordedOn: '2028-03-04',
      reason: 'Exception under the approved personnel-departure provision.',
    });
    expect(fieldsRejected(result)).toEqual(['evidenceItemIds']);
  });

  it('accepts an ACCEPTED_EXCEPTION supported by evidence', () => {
    const value = disposition({
      kind: 'ACCEPTED_EXCEPTION',
      reason: 'Exception under the approved personnel-departure provision.',
      evidenceItemIds: ['evd_11', 'evd_12', 'evd_13'],
    });
    expect(value.evidenceItemIds).toEqual(['evd_11', 'evd_12', 'evd_13']);
  });

  it('refuses an ACCEPTED_EXCEPTION or FALSE_POSITIVE with no written reason', () => {
    const base = {
      id: 'dsp_03',
      reviewerId: 'usr_42',
      reviewerName: 'Jane Smith',
      recordedOn: '2028-03-04',
      reason: '   ',
    };
    expect(
      fieldsRejected(
        recordDisposition(finding, {
          ...base,
          kind: 'ACCEPTED_EXCEPTION',
          evidenceItemIds: ['evd_11'],
        }),
      ),
    ).toEqual(['reason']);
    expect(fieldsRejected(recordDisposition(finding, { ...base, kind: 'FALSE_POSITIVE' }))).toEqual(
      ['reason'],
    );
  });

  it('requires a reason for every kind, not only the excusing ones', () => {
    for (const kind of FINDING_DISPOSITION_KINDS) {
      const result = recordDisposition(finding, {
        id: 'dsp_04',
        kind,
        reviewerId: 'usr_42',
        reviewerName: 'Jane Smith',
        recordedOn: '2028-03-04',
        evidenceItemIds: ['evd_11'],
      });
      expect(fieldsRejected(result)).toContain('reason');
    }
  });

  it('refuses a blank entry in the evidence list rather than silently dropping it', () => {
    const result = recordDisposition(finding, {
      id: 'dsp_05',
      kind: 'ACCEPTED_EXCEPTION',
      reviewerId: 'usr_42',
      reviewerName: 'Jane Smith',
      recordedOn: '2028-03-04',
      reason: 'Exception under the approved personnel-departure provision.',
      evidenceItemIds: ['evd_11', ''],
    });
    expect(fieldsRejected(result)).toEqual(['evidenceItemIds[1]']);
  });

  it('refuses an unknown kind and a date that is not a calendar date', () => {
    const result = recordDisposition(finding, {
      id: 'dsp_06',
      kind: 'WAIVED',
      reviewerId: 'usr_42',
      reviewerName: 'Jane Smith',
      recordedOn: '2028-03-04T09:00:00Z',
      reason: 'Signed off.',
    });
    expect(fieldsRejected(result)).toEqual(expect.arrayContaining(['kind', 'recordedOn']));
  });
});

describe('resolveEffectiveStatus', () => {
  it('leaves the system result alone when nobody has dispositioned the finding', () => {
    const resolved = resolveEffectiveStatus('FAIL', undefined);
    expect(resolved.systemStatus).toBe('FAIL');
    expect(resolved.effectiveStatus).toBe('FAIL');
    expect(resolved.disposition).toBeUndefined();
  });

  // Section 24: the two facts sit side by side; the disposition never rewrites the result.
  it('reports both facts when a FAIL is accepted as an exception', () => {
    const resolved = resolveEffectiveStatus(
      'FAIL',
      disposition({
        kind: 'ACCEPTED_EXCEPTION',
        reason: 'Exception under the approved personnel-departure provision.',
        evidenceItemIds: ['evd_11'],
      }),
    );
    expect(resolved.systemStatus).toBe('FAIL');
    expect(resolved.effectiveStatus).toBe('NOT_APPLICABLE');
    expect(resolved.disposition).toBe('ACCEPTED_EXCEPTION');
    expect(resolved.rationale).toContain('Jane Smith');
  });

  it('sends a disputed finding to human adjudication rather than clearing it', () => {
    const resolved = resolveEffectiveStatus(
      'RISK',
      disposition({ kind: 'DISPUTED', reason: 'State restated the child count.' }),
    );
    expect(resolved.effectiveStatus).toBe('MANUAL_REVIEW');
    expect(resolved.systemStatus).toBe('RISK');
  });

  // Invariant 4: a finalized result is cleared by a new run, not by a reviewer's assertion.
  it('does not let ACKNOWLEDGED, REMEDIATION_PLANNED or RESOLVED clear a FAIL', () => {
    for (const kind of ['ACKNOWLEDGED', 'REMEDIATION_PLANNED', 'RESOLVED'] as const) {
      const resolved = resolveEffectiveStatus('FAIL', disposition({ kind, reason: 'Handled.' }));
      expect(resolved.effectiveStatus).toBe('FAIL');
    }
  });

  // Invariant 9's sibling concern: a human act must never manufacture a PASS.
  it('never turns any status into PASS, whatever the disposition', () => {
    const statuses: readonly EvaluationStatus[] = [
      'FAIL',
      'RISK',
      'INDETERMINATE',
      'MANUAL_REVIEW',
    ];
    for (const kind of FINDING_DISPOSITION_KINDS) {
      for (const status of statuses) {
        const resolved = resolveEffectiveStatus(
          status,
          disposition({ kind, reason: 'Reviewed.', evidenceItemIds: ['evd_11'] }),
        );
        expect(resolved.effectiveStatus).not.toBe('PASS');
        expect(resolved.systemStatus).toBe(status);
      }
    }
  });
});

describe('latestDisposition', () => {
  it('returns nothing for a finding nobody has dispositioned', () => {
    expect(latestDisposition([])).toBeUndefined();
  });

  it('picks the most recent act regardless of the order it was handed', () => {
    const first = disposition({ id: 'dsp_a', recordedOn: '2028-03-04' });
    const second = disposition({
      id: 'dsp_b',
      kind: 'ACCEPTED_EXCEPTION',
      recordedOn: '2028-04-01',
      reason: 'Exception granted.',
      evidenceItemIds: ['evd_11'],
    });
    expect(latestDisposition([second, first])?.id).toBe('dsp_b');
    expect(latestDisposition([first, second])?.id).toBe('dsp_b');
  });

  it('takes the later entry when a reviewer changes their mind the same day', () => {
    const morning = disposition({ id: 'dsp_a', recordedOn: '2028-03-04' });
    const afternoon = disposition({
      id: 'dsp_b',
      kind: 'DISPUTED',
      recordedOn: '2028-03-04',
      reason: 'On reflection, the child count is wrong.',
    });
    expect(latestDisposition([morning, afternoon])?.id).toBe('dsp_b');
  });
});
