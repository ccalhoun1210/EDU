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
 *
 * ## Why the prior determinations are built, not written
 *
 * The eight inputs a district may not assert do not appear in the file. They come from a
 * finalized run, and `carryForward` derives each one from that run's own record — value,
 * identifiers and evaluation hash together. Writing `MET` beside a run id by hand was how this
 * fixture used to work, and a hand-copied determination is indistinguishable from a fabricated
 * one. Now the fixture cannot state a prior status the recorded run did not reach.
 */

import type { CanonicalFact, MappingTemplate } from '@complianceos/ingest';
import {
  computeEvaluationHash,
  ENGINE_VERSION,
  type EvaluationResult,
} from '@complianceos/rules-engine';
import { carryForward } from './carry-forward.js';

/**
 * The uploaded file, byte for byte.
 *
 * Deliberately imperfect, because a clean fixture proves nothing about a real export: currency
 * symbols and thousands separators, an `FY` prefix on the fiscal year, `Yes`/`No` for the
 * attestation, quoted fields containing commas, and CRLF endings so the line counting that
 * feeds `sourceLine` on the provenance panel is exercised rather than assumed.
 *
 * Two lines, each assembled from four joined pieces so the header and the row can be read
 * against one another without counting commas across a 39-column line. The pieces are string
 * literals and the joins add nothing but the separator, so the exact bytes are still in the
 * diff — which is the property that made the export a literal rather than a builder.
 *
 * The figures are internally consistent across the two requirements, because a real export
 * would be and an inconsistent one would hide a class of bug. The excess cost columns put 620
 * children with disabilities in elementary schools and 384 in secondary, totalling the 1,004
 * the maintenance-of-effort columns report; and the Part B expended at the two levels totals
 * the 1,450,000.00 subgrant.
 */
export const NORTHFIELD_EXPORT_CSV = [
  [
    // Maintenance of effort — 34 CFR 300.203.
    'LEA ID,LEA Name,Fiscal Year,Fiscal Year End,Basis,Comparison FY,Comparison Local Actual,Comparison State+Local Actual,Comparison Child Count,Local Actual,State+Local Actual,Child Count,Part B Subgrant,Federal Funds Excluded',
    // Excess cost — 34 CFR 300.16 and Appendix A. Elementary and secondary are separate
    // columns because the regulation computes them separately and forbids combining them.
    'Serves Elementary,Serves Secondary,Prior FY',
    'Elem Total Exp,Elem Capital Outlay,Elem Debt Service,Elem Part B Exp,Elem Title I A Exp,Elem Title III Exp,Elem SPED State Local,Elem ESEA State Local,Elem Enrollment,Elem Children With Disabilities,Elem Non Part B Spend',
    'Sec Total Exp,Sec Capital Outlay,Sec Debt Service,Sec Part B Exp,Sec Title I A Exp,Sec Title III Exp,Sec SPED State Local,Sec ESEA State Local,Sec Enrollment,Sec Children With Disabilities,Sec Non Part B Spend',
  ].join(','),
  [
    'LEA-0417,"Northfield Consolidated School District, Unit 3",FY2026,2026-06-30,ACTUAL_EXPENDITURE,FY2025,"$4,900,000.00","$7,850,000.00",991,"$4,830,000.00","$7,975,000.00",1004,"$1,450,000.00",Yes',
    'Yes,Yes,FY2025',
    '"$48,600,000.00","$2,400,000.00","$1,200,000.00","$900,000.00","$1,800,000.00","$300,000.00","$3,600,000.00","$600,000.00",5400,620,"$4,455,000.00"',
    '"$33,000,000.00","$1,500,000.00","$700,000.00","$550,000.00","$1,100,000.00","$200,000.00","$2,600,000.00","$350,000.00",3200,384,"$3,041,000.00"',
  ].join(','),
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
/**
 * The twenty-two excess cost figures, as mapping fields.
 *
 * Built from a table rather than written out twice because the two levels are mechanically
 * identical — same eleven figures, same transforms, different prefix — and a hand-written
 * second copy is where a `secondary_` target ends up reading an `Elem` column. That mistake
 * would not fail validation: both are money, the row parses, the reconciliation balances, and
 * the district gets a secondary threshold computed from its elementary ledger.
 *
 * The source column names stay literal so the template can still be read against the header.
 */
const CURRENCY = [
  { transform: 'trim' as const },
  { transform: 'parseCurrency' as const, allowSymbol: true },
];
const WHOLE = [{ transform: 'trim' as const }, { transform: 'parseInteger' as const }];

const EXCESS_COST_FIGURES: readonly {
  readonly target: string;
  readonly source: string;
  readonly valueType: 'money' | 'count';
}[] = (
  [
    ['total_expenditures', 'Total Exp', 'money'],
    ['capital_outlay', 'Capital Outlay', 'money'],
    ['debt_service', 'Debt Service', 'money'],
    ['part_b_expenditures', 'Part B Exp', 'money'],
    ['esea_title_i_a_expenditures', 'Title I A Exp', 'money'],
    ['esea_title_iii_expenditures', 'Title III Exp', 'money'],
    ['state_local_sped_expenditures', 'SPED State Local', 'money'],
    ['state_local_esea_expenditures', 'ESEA State Local', 'money'],
    ['enrollment_preceding_year', 'Enrollment', 'count'],
    ['children_with_disabilities', 'Children With Disabilities', 'count'],
    ['non_part_b_spend_on_children', 'Non Part B Spend', 'money'],
  ] as const
).flatMap(([suffix, column, valueType]) =>
  (
    [
      ['elementary', 'Elem'],
      ['secondary', 'Sec'],
    ] as const
  ).map(([prefix, header]) => ({
    target: `${prefix}_${suffix}`,
    source: `${header} ${column}`,
    valueType,
  })),
);

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
    {
      // Declared, never inferred from the presence of a level's figures. See the excess cost
      // calculator: an LEA that operates secondary schools and failed to export them looks
      // identical to one that operates none.
      target: 'serves_elementary',
      valueType: 'boolean',
      sources: ['Serves Elementary'],
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
    {
      target: 'serves_secondary',
      valueType: 'boolean',
      sources: ['Serves Secondary'],
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
    {
      // The expenditure base is the preceding year, and the calculator refuses a pair that is
      // not consecutive. Mapped from the district's own prior-year label rather than derived,
      // so a district that exported the wrong year is caught rather than corrected silently.
      target: 'preceding_fiscal_year_start',
      valueType: 'date',
      sources: ['Prior FY'],
      transforms: [
        { transform: 'trim' },
        { transform: 'stripPrefix', prefix: 'FY' },
        { transform: 'crosswalk', codes: { '2025': '2024-07-01' } },
      ],
      required: true,
      classification: 'CONFIDENTIAL',
    },
    ...EXCESS_COST_FIGURES.map((figure) => ({
      target: figure.target,
      valueType: figure.valueType,
      sources: [figure.source],
      transforms: figure.valueType === 'money' ? CURRENCY : WHOLE,
      required: true,
      classification: 'CONFIDENTIAL' as const,
    })),
  ],
};

/** Fixed, because nothing in this path may read a clock. */
export const IMPORT_JOB_ID = 'job_northfield_fy2026_0001';
export const PRIOR_RUN_ID = 'RUN-MOE-COMPLIANCE-2025-0001';

/**
 * Last year's determination, as the platform actually recorded it.
 *
 * Written out rather than computed by running FY2025, because that run would need FY2024's
 * determination, which would need FY2023's, and so on: every district has a first year on the
 * platform and this fixture is Northfield's. What is *not* fabricated is the binding — the
 * evaluation hash below is computed by the engine's own `computeEvaluationHash` over this
 * record, so `verifyCarriedForward` genuinely checks something. Change a figure here without
 * re-deriving and the chain breaks, which is the property the whole mechanism exists for.
 *
 * FY2025 met the standard on all four measures, which is why FY2026 is measured against
 * FY2025's actual expenditure rather than against a level carried forward under
 * 34 CFR 300.203(c).
 */
const PRIOR_WITHOUT_HASH = {
  tenantId: 'tenant_northfield',
  organizationId: 'LEA-0417',
  subjectType: 'lea_fiscal_year',
  subjectId: 'LEA-0417:2025',
  dataSnapshotId: 'snap_northfield_fy2025',
  engineVersion: ENGINE_VERSION,
  ruleId: 'IDEA-MOE-COMPLIANCE-001',
  ruleTitle: 'IDEA Part B — LEA maintenance of effort, compliance standard',
  ruleLifecycle: 'DRAFT',
  pack: { packId: 'US-FED-IDEA-B-2026', version: '0.1.0', layer: 'FEDERAL' },
  authority: {
    citation: '34 CFR 300.203(b)',
    sourceId: 'REG-US-IDEA-300-203',
  },
  computedInputs: {
    comparison_actual_local: '4750000.00',
    comparison_actual_state_local: '7600000.00',
    comparison_child_count: 978,
    comparison_fiscal_year_start: '2023-07-01',
    current_actual_local: '4900000.00',
    current_actual_state_local: '7850000.00',
    current_child_count: 991,
    current_fiscal_year_start: '2024-07-01',
  },
  status: 'PASS',
  severityOnFailure: 'CRITICAL',
  output: {
    moeStatus: 'MET',
    qualifyingMethods: [
      'LOCAL_ONLY',
      'STATE_AND_LOCAL',
      'LOCAL_PER_CAPITA',
      'STATE_AND_LOCAL_PER_CAPITA',
    ],
  },
  steps: [],
  warnings: [],
  missingInputs: [],
  notes: [],
  explanation: 'Result: PASS.',
} satisfies Omit<EvaluationResult, 'evaluationHash' | 'evaluatedAt' | 'assessmentRunId'>;

export const NORTHFIELD_PRIOR_RESULT: EvaluationResult = {
  ...PRIOR_WITHOUT_HASH,
  assessmentRunId: PRIOR_RUN_ID,
  evaluatedAt: '2025-09-15T00:00:00.000Z',
  evaluationHash: computeEvaluationHash(PRIOR_WITHOUT_HASH),
};

const CARRIED = {
  subjectType: 'lea_fiscal_year',
  subjectId: 'LEA-0417:2026',
  classification: 'CONFIDENTIAL',
  result: NORTHFIELD_PRIOR_RESULT,
} as const;

/**
 * The prior determinations, as facts.
 *
 * Built by `carryForward` rather than written out, so each value is read from the finalized
 * result it cites and carries that result's evaluation hash. There is no way to state a status
 * here that the prior run did not reach — which is the point, because a district-facing finding
 * computed against a fabricated prior year would look flawless.
 *
 * `moe_status_source_run_id` is the odd one out: it is not a determination, it is the *name* of
 * the run the others came from, which the calculator requires whenever a prior status is
 * asserted. It is derived from the same result so the two cannot drift apart.
 */
export const NORTHFIELD_PRIOR_DETERMINATIONS: readonly CanonicalFact[] = [
  carryForward({
    ...CARRIED,
    field: 'comparison_year_moe_status',
    derivedFrom: 'output.moeStatus',
  }),
];

/** The four measures the comparison year was met under, also a determination. */
export const NORTHFIELD_METHODS_MET: CanonicalFact = carryForward({
  ...CARRIED,
  field: 'comparison_year_methods_met',
  derivedFrom: 'output.qualifyingMethods',
});

/**
 * The run that established the prior status.
 *
 * Not a conclusion the run reached — it is the run's own identity, which the calculator
 * requires whenever a prior status is asserted so that the subsequent-years branch does not
 * dead-end at an unattributed enum. Derived from the same record as the status it attributes,
 * so the two cannot drift apart.
 */
export const NORTHFIELD_STATUS_SOURCE: CanonicalFact = carryForward({
  ...CARRIED,
  field: 'moe_status_source_run_id',
  derivedFrom: 'assessmentRunId',
});
