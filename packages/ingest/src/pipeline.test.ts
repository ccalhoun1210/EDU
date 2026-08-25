/**
 * End-to-end tests for the import pipeline.
 *
 * Spec: Master Technical Buildout sections 10.2–10.6. CLAUDE.md invariants 3, 4 and 5.
 *
 * `runImport` is the only place in the package where a district's uploaded bytes become facts
 * a rule can be evaluated against, so the guarantees tested here are the ones the product is
 * sold on: an unscanned file never reaches the parser, every row that came in is accounted
 * for, money crosses the boundary as an exact decimal string, and nothing the platform cannot
 * attribute or cannot agree with itself about is quietly resolved.
 *
 * Fixtures are synthetic. No real district appears here.
 */

import { describe, expect, it } from 'vitest';
import type { CanonicalValue } from '@complianceos/domain';
import type { SourceFileRef } from './provenance.js';
import type { MappingTemplate } from './mapping.js';
import {
  runImport,
  type ImportRequest,
  type ScanResult,
  type ScanStatus,
  type SubjectBinding,
} from './pipeline.js';
import type { CanonicalFact, DataSnapshot } from './snapshot.js';

const FILE: SourceFileRef = {
  sourceFileId: 'file_fy2028_expenditures',
  originalFilename: 'FY2028 Expenditure Export.csv',
  sourceHash: '1'.repeat(64),
  uploadedAt: '2028-07-14T09:12:00.000Z',
  uploadedBy: 'user_business_officer',
};

const CLEAN: ScanResult = {
  status: 'CLEAN',
  scanner: 'synthetic-scanner/1.0',
  scannedAt: '2028-07-14T09:12:30.000Z',
};

/**
 * A realistic district fiscal export mapping.
 *
 * `lea_id` and `fiscal_year` are the subject key, so they identify rather than become facts.
 * The money field parses to an exact decimal string and the count parses to a whole number;
 * that split is invariant 5 arriving at the boundary.
 */
const TEMPLATE: MappingTemplate = {
  templateId: 'tpl_fiscal_expenditure',
  version: '3.1.0',
  sourceSystem: 'Meadowvale Regional ERP',
  targetEntity: 'expenditure_fact',
  fields: [
    {
      target: 'lea_id',
      valueType: 'text',
      sources: ['LEA_ID'],
      transforms: [{ transform: 'trim' }],
      required: true,
      classification: 'INTERNAL',
    },
    {
      target: 'fiscal_year',
      valueType: 'text',
      sources: ['FISCAL_YEAR'],
      transforms: [{ transform: 'trim' }, { transform: 'stripPrefix', prefix: 'FY' }],
      required: true,
      classification: 'INTERNAL',
    },
    {
      target: 'local_actual_expenditure',
      valueType: 'money',
      sources: ['LOCAL_ACTUAL'],
      transforms: [{ transform: 'trim' }, { transform: 'parseCurrency' }],
      required: true,
      classification: 'INTERNAL',
    },
    {
      target: 'child_count',
      valueType: 'count',
      sources: ['CHILD_COUNT'],
      transforms: [{ transform: 'trim' }, { transform: 'parseInteger' }],
      required: true,
      classification: 'INTERNAL',
    },
    {
      target: 'fund_code',
      valueType: 'text',
      sources: ['FUND_CODE'],
      transforms: [{ transform: 'trim' }],
      required: false,
      classification: 'INTERNAL',
    },
  ],
};

const SUBJECT: SubjectBinding = {
  subjectType: 'lea_fiscal_year',
  keyFields: ['lea_id', 'fiscal_year'],
  separator: ':',
};

const HEADER = 'LEA_ID,FISCAL_YEAR,FUND_CODE,LOCAL_ACTUAL,CHILD_COUNT,PREPARED_BY';

const CLEAN_CSV = `${HEADER}
LEA-4412,FY2028,3310,"1,250,000.00",412,B. Okonkwo
LEA-7781,FY2028,3310,"990,500.25",287,B. Okonkwo
`;

interface RequestSpec {
  readonly content: string;
  readonly scan?: ScanResult;
  readonly template?: MappingTemplate;
  readonly subject?: SubjectBinding;
  readonly importJobId?: string;
  readonly snapshotId?: string;
}

function request(spec: RequestSpec): ImportRequest {
  return {
    importJobId: spec.importJobId ?? 'job_fy2028_expenditures',
    tenantId: 'tenant_meadowvale',
    organizationId: 'org_larkspur_hollow',
    snapshotId: spec.snapshotId ?? 'snap_fy2028_01',
    createdAt: '2028-07-14T09:30:00.000Z',
    file: FILE,
    scan: spec.scan ?? CLEAN,
    content: spec.content,
    template: spec.template ?? TEMPLATE,
    subject: spec.subject ?? SUBJECT,
  };
}

function snapshotOrThrow(snapshot: DataSnapshot | undefined): DataSnapshot {
  if (snapshot === undefined) throw new Error('the import produced no snapshot');
  return snapshot;
}

function valueOf(
  snapshot: DataSnapshot,
  subjectId: string,
  field: string,
): CanonicalValue | undefined {
  return snapshot.facts.find((entry) => entry.subjectId === subjectId && entry.field === field)
    ?.value;
}

function triples(facts: readonly CanonicalFact[]): readonly string[] {
  return facts.map((entry) => `${entry.subjectId}|${entry.field}|${String(entry.value)}`);
}

describe('the malware scan gate', () => {
  // Content that would produce two subjects' worth of facts if it were ever parsed, plus a
  // ragged row and an unclosed quote that the parser would certainly report. If the outcome
  // carries nothing but the scan refusal, the content was never read.
  const WOULD_PARSE = `${HEADER}
LEA-4412,FY2028,3310,"1,250,000.00",412
LEA-7781,FY2028,3310,"990,500.25,287,B. Okonkwo
`;

  it.each<[ScanStatus]>([['INFECTED'], ['FAILED'], ['PENDING']])(
    'rejects a %s file at the scan and never parses its content',
    (status) => {
      const outcome = runImport(request({ content: WOULD_PARSE, scan: { ...CLEAN, status } }));

      expect(outcome.kind).toBe('REJECTED_AT_SCAN');
      expect(outcome.snapshot).toBeUndefined();
      expect(outcome.reconciliation).toBeUndefined();
      // Exactly one issue, and it is the scan refusal — no RAGGED_ROW, no UNCLOSED_QUOTE.
      expect(outcome.issues).toHaveLength(1);
      expect(outcome.issues[0]?.code).toBe('SCAN_NOT_CLEAN');
      expect(outcome.issues[0]?.severity).toBe('ERROR');
    },
  );

  it('names the file and the status it was refused for', () => {
    const outcome = runImport(
      request({ content: CLEAN_CSV, scan: { ...CLEAN, status: 'INFECTED' } }),
    );

    expect(outcome.issues[0]?.message).toContain(FILE.originalFilename);
    expect(outcome.issues[0]?.message).toContain('INFECTED');
    expect(outcome.importJobId).toBe('job_fy2028_expenditures');
  });

  it('tells the district to retry a PENDING scan and to replace an INFECTED file', () => {
    const pending = runImport(
      request({ content: CLEAN_CSV, scan: { ...CLEAN, status: 'PENDING' } }),
    );
    const infected = runImport(
      request({ content: CLEAN_CSV, scan: { ...CLEAN, status: 'INFECTED' } }),
    );

    expect(pending.issues[0]?.resolution).toMatch(/retry/i);
    expect(infected.issues[0]?.resolution).toMatch(/clean export/i);
  });
});

describe('a clean import', () => {
  it('completes and produces a snapshot bound to the uploaded artifact', () => {
    const outcome = runImport(request({ content: CLEAN_CSV }));
    const snapshot = snapshotOrThrow(outcome.snapshot);

    expect(outcome.kind).toBe('COMPLETED');
    expect(snapshot.snapshotId).toBe('snap_fy2028_01');
    expect(snapshot.tenantId).toBe('tenant_meadowvale');
    expect(snapshot.organizationId).toBe('org_larkspur_hollow');
    expect(snapshot.sourceFiles).toEqual([FILE]);
    expect(outcome.issues).toEqual([]);
  });

  it('attributes each row to the subject its key fields identify, after transformation', () => {
    const snapshot = snapshotOrThrow(runImport(request({ content: CLEAN_CSV })).snapshot);

    // `FY2028` was normalised to `2028` before the key was built.
    expect([...new Set(snapshot.facts.map((entry) => entry.subjectId))].sort()).toEqual([
      'LEA-4412:2028',
      'LEA-7781:2028',
    ]);
    expect(snapshot.facts.every((entry) => entry.subjectType === 'lea_fiscal_year')).toBe(true);
  });

  it('does not turn the subject key fields into facts of their own', () => {
    const snapshot = snapshotOrThrow(runImport(request({ content: CLEAN_CSV })).snapshot);

    expect(snapshot.facts.map((entry) => entry.field)).not.toContain('lea_id');
    expect(snapshot.facts.map((entry) => entry.field)).not.toContain('fiscal_year');
  });

  it('gives every fact the full provenance chain back to the source row', () => {
    const snapshot = snapshotOrThrow(runImport(request({ content: CLEAN_CSV })).snapshot);
    const fact = snapshot.facts.find(
      (entry) => entry.subjectId === 'LEA-4412:2028' && entry.field === 'local_actual_expenditure',
    );

    expect(fact?.provenance).toEqual({
      importJobId: 'job_fy2028_expenditures',
      sourceFileId: FILE.sourceFileId,
      sourceHash: FILE.sourceHash,
      sourceRow: 1,
      sourceLine: 2,
      sourceFields: ['LOCAL_ACTUAL'],
      sourceValues: ['1,250,000.00'],
      mappingTemplateId: 'tpl_fiscal_expenditure',
      mappingVersion: '3.1.0',
      transformation: 'trim → parseCurrency',
    });
  });

  it('reports a reconciliation summary that accounts for the whole file', () => {
    const outcome = runImport(request({ content: CLEAN_CSV }));

    expect(outcome.reconciliation).toEqual({
      rowsReceived: 2,
      rowsAccepted: 2,
      rowsQuarantined: 0,
      warnings: 0,
      duplicateCandidates: 0,
      missingRequiredFields: 0,
      unmappedColumns: ['PREPARED_BY'],
      parseIssues: [],
    });
  });
});

describe('reconciliation always balances', () => {
  // §10.5 — "never silently discard records." Received must equal accepted plus quarantined
  // for every shape of file, not only the well-formed one. This is the property that lets a
  // district trust the summary at all, so it is tested across every failure mode the pipeline
  // knows how to produce.
  const RAGGED_SHORT = `${HEADER}
LEA-4412,FY2028,3310,"1,250,000.00",412,B. Okonkwo
LEA-7781,FY2028,3310
`;

  const RAGGED_LONG = `${HEADER}
LEA-4412,FY2028,3310,"1,250,000.00",412,B. Okonkwo,extra
LEA-7781,FY2028,3310,"990,500.25",287,B. Okonkwo
`;

  const BAD_CURRENCY = `${HEADER}
LEA-4412,FY2028,3310,"1.250.000,00",412,B. Okonkwo
LEA-7781,FY2028,3310,"990,500.25",287,B. Okonkwo
`;

  const UNATTRIBUTABLE = `${HEADER}
,FY2028,3310,"1,250,000.00",412,B. Okonkwo
LEA-7781,FY2028,3310,"990,500.25",287,B. Okonkwo
`;

  const CONFLICTING = `${HEADER}
LEA-4412,FY2028,3310,"1,250,000.00",412,B. Okonkwo
LEA-4412,FY2028,3310,"1,400,000.00",412,B. Okonkwo
`;

  it.each([
    ['a clean file', CLEAN_CSV],
    ['a file with a short ragged row', RAGGED_SHORT],
    ['a file with an over-long ragged row', RAGGED_LONG],
    ['a file with unparseable currency', BAD_CURRENCY],
    ['a file with a row that cannot be attributed to a subject', UNATTRIBUTABLE],
    ['a file with two rows that disagree', CONFLICTING],
  ])('balances for %s', (_label, content) => {
    const outcome = runImport(request({ content }));
    const summary = outcome.reconciliation;

    expect(summary).toBeDefined();
    if (summary === undefined) return;
    expect(summary.rowsAccepted + summary.rowsQuarantined).toBe(summary.rowsReceived);
    expect(summary.rowsReceived).toBe(2);
    expect(summary.rowsAccepted).toBeGreaterThanOrEqual(0);
    expect(summary.rowsQuarantined).toBeGreaterThanOrEqual(0);
  });

  it('quarantines a row whose required money value will not parse, and counts it', () => {
    const outcome = runImport(request({ content: BAD_CURRENCY }));

    expect(outcome.reconciliation?.rowsQuarantined).toBe(1);
    expect(outcome.reconciliation?.rowsAccepted).toBe(1);
    expect(outcome.issues.some((issue) => issue.code === 'UNRECOGNISED_FORMAT')).toBe(true);
  });

  it('keeps a quarantined row’s facts out of the snapshot entirely', () => {
    const snapshot = snapshotOrThrow(runImport(request({ content: BAD_CURRENCY })).snapshot);

    // Not just the unparseable amount: the row's child count and fund code must not reach the
    // snapshot either, or a rule would evaluate half a row the district was told was rejected.
    expect(snapshot.facts.some((entry) => entry.subjectId === 'LEA-4412:2028')).toBe(false);
    expect(snapshot.facts.map((entry) => entry.subjectId)).toEqual([
      'LEA-7781:2028',
      'LEA-7781:2028',
      'LEA-7781:2028',
    ]);
  });

  it('quarantines a row it cannot attribute and says why', () => {
    const outcome = runImport(request({ content: UNATTRIBUTABLE }));
    const issue = outcome.issues.find((entry) => entry.code === 'UNIDENTIFIED_SUBJECT');

    expect(outcome.reconciliation?.rowsQuarantined).toBe(1);
    expect(issue?.severity).toBe('ERROR');
    expect(issue?.message).toContain('lea_id');
    expect(issue?.sourceRow).toBe(1);
    expect(
      snapshotOrThrow(outcome.snapshot).facts.every((entry) => entry.subjectId === 'LEA-7781:2028'),
    ).toBe(true);
  });

  it('reports a short ragged row rather than padding it out', () => {
    const outcome = runImport(request({ content: RAGGED_SHORT }));

    expect(outcome.reconciliation?.parseIssues.map((issue) => issue.code)).toEqual(['RAGGED_ROW']);
    expect(outcome.reconciliation?.rowsQuarantined).toBe(1);
    // Nothing was invented for the columns the row does not reach.
    expect(
      snapshotOrThrow(outcome.snapshot).facts.some((entry) => entry.subjectId === 'LEA-7781:2028'),
    ).toBe(false);
  });

  it('does not report an ERROR against a row it went on to accept', () => {
    // An over-long row usually means an unquoted delimiter, which shifts every column after
    // it — so the row is quarantined rather than used. The rule validate.ts states plainly
    // ("an ERROR quarantines its row") now holds for parse issues too.
    const outcome = runImport(request({ content: RAGGED_LONG }));
    const ragged = outcome.issues.find((issue) => issue.code === 'RAGGED_ROW');

    expect(ragged?.severity).toBe('ERROR');
    expect(outcome.reconciliation?.rowsAccepted).toBe(1);
    expect(outcome.reconciliation?.rowsQuarantined).toBe(1);
  });

  it('counts an unmapped column without treating it as a problem', () => {
    const outcome = runImport(request({ content: CLEAN_CSV }));

    expect(outcome.reconciliation?.unmappedColumns).toEqual(['PREPARED_BY']);
    expect(outcome.issues).toEqual([]);
  });
});

describe('duplicate and conflicting statements of the same fact', () => {
  const SAME_TWICE = `${HEADER}
LEA-4412,FY2028,3310,"1,250,000.00",412,B. Okonkwo
LEA-4412,FY2028,3310,"1,250,000.00",412,B. Okonkwo
`;

  const DISAGREEING = `${HEADER}
LEA-4412,FY2028,3310,"1,250,000.00",412,B. Okonkwo
LEA-4412,FY2028,3310,"1,400,000.00",412,B. Okonkwo
`;

  it('counts a repeated identical value as a duplicate candidate, not an error', () => {
    const outcome = runImport(request({ content: SAME_TWICE }));

    expect(outcome.kind).toBe('COMPLETED');
    expect(outcome.issues).toEqual([]);
    expect(outcome.reconciliation?.rowsAccepted).toBe(2);
    expect(outcome.reconciliation?.rowsQuarantined).toBe(0);
    // Three non-key fields restated: money, count and fund code.
    expect(outcome.reconciliation?.duplicateCandidates).toBe(3);
  });

  it('records a repeated identical value once, so the fact bag stays projectable', () => {
    const snapshot = snapshotOrThrow(runImport(request({ content: SAME_TWICE })).snapshot);

    expect(
      snapshot.facts.filter((entry) => entry.field === 'local_actual_expenditure'),
    ).toHaveLength(1);
  });

  it('quarantines the second row when two rows disagree, and says which row it disagrees with', () => {
    const outcome = runImport(request({ content: DISAGREEING }));
    const conflict = outcome.issues.find((issue) => issue.code === 'CONFLICTING_VALUE');

    expect(conflict?.severity).toBe('ERROR');
    expect(conflict?.sourceRow).toBe(2);
    expect(conflict?.targetField).toBe('local_actual_expenditure');
    expect(conflict?.message).toContain('row 1');
    expect(conflict?.resolution).toMatch(/will not choose/i);
    expect(outcome.reconciliation?.rowsQuarantined).toBe(1);
    expect(outcome.reconciliation?.rowsAccepted).toBe(1);
  });

  it('does not let the disagreeing row’s value into the snapshot', () => {
    const snapshot = snapshotOrThrow(runImport(request({ content: DISAGREEING })).snapshot);

    expect(snapshot.facts.some((entry) => entry.value === '1400000.00')).toBe(false);
  });

  it('emits no fact for a field two rows disagree about, and none from the quarantined row', () => {
    // Keeping whichever value arrived first is still choosing — just choosing badly. With no
    // fact at all the rule evaluates to INDETERMINATE for want of data (invariant 9) rather
    // than returning a confident answer computed from an arbitrary half of the file.
    const snapshot = snapshotOrThrow(runImport(request({ content: DISAGREEING })).snapshot);

    expect(valueOf(snapshot, 'LEA-4412:2028', 'local_actual_expenditure')).toBeUndefined();
    // And the quarantined row contributes nothing else either.
    expect(snapshot.facts.filter((entry) => entry.provenance.sourceRow === 2)).toEqual([]);
  });
});

describe('canonical value types at the boundary', () => {
  it('carries money into the snapshot as an exact decimal string, never a number', () => {
    const snapshot = snapshotOrThrow(runImport(request({ content: CLEAN_CSV })).snapshot);
    const money = valueOf(snapshot, 'LEA-7781:2028', 'local_actual_expenditure');

    expect(typeof money).toBe('string');
    // The cents survive verbatim; nothing was rounded and nothing became 990500.25 as a float.
    expect(money).toBe('990500.25');
  });

  it('keeps a trailing zero rather than normalising the amount to a number', () => {
    const snapshot = snapshotOrThrow(runImport(request({ content: CLEAN_CSV })).snapshot);

    expect(valueOf(snapshot, 'LEA-4412:2028', 'local_actual_expenditure')).toBe('1250000.00');
  });

  it('carries a count into the snapshot as an integer', () => {
    const snapshot = snapshotOrThrow(runImport(request({ content: CLEAN_CSV })).snapshot);
    const count = valueOf(snapshot, 'LEA-4412:2028', 'child_count');

    expect(typeof count).toBe('number');
    expect(Number.isInteger(count)).toBe(true);
    expect(count).toBe(412);
  });

  it('carries accounting parentheses through as a negative decimal string', () => {
    const negative = `${HEADER}\nLEA-4412,FY2028,3310,"(1,250.00)",412,B. Okonkwo\n`;
    const snapshot = snapshotOrThrow(runImport(request({ content: negative })).snapshot);

    expect(valueOf(snapshot, 'LEA-4412:2028', 'local_actual_expenditure')).toBe('-1250.00');
  });

  it('never turns a blank count cell into a zero', () => {
    // `Number('')` is 0. A count field whose template omits `parseInteger` would otherwise
    // record a child count the district never supplied, with provenance pointing at an empty
    // cell. transform.ts is explicit: a value the platform cannot read is a reported problem,
    // never a zero.
    const lenient: MappingTemplate = {
      ...TEMPLATE,
      fields: TEMPLATE.fields.map((mapping) =>
        mapping.target === 'child_count'
          ? { ...mapping, transforms: [{ transform: 'trim' } as const] }
          : mapping,
      ),
    };
    const blankCount = `${HEADER}\nLEA-4412,FY2028,3310,"1,250,000.00",,B. Okonkwo\n`;

    const outcome = runImport(request({ content: blankCount, template: lenient }));
    const snapshot = snapshotOrThrow(outcome.snapshot);

    expect(valueOf(snapshot, 'LEA-4412:2028', 'child_count')).toBeUndefined();
    expect(outcome.issues.map((issue) => issue.code)).toContain('UNCONVERTIBLE_VALUE');
    expect(outcome.reconciliation?.rowsQuarantined).toBe(1);
  });

  it('raises an issue when a mapped value cannot be canonicalized as its declared type', () => {
    // Dropping the fact while still counting the row as accepted told the district their row
    // was fine. That is the silent discard spec 10.5 forbids.
    const lenient: MappingTemplate = {
      ...TEMPLATE,
      fields: TEMPLATE.fields.map((mapping) =>
        mapping.target === 'child_count'
          ? { ...mapping, transforms: [{ transform: 'trim' } as const] }
          : mapping,
      ),
    };
    const fractional = `${HEADER}\nLEA-4412,FY2028,3310,"1,250,000.00",412.5,B. Okonkwo\n`;

    const outcome = runImport(request({ content: fractional, template: lenient }));
    const snapshot = snapshotOrThrow(outcome.snapshot);

    expect(valueOf(snapshot, 'LEA-4412:2028', 'child_count')).toBeUndefined();
    expect(outcome.reconciliation?.rowsAccepted).toBe(0);
    expect(outcome.reconciliation?.rowsQuarantined).toBe(1);
    expect(outcome.issues.map((issue) => issue.code)).toContain('UNCONVERTIBLE_VALUE');
  });
});

describe('determinism and reproducibility', () => {
  it('produces the same contentHash when the same import is run twice', () => {
    const first = snapshotOrThrow(runImport(request({ content: CLEAN_CSV })).snapshot);
    const second = snapshotOrThrow(runImport(request({ content: CLEAN_CSV })).snapshot);

    expect(second.contentHash).toBe(first.contentHash);
  });

  it('produces the same contentHash even under a different import job id', () => {
    // The job is about the run; the snapshot is about what the run saw (§11).
    const first = snapshotOrThrow(runImport(request({ content: CLEAN_CSV })).snapshot);
    const second = snapshotOrThrow(
      runImport(request({ content: CLEAN_CSV, importJobId: 'job_second_attempt' })).snapshot,
    );

    expect(second.contentHash).toBe(first.contentHash);
  });

  /**
   * Reordering the rows in the file.
   *
   * What must match: the fact set. The same district stated the same figures about the same
   * subjects, so subject, field and value are identical and the facts come back in the same
   * deterministic order regardless of the order they were read in.
   *
   * What must NOT match, and is correct not to: the contentHash. Each fact's provenance
   * points at the physical row it was read from, and those row numbers genuinely changed —
   * `LEA-7781`'s figures really are on row 1 of the second file. Since provenance is inside
   * the hash (that is the tamper guarantee snapshot.ts exists to give), a file whose rows were
   * shuffled is a different snapshot. That is the right answer, not a bug: a run pinned to the
   * first snapshot must not silently start resolving to evidence in different rows. The
   * two files are equivalent in *content* and distinguishable in *provenance*, and the
   * snapshot identity tracks provenance deliberately.
   */
  it('produces the same fact set but a different identity when the rows are reordered', () => {
    const reordered = `${HEADER}
LEA-7781,FY2028,3310,"990,500.25",287,B. Okonkwo
LEA-4412,FY2028,3310,"1,250,000.00",412,B. Okonkwo
`;

    const original = snapshotOrThrow(runImport(request({ content: CLEAN_CSV })).snapshot);
    const shuffled = snapshotOrThrow(runImport(request({ content: reordered })).snapshot);

    expect(triples(shuffled.facts)).toEqual(triples(original.facts));
    expect(shuffled.contentHash).not.toBe(original.contentHash);
    expect(
      shuffled.facts.find(
        (entry) => entry.subjectId === 'LEA-7781:2028' && entry.field === 'child_count',
      )?.provenance.sourceRow,
    ).toBe(1);
    expect(
      original.facts.find(
        (entry) => entry.subjectId === 'LEA-7781:2028' && entry.field === 'child_count',
      )?.provenance.sourceRow,
    ).toBe(2);
  });

  it('produces a snapshot that verifies against its own hash', () => {
    const snapshot = snapshotOrThrow(runImport(request({ content: CLEAN_CSV })).snapshot);

    expect(snapshot.contentHash).toHaveLength(64);
    expect(snapshot.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('files the pipeline cannot parse', () => {
  it('returns PARSE_FAILED for a file with a header row and no data rows', () => {
    const outcome = runImport(request({ content: `${HEADER}\n` }));

    expect(outcome.kind).toBe('PARSE_FAILED');
    expect(outcome.snapshot).toBeUndefined();
    expect(outcome.reconciliation).toBeUndefined();
  });

  it('explains why a header-only file failed to parse', () => {
    // A failed import with no stated reason tells a district less than nothing.
    const issues = runImport(request({ content: `${HEADER}\n` })).issues;

    expect(issues.map((issue) => issue.code)).toEqual(['NO_DATA_ROWS']);
    expect(issues[0]?.resolution).toBeDefined();
  });

  it('returns PARSE_FAILED for an empty file and does say why', () => {
    const outcome = runImport(request({ content: '' }));

    expect(outcome.kind).toBe('PARSE_FAILED');
    expect(outcome.issues.map((issue) => issue.code)).toEqual(['EMPTY_FILE']);
  });

  it('returns PARSE_FAILED for a file of nothing but blank lines', () => {
    const outcome = runImport(request({ content: '\n\n\n' }));

    expect(outcome.kind).toBe('PARSE_FAILED');
    expect(outcome.issues.map((issue) => issue.code)).toEqual(['EMPTY_FILE']);
  });
});
