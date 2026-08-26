/**
 * A synthetic district export, and the prior determinations that go with it.
 *
 * **Northfield Consolidated School District is invented.** Every figure here is made up. No
 * number, name or identifier comes from a real LEA, and none may be added: CLAUDE.md forbids
 * customer data in this repository and the `data-hygiene` CI job enforces it.
 *
 * ## Why the bytes live in TypeScript
 *
 * `.gitignore` blocks `*.csv` outside `docs/`, and the `data-hygiene` job independently fails
 * the build on any committed `*.csv`. That is a deliberate control and not one to work around
 * with a negation, so the export is a string literal instead. It reads better anyway: the exact
 * bytes are in the diff, reviewable line by line, including the CRLF line endings and the
 * currency symbols a real ERP emits and a parser has to survive.
 *
 * ## Why the export is denormalised
 *
 * `projectFactBag` filters by subject and throws on a duplicate field — it does not join rows.
 * So every fact a rule needs must arrive on the one row for that subject, and a
 * maintenance-of-effort determination is about the year under test *and* its comparison year.
 * Both sit on one line.
 *
 * That is not a modelling compromise. It is what a district's own maintenance-of-effort
 * worksheet looks like: the comparison figures next to the current ones, so a business officer
 * can read the test across the page.
 */

import type { CanonicalFact } from '@complianceos/ingest';
import type { MappingTemplate } from '@complianceos/ingest';

/**
 * The uploaded file, byte for byte.
 *
 * Deliberately imperfect, because a clean fixture proves nothing about a real export: currency
 * symbols and thousands separators, an `FY` prefix on the fiscal year, `Yes`/`No` for the
 * attestation, quoted fields containing commas, and CRLF endings so the line counting that
 * feeds `sourceLine` on the provenance panel is exercised rather than assumed.
 */
export const NORTHFIELD_EXPORT_CSV = [
  'LEA ID,LEA Name,Fiscal Year,Fiscal Year End,Basis,Comparison FY,Comparison Local Actual,Comparison State+Local Actual,Comparison Child Count,Local Actual,State+Local Actual,Child Count,Part B Subgrant,Federal Funds Excluded',
  'LEA-0417,"Northfield Consolidated School District, Unit 3",FY2026,2026-06-30,ACTUAL_EXPENDITURE,FY2025,"$4,900,000.00","$7,850,000.00",991,"$4,830,000.00","$7,975,000.00",1004,"$1,450,000.00",Yes',
].join('\r\n');

/** SHA-256 of the bytes above, as an uploaded artifact would carry. Synthetic but fixed. */
export const NORTHFIELD_SOURCE_HASH =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * The mapping template, versioned.
 *
 * Only the eighteen inputs a district may assert appear here. The other eight are prior
 * determinations, and a template that targeted one would be refused at projection — which is
 * the point of `fact-origin.ts` and is asserted in `assess.test.ts`.
 */
export const NORTHFIELD_TEMPLATE: MappingTemplate = {
  templateId: 'NORTHFIELD-FISCAL-V1',
  version: '1.0.0',
  sourceSystem: 'GENERIC_ERP_CSV',
  targetEntity: 'lea_fiscal_year',
  fields: [
    {
      // Subject key. `SubjectBinding.keyFields` names mapped targets, not source columns, so
      // the subject is identified after transformation — `FY2026` and `2026` key the same
      // subject. Key fields are deliberately excluded from the fact set, which is why the
      // fiscal year is mapped twice: once as a key, once as the date a calculator reads.
      target: 'lea_id',
      valueType: 'text',
      sources: ['LEA ID'],
      transforms: [{ transform: 'trim' }],
      required: true,
      classification: 'CONFIDENTIAL',
      description: 'Subject key. Not a calculator input.',
    },
    {
      target: 'fiscal_year_key',
      valueType: 'text',
      sources: ['Fiscal Year'],
      transforms: [{ transform: 'trim' }, { transform: 'stripPrefix', prefix: 'FY' }],
      required: true,
      classification: 'CONFIDENTIAL',
      description: 'Subject key. Not a calculator input.',
    },
    {
      target: 'lea_name',
      valueType: 'text',
      sources: ['LEA Name'],
      transforms: [{ transform: 'trim' }],
      required: false,
      classification: 'CONFIDENTIAL',
      description: 'Carried for display. No rule reads it.',
    },
    {
      target: 'current_fiscal_year_start',
      valueType: 'date',
      sources: ['Fiscal Year'],
      transforms: [
        { transform: 'trim' },
        { transform: 'stripPrefix', prefix: 'FY' },
        // The export names the year; the canonical fact is the first day of it. A district
        // fiscal year begins 1 July, which is a mapping decision for this source system and
        // not a fact about every district — hence a template concern rather than a calculator
        // one.
        { transform: 'crosswalk', codes: { '2026': '2025-07-01' } },
      ],
      required: true,
      classification: 'CONFIDENTIAL',
      description: 'First day of the fiscal year under test.',
    },
    {
      target: 'current_fiscal_year_end',
      valueType: 'date',
      sources: ['Fiscal Year End'],
      transforms: [{ transform: 'trim' }],
      required: true,
      classification: 'CONFIDENTIAL',
    },
    {
      target: 'comparison_fiscal_year_start',
      valueType: 'date',
      sources: ['Comparison FY'],
      transforms: [
        { transform: 'trim' },
        { transform: 'stripPrefix', prefix: 'FY' },
        { transform: 'crosswalk', codes: { '2025': '2024-07-01' } },
      ],
      required: true,
      classification: 'CONFIDENTIAL',
    },
    {
      target: 'comparison_basis',
      valueType: 'text',
      sources: ['Basis'],
      transforms: [
        { transform: 'trim' },
        { transform: 'upperCase' },
        {
          transform: 'requireOneOf',
          values: ['ACTUAL_EXPENDITURE', 'REQUIRED_LEVEL_AFTER_FAILURE'],
        },
      ],
      required: true,
      classification: 'CONFIDENTIAL',
    },
    {
      target: 'comparison_actual_local',
      valueType: 'money',
      sources: ['Comparison Local Actual'],
      transforms: [{ transform: 'trim' }, { transform: 'parseCurrency', allowSymbol: true }],
      required: true,
      classification: 'CONFIDENTIAL',
    },
    {
      target: 'comparison_actual_state_local',
      valueType: 'money',
      sources: ['Comparison State+Local Actual'],
      transforms: [{ transform: 'trim' }, { transform: 'parseCurrency', allowSymbol: true }],
      required: true,
      classification: 'CONFIDENTIAL',
    },
    {
      target: 'comparison_child_count',
      valueType: 'count',
      sources: ['Comparison Child Count'],
      transforms: [{ transform: 'trim' }, { transform: 'parseInteger' }],
      required: true,
      classification: 'CONFIDENTIAL',
    },
    {
      target: 'current_actual_local',
      valueType: 'money',
      sources: ['Local Actual'],
      transforms: [{ transform: 'trim' }, { transform: 'parseCurrency', allowSymbol: true }],
      required: true,
      classification: 'CONFIDENTIAL',
    },
    {
      target: 'current_actual_state_local',
      valueType: 'money',
      sources: ['State+Local Actual'],
      transforms: [{ transform: 'trim' }, { transform: 'parseCurrency', allowSymbol: true }],
      required: true,
      classification: 'CONFIDENTIAL',
    },
    {
      target: 'current_child_count',
      valueType: 'count',
      sources: ['Child Count'],
      transforms: [{ transform: 'trim' }, { transform: 'parseInteger' }],
      required: true,
      classification: 'CONFIDENTIAL',
    },
    {
      target: 'lea_part_b_subgrant_amount',
      valueType: 'money',
      sources: ['Part B Subgrant'],
      transforms: [{ transform: 'trim' }, { transform: 'parseCurrency', allowSymbol: true }],
      required: true,
      classification: 'CONFIDENTIAL',
    },
    {
      target: 'federal_funds_excluded',
      valueType: 'boolean',
      sources: ['Federal Funds Excluded'],
      transforms: [
        { transform: 'trim' },
        {
          transform: 'parseBoolean',
          trueValues: ['Yes', 'Y', 'TRUE'],
          falseValues: ['No', 'N', 'FALSE'],
        },
      ],
      required: true,
      classification: 'CONFIDENTIAL',
    },
  ],
};

/** Fixed, because nothing in this path may read a clock. */
export const IMPORT_JOB_ID = 'job_northfield_fy2026_0001';
export const PRIOR_RUN_ID = 'RUN-MOE-COMPLIANCE-2025-0001';

/**
 * The prior determinations, as facts.
 *
 * These come from a finalized run of this platform, not from the district. Their provenance
 * points at that run rather than at an uploaded file — and the shape strains, because
 * `FactProvenance` was designed for a row in a spreadsheet. `sourceRow` and `sourceLine` mean
 * nothing here. That is a real modelling gap and it is recorded rather than papered over: a
 * determination-shaped provenance variant is the next thing this needs.
 */
export const NORTHFIELD_PRIOR_DETERMINATIONS: readonly CanonicalFact[] = (
  [
    ['comparison_year_moe_status', 'MET'],
    ['moe_status_source_run_id', PRIOR_RUN_ID],
  ] as const
).map(([field, value]) => ({
  subjectType: 'lea_fiscal_year',
  subjectId: 'LEA-0417:2026',
  field,
  value,
  classification: 'CONFIDENTIAL' as const,
  origin: 'PLATFORM_DETERMINATION' as const,
  provenance: {
    importJobId: IMPORT_JOB_ID,
    sourceFileId: PRIOR_RUN_ID,
    sourceHash: NORTHFIELD_SOURCE_HASH,
    sourceRow: 1,
    sourceLine: 1,
    sourceFields: [field],
    sourceValues: [value],
    mappingTemplateId: 'PLATFORM-DETERMINATION-CARRY-FORWARD',
    mappingVersion: '1.0.0',
    transformation: `carried forward from finalized run ${PRIOR_RUN_ID}`,
  },
}));

/** The four measures the comparison year was met under, also a determination. */
export const NORTHFIELD_METHODS_MET: CanonicalFact = {
  subjectType: 'lea_fiscal_year',
  subjectId: 'LEA-0417:2026',
  field: 'comparison_year_methods_met',
  value: ['LOCAL_ONLY', 'STATE_AND_LOCAL', 'LOCAL_PER_CAPITA', 'STATE_AND_LOCAL_PER_CAPITA'],
  classification: 'CONFIDENTIAL',
  origin: 'PLATFORM_DETERMINATION',
  provenance: {
    importJobId: IMPORT_JOB_ID,
    sourceFileId: PRIOR_RUN_ID,
    sourceHash: NORTHFIELD_SOURCE_HASH,
    sourceRow: 1,
    sourceLine: 1,
    sourceFields: ['comparison_year_methods_met'],
    sourceValues: ['ALL'],
    mappingTemplateId: 'PLATFORM-DETERMINATION-CARRY-FORWARD',
    mappingVersion: '1.0.0',
    transformation: `carried forward from finalized run ${PRIOR_RUN_ID}`,
  },
};
