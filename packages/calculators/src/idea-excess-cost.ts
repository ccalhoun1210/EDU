/**
 * The IDEA Part B excess cost requirement.
 *
 * Spec: `docs/regulatory-methodology/idea-excess-cost.md`. Corpus:
 * `golden/idea_excess_cost_v1.yaml`. Authority: 34 CFR 300.202(b), 34 CFR 300.16, and the
 * worked computation at Appendix A to 34 CFR part 300.
 *
 * Part B money is for the *extra* cost of educating a child with a disability. So before a
 * district may charge anything to it, the district must first have spent on that child at
 * least what it spends on an average student at the same level, out of its other funds. This
 * computes that threshold and compares it.
 *
 * ## Two levels, never combined
 *
 * Elementary and secondary run the same eight steps independently, and the regulation is
 * explicit that they may not be averaged together. So the roll-up here is **FAIL-dominant**:
 * the levels are two separate obligations, and failing at secondary is failing. That is the
 * opposite of the maintenance-of-effort roll-up, which is PASS-dominant because its four
 * measures are statutory *alternatives* and satisfying any one satisfies the standard. An
 * implementation that reused either that roll-up or `rollUpStatus()` from `packages/domain`
 * would be wrong in the first case and wrong in kind in the second.
 *
 * ## What the earlier specification got wrong
 *
 * This is a revision. The adversarial review of the first specification returned two blocking
 * findings, recorded in `docs/regulatory-methodology/README.md`: a zero children-with-
 * disabilities count produced an automatic PASS, and an unhandled branch reached a division by
 * zero. Both are answered here as regulatory conclusions rather than as guard clauses —
 * `NOT_APPLICABLE` for a threshold with nothing to attach to, and a refusal for a level with
 * expenditure and no students. A requirement of nothing is not a requirement satisfied.
 */

import {
  MONEY_DP,
  ZERO,
  add,
  compare,
  count as toCount,
  divide,
  formatAmount,
  formatUsd,
  isNegative,
  isZero,
  multiply,
  parseCalendarDate,
  subtract,
  type Amount,
  type DataClassification,
  type EvaluationStatus,
} from '@complianceos/domain';
import type { CalculatorName } from '@complianceos/rulepack-sdk';
import {
  InputReader,
  PER_CHILD_DP,
  type CalculationStep,
  type Calculator,
  type CalculatorInputs,
  type CalculatorResult,
  type CalculatorInputSpec,
  type CalculatorWarning,
} from './types.js';

/**
 * The first year this rule version speaks to.
 *
 * A year before it is `MANUAL_REVIEW` and never `NOT_APPLICABLE` (ADR 0007): the excess cost
 * requirement bound the LEA then, and saying it did not apply would be false. What is true is
 * that this calculator does not implement the text in force at the time.
 */
export const EXCESS_COST_RULE_EFFECTIVE_START = '2015-07-01';

export const EXCESS_COST_LEVELS = ['ELEMENTARY', 'SECONDARY'] as const;
export type ExcessCostLevel = (typeof EXCESS_COST_LEVELS)[number];

/** The input prefix each level's figures carry. */
const PREFIX: Readonly<Record<ExcessCostLevel, string>> = {
  ELEMENTARY: 'elementary',
  SECONDARY: 'secondary',
};

/**
 * The five amounts the definition deducts, in the order Appendix A lists them.
 *
 * Ordered rather than summed from a set so the shown work reads in the order a district would
 * work down its own ledger, and so a reader can line the steps up against the regulation.
 */
const DEDUCTIONS = [
  { suffix: 'part_b_expenditures', label: 'Part B funds expended', citation: '34 CFR 300.16(a)' },
  {
    suffix: 'esea_title_i_a_expenditures',
    label: 'ESEA Title I Part A funds expended',
    citation: '34 CFR 300.16(a)',
  },
  {
    suffix: 'esea_title_iii_expenditures',
    label: 'ESEA Title III Parts A and B funds expended',
    citation: '34 CFR 300.16(a)',
  },
  {
    suffix: 'state_local_sped_expenditures',
    label: 'State and local funds for children with disabilities',
    citation: '34 CFR 300.16(b)',
  },
  {
    suffix: 'state_local_esea_expenditures',
    label: 'State and local funds for qualifying ESEA programmes',
    citation: '34 CFR 300.16(b)',
  },
] as const;

export type ExcessCostOutput = {
  readonly levelStatus: Readonly<Record<ExcessCostLevel, EvaluationStatus>>;
  /** Six places: an intermediate quotient, not a displayed conclusion. Null where uncomputed. */
  readonly averagePerStudentByLevel: Readonly<Record<ExcessCostLevel, string | null>>;
  readonly minimumRequiredByLevel: Readonly<Record<ExcessCostLevel, string | null>>;
  readonly actualNonPartBSpendByLevel: Readonly<Record<ExcessCostLevel, string | null>>;
  readonly marginByLevel: Readonly<Record<ExcessCostLevel, string | null>>;
  readonly shortfallByLevel: Readonly<Record<ExcessCostLevel, string | null>>;
  readonly netBaseByLevel: Readonly<Record<ExcessCostLevel, string | null>>;
  readonly deductionsByLevel: Readonly<Record<ExcessCostLevel, string | null>>;
  /** Levels the LEA operates and that carried a testable obligation. */
  readonly levelsTested: readonly ExcessCostLevel[];
};

const CONFIDENTIAL: DataClassification = 'CONFIDENTIAL';
const INTERNAL: DataClassification = 'INTERNAL';

function levelInputs(level: ExcessCostLevel): readonly CalculatorInputSpec[] {
  const p = PREFIX[level];
  const at = level === 'ELEMENTARY' ? 'elementary' : 'secondary';
  return [
    {
      name: `${p}_total_expenditures`,
      type: 'money',
      required: true,
      classification: CONFIDENTIAL,
      definition: `Everything the LEA spent on ${at} students in the preceding year, from every source including Part B, before any deduction.`,
    },
    {
      name: `${p}_capital_outlay`,
      type: 'money',
      required: true,
      classification: CONFIDENTIAL,
      definition: `Capital outlay at the ${at} level, excluded by the definition of excess costs. Absent is not zero — a district with none reports zero.`,
    },
    {
      name: `${p}_debt_service`,
      type: 'money',
      required: true,
      classification: CONFIDENTIAL,
      definition: `Debt service at the ${at} level, excluded on the same basis as capital outlay.`,
    },
    ...DEDUCTIONS.map((deduction) => ({
      name: `${p}_${deduction.suffix}`,
      type: 'money' as const,
      required: true,
      classification: CONFIDENTIAL,
      definition: `${deduction.label} at the ${at} level. Expended, not received or allocated — see OQ-2.`,
    })),
    {
      name: `${p}_enrollment_preceding_year`,
      type: 'count',
      required: true,
      classification: CONFIDENTIAL,
      definition: `Students enrolled at the ${at} level in the preceding year — all students, not only those with disabilities. The divisor. Which enrolment figure this is, is OQ-4.`,
    },
    {
      name: `${p}_children_with_disabilities`,
      type: 'count',
      required: true,
      classification: CONFIDENTIAL,
      definition: `Children with disabilities at the ${at} level. The multiplier that turns a per-student average into the LEA's obligation. Zero is a value, not a gap: it makes the level NOT_APPLICABLE, never PASS.`,
    },
    {
      name: `${p}_non_part_b_spend_on_children`,
      type: 'money',
      required: true,
      classification: CONFIDENTIAL,
      definition: `What the LEA actually spent on children with disabilities at the ${at} level from sources other than Part B. The figure the threshold is tested against — see OQ-1.`,
    },
  ];
}

const EXCESS_COST_INPUTS: readonly CalculatorInputSpec[] = [
  {
    name: 'serves_elementary',
    type: 'boolean',
    required: true,
    classification: INTERNAL,
    definition:
      'Whether the LEA operates elementary schools. Declared, never inferred from absent figures: an LEA that failed to export a level looks identical to one that has none.',
  },
  {
    name: 'serves_secondary',
    type: 'boolean',
    required: true,
    classification: INTERNAL,
    definition: 'Whether the LEA operates secondary schools. Declared for the same reason.',
  },
  {
    name: 'preceding_fiscal_year_start',
    type: 'date',
    required: true,
    classification: INTERNAL,
    definition:
      'First day of the year the expenditure base belongs to. Must be the year before the year under test; a misalignment is refused rather than computed.',
  },
  {
    name: 'current_fiscal_year_start',
    type: 'date',
    required: true,
    classification: INTERNAL,
    definition: 'First day of the fiscal year under test.',
  },
  ...levelInputs('ELEMENTARY'),
  ...levelInputs('SECONDARY'),
];

/* ------------------------------------------------------------------ one level at a time -- */

interface LevelOutcome {
  readonly status: EvaluationStatus;
  readonly steps: readonly CalculationStep[];
  readonly warnings: readonly CalculatorWarning[];
  readonly missing: readonly string[];
  readonly netBase: Amount | null;
  readonly deductions: Amount | null;
  readonly averagePerStudent: Amount | null;
  readonly minimumRequired: Amount | null;
  readonly actualSpend: Amount | null;
  readonly margin: Amount | null;
  readonly shortfall: Amount | null;
}

function unevaluated(status: EvaluationStatus, extra: Partial<LevelOutcome> = {}): LevelOutcome {
  return {
    status,
    steps: [],
    warnings: [],
    missing: [],
    netBase: null,
    deductions: null,
    averagePerStudent: null,
    minimumRequired: null,
    actualSpend: null,
    margin: null,
    shortfall: null,
    ...extra,
  };
}

function usd(
  key: string,
  label: string,
  value: Amount,
  citation: string,
  detail?: string,
): CalculationStep {
  return {
    key,
    label,
    value: formatAmount(value, MONEY_DP),
    unit: 'USD',
    citation,
    ...(detail === undefined ? {} : { detail }),
  };
}

/**
 * Evaluate one level.
 *
 * Computed **progressively**: each stage runs as soon as the figures it needs are present, and
 * a gap stops the chain rather than the whole level. A district whose export omitted one column
 * still sees its expenditure base, its deductions and — where the divisor survived — its
 * average annual per-student expenditure. The work done before the gap is part of what it is
 * owed, and the finding page has something to render besides the word INDETERMINATE.
 *
 * A fresh `InputReader` per level, so the inputs of a level the LEA does not operate are never
 * read and therefore never reported missing. A district told it is missing twenty-two figures
 * when it operates one level would reasonably stop reading.
 */
function evaluateLevel(level: ExcessCostLevel, inputs: CalculatorInputs): LevelOutcome {
  const p = PREFIX[level];
  const label = level === 'ELEMENTARY' ? 'elementary' : 'secondary';
  const scope = new InputReader(inputs);

  // 1. Does the level apply? Declared, never inferred.
  const serves = scope.boolean(`serves_${p}`);
  if (serves === undefined) {
    return unevaluated('INDETERMINATE', {
      missing: scope.missing,
      warnings: scope.malformedWarnings(),
    });
  }
  if (!serves) return unevaluated('NOT_APPLICABLE');

  const reader = new InputReader(inputs);
  const steps: CalculationStep[] = [];
  const warnings: CalculatorWarning[] = [];

  // Every figure is read up front, in one pass, so the result names every gap at once. A
  // district told about one missing column at a time makes one trip per column.
  const total = reader.money(`${p}_total_expenditures`);
  const capital = reader.money(`${p}_capital_outlay`);
  const debt = reader.money(`${p}_debt_service`);
  const deductionAmounts = DEDUCTIONS.map((deduction) => ({
    ...deduction,
    value: reader.money(`${p}_${deduction.suffix}`),
  }));
  const enrollment = reader.count(`${p}_enrollment_preceding_year`);
  const children = reader.count(`${p}_children_with_disabilities`);
  const actualSpend = reader.money(`${p}_non_part_b_spend_on_children`);

  const missing = reader.missing;
  warnings.push(...reader.malformedWarnings());

  /** Everything computed so far, whatever the chain reached. */
  const partial = (status: EvaluationStatus, extra: Partial<LevelOutcome> = {}): LevelOutcome =>
    unevaluated(status, { steps, warnings, missing, ...extra });

  /**
   * A level that could not be finished.
   *
   * A refusal outranks a gap: it is a definite statement about figures the district did
   * supply, and it names a provision and a question. A missing input is only the platform's
   * ignorance, and reporting it over a refusal would bury the actionable half.
   */
  const unfinished = (extra: Partial<LevelOutcome> = {}): LevelOutcome =>
    partial(
      warnings.some((warning) => warning.severity === 'BLOCKING')
        ? 'MANUAL_REVIEW'
        : 'INDETERMINATE',
      extra,
    );

  if (total === undefined || capital === undefined || debt === undefined) return unfinished();

  steps.push(
    usd(
      `${p}_total_expenditures`,
      `Total expenditures for ${label} students, all sources, preceding year`,
      total,
      '34 CFR 300.16',
    ),
  );

  // 2. Capital outlay and debt service leave first — excluded by the definition itself.
  const adjusted = subtract(subtract(total, capital), debt);
  steps.push(
    usd(
      `${p}_adjusted_total`,
      `Total expenditures for ${label} students, less capital outlay and debt service`,
      adjusted,
      '34 CFR 300.16(b)',
      `${formatUsd(total)} − ${formatUsd(capital)} − ${formatUsd(debt)}`,
    ),
  );

  // 3. The five earmarked amounts. Each is shown whether or not the set is complete.
  let deducted = ZERO;
  const oversized: string[] = [];
  for (const deduction of deductionAmounts) {
    if (deduction.value === undefined) continue;
    deducted = add(deducted, deduction.value);
    steps.push(
      usd(
        `${p}_deduction_${deduction.suffix}`,
        `${deduction.label}, ${label}`,
        deduction.value,
        deduction.citation,
      ),
    );
    if (compare(deduction.value, adjusted) > 0) oversized.push(`${p}_${deduction.suffix}`);
  }

  // A partial sum is not the deduction total, and subtracting it would overstate the base and
  // therefore the threshold. The chain stops here rather than reporting a base nobody's
  // figures support.
  if (deductionAmounts.some((deduction) => deduction.value === undefined)) return unfinished();

  steps.push(usd(`${p}_deductions_total`, `Total deducted, ${label}`, deducted, '34 CFR 300.16'));

  const netBase = subtract(adjusted, deducted);
  steps.push(
    usd(
      `${p}_net_base`,
      `Base for the ${label} per-student average`,
      netBase,
      '34 CFR 300.16',
      `${formatUsd(adjusted)} − ${formatUsd(deducted)}`,
    ),
  );

  // 4. A base of nothing is not a threshold of nothing that everyone clears.
  if (isNegative(netBase) || isZero(netBase)) {
    if (oversized.length > 0) {
      warnings.push({
        code: 'EXCESS_COST_DEDUCTION_EXCEEDS',
        severity: 'BLOCKING',
        citation: '34 CFR 300.16',
        message:
          `One deducted amount alone exceeds the ${label} total after capital outlay and debt ` +
          `service: ${oversized.join(', ')}. That line is where the export is most likely ` +
          'wrong, and naming it saves re-deriving the whole computation.',
      });
    }
    warnings.push({
      code: 'EXCESS_COST_BASE_NOT_POSITIVE',
      severity: 'BLOCKING',
      citation: '34 CFR 300.16',
      message:
        `The deducted amounts consume the entire ${label} expenditure base ` +
        `(${formatUsd(adjusted)} adjusted, ${formatUsd(deducted)} deducted), leaving ` +
        `${formatUsd(netBase)}. No average annual per-student expenditure follows from ` +
        'that, and a threshold of nothing would be cleared by any district. This is a ' +
        'mapping error or a double count, and the platform cannot tell which.',
    });
    return partial('MANUAL_REVIEW', { netBase, deductions: deducted });
  }

  if (enrollment === undefined) return unfinished({ netBase, deductions: deducted });

  // 5. A divisor of nothing.
  if (enrollment === 0) {
    warnings.push({
      code: 'EXCESS_COST_NO_ENROLLMENT',
      severity: 'BLOCKING',
      citation: '34 CFR 300.16',
      message:
        `The LEA reports ${formatUsd(netBase)} of ${label} expenditure against an ` +
        'enrolment of zero, so there is no average to compute. Every available default — ' +
        'zero, skipping the level, treating it as inapplicable — states something about the ' +
        'district that the platform does not know.',
    });
    return partial('MANUAL_REVIEW', { netBase, deductions: deducted });
  }

  // 6. The average annual per-student expenditure, over every student at the level.
  const averagePerStudent = divide(netBase, toCount(enrollment), PER_CHILD_DP);
  if (averagePerStudent === undefined) {
    // `divide` returns undefined only on a zero divisor, which step 5 has already refused.
    return partial('MANUAL_REVIEW', { netBase, deductions: deducted });
  }
  steps.push({
    key: `${p}_average_per_student`,
    label: `Average annual per-student expenditure, ${label}`,
    value: formatAmount(averagePerStudent, PER_CHILD_DP),
    unit: 'USD_PER_STUDENT',
    citation: '34 CFR 300.16',
    detail: `${formatUsd(netBase)} ÷ ${enrollment} students enrolled`,
  });

  const computed = { netBase, deductions: deducted, averagePerStudent };
  if (children === undefined) return unfinished(computed);

  // 7. The minimum the LEA must spend before Part B may be charged. Rounded once, here.
  const minimumRequired = multiply(averagePerStudent, toCount(children));
  steps.push(
    usd(
      `${p}_minimum_required`,
      `Minimum the LEA must spend on ${label} children with disabilities before using Part B funds`,
      minimumRequired,
      '34 CFR 300.202(b)',
      `${formatUsd(averagePerStudent, PER_CHILD_DP)} × ${children} children with disabilities`,
    ),
  );

  // 8. A threshold with nothing to attach to is not a threshold satisfied.
  if (children === 0) {
    warnings.push({
      code: 'EXCESS_COST_NO_CHILDREN_AT_LEVEL',
      severity: 'WARNING',
      citation: '34 CFR 300.202(b)',
      message:
        `The LEA reports no children with disabilities at the ${label} level, so the minimum ` +
        'is zero and any spending would clear it. The requirement has nothing to attach to ' +
        'here, which is not the same as the requirement being satisfied — the level is ' +
        'reported as inapplicable and carries no margin.',
    });
    return partial('NOT_APPLICABLE', { ...computed, minimumRequired });
  }

  if (actualSpend === undefined) return unfinished({ ...computed, minimumRequired });

  steps.push(
    usd(
      `${p}_actual_spend`,
      `Actual non-Part-B spending on ${label} children with disabilities`,
      actualSpend,
      '34 CFR 300.202(b)',
    ),
  );

  const margin = subtract(actualSpend, minimumRequired);
  const met = !isNegative(margin);
  const shortfall = met ? ZERO : margin.negated();

  steps.push({
    key: `${p}_result`,
    label: `Excess cost requirement, ${label}`,
    value: met ? 'PASS' : 'FAIL',
    unit: 'TEXT',
    citation: '34 CFR 300.202(b)',
    detail:
      `Spent ${formatUsd(actualSpend)} against a minimum of ` +
      `${formatUsd(minimumRequired)}; margin ${formatUsd(margin)}`,
  });

  return {
    status: met ? 'PASS' : 'FAIL',
    steps,
    warnings,
    missing,
    ...computed,
    minimumRequired,
    actualSpend,
    margin,
    shortfall,
  };
}

/* ------------------------------------------------------------------------- the roll-up -- */

/**
 * FAIL-dominant, and unanswered outranks satisfied.
 *
 * The two levels are separate obligations rather than statutory alternatives, so a failure at
 * either is a failure. Between the two ways of not answering, a refusal outranks a gap: both
 * mean the platform has not concluded, and only the refusal names a provision and a question
 * a reader can act on.
 */
function rollUp(levels: readonly EvaluationStatus[]): EvaluationStatus {
  if (levels.includes('FAIL')) return 'FAIL';
  if (levels.includes('MANUAL_REVIEW')) return 'MANUAL_REVIEW';
  if (levels.includes('INDETERMINATE')) return 'INDETERMINATE';
  if (levels.includes('PASS')) return 'PASS';
  return 'NOT_APPLICABLE';
}

function byLevel<T>(pick: (level: ExcessCostLevel) => T): Readonly<Record<ExcessCostLevel, T>> {
  return { ELEMENTARY: pick('ELEMENTARY'), SECONDARY: pick('SECONDARY') };
}

function money(value: Amount | null, dp: number = MONEY_DP): string | null {
  return value === null ? null : formatAmount(value, dp);
}

function emptyOutput(status: EvaluationStatus): ExcessCostOutput {
  return {
    levelStatus: byLevel(() => status),
    averagePerStudentByLevel: byLevel(() => null),
    minimumRequiredByLevel: byLevel(() => null),
    actualNonPartBSpendByLevel: byLevel(() => null),
    marginByLevel: byLevel(() => null),
    shortfallByLevel: byLevel(() => null),
    netBaseByLevel: byLevel(() => null),
    deductionsByLevel: byLevel(() => null),
    levelsTested: [],
  };
}

function run(inputs: CalculatorInputs): CalculatorResult<ExcessCostOutput> {
  const dates = new InputReader(inputs);
  const precedingStart = dates.date('preceding_fiscal_year_start');
  const currentStart = dates.date('current_fiscal_year_start');

  if (dates.hasProblems) {
    return {
      status: 'INDETERMINATE',
      missingInputs: dates.missing,
      warnings: dates.malformedWarnings(),
      steps: [],
      output: emptyOutput('INDETERMINATE'),
    };
  }
  if (precedingStart === undefined || currentStart === undefined) {
    return {
      status: 'INDETERMINATE',
      missingInputs: dates.missing,
      warnings: [],
      steps: [],
      output: emptyOutput('INDETERMINATE'),
    };
  }

  const yearStep: CalculationStep = {
    key: 'fiscal_year_under_test',
    label: 'Fiscal year under test',
    value: currentStart,
    unit: 'DATE',
    citation: '34 CFR 300.202(b)',
    detail: `measured against the base year beginning ${precedingStart}`,
  };

  // The effective window. Before it, the requirement bound the LEA and this calculator does
  // not implement the text that governed — a platform limit, not an exemption (ADR 0007).
  if (currentStart < EXCESS_COST_RULE_EFFECTIVE_START) {
    return {
      status: 'MANUAL_REVIEW',
      missingInputs: [],
      warnings: [
        {
          code: 'EXCESS_COST_BEFORE_EFFECTIVE_WINDOW',
          severity: 'BLOCKING',
          citation: '34 CFR 300.202(b)',
          message:
            `The year under test begins ${currentStart}, before this rule version takes ` +
            `effect on ${EXCESS_COST_RULE_EFFECTIVE_START}. The excess cost requirement ` +
            'applied then; this calculator does not implement the text in force at the time, ' +
            'so the year is referred rather than reported as exempt.',
        },
      ],
      steps: [yearStep],
      output: emptyOutput('MANUAL_REVIEW'),
    };
  }

  // Period alignment. Most errors in fiscal compliance are alignment errors, and this is the
  // only place the calculator can see one.
  const precedingYear = parseCalendarDate(precedingStart).year;
  const currentYear = parseCalendarDate(currentStart).year;
  if (precedingYear !== currentYear - 1) {
    return {
      status: 'MANUAL_REVIEW',
      missingInputs: [],
      warnings: [
        {
          code: 'EXCESS_COST_PERIOD_MISALIGNED',
          severity: 'BLOCKING',
          citation: '34 CFR 300.16',
          message:
            `The expenditure base begins ${precedingStart} and the year under test begins ` +
            `${currentStart}, which are not consecutive years. The average is defined against ` +
            'the preceding year, and a stale base moves the threshold by whatever the ' +
            "district's per-student spending has done since.",
        },
      ],
      steps: [yearStep],
      output: emptyOutput('MANUAL_REVIEW'),
    };
  }

  const outcomes = byLevel((level) => evaluateLevel(level, inputs));
  const status = rollUp(EXCESS_COST_LEVELS.map((level) => outcomes[level].status));

  const output: ExcessCostOutput = {
    levelStatus: byLevel((level) => outcomes[level].status),
    averagePerStudentByLevel: byLevel((level) =>
      money(outcomes[level].averagePerStudent, PER_CHILD_DP),
    ),
    minimumRequiredByLevel: byLevel((level) => money(outcomes[level].minimumRequired)),
    actualNonPartBSpendByLevel: byLevel((level) => money(outcomes[level].actualSpend)),
    marginByLevel: byLevel((level) => money(outcomes[level].margin)),
    shortfallByLevel: byLevel((level) => money(outcomes[level].shortfall)),
    netBaseByLevel: byLevel((level) => money(outcomes[level].netBase)),
    deductionsByLevel: byLevel((level) => money(outcomes[level].deductions)),
    levelsTested: EXCESS_COST_LEVELS.filter((level) =>
      ['PASS', 'FAIL'].includes(outcomes[level].status),
    ),
  };

  return {
    status,
    missingInputs: [...EXCESS_COST_LEVELS.flatMap((level) => outcomes[level].missing)].sort(),
    warnings: EXCESS_COST_LEVELS.flatMap((level) => outcomes[level].warnings),
    steps: [yearStep, ...EXCESS_COST_LEVELS.flatMap((level) => outcomes[level].steps)],
    output,
  };
}

export const ideaExcessCostV1: Calculator<ExcessCostOutput> = {
  name: 'idea_excess_cost_v1' as CalculatorName,
  title: 'IDEA Part B — LEA excess cost requirement',
  authority: [
    '34 CFR 300.202(b)',
    '34 CFR 300.16',
    'Appendix A to 34 CFR part 300',
    '20 U.S.C. 1401(8)',
  ],
  inputs: EXCESS_COST_INPUTS,
  run,
};
