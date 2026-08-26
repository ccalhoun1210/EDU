/**
 * Behavioural tests for the retention engine.
 *
 * Spec: Master Technical Buildout section 20; section 37's mitigation for "deleted required
 * evidence". Each test names the obligation it defends. The ones that matter most are the
 * three ways this module can destroy evidence it should have kept: taking the shortest
 * period instead of the longest, deleting on the day a record is still required, and
 * honouring an expired period while a hold is open.
 */

import { describe, expect, it } from 'vitest';
import {
  ANY_RECORD_TYPE,
  RetentionError,
  activeHolds,
  assessDeletion,
  canDelete,
  policyApplies,
  previewDeletionScope,
  resolveRetention,
  retainUntil,
} from './retention.js';
import type { RetainableRecord, RetentionHold, RetentionPolicy } from './retention.js';

/**
 * 2 CFR 200.334 — three years from the date of submission of the final expenditure report.
 * Record type is the wildcard because the rule reaches every record pertinent to the award.
 */
const FEDERAL: RetentionPolicy = {
  policyId: 'FED-2CFR200.334',
  authority: 'FEDERAL',
  recordType: ANY_RECORD_TYPE,
  program: 'IDEA_PART_B',
  baseYears: 3,
  anchor: 'FINAL_EXPENDITURE_REPORT',
  citation: '2 CFR 200.334',
};

/** A state schedule that runs longer, from a different anchor. */
const STATE: RetentionPolicy = {
  policyId: 'ST-EXPENDITURE-5Y',
  authority: 'STATE',
  recordType: 'EXPENDITURE_DETAIL',
  baseYears: 5,
  anchor: 'FISCAL_YEAR_END',
  citation: 'State records retention schedule GR1000-26',
};

/** A district that has decided two years is enough. It is not. */
const TENANT_SHORTER: RetentionPolicy = {
  policyId: 'TENANT-PURGE-2Y',
  authority: 'TENANT_POLICY',
  recordType: ANY_RECORD_TYPE,
  baseYears: 2,
  anchor: 'FINAL_EXPENDITURE_REPORT',
  citation: 'District records policy DP-140',
};

const RECORD: RetainableRecord = {
  recordId: 'exp-1',
  tenantId: 'tenant-a',
  recordType: 'EXPENDITURE_DETAIL',
  program: 'IDEA_PART_B',
  anchorDates: {
    RECORD_CREATED: '2020-08-01',
    FISCAL_YEAR_END: '2026-06-30',
    FINAL_EXPENDITURE_REPORT: '2026-12-15',
  },
};

/** Federal alone resolves to this date; it is the boundary most tests turn on. */
const FEDERAL_RETAIN_UNTIL = '2029-12-15';

describe('policyApplies', () => {
  it('matches a wildcard record type and an exact record type alike', () => {
    expect(policyApplies(FEDERAL, RECORD)).toBe(true);
    expect(policyApplies(STATE, RECORD)).toBe(true);
  });

  it('does not reach a record of another type', () => {
    expect(policyApplies(STATE, { ...RECORD, recordType: 'PAYROLL_JOURNAL' })).toBe(false);
  });

  it('does not reach a record of another program', () => {
    expect(policyApplies(FEDERAL, { ...RECORD, program: 'TITLE_I' })).toBe(false);
  });

  it('does not guess that an unknown program is the policy program', () => {
    // Guessing would let a program-scoped period stand in for one that was never proven to
    // apply. The record is left NOT_GOVERNED instead, which blocks deletion anyway.
    const unknownProgram: RetainableRecord = {
      recordId: RECORD.recordId,
      tenantId: RECORD.tenantId,
      recordType: RECORD.recordType,
      anchorDates: RECORD.anchorDates,
    };
    expect(policyApplies(FEDERAL, unknownProgram)).toBe(false);
    expect(policyApplies(STATE, unknownProgram)).toBe(true);
  });
});

describe('retainUntil', () => {
  it('adds whole years to a calendar date without touching a clock', () => {
    expect(retainUntil('2026-12-15', 3)).toBe('2029-12-15');
    expect(retainUntil('2026-06-30', 5)).toBe('2031-06-30');
  });

  it('keeps a 1 January anchor on 1 January', () => {
    // A UTC round trip on a host west of Greenwich returns 31 December of the prior year.
    // Invariant 6: the arithmetic is on the string, so there is no zone to get this wrong.
    expect(retainUntil('2026-01-01', 1)).toBe('2027-01-01');
    expect(retainUntil('2026-12-31', 1)).toBe('2027-12-31');
  });

  it('lands a 29 February anchor on 28 February in a common year', () => {
    // The last day of February is the anniversary of 29 February. Clamping forward to
    // 1 March would move the boundary into the wrong month.
    expect(retainUntil('2024-02-29', 1)).toBe('2025-02-28');
    expect(retainUntil('2024-02-29', 3)).toBe('2027-02-28');
  });

  it('lands a 29 February anchor on 29 February when the target year is a leap year', () => {
    expect(retainUntil('2024-02-29', 4)).toBe('2028-02-29');
    expect(retainUntil('2024-02-29', 8)).toBe('2032-02-29');
  });

  it('treats a zero-year period as the anchor date itself', () => {
    expect(retainUntil('2024-02-29', 0)).toBe('2024-02-29');
  });

  it('rejects a period that is not a whole number of years', () => {
    expect(() => retainUntil('2026-12-15', 2.5)).toThrow(RetentionError);
    expect(() => retainUntil('2026-12-15', -1)).toThrow(RetentionError);
  });

  it('rejects a date that does not exist rather than normalising it', () => {
    expect(() => retainUntil('2026-02-30', 3)).toThrow(RetentionError);
    expect(() => retainUntil('2026-13-01', 3)).toThrow(RetentionError);
    expect(() => retainUntil('15/12/2026', 3)).toThrow(RetentionError);
  });
});

describe('resolveRetention', () => {
  it('selects the longest applicable period, not the first match', () => {
    // Tenant policy is listed first and is the shortest; the state schedule governs.
    const resolution = resolveRetention(RECORD, [TENANT_SHORTER, FEDERAL, STATE]);
    expect(resolution.outcome).toBe('RETAIN');
    expect(resolution.retainUntil).toBe('2031-06-30');
    expect(resolution.governing?.policy.policyId).toBe(STATE.policyId);
  });

  it('is independent of the order the policies arrive in', () => {
    const permutations: readonly (readonly RetentionPolicy[])[] = [
      [FEDERAL, STATE, TENANT_SHORTER],
      [STATE, TENANT_SHORTER, FEDERAL],
      [TENANT_SHORTER, STATE, FEDERAL],
    ];
    for (const policies of permutations) {
      const resolution = resolveRetention(RECORD, policies);
      expect(resolution.retainUntil).toBe('2031-06-30');
      expect(resolution.governing?.policy.policyId).toBe(STATE.policyId);
    }
  });

  it('holds the federal floor when the tenant override is shorter', () => {
    // The whole point of taking the maximum: a district cannot shorten 2 CFR 200.334 by
    // writing a two-year purge schedule.
    const resolution = resolveRetention(RECORD, [FEDERAL], TENANT_SHORTER);
    expect(resolution.outcome).toBe('RETAIN');
    expect(resolution.retainUntil).toBe(FEDERAL_RETAIN_UNTIL);
    expect(resolution.governing?.policy.authority).toBe('FEDERAL');
    expect(resolution.considered).toHaveLength(2);
  });

  it('lets a tenant override extend beyond the federal floor', () => {
    const longer: RetentionPolicy = { ...TENANT_SHORTER, baseYears: 7 };
    const resolution = resolveRetention(RECORD, [FEDERAL], longer);
    expect(resolution.retainUntil).toBe('2033-12-15');
    expect(resolution.governing?.policy.policyId).toBe(longer.policyId);
  });

  it('compares computed dates, not year counts, because anchors differ', () => {
    // Five years from record creation expires in 2025; three years from the final
    // expenditure report runs to 2029. Comparing baseYears would pick the wrong one and
    // authorise deletion four years early.
    const fiveFromCreation: RetentionPolicy = {
      policyId: 'SRC-SIS-5Y',
      authority: 'SOURCE_SYSTEM',
      recordType: ANY_RECORD_TYPE,
      baseYears: 5,
      anchor: 'RECORD_CREATED',
      citation: 'Source system retention contract clause 6.2',
    };
    const resolution = resolveRetention(RECORD, [fiveFromCreation, FEDERAL]);
    expect(resolution.retainUntil).toBe(FEDERAL_RETAIN_UNTIL);
    expect(resolution.governing?.policy.baseYears).toBe(3);
  });

  it('breaks a tie on authority so the explanation is stable', () => {
    const twin: RetentionPolicy = { ...FEDERAL, policyId: 'ST-MIRROR-3Y', authority: 'STATE' };
    const resolution = resolveRetention(RECORD, [twin, FEDERAL]);
    expect(resolution.retainUntil).toBe(FEDERAL_RETAIN_UNTIL);
    expect(resolution.governing?.policy.policyId).toBe(FEDERAL.policyId);
  });

  it('cites the governing authority in the explanation', () => {
    const resolution = resolveRetention(RECORD, [FEDERAL]);
    expect(resolution.explanation).toContain('2 CFR 200.334');
    expect(resolution.explanation).toContain(FEDERAL_RETAIN_UNTIL);
  });

  it('is INDETERMINATE when an applicable anchor event has not been recorded', () => {
    // Invariant 9. An unknown period is not a short one: the final expenditure report has
    // not been filed, so nothing can say when the three years start.
    const noReport: RetainableRecord = {
      ...RECORD,
      anchorDates: { RECORD_CREATED: '2020-08-01', FISCAL_YEAR_END: '2026-06-30' },
    };
    const resolution = resolveRetention(noReport, [FEDERAL, STATE]);
    expect(resolution.outcome).toBe('INDETERMINATE');
    expect(resolution.unresolved).toHaveLength(1);
    expect(resolution.unresolved[0]?.missingAnchor).toBe('FINAL_EXPENDITURE_REPORT');
    // The state schedule still resolved, so its date is reported as a known floor.
    expect(resolution.retainUntil).toBe('2031-06-30');
  });

  it('reports NOT_GOVERNED rather than a free hand when no schedule applies', () => {
    const resolution = resolveRetention({ ...RECORD, recordType: 'PAYROLL_JOURNAL' }, [STATE]);
    expect(resolution.outcome).toBe('NOT_GOVERNED');
    expect(resolution.retainUntil).toBeUndefined();
    expect(resolution.considered).toHaveLength(0);
  });
});

describe('activeHolds', () => {
  const hold: RetentionHold = {
    holdId: 'hold-1',
    tenantId: 'tenant-a',
    kind: 'AUDIT',
    placedOn: '2028-03-02',
    reason: 'Single audit of FY2026 IDEA Part B expenditures',
  };

  it('counts an open hold from the day it is placed', () => {
    expect(activeHolds([hold], '2028-03-01')).toHaveLength(0);
    expect(activeHolds([hold], '2028-03-02')).toHaveLength(1);
    expect(activeHolds([hold], '2035-01-01')).toHaveLength(1);
  });

  it('keeps a released hold in force through its release date', () => {
    // Inclusive on release: where the two readings differ, the one that keeps the record
    // is the correct one.
    const released: RetentionHold = { ...hold, releasedOn: '2030-06-30' };
    expect(activeHolds([released], '2030-06-30')).toHaveLength(1);
    expect(activeHolds([released], '2030-07-01')).toHaveLength(0);
  });
});

describe('canDelete', () => {
  it('refuses on the retain_until date itself and allows the day after', () => {
    const subject = { record: RECORD, policies: [FEDERAL], holds: [] };
    expect(canDelete(subject, FEDERAL_RETAIN_UNTIL)).toBe(false);
    expect(canDelete(subject, '2029-12-16')).toBe(true);
  });

  it('refuses while a hold is in force even though the period has expired', () => {
    // 2 CFR 200.334(a) and the section 37 mitigation: a matter opened before expiry keeps
    // the records until it is resolved. This is the test that stops a purge job destroying
    // evidence an auditor is still asking about.
    const hold: RetentionHold = {
      holdId: 'hold-audit-2030',
      tenantId: 'tenant-a',
      kind: 'AUDIT',
      placedOn: '2029-01-05',
      reason: 'Single audit finding under appeal',
    };
    const subject = { record: RECORD, policies: [FEDERAL], holds: [hold] };
    expect(canDelete(subject, '2040-01-01')).toBe(false);

    const assessment = assessDeletion(subject, '2040-01-01');
    expect(assessment.retention.outcome).toBe('RETAIN');
    expect(assessment.blocks.map((block) => block.kind)).toEqual(['HOLD']);
    expect(assessment.blocks[0]?.holdId).toBe('hold-audit-2030');
  });

  it('allows deletion once the hold is released and the period has run', () => {
    const hold: RetentionHold = {
      holdId: 'hold-legal-1',
      tenantId: 'tenant-a',
      kind: 'LEGAL',
      placedOn: '2029-01-05',
      releasedOn: '2030-06-30',
      reason: 'Due process complaint resolved',
    };
    const subject = { record: RECORD, policies: [FEDERAL], holds: [hold] };
    expect(canDelete(subject, '2030-06-30')).toBe(false);
    expect(canDelete(subject, '2030-07-01')).toBe(true);
  });

  it('ignores a hold that has not been placed yet', () => {
    const future: RetentionHold = {
      holdId: 'hold-future',
      tenantId: 'tenant-a',
      kind: 'STATE_MONITORING',
      placedOn: '2031-01-01',
      reason: 'Scheduled cyclical monitoring',
    };
    expect(canDelete({ record: RECORD, policies: [FEDERAL], holds: [future] }, '2029-12-16')).toBe(
      true,
    );
  });

  it('refuses while retention is indeterminate, however old the record is', () => {
    const noReport: RetainableRecord = {
      ...RECORD,
      anchorDates: { RECORD_CREATED: '2020-08-01' },
    };
    const subject = { record: noReport, policies: [FEDERAL], holds: [] };
    expect(canDelete(subject, '2099-01-01')).toBe(false);
    expect(assessDeletion(subject, '2099-01-01').blocks[0]?.kind).toBe('INDETERMINATE_RETENTION');
  });

  it('refuses when no schedule governs the record', () => {
    const subject = { record: RECORD, policies: [], holds: [] };
    expect(canDelete(subject, '2099-01-01')).toBe(false);
    expect(assessDeletion(subject, '2099-01-01').blocks[0]?.kind).toBe('NOT_GOVERNED');
  });

  it('reports every blocking reason, not only the first', () => {
    // A district clearing a hold needs to know whether the record then becomes deletable.
    const hold: RetentionHold = {
      holdId: 'hold-both',
      tenantId: 'tenant-a',
      kind: 'LITIGATION',
      placedOn: '2027-01-01',
      reason: 'Pending claim',
    };
    const assessment = assessDeletion(
      { record: RECORD, policies: [FEDERAL], holds: [hold] },
      '2028-01-01',
    );
    expect(assessment.blocks.map((block) => block.kind)).toEqual(['HOLD', 'RETENTION_PERIOD']);
    expect(assessment.blocks[1]?.policyId).toBe(FEDERAL.policyId);
  });

  it('honours a tenant override that is shorter by keeping the federal date', () => {
    const subject = {
      record: RECORD,
      policies: [FEDERAL],
      tenantOverride: TENANT_SHORTER,
      holds: [],
    };
    // The tenant schedule expired on 2028-12-15; the federal floor still governs.
    expect(canDelete(subject, '2028-12-16')).toBe(false);
    expect(canDelete(subject, '2029-12-16')).toBe(true);
  });
});

describe('previewDeletionScope', () => {
  const other: RetainableRecord = {
    recordId: 'exp-2',
    tenantId: 'tenant-a',
    recordType: 'EXPENDITURE_DETAIL',
    program: 'IDEA_PART_B',
    anchorDates: { FINAL_EXPENDITURE_REPORT: '2026-12-15' },
  };

  const hold: RetentionHold = {
    holdId: 'hold-shared',
    tenantId: 'tenant-a',
    kind: 'AUDIT',
    placedOn: '2029-01-01',
    reason: 'Program monitoring of FY2026 expenditures',
  };

  it('partitions the scope into what would be deleted and what is blocked, with reasons', () => {
    const preview = previewDeletionScope({
      requestId: 'req-1',
      tenantId: 'tenant-a',
      asOf: '2029-12-16',
      subjects: [
        { record: RECORD, policies: [FEDERAL], holds: [] },
        { record: other, policies: [FEDERAL], holds: [hold] },
      ],
    });
    expect(preview.deletable.map((entry) => entry.recordId)).toEqual(['exp-1']);
    expect(preview.blocked.map((entry) => entry.recordId)).toEqual(['exp-2']);
    expect(preview.blocked[0]?.blocks[0]?.explanation).toContain('Program monitoring');
  });

  it('lists each blocking hold once however many records it covers', () => {
    const preview = previewDeletionScope({
      requestId: 'req-2',
      tenantId: 'tenant-a',
      asOf: '2029-12-16',
      subjects: [
        { record: RECORD, policies: [FEDERAL], holds: [hold] },
        { record: other, policies: [FEDERAL], holds: [hold] },
      ],
    });
    expect(preview.deletable).toHaveLength(0);
    expect(preview.holdsInForce.map((entry) => entry.holdId)).toEqual(['hold-shared']);
  });

  it('refuses a scope that reaches across tenants', () => {
    // Invariant 7. A caller that assembled two tenants' records has a bug; silently
    // dropping the foreign rows would hide it.
    expect(() =>
      previewDeletionScope({
        requestId: 'req-3',
        tenantId: 'tenant-a',
        asOf: '2029-12-16',
        subjects: [{ record: { ...other, tenantId: 'tenant-b' }, policies: [FEDERAL], holds: [] }],
      }),
    ).toThrow(RetentionError);
  });
});
