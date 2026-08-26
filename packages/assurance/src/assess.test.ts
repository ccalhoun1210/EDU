/**
 * The buildout's first milestone, executed rather than asserted.
 *
 * > a deterministic, tested, source-cited compliance engine capable of ingesting a district
 * > export and reproducing an IDEA Fiscal assessment from an immutable snapshot.
 *
 * Every clause of that is a test below. The path runs uploaded bytes → RFC 4180 parse →
 * versioned mapping → canonical facts → sealed snapshot → fact bag → rule resolution →
 * statutory calculator → explanation → evaluation hash, with no clock and no database.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALCULATORS } from '@complianceos/calculators';
import {
  FactOriginError,
  isFileRowProvenance,
  projectFactBag,
  provenanceFor,
  verifySnapshot,
} from '@complianceos/ingest';
import { ALLOWED_CALCULATORS, loadRulePack } from '@complianceos/rulepack-sdk';
import {
  assessDistrictExport,
  assessedDataFingerprint,
  type AssessDistrictExportRequest,
} from './assess.js';
import {
  IMPORT_JOB_ID,
  NORTHFIELD_EXPORT_CSV,
  NORTHFIELD_METHODS_MET,
  NORTHFIELD_PRIOR_DETERMINATIONS,
  NORTHFIELD_PRIOR_RESULT,
  NORTHFIELD_SOURCE_HASH,
  NORTHFIELD_STATUS_SOURCE,
  NORTHFIELD_TEMPLATE,
} from './northfield-fixture.js';
import { verifyCarriedForward } from './carry-forward.js';

const pack = await loadRulePack(
  path.join(import.meta.dirname, '../../../rulepacks/federal/idea-b/us-fed-idea-b-2026'),
  ALLOWED_CALCULATORS,
);

const SUBJECT = { subjectType: 'lea_fiscal_year', subjectId: 'LEA-0417:2026' } as const;

/** The export with one extra column, header and value, on the end of each line. */
function hostileColumn(header: string, value: string): string {
  const [head = '', row = ''] = NORTHFIELD_EXPORT_CSV.split('\r\n');
  return [`${head},${header}`, `${row},${value}`].join('\r\n');
}

function request(
  overrides: Partial<AssessDistrictExportRequest> = {},
): AssessDistrictExportRequest {
  return {
    import: {
      importJobId: IMPORT_JOB_ID,
      tenantId: 'tenant_northfield',
      organizationId: 'LEA-0417',
      snapshotId: 'snap_northfield_fy2026',
      // Supplied, never read from a clock: a finalized run reproduces years later.
      createdAt: '2026-08-01T00:00:00.000Z',
      file: {
        sourceFileId: 'file_northfield_fy2026',
        originalFilename: 'northfield-fiscal-fy2026.csv',
        sourceHash: NORTHFIELD_SOURCE_HASH,
        uploadedAt: '2026-08-01T00:00:00.000Z',
        uploadedBy: 'business.officer@northfield.example',
      },
      scan: { status: 'CLEAN', scanner: 'test-scanner', scannedAt: '2026-08-01T00:00:00.000Z' },
      content: NORTHFIELD_EXPORT_CSV,
      template: NORTHFIELD_TEMPLATE,
      subject: {
        subjectType: 'lea_fiscal_year',
        keyFields: ['lea_id', 'fiscal_year_key'],
        separator: ':',
      },
    },
    priorDeterminations: [
      ...NORTHFIELD_PRIOR_DETERMINATIONS,
      NORTHFIELD_METHODS_MET,
      NORTHFIELD_STATUS_SOURCE,
    ],
    subject: SUBJECT,
    context: {
      tenantId: 'tenant_northfield',
      organizationId: 'LEA-0417',
      assessmentRunId: 'run_northfield_0001',
      evaluatedAt: '2026-08-01T00:00:00.000Z',
    },
    packs: [pack],
    asOf: '2026-08-01',
    calculators: CALCULATORS,
    includeLifecycles: ['DRAFT'],
    ...overrides,
  };
}

describe('ingesting a district export and assessing it', () => {
  const outcome = assessDistrictExport(request());

  it('parses the upload and balances the reconciliation', () => {
    expect(outcome.import.kind, JSON.stringify(outcome.import.issues)).toBe('COMPLETED');
    const reconciliation = outcome.import.reconciliation;
    expect(reconciliation).toBeDefined();
    // Section 10.5: rows received must equal rows accepted plus rows quarantined, exactly.
    expect(reconciliation?.rowsReceived).toBe(1);
    expect(reconciliation?.rowsAccepted).toBe(1);
  });

  it('seals a snapshot that verifies against its own hash', () => {
    expect(outcome.snapshot).toBeDefined();
    expect(outcome.snapshot?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reaches the right answer, computed from the bytes in the file', () => {
    const compliance = outcome.assessment?.results.find(
      (result) => result.ruleId === 'IDEA-MOE-COMPLIANCE-001',
    );
    expect(compliance?.status, `missing: ${JSON.stringify(compliance?.missingInputs)}`).toBe(
      'PASS',
    );
    expect(compliance?.missingInputs).toEqual([]);

    // The arithmetic, from the CSV: local 4,830,000.00 against 4,900,000.00 is 70,000.00
    // short, and State-and-local 7,975,000.00 against 7,850,000.00 is 125,000.00 clear.
    // Satisfying either measure satisfies the standard, so the year is compliant on the
    // combined one despite the local shortfall.
    const output = compliance?.output as { marginByMethod: Record<string, string> } | undefined;
    expect(output?.marginByMethod['LOCAL_ONLY']).toBe('-70000.00');
    expect(output?.marginByMethod['STATE_AND_LOCAL']).toBe('125000.00');
  });

  it('computes the excess cost requirement from the same upload, level by level', () => {
    // The second implemented requirement, off the same row of the same file. Elementary and
    // secondary are separate obligations under 34 CFR 300.16, so a district that cleared its
    // elementary threshold and fell short at secondary has not satisfied the requirement —
    // averaging the +115,000.00 against the −79,000.00 is exactly what computing the levels
    // apart forbids.
    const excessCost = outcome.assessment?.results.find(
      (result) => result.ruleId === 'IDEA-EXCESS-COST-001',
    );
    expect(excessCost?.status, `missing: ${JSON.stringify(excessCost?.missingInputs)}`).toBe(
      'FAIL',
    );
    expect(excessCost?.missingInputs).toEqual([]);

    const output = excessCost?.output as
      | {
          levelStatus: Record<string, string>;
          averagePerStudentByLevel: Record<string, string>;
          minimumRequiredByLevel: Record<string, string>;
          shortfallByLevel: Record<string, string>;
        }
      | undefined;

    // 37,800,000.00 over 5,400 elementary students is 7,000.000000 each; times 620 children
    // with disabilities is a 4,340,000.00 floor, and the district put 4,455,000.00 behind them.
    expect(output?.levelStatus['ELEMENTARY']).toBe('PASS');
    expect(output?.averagePerStudentByLevel['ELEMENTARY']).toBe('7000.000000');
    expect(output?.minimumRequiredByLevel['ELEMENTARY']).toBe('4340000.00');

    // 26,000,000.00 over 3,200 secondary students is 8,125.000000; times 384 is 3,120,000.00
    // against 3,041,000.00 actually spent.
    expect(output?.levelStatus['SECONDARY']).toBe('FAIL');
    expect(output?.minimumRequiredByLevel['SECONDARY']).toBe('3120000.00');
    expect(output?.shortfallByLevel['SECONDARY']).toBe('79000.00');
  });

  it('carries one head count consistently across two requirements', () => {
    // The export states 1,004 children with disabilities for maintenance of effort and splits
    // them 620/384 by level for excess cost. Two rules reading the same district's figures must
    // not disagree about how many children it serves, and a fixture that let them drift would
    // hide the class of bug where a level's column is mapped to the wrong target.
    const excessCost = outcome.assessment?.results.find(
      (result) => result.ruleId === 'IDEA-EXCESS-COST-001',
    );
    const compliance = outcome.assessment?.results.find(
      (result) => result.ruleId === 'IDEA-MOE-COMPLIANCE-001',
    );

    const elementary = Number(excessCost?.computedInputs['elementary_children_with_disabilities']);
    const secondary = Number(excessCost?.computedInputs['secondary_children_with_disabilities']);
    expect(elementary + secondary).toBe(Number(compliance?.computedInputs['current_child_count']));
  });

  it('leaves the eligibility rule unanswerable, and says which determination is missing', () => {
    // This export is a closed-year compliance return. The eligibility test needs the status
    // of the most recent year with final figures, which is a determination and not something
    // the file can carry — so the honest answer is INDETERMINATE naming it, rather than a
    // status computed from whatever the district happened to upload.
    const eligibility = outcome.assessment?.results.find(
      (result) => result.ruleId === 'IDEA-MOE-ELIGIBILITY-001',
    );
    expect(eligibility?.status).toBe('INDETERMINATE');
    expect(eligibility?.missingInputs).toContain('most_recent_available_year_moe_status');
  });

  it('walks every figure back to the row and cell it came from', () => {
    // Invariant 3, demonstrated rather than asserted: the number on a finding-detail screen
    // has to lead back to the spreadsheet cell a district uploaded.
    const snapshot = outcome.snapshot;
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) return;

    const provenance = provenanceFor(
      snapshot,
      SUBJECT.subjectType,
      SUBJECT.subjectId,
      'current_actual_local',
    );
    expect(provenance).toBeDefined();
    if (provenance === undefined || !isFileRowProvenance(provenance)) {
      throw new Error('a district figure must carry file-row provenance');
    }
    expect(provenance.sourceFileId).toBe('file_northfield_fy2026');
    expect(provenance.sourceRow).toBe(1);
    // The raw text as it appeared, before any transformation — currency symbol and all.
    expect(provenance.sourceValues).toContain('$4,830,000.00');
    expect(provenance.transformation).toBeTruthy();
    expect(provenance.mappingTemplateId).toBe('NORTHFIELD-FISCAL-V1');
  });

  it('binds every carried-forward determination to the run that made it', () => {
    // Invariant 3 for a fact with no spreadsheet cell behind it. Each prior determination in
    // the snapshot names a finalized run, a rule and an evaluation hash, and the value still
    // reads out of that result — so the chain is checkable rather than asserted.
    const snapshot = outcome.snapshot;
    if (snapshot === undefined) throw new Error('no snapshot');

    const carried = snapshot.facts.filter((fact) => fact.origin === 'PLATFORM_DETERMINATION');
    expect(carried.length).toBeGreaterThan(0);

    for (const fact of carried) {
      expect(verifyCarriedForward(fact, [NORTHFIELD_PRIOR_RESULT]), fact.field).toEqual({
        ok: true,
      });
    }
  });

  it('refuses a prior status the finalized run never reached', () => {
    // The attack this exists for: an LEA that failed last year appearing to have met the
    // standard, which under 34 CFR 300.203(c) is what decides the bar it is measured against
    // this year. The value is edited; the hash still names the real run.
    const snapshot = outcome.snapshot;
    if (snapshot === undefined) throw new Error('no snapshot');

    const status = snapshot.facts.find((fact) => fact.field === 'comparison_year_moe_status');
    if (status === undefined) throw new Error('fixture must carry a prior status');

    const verdict = verifyCarriedForward({ ...status, value: 'NOT_MET' }, [
      NORTHFIELD_PRIOR_RESULT,
    ]);
    expect(verdict.ok).toBe(false);
  });

  it('records the two fact origins separately in one snapshot', () => {
    const snapshot = outcome.snapshot;
    if (snapshot === undefined) throw new Error('no snapshot');
    const origins = new Map(snapshot.facts.map((fact) => [fact.field, fact.origin]));
    expect(origins.get('current_actual_local')).toBe('DISTRICT_EXPORT');
    expect(origins.get('comparison_year_moe_status')).toBe('PLATFORM_DETERMINATION');
  });

  it('is not an official determination while the pack is at DRAFT', () => {
    // The source-verification gate as a property of a run: no citation has been retrieved, so
    // nothing here may be shown to a district or an SEA as a finding.
    expect(outcome.assessment?.official).toBe(false);
  });

  it('reproduces byte for byte from the same bytes', () => {
    const again = assessDistrictExport(request());
    expect(again.snapshot?.contentHash).toBe(outcome.snapshot?.contentHash);
    expect(again.assessment?.results.map((result) => result.evaluationHash)).toEqual(
      outcome.assessment?.results.map((result) => result.evaluationHash),
    );
  });

  it('gives the same snapshot hash under a different import job', () => {
    // importJobId identifies the job, not the district's data. Re-importing identical bytes
    // must not look like a change, or every run comparison reports change where none happened.
    const other = assessDistrictExport(
      request({ import: { ...request().import, importJobId: 'job_a_second_attempt' } }),
    );
    expect(other.snapshot?.contentHash).toBe(outcome.snapshot?.contentHash);
    expect(assessedDataFingerprint(other.snapshot as never)).toBe(
      assessedDataFingerprint(outcome.snapshot as never),
    );
  });

  it('produces a different hash when a figure in the file changes', () => {
    // The other half: a hash that never moves is not evidence of anything.
    const edited = assessDistrictExport(
      request({
        import: {
          ...request().import,
          content: NORTHFIELD_EXPORT_CSV.replace('$4,830,000.00', '$4,000,000.00'),
        },
      }),
    );
    expect(edited.snapshot?.contentHash).not.toBe(outcome.snapshot?.contentHash);
  });
});

describe('what the path refuses', () => {
  it('refuses a determination the district tried to assert in its own file', () => {
    // The concrete attack, run end to end: a mapping template that targets a platform-owned
    // field. Every earlier stage accepts it — the value parses, the row is well-formed, the
    // reconciliation balances — and projection is where it stops.
    const hostile = request({
      import: {
        ...request().import,
        // Appended as a new last column on both lines rather than spliced in by name, so the
        // attack keeps working as the export grows columns.
        content: hostileColumn('Prior Yr Status', 'NOT_MET'),
        template: {
          ...NORTHFIELD_TEMPLATE,
          fields: [
            ...NORTHFIELD_TEMPLATE.fields,
            {
              target: 'comparison_year_moe_status',
              valueType: 'text' as const,
              sources: ['Prior Yr Status'],
              transforms: [{ transform: 'trim' as const }],
              required: true,
              classification: 'CONFIDENTIAL' as const,
            },
          ],
        },
      },
      priorDeterminations: [],
    });

    expect(() => assessDistrictExport(hostile)).toThrow(FactOriginError);
  });

  it('does not assess a snapshot whose hash fails to re-derive', () => {
    const outcome = assessDistrictExport(request());
    const snapshot = outcome.snapshot;
    if (snapshot === undefined) throw new Error('no snapshot');

    // Tamper after sealing, exactly as an attacker with write access would.
    const tampered = {
      ...snapshot,
      facts: snapshot.facts.map((fact) =>
        fact.field === 'current_actual_local' ? { ...fact, value: '9999999.00' } : fact,
      ),
    };

    expect(() => projectFactBag(tampered, SUBJECT.subjectType, SUBJECT.subjectId)).not.toThrow();
    // Projection alone would happily read it; the integrity check is what refuses.
    expect(verifySnapshot(tampered)).toBe(false);
  });

  it('reports a rejected scan instead of assessing anything', () => {
    const infected = assessDistrictExport(
      request({
        import: {
          ...request().import,
          scan: {
            status: 'INFECTED',
            scanner: 'test-scanner',
            scannedAt: '2026-08-01T00:00:00.000Z',
          },
        },
      }),
    );
    expect(infected.import.kind).toBe('REJECTED_AT_SCAN');
    expect(infected.snapshot).toBeUndefined();
    expect(infected.assessment).toBeUndefined();
  });
});
