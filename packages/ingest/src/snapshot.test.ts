/**
 * Behavioural tests for canonical facts and immutable data snapshots.
 *
 * Spec: Master Technical Buildout sections 10.6 and 11. CLAUDE.md invariants 3 and 4.
 *
 * A snapshot is an identity claim: "these are the facts a run saw, and this is where each of
 * them came from". The tests below defend that claim from both directions — the identity must
 * not move when nothing material changed (or every run comparison reports spurious drift),
 * and it must move when anything material changed, provenance included.
 */

import { describe, expect, it } from 'vitest';
import type { CanonicalValue, DataClassification, FactOrigin } from '@complianceos/domain';
import type { ValueType } from './mapping.js';
import {
  isFileRowProvenance,
  type DeterminationProvenance,
  type FactProvenance,
  type FileRowProvenance,
  type SourceFileRef,
} from './provenance.js';
import {
  DuplicateFactError,
  FactOriginError,
  ProvenanceShapeError,
  buildSnapshot,
  computeSnapshotHash,
  projectFactBag,
  provenanceFor,
  sourceFileFor,
  verifySnapshot,
  type CanonicalFact,
  type DataSnapshot,
} from './snapshot.js';

const FILE: SourceFileRef = {
  sourceFileId: 'file_fy2028_expenditures',
  originalFilename: 'FY2028 Expenditure Export.csv',
  sourceHash: '1'.repeat(64),
  uploadedAt: '2028-07-14T09:12:00.000Z',
  uploadedBy: 'user_business_officer',
};

const OTHER_FILE: SourceFileRef = {
  sourceFileId: 'file_fy2028_child_count',
  originalFilename: 'FY2028 Child Count.csv',
  sourceHash: '2'.repeat(64),
  uploadedAt: '2028-07-14T09:20:00.000Z',
  uploadedBy: 'user_business_officer',
};

interface ProvenanceSpec {
  readonly sourceRow?: number;
  readonly sourceLine?: number;
  readonly sourceFields?: readonly string[];
  readonly sourceValues?: readonly (string | null)[];
  readonly sourceFileId?: string;
  readonly sourceHash?: string;
  readonly importJobId?: string;
  readonly mappingTemplateId?: string;
  readonly mappingVersion?: string;
  readonly transformation?: string;
}

/**
 * Narrow to the file-row form.
 *
 * Everything the import pipeline produces is one. A determination reaching here would be a
 * bug worth failing loudly on rather than an optional chain that quietly asserts undefined.
 */
function fileRow(provenance: FactProvenance | undefined): FileRowProvenance {
  if (provenance === undefined || !isFileRowProvenance(provenance)) {
    throw new Error(`expected file-row provenance, got ${provenance?.kind ?? 'nothing'}`);
  }
  return provenance;
}

function provenance(spec: ProvenanceSpec = {}): FileRowProvenance {
  return {
    kind: 'FILE_ROW',
    importJobId: spec.importJobId ?? 'job_fy2028_expenditures',
    sourceFileId: spec.sourceFileId ?? FILE.sourceFileId,
    sourceHash: spec.sourceHash ?? FILE.sourceHash,
    sourceRow: spec.sourceRow ?? 1,
    sourceLine: spec.sourceLine ?? 2,
    sourceFields: spec.sourceFields ?? ['LOCAL_ACTUAL'],
    sourceValues: spec.sourceValues ?? ['1,250,000.00'],
    mappingTemplateId: spec.mappingTemplateId ?? 'tpl_fiscal_expenditure',
    mappingVersion: spec.mappingVersion ?? '3.1.0',
    transformation: spec.transformation ?? 'trim → parseCurrency',
  };
}

interface FactSpec {
  readonly field: string;
  readonly value: CanonicalValue;
  readonly subjectId?: string;
  readonly subjectType?: string;
  readonly classification?: DataClassification;
  readonly origin?: FactOrigin;
  readonly provenance?: FactProvenance;
  readonly valueType?: ValueType;
}

/** A plausible carry-forward record, for the origins that are not a district's file. */
function determination(): DeterminationProvenance {
  return {
    kind: 'DETERMINATION',
    assessmentRunId: 'RUN-MOE-COMPLIANCE-2027-0001',
    ruleId: 'IDEA-MOE-COMPLIANCE-001',
    rulePackId: 'US-FED-IDEA-B-2026',
    rulePackVersion: '0.1.0',
    dataSnapshotId: 'snap_fy2027',
    engineVersion: '0.1.0',
    evaluationHash: 'a'.repeat(64),
    derivedFrom: 'output.moeStatus',
    determinedAt: '2027-09-01T00:00:00.000Z',
  };
}

function fact(spec: FactSpec): CanonicalFact {
  const origin = spec.origin ?? 'DISTRICT_EXPORT';
  return {
    subjectType: spec.subjectType ?? 'lea_fiscal_year',
    subjectId: spec.subjectId ?? 'LEA-4412:2028',
    field: spec.field,
    value: spec.value,
    valueType: spec.valueType ?? 'text',
    classification: spec.classification ?? 'INTERNAL',
    origin,
    // Defaulted to the shape the origin is entitled to, so a fixture cannot accidentally
    // describe a determination as a spreadsheet row — which is the incoherence
    // `buildSnapshot` now refuses, and which these fixtures used to contain.
    provenance: spec.provenance ?? (origin === 'DISTRICT_EXPORT' ? provenance() : determination()),
  };
}

const LOCAL_ACTUAL = fact({
  field: 'local_actual_expenditure',
  value: '1250000.00',
  provenance: provenance({ sourceRow: 1, sourceFields: ['LOCAL_ACTUAL'] }),
});

const CHILD_COUNT = fact({
  field: 'child_count',
  value: 412,
  provenance: provenance({
    sourceRow: 2,
    sourceFields: ['CHILD_COUNT'],
    sourceValues: ['412'],
    transformation: 'trim → parseInteger',
  }),
});

const STATE_ACTUAL = fact({
  field: 'state_actual_expenditure',
  value: '480000.00',
  provenance: provenance({ sourceRow: 3, sourceFields: ['STATE_ACTUAL'] }),
});

const FACTS: readonly CanonicalFact[] = [LOCAL_ACTUAL, CHILD_COUNT, STATE_ACTUAL];

function snapshotOf(facts: readonly CanonicalFact[], files: readonly SourceFileRef[] = [FILE]) {
  return buildSnapshot({
    snapshotId: 'snap_fy2028_01',
    tenantId: 'tenant_meadowvale',
    organizationId: 'org_larkspur_hollow',
    createdAt: '2028-07-14T09:30:00.000Z',
    sourceFiles: files,
    facts,
  });
}

describe('computeSnapshotHash — stability', () => {
  it('does not depend on the order the facts are supplied in', () => {
    const forwards = computeSnapshotHash([LOCAL_ACTUAL, CHILD_COUNT, STATE_ACTUAL], [FILE]);
    const backwards = computeSnapshotHash([STATE_ACTUAL, CHILD_COUNT, LOCAL_ACTUAL], [FILE]);
    const shuffled = computeSnapshotHash([CHILD_COUNT, LOCAL_ACTUAL, STATE_ACTUAL], [FILE]);

    expect(backwards).toBe(forwards);
    expect(shuffled).toBe(forwards);
  });

  it('does not depend on the order the source files are supplied in', () => {
    const facts = [LOCAL_ACTUAL, CHILD_COUNT];

    expect(computeSnapshotHash(facts, [FILE, OTHER_FILE])).toBe(
      computeSnapshotHash(facts, [OTHER_FILE, FILE]),
    );
  });

  it('is the same for two independently constructed but identical fact sets', () => {
    const rebuilt = FACTS.map((original) => ({
      ...original,
      provenance: { ...original.provenance },
    }));

    expect(computeSnapshotHash(rebuilt, [FILE])).toBe(computeSnapshotHash(FACTS, [FILE]));
  });

  it('separates two facts for one field by source row without collapsing them', () => {
    // A subject can legitimately carry repeated line items for one field before roll-up.
    const lineOne = fact({
      field: 'expenditure_line',
      value: '100.00',
      provenance: provenance({ sourceRow: 1 }),
    });
    const lineTwo = fact({
      field: 'expenditure_line',
      value: '200.00',
      provenance: provenance({ sourceRow: 2 }),
    });

    expect(computeSnapshotHash([lineOne, lineTwo], [FILE])).toBe(
      computeSnapshotHash([lineTwo, lineOne], [FILE]),
    );
  });
});

describe('computeSnapshotHash — sensitivity', () => {
  const baseline = computeSnapshotHash(FACTS, [FILE]);

  it('changes when a fact value changes', () => {
    const altered = [{ ...LOCAL_ACTUAL, value: '1250000.01' }, CHILD_COUNT, STATE_ACTUAL];

    expect(computeSnapshotHash(altered, [FILE])).not.toBe(baseline);
  });

  it('changes when a money value gains a trailing zero, since the string is the value', () => {
    const altered = [{ ...LOCAL_ACTUAL, value: '1250000.000' }, CHILD_COUNT, STATE_ACTUAL];

    expect(computeSnapshotHash(altered, [FILE])).not.toBe(baseline);
  });

  it('changes when a fact is added', () => {
    const added = [...FACTS, fact({ field: 'federal_actual_expenditure', value: '75000.00' })];

    expect(computeSnapshotHash(added, [FILE])).not.toBe(baseline);
  });

  it('changes when a fact is removed', () => {
    expect(computeSnapshotHash([LOCAL_ACTUAL, CHILD_COUNT], [FILE])).not.toBe(baseline);
  });

  it('changes when the subject a fact is attributed to changes', () => {
    const reattributed = [
      { ...LOCAL_ACTUAL, subjectId: 'LEA-7781:2028' },
      CHILD_COUNT,
      STATE_ACTUAL,
    ];

    expect(computeSnapshotHash(reattributed, [FILE])).not.toBe(baseline);
  });

  it('changes when the uploaded bytes behind the snapshot change', () => {
    const restated: SourceFileRef = { ...FILE, sourceHash: '9'.repeat(64) };

    expect(computeSnapshotHash(FACTS, [restated])).not.toBe(baseline);
  });

  // This is the guarantee that a snapshot cannot be quietly re-pointed at different source
  // data while keeping its identity. If provenance were outside the hash, a sealed snapshot
  // could be edited so that the same $1,250,000 figure claimed to come from a different row,
  // a different column, or a different mapping version — and every run that pinned the
  // snapshot id would still verify. Provenance is part of what the run saw, so the identity
  // has to move with it even though no value moved.
  it.each([
    ['the source row it points at', provenance({ sourceRow: 99 })],
    ['the source columns it was derived from', provenance({ sourceFields: ['LOCAL_BUDGET'] })],
    ['the file it points at', provenance({ sourceFileId: 'file_something_else' })],
    ['the mapping template that produced it', provenance({ mappingTemplateId: 'tpl_other' })],
    ['the mapping version that produced it', provenance({ mappingVersion: '4.0.0' })],
    ['the transformation chain applied to it', provenance({ transformation: 'identity' })],
  ])('changes when provenance changes and the value does not: %s', (_label, tampered) => {
    const edited = [{ ...LOCAL_ACTUAL, provenance: tampered }, CHILD_COUNT, STATE_ACTUAL];

    expect(edited[0]?.value).toBe(LOCAL_ACTUAL.value);
    expect(computeSnapshotHash(edited, [FILE])).not.toBe(baseline);
  });

  it('changes when the RAW source values recorded on a fact are edited', () => {
    // The raw source text and the physical line are what a monitor is shown on the
    // finding-detail screen, so they are evidence. Excluded from the hash, a sealed snapshot
    // could be edited to claim a district's cell said something it never said, with
    // `verifySnapshot` still returning true.
    const edited = [
      {
        ...LOCAL_ACTUAL,
        provenance: provenance({
          sourceValues: ['9,999,999.00'],
          sourceLine: 4001,
          sourceHash: '0'.repeat(64),
        }),
      },
      CHILD_COUNT,
      STATE_ACTUAL,
    ];

    expect(computeSnapshotHash(edited, [FILE])).not.toBe(baseline);
  });

  it('ignores the importJobId, so re-importing identical bytes is the same snapshot', () => {
    // Deliberate and correct: the job id is about the run, not about what the run saw.
    const reimported = [
      { ...LOCAL_ACTUAL, provenance: provenance({ importJobId: 'job_second_attempt' }) },
      CHILD_COUNT,
      STATE_ACTUAL,
    ];

    expect(computeSnapshotHash(reimported, [FILE])).toBe(baseline);
  });

  it('ignores the classification, which is policy metadata rather than observed data', () => {
    const reclassified = [
      { ...LOCAL_ACTUAL, classification: 'CONFIDENTIAL' as DataClassification },
      CHILD_COUNT,
      STATE_ACTUAL,
    ];

    expect(computeSnapshotHash(reclassified, [FILE])).toBe(baseline);
  });

  it('distinguishes the string "412" from the integer 412', () => {
    const asText = [fact({ field: 'child_count', value: '412' })];
    const asNumber = [fact({ field: 'child_count', value: 412 })];

    expect(computeSnapshotHash(asText, [FILE])).not.toBe(computeSnapshotHash(asNumber, [FILE]));
  });
});

describe('buildSnapshot', () => {
  it('carries the caller-supplied identity and clock rather than reading either itself', () => {
    const snapshot = snapshotOf(FACTS);

    expect(snapshot.snapshotId).toBe('snap_fy2028_01');
    expect(snapshot.tenantId).toBe('tenant_meadowvale');
    expect(snapshot.organizationId).toBe('org_larkspur_hollow');
    expect(snapshot.createdAt).toBe('2028-07-14T09:30:00.000Z');
  });

  it('stores the facts in the deterministic order the hash is computed over', () => {
    const snapshot = snapshotOf([STATE_ACTUAL, LOCAL_ACTUAL, CHILD_COUNT]);

    expect(snapshot.facts.map((entry) => entry.field)).toEqual([
      'child_count',
      'local_actual_expenditure',
      'state_actual_expenditure',
    ]);
  });

  it('produces the same contentHash whatever order the facts arrived in', () => {
    expect(snapshotOf([STATE_ACTUAL, LOCAL_ACTUAL, CHILD_COUNT]).contentHash).toBe(
      snapshotOf(FACTS).contentHash,
    );
  });

  it('does not mutate the array it was handed', () => {
    const supplied = [STATE_ACTUAL, LOCAL_ACTUAL, CHILD_COUNT];
    snapshotOf(supplied);

    expect(supplied.map((entry) => entry.field)).toEqual([
      'state_actual_expenditure',
      'local_actual_expenditure',
      'child_count',
    ]);
  });

  it('seals an empty fact set rather than refusing it', () => {
    const empty = snapshotOf([]);

    expect(empty.facts).toEqual([]);
    expect(verifySnapshot(empty)).toBe(true);
  });
});

describe('verifySnapshot', () => {
  it('accepts a snapshot exactly as it was sealed', () => {
    expect(verifySnapshot(snapshotOf(FACTS))).toBe(true);
  });

  it('detects a fact whose value was mutated after sealing', () => {
    const sealed = snapshotOf(FACTS);
    const [first, ...rest] = sealed.facts;
    if (first === undefined) throw new Error('fixture must seal at least one fact');

    // The contentHash is deliberately kept: this is what an edited row in the facts table,
    // or an altered export, would look like to the verifier.
    const tampered: DataSnapshot = { ...sealed, facts: [{ ...first, value: '1.00' }, ...rest] };

    expect(verifySnapshot(tampered)).toBe(false);
  });

  it('detects a fact whose provenance was re-pointed at another row after sealing', () => {
    const sealed = snapshotOf(FACTS);
    const [first, ...rest] = sealed.facts;
    if (first === undefined) throw new Error('fixture must seal at least one fact');

    const tampered: DataSnapshot = {
      ...sealed,
      facts: [{ ...first, provenance: { ...fileRow(first.provenance), sourceRow: 4001 } }, ...rest],
    };

    expect(verifySnapshot(tampered)).toBe(false);
  });

  it('detects a fact deleted from a sealed snapshot', () => {
    const sealed = snapshotOf(FACTS);
    const tampered: DataSnapshot = { ...sealed, facts: sealed.facts.slice(1) };

    expect(verifySnapshot(tampered)).toBe(false);
  });

  it('detects a fact inserted into a sealed snapshot', () => {
    const sealed = snapshotOf(FACTS);
    const tampered: DataSnapshot = {
      ...sealed,
      facts: [...sealed.facts, fact({ field: 'federal_actual_expenditure', value: '75000.00' })],
    };

    expect(verifySnapshot(tampered)).toBe(false);
  });

  it('detects a source file swapped for different bytes', () => {
    const sealed = snapshotOf(FACTS);
    const tampered: DataSnapshot = {
      ...sealed,
      sourceFiles: [{ ...FILE, sourceHash: '3'.repeat(64) }],
    };

    expect(verifySnapshot(tampered)).toBe(false);
  });

  it('still verifies when only the facts are re-ordered, which is not a material change', () => {
    const sealed = snapshotOf(FACTS);
    const reordered: DataSnapshot = { ...sealed, facts: [...sealed.facts].reverse() };

    expect(verifySnapshot(reordered)).toBe(true);
  });
});

describe('projectFactBag', () => {
  const MULTI_SUBJECT = snapshotOf([
    LOCAL_ACTUAL,
    CHILD_COUNT,
    fact({
      field: 'local_actual_expenditure',
      value: '990000.00',
      subjectId: 'LEA-7781:2028',
      provenance: provenance({ sourceRow: 4 }),
    }),
    fact({
      field: 'local_actual_expenditure',
      value: '880000.00',
      subjectType: 'lea_fiscal_year_draft',
      provenance: provenance({ sourceRow: 5 }),
    }),
  ]);

  it('returns only the named subject’s facts, keyed by canonical field', () => {
    expect(projectFactBag(MULTI_SUBJECT, 'lea_fiscal_year', 'LEA-4412:2028')).toEqual({
      local_actual_expenditure: '1250000.00',
      child_count: 412,
    });
  });

  it('does not leak a sibling subject’s value for the same field', () => {
    expect(projectFactBag(MULTI_SUBJECT, 'lea_fiscal_year', 'LEA-7781:2028')).toEqual({
      local_actual_expenditure: '990000.00',
    });
  });

  it('distinguishes subjects of different types that share an id', () => {
    expect(projectFactBag(MULTI_SUBJECT, 'lea_fiscal_year_draft', 'LEA-4412:2028')).toEqual({
      local_actual_expenditure: '880000.00',
    });
  });

  it('returns an empty bag for a subject the snapshot knows nothing about', () => {
    expect(projectFactBag(MULTI_SUBJECT, 'lea_fiscal_year', 'LEA-0000:2028')).toEqual({});
  });

  it('throws DuplicateFactError rather than picking one of two values for a field', () => {
    const conflicted = snapshotOf([
      LOCAL_ACTUAL,
      fact({
        field: 'local_actual_expenditure',
        value: '1400000.00',
        provenance: provenance({ sourceRow: 7 }),
      }),
    ]);

    expect(() => projectFactBag(conflicted, 'lea_fiscal_year', 'LEA-4412:2028')).toThrow(
      DuplicateFactError,
    );
  });

  it('names the field and the subject on the error so the conflict can be found', () => {
    const conflicted = snapshotOf([
      LOCAL_ACTUAL,
      fact({
        field: 'local_actual_expenditure',
        value: '1400000.00',
        provenance: provenance({ sourceRow: 7 }),
      }),
    ]);

    try {
      projectFactBag(conflicted, 'lea_fiscal_year', 'LEA-4412:2028');
      expect.unreachable('a duplicate fact must not be projected');
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateFactError);
      const duplicate = error as DuplicateFactError;
      expect(duplicate.field).toBe('local_actual_expenditure');
      expect(duplicate.subjectId).toBe('LEA-4412:2028');
      expect(duplicate.name).toBe('DuplicateFactError');
      expect(duplicate.message).toContain('reconciliation');
    }
  });

  it('throws even when the two values happen to be equal, since neither is authoritative', () => {
    // Equal duplicates still mean the pipeline let two rows through for one fact; the engine
    // must not be the place that discovers it.
    const duplicated = snapshotOf([
      LOCAL_ACTUAL,
      fact({
        field: 'local_actual_expenditure',
        value: '1250000.00',
        provenance: provenance({ sourceRow: 8 }),
      }),
    ]);

    expect(() => projectFactBag(duplicated, 'lea_fiscal_year', 'LEA-4412:2028')).toThrow(
      DuplicateFactError,
    );
  });

  it('does not throw when the duplicate belongs to another subject', () => {
    expect(() => projectFactBag(MULTI_SUBJECT, 'lea_fiscal_year', 'LEA-4412:2028')).not.toThrow();
  });

  it('is not confused by a field named like an Object.prototype member', () => {
    // `bag` is a plain object, so a canonical field called `constructor` or `toString` must
    // not be mistaken for an inherited property and reported as a duplicate.
    const awkward = snapshotOf([
      fact({ field: 'constructor', value: 'x' }),
      fact({ field: 'toString', value: 'y', provenance: provenance({ sourceRow: 2 }) }),
    ]);

    expect(projectFactBag(awkward, 'lea_fiscal_year', 'LEA-4412:2028')).toEqual({
      constructor: 'x',
      toString: 'y',
    });
  });
});

describe('provenanceFor', () => {
  it('closes the chain from a canonical field back to the source row and column', () => {
    const snapshot = snapshotOf(FACTS);

    const found = provenanceFor(
      snapshot,
      'lea_fiscal_year',
      'LEA-4412:2028',
      'local_actual_expenditure',
    );

    const row = fileRow(found);
    expect(row.sourceFileId).toBe(FILE.sourceFileId);
    expect(row.sourceRow).toBe(1);
    expect(row.sourceFields).toEqual(['LOCAL_ACTUAL']);
    expect(row.sourceValues).toEqual(['1,250,000.00']);
    expect(row.transformation).toBe('trim → parseCurrency');
    // …and the file the provenance names is present on the snapshot, so the chain reaches an
    // artifact a district can be shown, not a dangling id.
    expect(sourceFileFor(snapshot, row.sourceFileId)?.originalFilename).toBe(
      'FY2028 Expenditure Export.csv',
    );
  });

  it('returns undefined for a field the subject has no fact for', () => {
    expect(
      provenanceFor(snapshotOf(FACTS), 'lea_fiscal_year', 'LEA-4412:2028', 'federal_actual'),
    ).toBeUndefined();
  });

  it('returns undefined for a subject that is not in the snapshot', () => {
    expect(
      provenanceFor(snapshotOf(FACTS), 'lea_fiscal_year', 'LEA-0000:2028', 'child_count'),
    ).toBeUndefined();
  });

  it('does not return another subject’s provenance for the same field', () => {
    const snapshot = snapshotOf([
      LOCAL_ACTUAL,
      fact({
        field: 'local_actual_expenditure',
        value: '990000.00',
        subjectId: 'LEA-7781:2028',
        provenance: provenance({ sourceRow: 4 }),
      }),
    ]);

    expect(
      fileRow(
        provenanceFor(snapshot, 'lea_fiscal_year', 'LEA-7781:2028', 'local_actual_expenditure'),
      ).sourceRow,
    ).toBe(4);
  });
});

describe('sourceFileFor', () => {
  it('finds the uploaded artifact a fact was derived from', () => {
    const snapshot = snapshotOf(FACTS, [FILE, OTHER_FILE]);

    expect(sourceFileFor(snapshot, OTHER_FILE.sourceFileId)?.sourceHash).toBe(
      OTHER_FILE.sourceHash,
    );
  });

  it('returns undefined for a file id the snapshot does not carry', () => {
    expect(sourceFileFor(snapshotOf(FACTS), 'file_never_uploaded')).toBeUndefined();
  });
});

describe('projectFactBag — authority', () => {
  // The gap: a MappingTemplate may target any canonical field name, and a projected bag is
  // flat. Without an origin on the fact, a determination the platform made and a figure the
  // district typed are the same thing by the time the engine sees them.
  it('refuses a determination asserted by a district export', () => {
    const snapshot = snapshotOf([
      fact({ field: 'current_actual_local', value: '4800000.00' }),
      // A district declaring its own prior year compliant. Under 34 CFR 300.203(c) that
      // decides which level the next year is measured against, so accepting it would let an
      // LEA measure itself against the reduced level it actually reached.
      fact({ field: 'comparison_year_moe_status', value: 'MET' }),
    ]);

    expect(() => projectFactBag(snapshot, 'lea_fiscal_year', 'LEA-4412:2028')).toThrow(
      FactOriginError,
    );
  });

  it('accepts the same field from a prior finalized run', () => {
    const snapshot = snapshotOf([
      fact({
        field: 'comparison_year_moe_status',
        value: 'MET',
        origin: 'PLATFORM_DETERMINATION',
      }),
    ]);

    expect(projectFactBag(snapshot, 'lea_fiscal_year', 'LEA-4412:2028')).toEqual({
      comparison_year_moe_status: 'MET',
    });
  });

  it('throws rather than dropping the fact', () => {
    // Dropping would make the field absent, the calculator would return INDETERMINATE, and the
    // district would be told it was missing a figure it had supplied — an attempt to assert a
    // determination reported as a data-quality problem.
    const snapshot = snapshotOf([
      fact({ field: 'comparison_required_level_local', value: '5000000.00' }),
    ]);

    try {
      projectFactBag(snapshot, 'lea_fiscal_year', 'LEA-4412:2028');
      expect.unreachable('projection should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(FactOriginError);
      expect((error as FactOriginError).field).toBe('comparison_required_level_local');
      expect((error as FactOriginError).origin).toBe('DISTRICT_EXPORT');
      // The message has to say why, not just that.
      expect((error as FactOriginError).message).toMatch(/PLATFORM_DETERMINATION/);
    }
  });

  it('leaves ordinary district data alone', () => {
    const snapshot = snapshotOf([
      fact({ field: 'current_actual_local', value: '4800000.00' }),
      fact({ field: 'current_child_count', value: 1000 }),
    ]);

    expect(projectFactBag(snapshot, 'lea_fiscal_year', 'LEA-4412:2028')).toEqual({
      current_actual_local: '4800000.00',
      current_child_count: 1000,
    });
  });
});

describe('the snapshot hash covers who asserted a fact', () => {
  it('rejects the relabelled fact after sealing', () => {
    // The attack, run the way an attacker would: not by calling `buildSnapshot`, which refuses
    // the mismatch outright, but by editing a stored row. If origin sat outside the hash, a
    // district's own figure could be relabelled a platform determination — a bar it set for
    // itself, indistinguishable from one this platform determined — and `verifySnapshot` would
    // still pass.
    const sealed = snapshotOf([fact({ field: 'current_actual_local', value: '4800000.00' })]);
    const [first, ...rest] = sealed.facts;
    if (first === undefined) throw new Error('fixture must seal a fact');

    const relabelled: DataSnapshot = {
      ...sealed,
      facts: [{ ...first, origin: 'PLATFORM_DETERMINATION' }, ...rest],
    };

    expect(verifySnapshot(sealed)).toBe(true);
    expect(verifySnapshot(relabelled)).toBe(false);
  });
});

describe('provenance has to describe the kind of source the origin claims', () => {
  it('refuses a determination wearing a spreadsheet row', () => {
    // The shape this whole variant exists to stop. `sourceRow: 1` on a prior-year status sends
    // a business officer looking for a cell that does not exist, and the `sourceHash` beside it
    // names an upload the determination never came from.
    expect(() =>
      snapshotOf([
        fact({
          field: 'comparison_year_moe_status',
          value: 'MET',
          origin: 'PLATFORM_DETERMINATION',
          provenance: provenance(),
        }),
      ]),
    ).toThrow(ProvenanceShapeError);
  });

  it('refuses a district figure wearing a determination', () => {
    expect(() =>
      snapshotOf([
        fact({
          field: 'current_actual_local',
          value: '4800000.00',
          origin: 'DISTRICT_EXPORT',
          provenance: determination(),
        }),
      ]),
    ).toThrow(ProvenanceShapeError);
  });

  it('refuses an origin no provenance shape has been designed for, and says which', () => {
    // Not an oversight to route around. An SEA determination of record is a state agency's
    // document, not a run of this platform and not a row in an export; recording one under
    // either existing shape would put a false citation into a finding.
    let thrown: unknown;
    try {
      snapshotOf([
        fact({
          field: 'sea_prohibition_300_205_ground',
          value: 'ENFORCEMENT_ACTION_UNDER_SECTION_616',
          origin: 'SEA_DETERMINATION',
          provenance: determination(),
        }),
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProvenanceShapeError);
    expect((thrown as ProvenanceShapeError).message).toMatch(/no provenance shape yet/);
    expect((thrown as ProvenanceShapeError).message).toMatch(/provenance\.ts/);
  });

  it('seals a determination that carries the right shape', () => {
    const sealed = snapshotOf([
      fact({
        field: 'comparison_year_moe_status',
        value: 'MET',
        origin: 'PLATFORM_DETERMINATION',
        provenance: determination(),
      }),
    ]);

    expect(verifySnapshot(sealed)).toBe(true);
    expect(projectFactBag(sealed, 'lea_fiscal_year', 'LEA-4412:2028')).toEqual({
      comparison_year_moe_status: 'MET',
    });
  });

  it('covers the determination fields in the content hash', () => {
    // A carried-forward fact's evaluation hash is the only thing binding it to the run it
    // names. Outside the snapshot hash, that binding could be rewritten to point at a run that
    // concluded the opposite, and `verifySnapshot` would certify the result.
    const sealed = snapshotOf([
      fact({
        field: 'comparison_year_moe_status',
        value: 'MET',
        origin: 'PLATFORM_DETERMINATION',
        provenance: determination(),
      }),
    ]);
    const [first, ...rest] = sealed.facts;
    if (first === undefined) throw new Error('fixture must seal a fact');

    const repointed: DataSnapshot = {
      ...sealed,
      facts: [
        { ...first, provenance: { ...determination(), evaluationHash: 'b'.repeat(64) } },
        ...rest,
      ],
    };

    expect(verifySnapshot(repointed)).toBe(false);
  });
});
