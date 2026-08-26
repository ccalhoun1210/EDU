/**
 * Shared machinery for the two IDEA Part B maintenance-of-effort calculators.
 *
 * Spec: `docs/regulatory-methodology/idea-moe.md`, whose algorithm this file implements step
 * for step. Golden corpora: `golden/idea_moe_eligibility_v1.yaml`,
 * `golden/idea_moe_compliance_v1.yaml`.
 *
 * The eligibility test at 34 CFR 300.203(a) and the compliance test at 34 CFR 300.203(b) ask
 * the same question of different quantities — budgeted against prior actual, and actual
 * against prior actual — over the same four measures, subject to the same exceptions at
 * 34 CFR 300.204 and the same adjustment at 34 CFR 300.205. So the arithmetic lives here
 * once, and each calculator supplies the names of its own inputs and the handful of places
 * the two tests genuinely diverge.
 *
 * ## The governing constraint
 *
 * No regulatory text was retrievable when this was written: eCFR is blocked by the egress
 * policy, which is recorded in ADR 0006, and both rules are held at DRAFT because of it. The
 * design principle that follows is to be right where the regulation is unambiguous and to
 * refuse where it is not, naming the provision and the open question so a reviewing attorney
 * knows what to resolve. A refusal is MANUAL_REVIEW with a BLOCKING warning. It is never a
 * guess wearing a status, and it is never RISK: the statute sets no de minimis band and the
 * platform must not invent one.
 *
 * Every refusal branch below traces to a numbered open question in the methodology document.
 * None of them is a defensive `else`.
 */

import type { DataClassification, EvaluationStatus } from '@complianceos/domain';
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
  meetsOrExceeds,
  multiply,
  roundTowardZero,
  subtract,
  sum,
  type Amount,
} from '@complianceos/domain';
import {
  InputReader,
  PER_CHILD_DP,
  step,
  type CalculationStep,
  type CalculatorInputSpec,
  type CalculatorInputs,
  type CalculatorResult,
  type CalculatorValue,
  type CalculatorWarning,
} from './types.js';

/* ---------------------------------------------------------------------- vocabulary */

/**
 * The four measures, in canonical order.
 *
 * The order is load-bearing rather than cosmetic: `qualifyingMethods` is an ordered array in
 * a finalized result, and a finalized run must reproduce byte for byte (invariant 4).
 */
export const MOE_METHODS = [
  'LOCAL_ONLY',
  'STATE_AND_LOCAL',
  'LOCAL_PER_CAPITA',
  'STATE_AND_LOCAL_PER_CAPITA',
] as const;

export type MoeMethod = (typeof MOE_METHODS)[number];

/**
 * The two measures a reduction may be claimed against.
 *
 * A claim is never inferred from one to the other: the local measure and the combined
 * measure have different denominators of eligible expenditure, so an LEA that claims against
 * one has not thereby claimed against the other.
 */
export const MOE_SOURCES = ['LOCAL', 'STATE_AND_LOCAL'] as const;
export type MoeSource = (typeof MOE_SOURCES)[number];

const METHOD_SOURCE: Readonly<Record<MoeMethod, MoeSource>> = {
  LOCAL_ONLY: 'LOCAL',
  STATE_AND_LOCAL: 'STATE_AND_LOCAL',
  LOCAL_PER_CAPITA: 'LOCAL',
  STATE_AND_LOCAL_PER_CAPITA: 'STATE_AND_LOCAL',
};

const METHOD_IS_PER_CAPITA: Readonly<Record<MoeMethod, boolean>> = {
  LOCAL_ONLY: false,
  STATE_AND_LOCAL: false,
  LOCAL_PER_CAPITA: true,
  STATE_AND_LOCAL_PER_CAPITA: true,
};

const METHOD_KEY: Readonly<Record<MoeMethod, string>> = {
  LOCAL_ONLY: 'local_only',
  STATE_AND_LOCAL: 'state_and_local',
  LOCAL_PER_CAPITA: 'local_per_capita',
  STATE_AND_LOCAL_PER_CAPITA: 'state_and_local_per_capita',
};

const METHOD_LABEL: Readonly<Record<MoeMethod, string>> = {
  LOCAL_ONLY: 'Local funds only',
  STATE_AND_LOCAL: 'State and local funds combined',
  LOCAL_PER_CAPITA: 'Local funds only, per child with a disability',
  STATE_AND_LOCAL_PER_CAPITA: 'State and local funds combined, per child with a disability',
};

const SOURCE_KEY: Readonly<Record<MoeSource, string>> = {
  LOCAL: 'local',
  STATE_AND_LOCAL: 'state_local',
};

const SOURCE_LABEL: Readonly<Record<MoeSource, string>> = {
  LOCAL: 'local funds',
  STATE_AND_LOCAL: 'State and local funds',
};

/** The five grounds at 34 CFR 300.204, and only these five. */
export const EXCEPTION_GROUNDS = [
  'VOLUNTARY_DEPARTURE_OF_PERSONNEL',
  'DECREASE_IN_ENROLLMENT_OF_CHILDREN_WITH_DISABILITIES',
  'TERMINATION_OF_EXCEPTIONALLY_COSTLY_PROGRAM',
  'TERMINATION_OF_LONG_TERM_PURCHASE',
  'HIGH_COST_FUND_ASSUMPTION',
] as const;

export type ExceptionGround = (typeof EXCEPTION_GROUNDS)[number];

const GROUND_CITATION: Readonly<Record<ExceptionGround, string>> = {
  VOLUNTARY_DEPARTURE_OF_PERSONNEL: '34 CFR 300.204(a)',
  DECREASE_IN_ENROLLMENT_OF_CHILDREN_WITH_DISABILITIES: '34 CFR 300.204(b)',
  TERMINATION_OF_EXCEPTIONALLY_COSTLY_PROGRAM: '34 CFR 300.204(c)',
  TERMINATION_OF_LONG_TERM_PURCHASE: '34 CFR 300.204(d)',
  HIGH_COST_FUND_ASSUMPTION: '34 CFR 300.204(e)',
};

const PERSONNEL_DEPARTURE_TYPES = ['VOLUNTARY', 'RETIREMENT', 'JUST_CAUSE'] as const;

const CHILD_DEPARTURE_REASONS = [
  'LEFT_JURISDICTION',
  'AGED_OUT_OF_FAPE_OBLIGATION',
  'NO_LONGER_NEEDS_PROGRAM',
] as const;

const EXCEPTION_TIMINGS = ['TAKEN_INTERVENING', 'EXPECTED_BUDGET_YEAR'] as const;

export const COMPARISON_BASES = ['ACTUAL_EXPENDITURE', 'REQUIRED_LEVEL_AFTER_FAILURE'] as const;
export type ComparisonBasis = (typeof COMPARISON_BASES)[number];

export const MOE_YEAR_STATUSES = ['MET', 'NOT_MET', 'UNKNOWN'] as const;
export type MoeYearStatus = (typeof MOE_YEAR_STATUSES)[number];

export const SEA_PROHIBITION_GROUNDS = [
  'NONE',
  'FAPE_CAPACITY_DETERMINATION',
  'ENFORCEMENT_ACTION_UNDER_SECTION_616',
] as const;

/**
 * The first fiscal year the text this calculator version implements governs.
 *
 * Mirrors `effective.start` on both rule files. Whether the rule's window or the pack's
 * window governs applicability is OQ-25 and is unresolved, so no golden case pins the exact
 * boundary date. A fiscal year before this is MANUAL_REVIEW and never NOT_APPLICABLE: the
 * requirement applied to that year under the earlier text, and NOT_APPLICABLE would report
 * an exemption that does not exist. What does not apply is this calculator version.
 */
export const MOE_RULE_EFFECTIVE_START = '2015-07-01';

/**
 * Working precision for a pro-rata share before it is floored at the cent.
 *
 * Far inside the 34 significant digits the decimal context carries, so the floor lands on
 * the mathematically exact share for any figure a district will ever submit.
 */
const APPORTION_DP = 20;

/** The smallest non-zero value a figure reported at `dp` places can carry. */
function unitInLastPlace(dp: number): Amount {
  return divide(toCount(1), toCount(10 ** dp), dp) ?? ZERO;
}

const ONE_CENT: Amount = unitInLastPlace(MONEY_DP);

/* ------------------------------------------------------------------- small helpers */

function byMethod<T>(produce: (method: MoeMethod) => T): Record<MoeMethod, T> {
  return {
    LOCAL_ONLY: produce('LOCAL_ONLY'),
    STATE_AND_LOCAL: produce('STATE_AND_LOCAL'),
    LOCAL_PER_CAPITA: produce('LOCAL_PER_CAPITA'),
    STATE_AND_LOCAL_PER_CAPITA: produce('STATE_AND_LOCAL_PER_CAPITA'),
  };
}

function bySource<T>(produce: (source: MoeSource) => T): Record<MoeSource, T> {
  return { LOCAL: produce('LOCAL'), STATE_AND_LOCAL: produce('STATE_AND_LOCAL') };
}

/** Money in canonical two-place form. `formatAmount` already emits a rounded zero unsigned. */
function usd(value: Amount): string {
  return formatAmount(value, MONEY_DP);
}

/** A per-child amount at six places. Display only; no comparison ever reads this form. */
function perChild(value: Amount): string {
  return formatAmount(value, PER_CHILD_DP);
}

function blocking(code: string, message: string, citation?: string): CalculatorWarning {
  return { code, message, severity: 'BLOCKING', ...(citation === undefined ? {} : { citation }) };
}

function advisory(code: string, message: string, citation?: string): CalculatorWarning {
  return { code, message, severity: 'WARNING', ...(citation === undefined ? {} : { citation }) };
}

/**
 * Collapse warnings that two methods raised for one fact.
 *
 * A zero comparison-year child count disables both per-capita methods and would otherwise be
 * reported twice. Messages that legitimately differ per method survive, because the key is
 * the code and the message together.
 */
function dedupeWarnings(warnings: readonly CalculatorWarning[]): readonly CalculatorWarning[] {
  const seen = new Set<string>();
  const kept: CalculatorWarning[] = [];
  for (const warning of warnings) {
    const key = `${warning.code}\u0001${warning.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(warning);
  }
  return kept;
}

function sorted(names: Iterable<string>): readonly string[] {
  return [...new Set(names)].sort();
}

function objectField(entry: CalculatorValue, key: string): CalculatorValue | undefined {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined;
  const value = (entry as { readonly [name: string]: CalculatorValue })[key];
  return value === null ? undefined : value;
}

function stringField(entry: CalculatorValue, key: string): string | undefined {
  const value = objectField(entry, key);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/* --------------------------------------------------------------------- claim shapes */

interface ExceptionClaim {
  readonly ground: ExceptionGround;
  readonly source: MoeSource;
  readonly amount: Amount;
  /** An evidence reference was supplied. Its absence marks a claim unverified, not invalid. */
  readonly verified: boolean;
  /** 34 CFR 300.203(a)(2) — a reduction anticipated rather than already taken. Eligibility. */
  readonly anticipated: boolean;
}

interface AdjustmentClaim {
  readonly source: MoeSource;
  readonly amount: Amount;
}

/* ----------------------------------------------------------------------- the output */

export type MoeComparisonYear = {
  readonly fiscalYearStart: string;
  readonly basis: ComparisonBasis;
  readonly selectionAuthority: string;
};

export type MoeRepaymentBounds = {
  readonly low: string;
  readonly high: string;
};

/**
 * What both calculators emit.
 *
 * The variant-specific fields are present only on the calculator they belong to, because an
 * always-present `repaymentExposureBounds: null` on the eligibility side would assert that a
 * liability was considered and came out at nothing, on a test that has no repayment attached.
 *
 * One key carries one unit. Every `…ByMethod` magnitude is current-year dollars at two
 * places, on both calculators and on all four measures, so a reviewer reading the same column
 * across the two tests is reading the same quantity. The per-child figures eligibility also
 * reports have their own names and are null on the two total-amount measures, which have no
 * per-child magnitude. Both forms come from the same exact cross-product, each rounded once;
 * neither is derived from the other's rounded value.
 */
/**
 * The determination in the vocabulary the *following* year reads it in.
 *
 * `comparison_year_moe_status` is declared as `MET | NOT_MET | UNKNOWN`, and an evaluation
 * status is `PASS | FAIL | INDETERMINATE | …`. Those are different vocabularies for the same
 * conclusion, and until this existed the translation between them happened wherever somebody
 * carried a value forward — which is to say, by hand, in prose, unverifiable.
 *
 * Stating it in the output makes the carry-forward mechanical: the next year reads
 * `output.moeStatus` out of the finalized result, and nothing has to reinterpret a status.
 */
export type MoeDeterminedStatus = 'MET' | 'NOT_MET' | 'UNKNOWN';

export type MoeOutput = {
  readonly qualifyingMethods: readonly MoeMethod[];
  readonly methodStatus: Readonly<Record<MoeMethod, EvaluationStatus>>;
  readonly marginByMethod: Readonly<Record<MoeMethod, string | null>>;
  readonly shortfallByMethod: Readonly<Record<MoeMethod, string | null>>;
  readonly reductionBySource: Readonly<Record<MoeSource, string | null>>;
  readonly comparisonYear: MoeComparisonYear | null;
  /** Absent inputs the evaluation touched but the result did not depend on. */
  readonly dataGapsObserved: readonly string[];
  readonly marginPerChildByMethod?: Readonly<Record<MoeMethod, string | null>>;
  readonly projectedShortfallByMethod?: Readonly<Record<MoeMethod, string | null>> | null;
  readonly projectedShortfallPerChildByMethod?: Readonly<Record<MoeMethod, string | null>> | null;
  readonly qualifiesOnlyOnExpectedReductions?: boolean;
  /**
   * Present on the compliance variant only.
   *
   * The eligibility standard asks whether an LEA *budgets* at least the required level for the
   * year ahead. That is a projection, not a determination about a year that has closed, and
   * 34 CFR 300.203(c) carries forward the latter. Emitting it from both would let a budget
   * projection become the bar the next year is measured against.
   */
  readonly moeStatus?: MoeDeterminedStatus;
  readonly smallestShortfall?: string | null;
  readonly largestShortfall?: string | null;
  readonly repaymentExposureBounds?: MoeRepaymentBounds | null;
  readonly shortfallIfUnverifiedClaimsDisallowedByMethod?: Readonly<
    Record<MoeMethod, string | null>
  > | null;
  readonly qualifyingMethodsDependOnUnverifiedClaims?: boolean;
};

/* --------------------------------------------------------------- the variant contract */

export interface MoeVariantConfig {
  readonly variant: 'ELIGIBILITY' | 'COMPLIANCE';
  /** The paragraph that states the standard this calculator tests. */
  readonly standardCitation: string;
  /** Cited on `comparisonYear` when the declared basis is actual expenditure. */
  readonly actualBasisAuthority: string;
  readonly currentLocalInput: string;
  readonly currentStateLocalInput: string;
  /** "Budgeted" or "Actual" — used in step labels a business officer reads. */
  readonly currentAmountLabel: string;
  /** Step-key prefix for the current-year figures: `budget` or `current`. */
  readonly currentStepPrefix: string;
  readonly priorStatusInput: string;
}

/* ------------------------------------------------------------------- input dictionary */

const CONFIDENTIAL: DataClassification = 'CONFIDENTIAL';
const INTERNAL: DataClassification = 'INTERNAL';

/**
 * The inputs both calculators declare.
 *
 * Nothing here rises above CONFIDENTIAL. IDEA Fiscal operates with no student PII: every
 * count is an aggregate, and no exception entry may carry a student name, a student
 * identifier, a staff name or a date of birth. Identifying material stays in the evidence
 * document behind a reference (invariant 10).
 */
export const SHARED_MOE_INPUTS: readonly CalculatorInputSpec[] = [
  {
    name: 'current_fiscal_year_start',
    type: 'date',
    required: true,
    classification: INTERNAL,
    definition: 'First day of the fiscal year under test.',
  },
  {
    name: 'federal_funds_excluded',
    type: 'boolean',
    required: true,
    classification: INTERNAL,
    definition:
      'Attestation from the ingest transformation that no expenditure from federal funds ' +
      'the LEA or SEA must account for federally is included in any amount. False is a ' +
      'known-bad input, not a gap.',
  },
  {
    name: 'comparison_fiscal_year_start',
    type: 'date',
    required: true,
    classification: INTERNAL,
    definition:
      'First day of the fiscal year the comparison amounts belong to. Selected by the ' +
      'pipeline, validated here.',
  },
  {
    name: 'comparison_basis',
    type: 'enum',
    required: true,
    classification: INTERNAL,
    definition:
      'ACTUAL_EXPENDITURE or REQUIRED_LEVEL_AFTER_FAILURE. Declares which pair of ' +
      'comparison amounts is operative.',
  },
  {
    name: 'moe_status_source_run_id',
    type: 'string',
    required: false,
    classification: INTERNAL,
    definition:
      'The finalized compliance run, or SEA determination of record, establishing the ' +
      'declared prior-year status. Required whenever that status is MET or NOT_MET.',
  },
  {
    name: 'comparison_actual_local',
    type: 'money',
    required: false,
    classification: CONFIDENTIAL,
    definition:
      'Comparison-year actual expenditure, local funds only. Operative when the declared ' +
      'basis is ACTUAL_EXPENDITURE.',
  },
  {
    name: 'comparison_actual_state_local',
    type: 'money',
    required: false,
    classification: CONFIDENTIAL,
    definition: 'Comparison-year actual expenditure, State and local funds combined.',
  },
  {
    name: 'comparison_child_count',
    type: 'count',
    required: false,
    classification: CONFIDENTIAL,
    definition:
      'Aggregate count of children with disabilities in the comparison year. Pairs with the ' +
      'comparison-year actual amounts.',
  },
  {
    name: 'comparison_required_level_local',
    type: 'money',
    required: false,
    classification: CONFIDENTIAL,
    definition:
      'The local-funds level that would have been required absent a prior failure. A ' +
      'distinct input from the failure year actual expenditure — see OQ-3.',
  },
  {
    name: 'comparison_required_level_state_local',
    type: 'money',
    required: false,
    classification: CONFIDENTIAL,
    definition: 'The same carried-forward level for State and local funds combined.',
  },
  {
    name: 'comparison_required_level_child_count',
    type: 'count',
    required: false,
    classification: CONFIDENTIAL,
    definition:
      'The aggregate child count declared to pair with the carried-forward required level. ' +
      'A distinct input because which year the count belongs to is unresolved — OQ-4.',
  },
  {
    name: 'claimed_exceptions',
    type: 'list',
    required: false,
    classification: CONFIDENTIAL,
    definition:
      'Reductions claimed under 34 CFR 300.204. Each entry names one of five enumerated ' +
      'grounds, a source, and a non-negative amount. No entry may carry an identifier.',
  },
  {
    name: 'claimed_adjustments_300_205',
    type: 'list',
    required: false,
    classification: CONFIDENTIAL,
    definition:
      'Reductions claimed under 34 CFR 300.205, at most one per source. A duplicate source ' +
      'is a validation failure.',
  },
  {
    name: 'part_b_611_allocation_current',
    type: 'money',
    required: false,
    classification: INTERNAL,
    definition:
      'Section 611 allocation for the year under test. Needed only to validate a ' +
      '34 CFR 300.205 claim.',
  },
  {
    name: 'part_b_611_allocation_prior',
    type: 'money',
    required: false,
    classification: INTERNAL,
    definition: 'Section 611 allocation for the preceding year.',
  },
  {
    name: 'ceis_amount_300_226',
    type: 'money',
    required: false,
    classification: CONFIDENTIAL,
    definition:
      'Coordinated early intervening services amount under 34 CFR 300.226. Consumes the ' +
      '34 CFR 300.205 ceiling.',
  },
  {
    name: 'sea_prohibition_300_205_ground',
    type: 'enum',
    required: false,
    classification: INTERNAL,
    definition:
      'NONE, FAPE_CAPACITY_DETERMINATION or ENFORCEMENT_ACTION_UNDER_SECTION_616. An ' +
      'enumerated ground rather than a bare boolean, so a prohibition is of record.',
  },
  {
    name: 'sea_prohibition_300_205_evidence_ref',
    type: 'string',
    required: false,
    classification: INTERNAL,
    definition: 'Evidence for that determination. Required when the ground is not NONE.',
  },
  {
    name: 'esea_use_condition_attested',
    type: 'boolean',
    required: false,
    classification: INTERNAL,
    definition:
      'Whether the LEA has shown it used an equal amount of local funds on ' +
      'ESEA-supportable activities. Absent makes a 34 CFR 300.205 claim unvalidatable; ' +
      'false disallows it.',
  },
];

/* ------------------------------------------------------------------------ validation */

interface ValidationOutcome {
  readonly problems: readonly CalculatorWarning[];
  readonly exceptions: readonly ExceptionClaim[];
  readonly adjustments: readonly AdjustmentClaim[];
  /** What the LEA submitted, whether or not it survived parsing. See `entriesSubmitted`. */
  readonly exceptionEntriesSubmitted: number;
  readonly adjustmentEntriesSubmitted: number;
}

interface ValidationScope {
  readonly moneyInputs: readonly string[];
  readonly countInputs: readonly string[];
  readonly dateInputs: readonly string[];
  readonly booleanInputs: readonly string[];
  readonly enumInputs: readonly { readonly name: string; readonly permitted: readonly string[] }[];
  /** Opaque references — a run id, an evidence reference. Present-but-not-a-string is a bug. */
  readonly referenceInputs: readonly string[];
}

/**
 * How many entries the LEA put in a claim list.
 *
 * Counted from the submitted list rather than from the claims that parsed, so that a run
 * refused *because* a claim could not be read does not also report that no claim was made.
 * A value that is not a list at all is a malformed input and is reported as one; there are no
 * entries in it to count.
 */
function entriesSubmitted(raw: CalculatorValue | undefined): number {
  return Array.isArray(raw) ? raw.length : 0;
}

/**
 * Money arrives at the cent, and a third fractional place is a malformed figure.
 *
 * Nothing rounds an operand before comparing it, so a value carrying more places than money
 * has decides the result at a precision the district never sees: the comparison amount, the
 * required level and the margin all render at two places, and a business officer reconciling
 * those three figures against a ledger would be checking numbers the calculator did not use.
 */
function moneyScaleProblem(
  subject: string,
  raw: string,
  citation?: string,
): CalculatorWarning | undefined {
  const fraction = raw.split('.')[1] ?? '';
  if (fraction.length <= MONEY_DP) return undefined;
  return blocking(
    'MALFORMED_INPUT',
    `${subject}: "${raw}" carries ${fraction.length} fractional digits. Money is exact at the ` +
      'cent, and a figure below it is displayed as something other than the value compared.',
    citation,
  );
}

/**
 * Every validation problem in one pass, before any applicability gate.
 *
 * Two properties matter. It collects rather than stopping at the first problem, so a
 * district is told once what it owes rather than three times in three runs. And it runs
 * before the gates, so a gate can never suppress a problem the reviewer needed to see.
 *
 * The probe reader is thrown away: its `missing` set is not the calculator's, because an
 * absent optional input is not a validation problem and must not be reported as one here.
 */
function validate(
  inputs: CalculatorInputs,
  config: MoeVariantConfig,
  scope: ValidationScope,
): ValidationOutcome {
  const probe = new InputReader(inputs);
  const problems: CalculatorWarning[] = [];

  for (const name of scope.moneyInputs) {
    if (!probe.has(name)) continue;
    const value = probe.money(name);
    if (value === undefined) continue;
    if (isNegative(value)) {
      problems.push(
        blocking(
          'NEGATIVE_MONEY_VALUE',
          `${name} is negative (${usd(value)}). No quantity in this calculation can be below zero.`,
        ),
      );
    }
    const raw = probe.raw(name);
    if (typeof raw === 'string') {
      const scale = moneyScaleProblem(name, raw);
      if (scale !== undefined) problems.push(scale);
    }
  }
  for (const name of scope.countInputs) if (probe.has(name)) probe.count(name);
  for (const name of scope.dateInputs) if (probe.has(name)) probe.date(name);
  for (const name of scope.booleanInputs) if (probe.has(name)) probe.boolean(name);
  for (const { name, permitted } of scope.enumInputs) {
    if (probe.has(name)) probe.enumValue(name, permitted);
  }
  // A reference of the wrong shape is malformed, not absent. Reporting it as absent tells a
  // district a field is missing that it supplied, and sends it looking for the wrong remedy.
  for (const name of scope.referenceInputs) {
    if (!probe.has(name) || typeof inputs[name] === 'string') continue;
    problems.push(
      blocking('MALFORMED_INPUT', `${name}: a value was supplied, but not as a reference string.`),
    );
  }

  const exceptions = readExceptionClaims(inputs, config, problems);
  const adjustments = readAdjustmentClaims(inputs, problems);
  const adjustmentEntriesSubmitted = entriesSubmitted(inputs['claimed_adjustments_300_205']);

  const prohibition = probe.has('sea_prohibition_300_205_ground')
    ? probe.enumValue('sea_prohibition_300_205_ground', SEA_PROHIBITION_GROUNDS)
    : undefined;
  // Only where the LEA claimed something under the section. A prohibition does one thing —
  // hold an allowed 34 CFR 300.205 adjustment at zero — so with no claim to hold down it
  // cannot move any figure in the run, and refusing over its evidence refuses a question
  // nobody asked. Counted from the entries submitted rather than the ones that parsed: a
  // claim the platform could not read is still a claim the LEA made.
  if (
    prohibition !== undefined &&
    prohibition !== 'NONE' &&
    adjustmentEntriesSubmitted > 0 &&
    !probe.has('sea_prohibition_300_205_evidence_ref')
  ) {
    problems.push(
      blocking(
        'SEA_PROHIBITION_EVIDENCE_NOT_SUPPLIED',
        'An SEA prohibition on the 34 CFR 300.205 adjustment was declared on an enumerated ' +
          'ground with no evidence reference. A prohibition is a determination of record.',
        '34 CFR 300.205',
      ),
    );
  }

  problems.push(...validateCombinedContainsLocal(probe, config));
  if (config.variant === 'COMPLIANCE') {
    problems.push(...validateComparisonMethodsMet(inputs));
  }

  problems.push(...probe.malformedWarnings());
  return {
    problems,
    exceptions,
    adjustments,
    exceptionEntriesSubmitted: entriesSubmitted(inputs['claimed_exceptions']),
    adjustmentEntriesSubmitted,
  };
}

/**
 * The combined measure contains the local one, so it cannot be the smaller of the two.
 *
 * An inversion is a fund-category mapping error, not a district that spent negative State
 * money, and every figure downstream of it is wrong. Checked on both comparison pairs
 * independently of which one the declared basis makes operative, because a mapping error in
 * the pair that is not used this year is still a mapping error — and on both calculators,
 * because the containment is a property of the fund categories and not of which test is
 * running. The two read the same comparison pairs.
 */
function validateCombinedContainsLocal(
  probe: InputReader,
  config: MoeVariantConfig,
): readonly CalculatorWarning[] {
  const pairs: readonly (readonly [string, string])[] = [
    [config.currentLocalInput, config.currentStateLocalInput],
    ['comparison_actual_local', 'comparison_actual_state_local'],
    ['comparison_required_level_local', 'comparison_required_level_state_local'],
  ];
  const problems: CalculatorWarning[] = [];
  for (const [localName, combinedName] of pairs) {
    if (!probe.has(localName) || !probe.has(combinedName)) continue;
    const local = probe.money(localName);
    const combined = probe.money(combinedName);
    if (local === undefined || combined === undefined) continue;
    if (compare(combined, local) < 0) {
      problems.push(
        blocking(
          'COMBINED_MEASURE_BELOW_LOCAL_MEASURE',
          `${combinedName} (${usd(combined)}) is below ${localName} (${usd(local)}). The ` +
            'combined measure contains the local one, so this is a fund-category mapping error.',
        ),
      );
    }
  }
  return problems;
}

function validateComparisonMethodsMet(inputs: CalculatorInputs): readonly CalculatorWarning[] {
  const raw = inputs['comparison_year_methods_met'];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    return [
      blocking('MALFORMED_INPUT', 'comparison_year_methods_met: expected a list of method names'),
    ];
  }
  const problems: CalculatorWarning[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !(MOE_METHODS as readonly string[]).includes(entry)) {
      problems.push(
        blocking(
          'MALFORMED_INPUT',
          `comparison_year_methods_met: "${String(entry)}" is not one of ${MOE_METHODS.join(', ')}`,
        ),
      );
    }
  }
  return problems;
}

function readExceptionClaims(
  inputs: CalculatorInputs,
  config: MoeVariantConfig,
  problems: CalculatorWarning[],
): readonly ExceptionClaim[] {
  const raw = inputs['claimed_exceptions'];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    problems.push(blocking('MALFORMED_INPUT', 'claimed_exceptions: expected a list'));
    return [];
  }

  const claims: ExceptionClaim[] = [];
  raw.forEach((entry, index) => {
    const where = `claimed_exceptions[${index}]`;
    const ground = stringField(entry, 'ground');
    if (ground === undefined || !(EXCEPTION_GROUNDS as readonly string[]).includes(ground)) {
      // Admitting an unrecognised ground would let the platform reduce a required level on a
      // basis the regulation does not recognise. Discarding it silently would report a status
      // while the district believes it is relying on the claim. Both are refused.
      problems.push(
        blocking(
          'UNRECOGNISED_EXCEPTION_GROUND',
          `${where}: "${ground ?? '(absent)'}" is not one of the five grounds enumerated at ` +
            '34 CFR 300.204.',
          '34 CFR 300.204',
        ),
      );
      return;
    }
    const typedGround = ground as ExceptionGround;
    const citation = GROUND_CITATION[typedGround];

    const source = stringField(entry, 'source');
    if (source === undefined || !(MOE_SOURCES as readonly string[]).includes(source)) {
      problems.push(
        blocking(
          'EXCEPTION_SOURCE_NOT_SUPPLIED',
          `${where}: source must be LOCAL or STATE_AND_LOCAL. A claim is never inferred from ` +
            'one measure to the other.',
          citation,
        ),
      );
      return;
    }

    const rawAmount = objectField(entry, 'amount');
    if (typeof rawAmount !== 'string') {
      problems.push(
        blocking(
          'MALFORMED_INPUT',
          `${where}: amount must arrive as a decimal string, never a number.`,
          citation,
        ),
      );
      return;
    }
    let claimAmount: Amount;
    try {
      claimAmount = amountFromString(rawAmount);
    } catch {
      problems.push(
        blocking('MALFORMED_INPUT', `${where}: "${rawAmount}" is not a plain decimal numeral.`),
      );
      return;
    }
    const scale = moneyScaleProblem(`${where} amount`, rawAmount, citation);
    if (scale !== undefined) {
      problems.push(scale);
      return;
    }
    if (isNegative(claimAmount)) {
      problems.push(blocking('NEGATIVE_MONEY_VALUE', `${where}: amount is negative.`, citation));
      return;
    }

    const eventYear = stringField(entry, 'event_fiscal_year_start');
    if (eventYear !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(eventYear)) {
      problems.push(
        blocking(
          'MALFORMED_INPUT',
          `${where}: event_fiscal_year_start "${eventYear}" is not a YYYY-MM-DD calendar date.`,
        ),
      );
      return;
    }

    problems.push(...groundConditions(where, typedGround, entry, citation));

    let anticipated = false;
    if (config.variant === 'ELIGIBILITY') {
      const timing = stringField(entry, 'timing');
      if (timing !== undefined && !(EXCEPTION_TIMINGS as readonly string[]).includes(timing)) {
        problems.push(
          blocking(
            'MALFORMED_INPUT',
            `${where}: timing "${timing}" is not one of ${EXCEPTION_TIMINGS.join(', ')}.`,
            '34 CFR 300.203(a)(2)',
          ),
        );
        return;
      }
      // An undeclared timing is read as a reduction already taken. 34 CFR 300.203(a)(2)
      // permits anticipating one, but anticipation is the departure from the ordinary case
      // and the platform does not assume it on the LEA's behalf.
      anticipated = timing === 'EXPECTED_BUDGET_YEAR';
    }

    claims.push({
      ground: typedGround,
      source: source as MoeSource,
      amount: claimAmount,
      verified: stringField(entry, 'evidence_ref') !== undefined,
      anticipated,
    });
  });
  return claims;
}

/**
 * The conditions a ground is subject to, checked only where the ground carries one.
 *
 * The SEA determination on the exceptionally-costly-program ground is the consequential one:
 * the ground is conditioned on that determination, so without it the claim is not the thing
 * the provision describes and admitting it at face value would move a required level by the
 * whole claimed amount on nobody's authority.
 */
function groundConditions(
  where: string,
  ground: ExceptionGround,
  entry: CalculatorValue,
  citation: string,
): readonly CalculatorWarning[] {
  const problems: CalculatorWarning[] = [];
  const missing = (what: string): void => {
    problems.push(
      blocking(
        'EXCEPTION_GROUND_CONDITION_NOT_SUPPLIED',
        `${where}: the ${ground} ground requires ${what}.`,
        citation,
      ),
    );
  };

  if (ground === 'VOLUNTARY_DEPARTURE_OF_PERSONNEL') {
    const kind = stringField(entry, 'personnel_departure_type');
    if (kind === undefined || !(PERSONNEL_DEPARTURE_TYPES as readonly string[]).includes(kind)) {
      missing(`personnel_departure_type to be one of ${PERSONNEL_DEPARTURE_TYPES.join(', ')}`);
    }
  }

  if (ground === 'TERMINATION_OF_EXCEPTIONALLY_COSTLY_PROGRAM') {
    const reason = stringField(entry, 'child_departure_reason');
    if (reason === undefined || !(CHILD_DEPARTURE_REASONS as readonly string[]).includes(reason)) {
      missing(`child_departure_reason to be one of ${CHILD_DEPARTURE_REASONS.join(', ')}`);
    }
    if (stringField(entry, 'sea_determination_ref') === undefined) {
      missing('sea_determination_ref, the SEA determination the ground is conditioned on');
    }
  }

  return problems;
}

function readAdjustmentClaims(
  inputs: CalculatorInputs,
  problems: CalculatorWarning[],
): readonly AdjustmentClaim[] {
  const raw = inputs['claimed_adjustments_300_205'];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    problems.push(blocking('MALFORMED_INPUT', 'claimed_adjustments_300_205: expected a list'));
    return [];
  }

  const claims: AdjustmentClaim[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const where = `claimed_adjustments_300_205[${index}]`;
    const source = stringField(entry, 'source');
    if (source === undefined || !(MOE_SOURCES as readonly string[]).includes(source)) {
      problems.push(
        blocking(
          'ADJUSTMENT_SOURCE_NOT_SUPPLIED',
          `${where}: source must be LOCAL or STATE_AND_LOCAL.`,
          '34 CFR 300.205',
        ),
      );
      return;
    }
    if (seen.has(source)) {
      problems.push(
        blocking(
          'DUPLICATE_ADJUSTMENT_SOURCE',
          `${where}: ${source} is claimed more than once under 34 CFR 300.205. At most one ` +
            'entry per measure is permitted.',
          '34 CFR 300.205',
        ),
      );
      return;
    }
    seen.add(source);

    const rawAmount = objectField(entry, 'amount');
    if (typeof rawAmount !== 'string') {
      problems.push(
        blocking(
          'MALFORMED_INPUT',
          `${where}: amount must arrive as a decimal string, never a number.`,
          '34 CFR 300.205',
        ),
      );
      return;
    }
    let claimAmount: Amount;
    try {
      claimAmount = amountFromString(rawAmount);
    } catch {
      problems.push(
        blocking('MALFORMED_INPUT', `${where}: "${rawAmount}" is not a plain decimal numeral.`),
      );
      return;
    }
    const scale = moneyScaleProblem(`${where} amount`, rawAmount, '34 CFR 300.205');
    if (scale !== undefined) {
      problems.push(scale);
      return;
    }
    if (isNegative(claimAmount)) {
      problems.push(
        blocking('NEGATIVE_MONEY_VALUE', `${where}: amount is negative.`, '34 CFR 300.205'),
      );
      return;
    }
    claims.push({ source: source as MoeSource, amount: claimAmount });
  });
  return claims;
}

/**
 * Parse a decimal string through the same reader every other amount goes through.
 *
 * A claim amount arrives inside a list element rather than as a top-level input, so
 * `InputReader.money` cannot reach it; this routes it to the identical strict parser so that
 * "1,250.00" and "$1250" are rejected here exactly as they would be there.
 */
function amountFromString(raw: string): Amount {
  const reader = new InputReader({ value: raw });
  const parsed = reader.money('value');
  if (parsed === undefined) throw new Error('not a plain decimal numeral');
  return parsed;
}

/* ------------------------------------------------------- the 34 CFR 300.205 ceiling */

interface AdjustmentOutcome {
  readonly allowedBySource: Record<MoeSource, Amount>;
  /** Absent inputs that made the claims unvalidatable, so a claim was allowed at zero. */
  readonly setAsideInputs: readonly string[];
  readonly warnings: readonly CalculatorWarning[];
  readonly steps: readonly CalculationStep[];
}

const NO_ADJUSTMENT: AdjustmentOutcome = {
  allowedBySource: { LOCAL: ZERO, STATE_AND_LOCAL: ZERO },
  setAsideInputs: [],
  warnings: [],
  steps: [],
};

/**
 * The 34 CFR 300.205 adjustment, capped and apportioned order-independently.
 *
 * The ceiling applies to the *total* claimed under the section and is apportioned across the
 * claims in proportion to their amounts. Consuming it in list order — the draft algorithm —
 * made the result a function of how an upstream ingest happened to order a logically
 * unordered array, which defeats reproducibility of a finalized run outright (invariant 4).
 *
 * Whether the ceiling is shared across the two measures or is one per measure is OQ-11.
 */
function resolveAdjustment(
  reader: InputReader,
  inputs: CalculatorInputs,
  claims: readonly AdjustmentClaim[],
): AdjustmentOutcome {
  if (claims.length === 0) return NO_ADJUSTMENT;

  const probe = new InputReader(inputs);
  const prohibition = probe.has('sea_prohibition_300_205_ground')
    ? probe.enumValue('sea_prohibition_300_205_ground', SEA_PROHIBITION_GROUNDS)
    : 'NONE';

  if (prohibition !== undefined && prohibition !== 'NONE') {
    return {
      ...NO_ADJUSTMENT,
      warnings: [
        advisory(
          'ADJUSTMENT_300_205_PROHIBITED_BY_SEA',
          `The SEA has prohibited the 34 CFR 300.205 adjustment on the ground ${prohibition}, ` +
            'so the unreduced comparison level governs.',
          '34 CFR 300.205',
        ),
      ],
      steps: allowedSteps({ LOCAL: ZERO, STATE_AND_LOCAL: ZERO }),
    };
  }

  const esea = probe.has('esea_use_condition_attested')
    ? probe.boolean('esea_use_condition_attested')
    : undefined;
  if (esea === false) {
    return {
      ...NO_ADJUSTMENT,
      warnings: [
        advisory(
          'ADJUSTMENT_300_205_ESEA_CONDITION_NOT_MET',
          'The LEA has not shown it used an equal amount of local funds on ESEA-supportable ' +
            'activities, so no amount is allowed under 34 CFR 300.205. Whether that condition ' +
            'is a condition precedent or an independent obligation is OQ-14.',
          '34 CFR 300.205',
        ),
      ],
      steps: allowedSteps({ LOCAL: ZERO, STATE_AND_LOCAL: ZERO }),
    };
  }

  const unvalidatable: string[] = [];
  if (esea === undefined) unvalidatable.push('esea_use_condition_attested');
  const current = probe.has('part_b_611_allocation_current')
    ? probe.money('part_b_611_allocation_current')
    : undefined;
  if (current === undefined) unvalidatable.push('part_b_611_allocation_current');
  const prior = probe.has('part_b_611_allocation_prior')
    ? probe.money('part_b_611_allocation_prior')
    : undefined;
  if (prior === undefined) unvalidatable.push('part_b_611_allocation_prior');
  // Not defaulted to zero. A zero default enlarges the ceiling, which runs in the LEA's
  // favour on a figure nobody supplied. OQ-10.
  const ceis = probe.has('ceis_amount_300_226') ? probe.money('ceis_amount_300_226') : undefined;
  if (ceis === undefined) unvalidatable.push('ceis_amount_300_226');

  if (current === undefined || prior === undefined || ceis === undefined || esea === undefined) {
    // Set aside, not admitted. Zero is the conservative direction: it can only raise the bar,
    // so a method that passes anyway was not decided by the absent figures. Step 10 of the
    // methodology resolves the rest.
    return {
      allowedBySource: { LOCAL: ZERO, STATE_AND_LOCAL: ZERO },
      setAsideInputs: sorted(unvalidatable),
      warnings: [
        advisory(
          'ADJUSTMENT_300_205_UNVALIDATABLE',
          `The 34 CFR 300.205 ceiling cannot be computed: ${sorted(unvalidatable).join(', ')} ` +
            'absent. The claims are set aside and allowed at 0.00, which can only raise the ' +
            'required level.',
          '34 CFR 300.205',
        ),
      ],
      steps: allowedSteps({ LOCAL: ZERO, STATE_AND_LOCAL: ZERO }),
    };
  }

  for (const name of ['part_b_611_allocation_current', 'part_b_611_allocation_prior']) {
    reader.money(name);
  }
  reader.money('ceis_amount_300_226');

  const rawIncrease = subtract(current, prior);
  const increase = isNegative(rawIncrease) ? ZERO : rawIncrease;
  // The only directional rounding in either calculator. The ceiling is a statutory maximum,
  // and rounding a maximum up would authorise a reduction the regulation does not.
  const half = roundTowardZero(
    multiply(increase, divide(toCount(1), toCount(2), 1) ?? ZERO),
    MONEY_DP,
  );
  const rawCeiling = subtract(half, ceis);
  const ceiling = isNegative(rawCeiling) ? ZERO : rawCeiling;
  const claimedTotal = sum(claims.map((claim) => claim.amount));

  const steps: CalculationStep[] = [
    step(
      'adjustment_300_205_allocation_increase',
      'Increase in the section 611 allocation',
      usd(increase),
      'USD',
      {
        citation: '34 CFR 300.205',
        detail: `${formatUsd(current)} − ${formatUsd(prior)}, floored at zero`,
        inputsUsed: ['part_b_611_allocation_current', 'part_b_611_allocation_prior'],
      },
    ),
    step(
      'adjustment_300_205_ceiling',
      'Ceiling on the 34 CFR 300.205 adjustment',
      usd(ceiling),
      'USD',
      {
        citation: '34 CFR 300.205',
        detail:
          `half the increase, toward zero at the cent, is ${formatUsd(half)}; less ` +
          `coordinated early intervening services of ${formatUsd(ceis)}`,
        inputsUsed: [
          'part_b_611_allocation_current',
          'part_b_611_allocation_prior',
          'ceis_amount_300_226',
        ],
      },
    ),
    step(
      'adjustment_300_205_claimed_total',
      'Total claimed under 34 CFR 300.205',
      usd(claimedTotal),
      'USD',
      {
        citation: '34 CFR 300.205',
        detail: claims.map((claim) => `${claim.source} ${formatUsd(claim.amount)}`).join(' + '),
        inputsUsed: ['claimed_adjustments_300_205'],
      },
    ),
  ];

  const claimedBySource = bySource((source) =>
    sum(claims.filter((claim) => claim.source === source).map((claim) => claim.amount)),
  );

  if (meetsOrExceeds(ceiling, claimedTotal)) {
    const allowed = claimedBySource;
    return {
      allowedBySource: allowed,
      setAsideInputs: [],
      warnings: [],
      steps: [...steps, ...allowedSteps(allowed)],
    };
  }

  const allowed = apportion(claimedBySource, claimedTotal, ceiling);
  return {
    allowedBySource: allowed,
    setAsideInputs: [],
    warnings: [
      advisory(
        'ADJUSTMENT_300_205_CAPPED',
        `Claims totalling ${formatUsd(claimedTotal)} exceed the 34 CFR 300.205 ceiling of ` +
          `${formatUsd(ceiling)} and are apportioned pro rata by claim amount.`,
        '34 CFR 300.205',
      ),
    ],
    steps: [...steps, ...allowedSteps(allowed)],
  };
}

/**
 * Apportion a ceiling across the claims in proportion to their amounts.
 *
 * Each share is floored at the cent so the total allowed can never exceed the ceiling, and
 * the residual — at most one cent, since at most one claim per source is permitted — goes to
 * the LOCAL claim. That is a property of the source, not of the array, so reversing the
 * claim list produces an identical result.
 */
function apportion(
  claimedBySource: Record<MoeSource, Amount>,
  claimedTotal: Amount,
  ceiling: Amount,
): Record<MoeSource, Amount> {
  const shares = bySource((source) => {
    const claimed = claimedBySource[source];
    if (isZero(claimed)) return ZERO;
    const exact = divide(multiply(claimed, ceiling), claimedTotal, APPORTION_DP);
    return exact === undefined ? ZERO : roundTowardZero(exact, MONEY_DP);
  });

  const allowed: Record<MoeSource, Amount> = { ...shares };
  let residual = subtract(ceiling, add(allowed.LOCAL, allowed.STATE_AND_LOCAL));
  for (const source of MOE_SOURCES) {
    while (
      meetsOrExceeds(residual, ONE_CENT) &&
      compare(add(allowed[source], ONE_CENT), claimedBySource[source]) <= 0
    ) {
      allowed[source] = add(allowed[source], ONE_CENT);
      residual = subtract(residual, ONE_CENT);
    }
  }
  return allowed;
}

function allowedSteps(allowed: Record<MoeSource, Amount>): readonly CalculationStep[] {
  return MOE_SOURCES.map((source) =>
    step(
      `adjustment_allowed_${SOURCE_KEY[source]}`,
      `Allowed under 34 CFR 300.205 against ${SOURCE_LABEL[source]}`,
      usd(allowed[source]),
      'USD',
      { citation: '34 CFR 300.205', inputsUsed: ['claimed_adjustments_300_205'] },
    ),
  );
}

/* ------------------------------------------------------------- method-level evaluation */

interface MethodOutcome {
  readonly status: EvaluationStatus;
  /** Current-year dollars, on all four measures. */
  readonly margin: Amount | null;
  readonly shortfall: Amount | null;
  /** The same quantity per child. Null on a total-amount measure, which has no per-child form. */
  readonly marginPerChild: Amount | null;
  readonly shortfallPerChild: Amount | null;
  readonly missing: readonly string[];
  readonly warnings: readonly CalculatorWarning[];
  readonly steps: readonly CalculationStep[];
}

interface MethodFacts {
  readonly comparisonBySource: Record<MoeSource, Amount | undefined>;
  readonly comparisonInputBySource: Record<MoeSource, string>;
  readonly currentBySource: Record<MoeSource, Amount | undefined>;
  readonly currentInputBySource: Record<MoeSource, string>;
  readonly reductionBySource: Record<MoeSource, Amount>;
  readonly reductionWithoutEnrollmentBySource: Record<MoeSource, Amount>;
  readonly enrollmentClaimBySource: Record<MoeSource, boolean>;
  readonly setAsideBySource: Record<MoeSource, readonly string[]>;
  readonly currentCount: number | undefined;
  readonly currentCountInput: string;
  readonly comparisonCount: number | undefined;
  readonly comparisonCountInput: string;
  /** Methods refused before any arithmetic, by the 34 CFR 300.203(c) reading dispute. */
  readonly refusedMethods: ReadonlySet<MoeMethod>;
  readonly currentAmountLabel: string;
}

interface CrossReading {
  readonly key: string;
  readonly label: string;
  readonly passes: boolean;
  /** left-hand cross product minus right-hand cross product; sign carries the result. */
  readonly numerator: Amount;
  readonly detail: string;
  readonly admitsEnrollmentClaim: boolean;
}

/**
 * A per-capita magnitude, rounded once from the exact cross-product it came from.
 *
 * Never to nothing. A quotient can be smaller than the last place the figure is reported in,
 * and a measure the calculator has just reported as failing must not put the amount at zero:
 * on the compliance side that figure bounds a repayment, and a zero there understates a
 * district's exposure to nothing at all. A difference that is genuinely zero still reports as
 * zero — the floor moves only a magnitude that exists and would otherwise disappear.
 */
function magnitude(numerator: Amount, denominator: Amount, dp: number): Amount | null {
  const quotient = divide(numerator, denominator, dp);
  if (quotient === undefined) return null;
  if (!isZero(quotient) || isZero(numerator)) return quotient;
  const smallest = unitInLastPlace(dp);
  return isNegative(numerator) ? smallest.negated() : smallest;
}

function evaluateMethods(facts: MethodFacts): Record<MoeMethod, MethodOutcome> {
  return byMethod((method) => evaluateOneMethod(method, facts));
}

function evaluateOneMethod(method: MoeMethod, facts: MethodFacts): MethodOutcome {
  const source = METHOD_SOURCE[method];

  if (facts.refusedMethods.has(method)) {
    return {
      status: 'MANUAL_REVIEW',
      margin: null,
      shortfall: null,
      marginPerChild: null,
      shortfallPerChild: null,
      missing: [],
      warnings: [
        blocking(
          'COMPARISON_BASIS_READING_DISPUTED',
          `${METHOD_LABEL[method]}: the comparison year was met under some measures but not ` +
            'this one. Whether the subsequent-years rule carries forward per measure or on ' +
            'the standard as a whole decides this method’s comparison level, and the two ' +
            'readings give different answers. OQ-9.',
          '34 CFR 300.203(c)',
        ),
      ],
      steps: [],
    };
  }

  const comparison = facts.comparisonBySource[source];
  const current = facts.currentBySource[source];
  const perCapita = METHOD_IS_PER_CAPITA[method];

  const missing: string[] = [];
  if (comparison === undefined) missing.push(facts.comparisonInputBySource[source]);
  if (current === undefined) missing.push(facts.currentInputBySource[source]);
  if (perCapita) {
    if (facts.currentCount === undefined) missing.push(facts.currentCountInput);
    if (facts.comparisonCount === undefined) missing.push(facts.comparisonCountInput);
  }
  if (comparison === undefined || current === undefined) {
    return unanswerableMethod(missing);
  }

  const reduction = facts.reductionBySource[source];
  const required = subtract(comparison, reduction);
  const setAside = facts.setAsideBySource[source];

  if (!perCapita) {
    const margin = subtract(current, required);
    const passes = meetsOrExceeds(current, required);
    const outcome: MethodOutcome = {
      status: passes ? 'PASS' : 'FAIL',
      margin,
      shortfall: passes ? ZERO : margin.negated(),
      marginPerChild: null,
      shortfallPerChild: null,
      missing: [],
      warnings: [],
      steps: [
        step(
          `${METHOD_KEY[method]}_result`,
          `${METHOD_LABEL[method]} — total dollars`,
          passes ? 'PASS' : 'FAIL',
          'TEXT',
          {
            citation: '34 CFR 300.203',
            detail:
              `${facts.currentAmountLabel} ${formatUsd(current)} against a required level of ` +
              `${formatUsd(required)}; margin ${formatUsd(margin)}`,
            inputsUsed: [facts.currentInputBySource[source], facts.comparisonInputBySource[source]],
          },
        ),
      ],
    };
    return applySetAside(outcome, setAside);
  }

  const n = facts.currentCount;
  const nc = facts.comparisonCount;
  if (n === undefined || nc === undefined) return unanswerableMethod(missing);

  // A zero denominator is not a zero requirement. Cross-multiplying through it would either
  // compare a current amount against nothing or report a requirement of zero that any budget
  // clears; neither is a determination about the LEA.
  if (nc === 0 || n === 0) {
    // Both are reported where both are zero. Naming one and then the other on the next run —
    // after the district has fixed the first — is the "told three times in three runs"
    // failure this module keeps its problems accumulated to avoid.
    const zeroWarnings: CalculatorWarning[] = [];
    if (nc === 0) {
      zeroWarnings.push(
        advisory(
          'ZERO_COMPARISON_CHILD_COUNT',
          'The comparison-year child count is zero, so no comparison-year per-child level ' +
            'exists and the per-capita measures are not applicable.',
          '34 CFR 300.203',
        ),
      );
    }
    if (n === 0) {
      zeroWarnings.push(
        advisory(
          'ZERO_CURRENT_CHILD_COUNT',
          'The child count for the year under test is zero, so no per-child level exists ' +
            'and the per-capita measures are not applicable.',
          '34 CFR 300.203',
        ),
      );
    }
    return {
      status: 'NOT_APPLICABLE',
      margin: null,
      shortfall: null,
      marginPerChild: null,
      shortfallPerChild: null,
      missing: [],
      warnings: zeroWarnings,
      steps: [
        step(`${METHOD_KEY[method]}_result`, `${METHOD_LABEL[method]}`, 'NOT_APPLICABLE', 'TEXT', {
          citation: '34 CFR 300.203',
          detail: `child count ${nc === 0 ? facts.comparisonCountInput : facts.currentCountInput} is zero`,
          inputsUsed: [facts.comparisonCountInput, facts.currentCountInput],
        }),
      ],
    };
  }

  const readings = crossReadings({
    method,
    current,
    comparison,
    reduction,
    reductionExcluding: facts.reductionWithoutEnrollmentBySource[source],
    enrollmentClaim: facts.enrollmentClaimBySource[source],
    n,
    nc,
    currentAmountLabel: facts.currentAmountLabel,
  });

  const steps = readings.map((reading) =>
    step(
      `${METHOD_KEY[method]}_${reading.key}`,
      `${METHOD_LABEL[method]} — ${reading.label}`,
      reading.passes ? 'PASS' : 'FAIL',
      'TEXT',
      {
        citation: '34 CFR 300.203',
        detail: reading.detail,
        inputsUsed: [
          facts.currentInputBySource[source],
          facts.comparisonInputBySource[source],
          facts.currentCountInput,
          facts.comparisonCountInput,
        ],
      },
    ),
  );

  const admitted = readings.filter((reading) => reading.admitsEnrollmentClaim);
  const admittedDisagree = disagree(admitted);
  const allDisagree = disagree(readings);

  if (allDisagree) {
    const warnings: CalculatorWarning[] = [];
    if (admittedDisagree) {
      warnings.push(
        blocking(
          'PER_CAPITA_REDUCTION_BASIS_DISPUTED',
          `${METHOD_LABEL[method]}: spreading the reduction over the children served in the ` +
            'year under test and taking it off the comparison-year numerator give this method ' +
            'different answers. Which the regulation requires is unresolved. OQ-5.',
          '34 CFR 300.204',
        ),
      );
    }
    if (!admittedDisagree) {
      warnings.push(
        blocking(
          'ENROLLMENT_EXCEPTION_PER_CAPITA_DISPUTED',
          `${METHOD_LABEL[method]}: whether the 34 CFR 300.204(b) enrollment-decrease ` +
            'reduction may be claimed against a measure whose denominator already normalises ' +
            'for enrollment is unresolved, and admitting it against this method decides it. ' +
            'OQ-6.',
          '34 CFR 300.204(b)',
        ),
      );
    }
    return {
      status: 'MANUAL_REVIEW',
      margin: null,
      shortfall: null,
      marginPerChild: null,
      shortfallPerChild: null,
      missing: [],
      warnings,
      steps,
    };
  }

  const passes = readings.every((reading) => reading.passes);
  const numerator = readings[0]?.numerator ?? ZERO;
  // Compared unrounded. Two readings can differ by less than the last place the magnitude is
  // reported in, and comparing the rounded figures would collapse a real disagreement and
  // report reading A — which under falling enrollment is the reading that favours the LEA.
  const disputedAmount = readings.some((reading) => compare(reading.numerator, numerator) !== 0);

  if (disputedAmount) {
    // Every live reading agreed on the status, so the status stands; they disagreed only on
    // how far short the LEA fell, and the platform does not pick one magnitude over another.
    return applySetAside(
      {
        status: passes ? 'PASS' : 'FAIL',
        margin: null,
        shortfall: null,
        marginPerChild: null,
        shortfallPerChild: null,
        missing: [],
        warnings: [
          advisory(
            'SHORTFALL_AMOUNT_DISPUTED',
            `${METHOD_LABEL[method]}: the live readings agree on the outcome but not on the ` +
              'amount, so no single figure is reported. OQ-5.',
            '34 CFR 300.204',
          ),
        ],
        steps,
      },
      setAside,
    );
  }

  // Both forms come off the one cross-product, each rounded once: the per-child figure is not
  // the dollar figure divided again, and neither is derived from the other's rounded value.
  const dollarDenominator = toCount(nc);
  const perChildDenominator = multiply(toCount(n), dollarDenominator);
  const outcome: MethodOutcome = {
    status: passes ? 'PASS' : 'FAIL',
    margin: magnitude(numerator, dollarDenominator, MONEY_DP),
    shortfall: passes ? ZERO : magnitude(numerator.negated(), dollarDenominator, MONEY_DP),
    marginPerChild: magnitude(numerator, perChildDenominator, PER_CHILD_DP),
    shortfallPerChild: passes
      ? ZERO
      : magnitude(numerator.negated(), perChildDenominator, PER_CHILD_DP),
    missing: [],
    warnings: [],
    steps,
  };
  return applySetAside(outcome, setAside);
}

function disagree(readings: readonly CrossReading[]): boolean {
  if (readings.length < 2) return false;
  const first = readings[0];
  if (first === undefined) return false;
  return readings.some((reading) => reading.passes !== first.passes);
}

function unanswerableMethod(missing: readonly string[]): MethodOutcome {
  return {
    status: 'INDETERMINATE',
    margin: null,
    shortfall: null,
    marginPerChild: null,
    shortfallPerChild: null,
    missing: sorted(missing),
    warnings: [],
    steps: [],
  };
}

/**
 * Resolve a 34 CFR 300.205 claim that could not be validated.
 *
 * The claim was allowed at zero, which is the conservative direction, so the method has
 * already been evaluated against the *higher* bar. A method that passes anyway was not
 * decided by the absent figures. A method that fails might have passed had the ceiling
 * admitted part of the claim, so the honest answer is that the question could not be
 * reached — not that the LEA fell short.
 *
 * Every exit from a per-capita method routes through here, the shortfall dispute included:
 * the claim is set aside whether or not the readings agreed on how far short the LEA fell,
 * and a measure the calculator could not decide is what a finding would publish.
 */
function applySetAside(outcome: MethodOutcome, setAside: readonly string[]): MethodOutcome {
  if (setAside.length === 0 || outcome.status !== 'FAIL') return outcome;
  return {
    status: 'INDETERMINATE',
    margin: outcome.margin,
    shortfall: null,
    marginPerChild: outcome.marginPerChild,
    shortfallPerChild: null,
    missing: setAside,
    warnings: outcome.warnings,
    steps: outcome.steps,
  };
}

interface CrossInputs {
  readonly method: MoeMethod;
  readonly current: Amount;
  readonly comparison: Amount;
  readonly reduction: Amount;
  readonly reductionExcluding: Amount;
  readonly enrollmentClaim: boolean;
  readonly n: number;
  readonly nc: number;
  readonly currentAmountLabel: string;
}

/**
 * Every live reading of a per-capita method, decided without dividing.
 *
 * Division produces a repeating decimal for most child counts and truncating it can flip a
 * near-boundary result. Both counts are non-negative integers, so cross-multiplication
 * preserves the inequality exactly. The quotients are computed elsewhere for display and are
 * never the operands of a comparison.
 *
 * Reading A treats the reduction as an event of the year under test, spread over that year's
 * children. Reading B takes it off the comparison-year numerator. They coincide exactly when
 * the reduction is zero or the two counts are equal; where they diverge, reading A sets the
 * lower bar under falling enrollment. OQ-5.
 */
function crossReadings(spec: CrossInputs): readonly CrossReading[] {
  const readings: CrossReading[] = [];
  const seen = new Set<string>();

  const consider = (
    key: string,
    label: string,
    left: Amount,
    right: Amount,
    detail: string,
    admitsEnrollmentClaim: boolean,
  ): void => {
    const signature = `${formatAmount(left, MONEY_DP)}\u0001${formatAmount(right, MONEY_DP)}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    readings.push({
      key,
      label,
      passes: meetsOrExceeds(left, right),
      numerator: subtract(left, right),
      detail,
      admitsEnrollmentClaim,
    });
  };

  const nAmount = toCount(spec.n);
  const ncAmount = toCount(spec.nc);

  const addPair = (reduction: Amount, admits: boolean, suffix: string): void => {
    const leftA = multiply(add(spec.current, reduction), ncAmount);
    const rightA = multiply(spec.comparison, nAmount);
    consider(
      `reading_current_year_spread${suffix}`,
      `reduction spread over the children served in the year under test${suffix === '' ? '' : ', enrollment claim excluded'}`,
      leftA,
      rightA,
      `(${formatUsd(spec.current)} + ${formatUsd(reduction)}) × ${spec.nc} = ${usd(leftA)} ` +
        `against ${formatUsd(spec.comparison)} × ${spec.n} = ${usd(rightA)}`,
      admits,
    );

    const leftB = multiply(spec.current, ncAmount);
    const rightB = multiply(subtract(spec.comparison, reduction), nAmount);
    consider(
      `reading_comparison_numerator${suffix}`,
      `reduction taken off the comparison-year numerator${suffix === '' ? '' : ', enrollment claim excluded'}`,
      leftB,
      rightB,
      `${formatUsd(spec.current)} × ${spec.nc} = ${usd(leftB)} against ` +
        `(${formatUsd(spec.comparison)} − ${formatUsd(reduction)}) × ${spec.n} = ${usd(rightB)}`,
      admits,
    );
  };

  addPair(spec.reduction, true, '');
  if (spec.enrollmentClaim) addPair(spec.reductionExcluding, false, '_enrollment_excluded');

  return readings;
}

/* ----------------------------------------------------------------------- the engine */

/**
 * Run one maintenance-of-effort test.
 *
 * The order of the sections below is the order the methodology prescribes and is not
 * incidental: validation before the applicability gates so a gate cannot suppress a problem
 * a reviewer needed to see, and the comparison-basis consistency check before any arithmetic
 * so that no figure is compared against a level the declared facts contradict.
 */
export function runMoe(
  config: MoeVariantConfig,
  inputs: CalculatorInputs,
): CalculatorResult<MoeOutput> {
  const reader = new InputReader(inputs);
  const probe = new InputReader(inputs);
  const steps: CalculationStep[] = [];
  const warnings: CalculatorWarning[] = [];

  const scope = validationScope(config);
  const {
    problems,
    exceptions,
    adjustments,
    exceptionEntriesSubmitted,
    adjustmentEntriesSubmitted,
  } = validate(inputs, config, scope);

  const fiscalYear = probe.has('current_fiscal_year_start')
    ? probe.date('current_fiscal_year_start')
    : undefined;
  if (fiscalYear !== undefined) {
    steps.push(
      step('fiscal_year_under_test', 'Fiscal year under test', fiscalYear, 'DATE', {
        citation: config.standardCitation,
        inputsUsed: ['current_fiscal_year_start'],
      }),
    );
  }
  // Two different facts: what the LEA submitted, and what the platform could read. The run
  // that most needs both is the one refused because a claim could not be read — a lone count
  // of the entries that parsed says the district claimed nothing on the run its claim stopped.
  steps.push(
    step(
      'claimed_exception_entries',
      'Reductions claimed under 34 CFR 300.204',
      String(exceptionEntriesSubmitted),
      'COUNT',
      { citation: '34 CFR 300.204', inputsUsed: ['claimed_exceptions'] },
    ),
    step(
      'claimed_exception_entries_rejected',
      'Claimed 34 CFR 300.204 reductions the platform could not read',
      String(exceptionEntriesSubmitted - exceptions.length),
      'COUNT',
      { citation: '34 CFR 300.204', inputsUsed: ['claimed_exceptions'] },
    ),
    step(
      'claimed_adjustment_entries',
      'Reductions claimed under 34 CFR 300.205',
      String(adjustmentEntriesSubmitted),
      'COUNT',
      { citation: '34 CFR 300.205', inputsUsed: ['claimed_adjustments_300_205'] },
    ),
    step(
      'claimed_adjustment_entries_rejected',
      'Claimed 34 CFR 300.205 reductions the platform could not read',
      String(adjustmentEntriesSubmitted - adjustments.length),
      'COUNT',
      { citation: '34 CFR 300.205', inputsUsed: ['claimed_adjustments_300_205'] },
    ),
  );

  const refuse = (extra: readonly CalculatorWarning[]): CalculatorResult<MoeOutput> =>
    conclude(config, 'MANUAL_REVIEW', {
      steps,
      warnings: [...warnings, ...extra],
      methodStatus: byMethod(() => 'MANUAL_REVIEW' as EvaluationStatus),
      missingInputs: [],
      dataGaps: [],
      comparisonYear: null,
      reductionBySource: bySource(() => null),
      marginByMethod: byMethod(() => null),
      shortfallByMethod: byMethod(() => null),
    });

  const unanswerable = (
    missingInputs: readonly string[],
    extra: readonly CalculatorWarning[] = [],
  ): CalculatorResult<MoeOutput> =>
    conclude(config, 'INDETERMINATE', {
      steps,
      warnings: [...warnings, ...extra],
      methodStatus: byMethod(() => 'INDETERMINATE' as EvaluationStatus),
      missingInputs: sorted(missingInputs),
      dataGaps: [],
      comparisonYear: null,
      reductionBySource: bySource(() => null),
      marginByMethod: byMethod(() => null),
      shortfallByMethod: byMethod(() => null),
    });

  if (problems.length > 0) return refuse(dedupeWarnings(problems));

  /* 2. Effective window. Calendar-date string comparison; no timestamp round trip. */
  const currentFyStart = reader.date('current_fiscal_year_start');
  if (currentFyStart === undefined) return unanswerable(reader.missing);
  if (currentFyStart < MOE_RULE_EFFECTIVE_START) {
    return refuse([
      blocking(
        'OUTSIDE_RULE_EFFECTIVE_WINDOW',
        `The fiscal year beginning ${currentFyStart} precedes ${MOE_RULE_EFFECTIVE_START}, the ` +
          'start of the text this calculator version implements. The requirement applied to ' +
          'that year under the earlier text, so this is a version gap and not an exemption; a ' +
          'determination for it needs its own calculator version. OQ-25.',
        config.standardCitation,
      ),
    ]);
  }

  /* 3. Federal-funds gate. */
  const federalExcluded = reader.boolean('federal_funds_excluded');
  if (federalExcluded === undefined) return unanswerable(['federal_funds_excluded']);
  if (!federalExcluded) {
    return refuse([
      blocking(
        'FEDERAL_FUNDS_NOT_EXCLUDED',
        'The amounts include expenditure from federal funds the LEA or SEA must account for ' +
          'federally, so they are not the quantities the standard speaks about. The figures ' +
          'arrived, on the wrong basis; no arithmetic on them measures the requirement. OQ-20.',
        '34 CFR 300.203(a)(3)',
      ),
    ]);
  }

  /* 4. Subgrant gate — compliance only. Absent is different from zero. */
  const subgrantPresent = probe.has('lea_part_b_subgrant_amount');
  const subgrant =
    config.variant === 'COMPLIANCE' && subgrantPresent
      ? probe.money('lea_part_b_subgrant_amount')
      : undefined;
  if (config.variant === 'COMPLIANCE' && subgrant !== undefined && isZero(subgrant)) {
    return refuse([
      blocking(
        'NO_PART_B_SUBGRANT_FOR_THE_YEAR',
        'The LEA received no Part B subgrant for the year. Whether such an LEA is outside the ' +
          'compliance standard is unresolved, and NOT_APPLICABLE would answer it; the year’s ' +
          'expenditure levels still set the bar for the next year in which a subgrant is ' +
          'received. OQ-15.',
        '34 CFR 300.203(d)',
      ),
    ]);
  }

  /* 5. Comparison-basis consistency. The calculator validates the selection, never makes it. */
  const priorStatus = reader.enumValue(config.priorStatusInput, MOE_YEAR_STATUSES);
  const comparisonFyStart = reader.date('comparison_fiscal_year_start');
  const basis = reader.enumValue('comparison_basis', COMPARISON_BASES);
  if (priorStatus === undefined || comparisonFyStart === undefined || basis === undefined) {
    return unanswerable(reader.missing);
  }

  if (priorStatus === 'UNKNOWN') {
    return refuse([
      blocking(
        'COMPARISON_YEAR_MOE_STATUS_UNKNOWN',
        'The prior-year maintenance-of-effort status was supplied as UNKNOWN, so the ' +
          'comparison basis is undetermined and no comparison is meaningful. The remedy is a ' +
          'finalized idea_moe_compliance_v1 run for that fiscal year, or an SEA determination ' +
          'of record — not a resubmission of the field, which arrived with a value.',
        '34 CFR 300.203(c)',
      ),
    ]);
  }

  // Absence only. A value of another shape was refused as malformed in validation, because a
  // district that supplied the field must not be told the field is missing.
  if (!probe.has('moe_status_source_run_id')) {
    return unanswerable(['moe_status_source_run_id']);
  }

  const gateMissing: string[] = [];
  const methodsMet = new Set<MoeMethod>();
  if (config.variant === 'COMPLIANCE') {
    const raw = inputs['comparison_year_methods_met'];
    if (!Array.isArray(raw)) gateMissing.push('comparison_year_methods_met');
    else for (const entry of raw) methodsMet.add(entry as MoeMethod);
  }
  let mostRecentAvailable: string | undefined;
  if (config.variant === 'ELIGIBILITY') {
    mostRecentAvailable = reader.date('most_recent_available_fiscal_year_start');
    if (mostRecentAvailable === undefined)
      gateMissing.push('most_recent_available_fiscal_year_start');
  }
  if (gateMissing.length > 0) return unanswerable(gateMissing);

  if (comparisonFyStart >= currentFyStart) {
    return refuse([
      blocking(
        'COMPARISON_YEAR_NOT_PRIOR',
        `The declared comparison year ${comparisonFyStart} is not earlier than the year under ` +
          `test ${currentFyStart}. A year cannot be its own comparison year.`,
        '34 CFR 300.203',
      ),
    ]);
  }

  const inconsistency = basisInconsistency(
    config,
    priorStatus,
    basis,
    comparisonFyStart,
    mostRecentAvailable,
    methodsMet,
  );
  if (inconsistency !== undefined) return refuse([inconsistency]);

  /* 6. Operative comparison amounts. Declared, never inferred. */
  const usingRequiredLevel = basis === 'REQUIRED_LEVEL_AFTER_FAILURE';
  const comparisonInputBySource: Record<MoeSource, string> = usingRequiredLevel
    ? {
        LOCAL: 'comparison_required_level_local',
        STATE_AND_LOCAL: 'comparison_required_level_state_local',
      }
    : { LOCAL: 'comparison_actual_local', STATE_AND_LOCAL: 'comparison_actual_state_local' };
  const comparisonCountInput = usingRequiredLevel
    ? 'comparison_required_level_child_count'
    : 'comparison_child_count';

  const comparisonBySource = bySource((source) => reader.money(comparisonInputBySource[source]));
  const comparisonCount = reader.count(comparisonCountInput);

  const currentInputBySource: Record<MoeSource, string> = {
    LOCAL: config.currentLocalInput,
    STATE_AND_LOCAL: config.currentStateLocalInput,
  };
  const currentBySource = bySource((source) => reader.money(currentInputBySource[source]));
  const currentCount = reader.count('current_child_count');

  const comparisonYear: MoeComparisonYear = {
    fiscalYearStart: comparisonFyStart,
    basis,
    selectionAuthority: usingRequiredLevel ? '34 CFR 300.203(c)' : config.actualBasisAuthority,
  };

  steps.push(
    step('comparison_fiscal_year', 'Comparison fiscal year', comparisonFyStart, 'DATE', {
      citation: comparisonYear.selectionAuthority,
      inputsUsed: ['comparison_fiscal_year_start'],
    }),
    step('comparison_basis', 'Declared comparison basis', basis, 'TEXT', {
      citation: comparisonYear.selectionAuthority,
      detail: usingRequiredLevel
        ? 'the level that would have been required absent the prior failure, a distinct ' +
          'input from the failure year actual expenditure (OQ-3)'
        : 'the comparison year actual expenditure',
      inputsUsed: ['comparison_basis', config.priorStatusInput, 'moe_status_source_run_id'],
    }),
  );
  for (const source of MOE_SOURCES) {
    const value = comparisonBySource[source];
    if (value === undefined) continue;
    steps.push(
      step(
        `comparison_amount_${SOURCE_KEY[source]}`,
        `Comparison-year level, ${SOURCE_LABEL[source]}`,
        usd(value),
        'USD',
        {
          citation: comparisonYear.selectionAuthority,
          inputsUsed: [comparisonInputBySource[source]],
        },
      ),
    );
  }
  // The pair the declared basis did not select is shown but takes no part in the arithmetic.
  // That is the point of modelling the two as separate inputs rather than overloading one
  // pair of names: a reviewer can see the figure that was not used.
  for (const source of MOE_SOURCES) {
    const otherName = usingRequiredLevel
      ? source === 'LOCAL'
        ? 'comparison_actual_local'
        : 'comparison_actual_state_local'
      : source === 'LOCAL'
        ? 'comparison_required_level_local'
        : 'comparison_required_level_state_local';
    if (!probe.has(otherName)) continue;
    const value = probe.money(otherName);
    if (value === undefined) continue;
    steps.push(
      step(
        `comparison_amount_${SOURCE_KEY[source]}_not_operative`,
        `Supplied but not operative under the declared basis, ${SOURCE_LABEL[source]}`,
        usd(value),
        'USD',
        { citation: '34 CFR 300.203(c)', inputsUsed: [otherName] },
      ),
    );
  }

  /* 7. The 34 CFR 300.205 ceiling, then the reduction totals. */
  const adjustment = resolveAdjustment(reader, inputs, adjustments);
  warnings.push(...adjustment.warnings);
  steps.push(...adjustment.steps);

  const exceptionTotals = bySource((source) =>
    sum(exceptions.filter((claim) => claim.source === source).map((claim) => claim.amount)),
  );
  for (const source of MOE_SOURCES) {
    steps.push(
      step(
        `exception_total_${SOURCE_KEY[source]}`,
        `Reductions claimed under 34 CFR 300.204 against ${SOURCE_LABEL[source]}`,
        usd(exceptionTotals[source]),
        'USD',
        { citation: '34 CFR 300.204', inputsUsed: ['claimed_exceptions'] },
      ),
    );
  }

  const reductions = reductionTotals(exceptions, adjustment.allowedBySource);
  for (const source of MOE_SOURCES) {
    steps.push(
      step(
        `reduction_${SOURCE_KEY[source]}`,
        `Total permitted reduction against ${SOURCE_LABEL[source]}`,
        usd(reductions.total[source]),
        'USD',
        {
          citation: '34 CFR 300.204',
          detail:
            `${formatUsd(exceptionTotals[source])} under 34 CFR 300.204 + ` +
            `${formatUsd(adjustment.allowedBySource[source])} under 34 CFR 300.205`,
          inputsUsed: ['claimed_exceptions', 'claimed_adjustments_300_205'],
        },
      ),
    );
  }

  /* 8. The refusal at the comparison amount.
     A required level of zero would make any non-negative amount a pass on a test with a
     repayment attached, so a single bad ingest mapping would produce a clean result on the
     most consequential requirement in the module. The refusal is whole-run rather than
     per-source: a claim that consumes an entire measure puts the whole submission in
     question, and a BLOCKING warning may not accompany a PASS, so a per-source refusal that
     still let another method carry one would have to hide itself. */
  const zeroRequiredLevel: CalculatorWarning[] = [];
  for (const source of MOE_SOURCES) {
    const comparison = comparisonBySource[source];
    if (comparison === undefined) continue;
    if (!meetsOrExceeds(reductions.total[source], comparison)) continue;
    // Two ways to arrive at a required level of zero, and they are different problems for a
    // reviewer. Naming a claimed reduction where the LEA claimed none sends that reviewer
    // looking through an empty list for a claim that does not exist.
    const claimed = !isZero(reductions.total[source]);
    zeroRequiredLevel.push(
      claimed
        ? blocking(
            'REDUCTION_NOT_LESS_THAN_COMPARISON_AMOUNT',
            `Reductions of ${formatUsd(reductions.total[source])} against ${SOURCE_LABEL[source]} ` +
              `reach or exceed the comparison-year level of ${formatUsd(comparison)}. Clamping the ` +
              'required level to zero would make any non-negative amount a pass on a test with a ' +
              'repayment attached, so a required level of zero is never a pass. A claim that ' +
              'consumes an entire measure puts the whole submission in question.',
            '34 CFR 300.204',
          )
        : blocking(
            'ZERO_COMPARISON_AMOUNT',
            `The comparison-year level for ${SOURCE_LABEL[source]} is ` +
              `${formatUsd(comparison)} and no reduction is claimed against it, so the required ` +
              'level is zero and any figure would clear it. A required level of zero is never a ' +
              'pass. Either the comparison year genuinely had no such expenditure — in which ' +
              'case the maintenance-of-effort question is not the one to ask of it — or the ' +
              'figure did not survive the mapping. Both need a person.',
            '34 CFR 300.203',
          ),
    );
  }
  // Collected rather than returned inside the loop: a submission that puts both measures at a
  // required level of zero has two problems, and step 1's collect-don't-stop principle is what
  // keeps the district from being told about them one run at a time.
  if (zeroRequiredLevel.length > 0) return refuse(zeroRequiredLevel);

  /* 9. Required levels and the four methods. */
  for (const source of MOE_SOURCES) {
    const comparison = comparisonBySource[source];
    if (comparison === undefined) continue;
    const required = subtract(comparison, reductions.total[source]);
    steps.push(
      step(
        `required_${SOURCE_KEY[source]}`,
        `Required level, ${SOURCE_LABEL[source]}`,
        usd(required),
        'USD',
        {
          citation: config.standardCitation,
          detail: `${formatUsd(comparison)} − ${formatUsd(reductions.total[source])}`,
          inputsUsed: [comparisonInputBySource[source], 'claimed_exceptions'],
        },
      ),
    );
  }
  for (const source of MOE_SOURCES) {
    const value = currentBySource[source];
    if (value === undefined) continue;
    steps.push(
      step(
        `${config.currentStepPrefix}_${SOURCE_KEY[source]}`,
        `${config.currentAmountLabel} amount, ${SOURCE_LABEL[source]}`,
        usd(value),
        'USD',
        { citation: config.standardCitation, inputsUsed: [currentInputBySource[source]] },
      ),
    );
  }
  steps.push(
    ...perCapitaDisplaySteps(
      config,
      comparisonBySource,
      currentBySource,
      comparisonCount,
      currentCount,
      comparisonInputBySource,
      currentInputBySource,
      comparisonCountInput,
    ),
  );

  const refusedMethods = new Set<MoeMethod>();
  if (
    config.variant === 'COMPLIANCE' &&
    priorStatus === 'MET' &&
    methodsMet.size < MOE_METHODS.length
  ) {
    for (const method of MOE_METHODS) if (!methodsMet.has(method)) refusedMethods.add(method);
  }

  const setAsideBySource = bySource((source) =>
    adjustments.some((claim) => claim.source === source) ? adjustment.setAsideInputs : [],
  );

  const facts: MethodFacts = {
    comparisonBySource,
    comparisonInputBySource,
    currentBySource,
    currentInputBySource,
    reductionBySource: reductions.total,
    reductionWithoutEnrollmentBySource: reductions.withoutEnrollment,
    enrollmentClaimBySource: reductions.enrollmentClaim,
    setAsideBySource,
    currentCount,
    currentCountInput: 'current_child_count',
    comparisonCount,
    comparisonCountInput,
    refusedMethods,
    currentAmountLabel: config.currentAmountLabel,
  };

  const outcomes = evaluateMethods(facts);
  for (const method of MOE_METHODS) {
    steps.push(...outcomes[method].steps);
    warnings.push(...outcomes[method].warnings);
  }

  /* 10. Roll-up. PASS-dominant, and internal to the calculator: it implements the statutory
     disjunction between the four measures, not the platform's cross-rule precedence. An
     implementation must not reuse rollUpStatus() from the domain package here. */
  const statuses = MOE_METHODS.map((method) => outcomes[method].status);
  let status: EvaluationStatus;
  if (statuses.includes('PASS')) status = 'PASS';
  else if (statuses.includes('MANUAL_REVIEW')) status = 'MANUAL_REVIEW';
  else if (statuses.includes('INDETERMINATE')) status = 'INDETERMINATE';
  // Not a defensive fallback. NOT_APPLICABLE is produced only inside the per-capita branch, so
  // the two total-amount measures always carry one of the four statuses above, and with three
  // of them excluded what is left on those two is FAIL.
  else status = 'FAIL';

  const shadow = shadowOutcomes(config, facts, exceptions, adjustment.allowedBySource);

  return finalize({
    config,
    status,
    steps,
    warnings,
    outcomes,
    shadow,
    comparisonYear,
    reductions: reductions.total,
    subgrant,
    subgrantPresent,
    setAsideInputs: adjustment.setAsideInputs,
  });
}

/* ------------------------------------------------------------------ supporting pieces */

function validationScope(config: MoeVariantConfig): ValidationScope {
  const shared = {
    money: [
      'comparison_actual_local',
      'comparison_actual_state_local',
      'comparison_required_level_local',
      'comparison_required_level_state_local',
      'part_b_611_allocation_current',
      'part_b_611_allocation_prior',
      'ceis_amount_300_226',
      config.currentLocalInput,
      config.currentStateLocalInput,
    ],
    count: [
      'comparison_child_count',
      'comparison_required_level_child_count',
      'current_child_count',
    ],
    date: ['current_fiscal_year_start', 'comparison_fiscal_year_start'],
  };
  return {
    moneyInputs:
      config.variant === 'COMPLIANCE'
        ? [...shared.money, 'lea_part_b_subgrant_amount']
        : shared.money,
    countInputs: shared.count,
    dateInputs:
      config.variant === 'COMPLIANCE'
        ? [...shared.date, 'current_fiscal_year_end']
        : [...shared.date, 'most_recent_available_fiscal_year_start'],
    booleanInputs: ['federal_funds_excluded', 'esea_use_condition_attested'],
    enumInputs: [
      { name: 'comparison_basis', permitted: COMPARISON_BASES },
      { name: config.priorStatusInput, permitted: MOE_YEAR_STATUSES },
      { name: 'sea_prohibition_300_205_ground', permitted: SEA_PROHIBITION_GROUNDS },
    ],
    referenceInputs: ['moe_status_source_run_id', 'sea_prohibition_300_205_evidence_ref'],
  };
}

/**
 * The declared basis against the declared prior-year status.
 *
 * The inconsistency is at least as likely to be an ingest-mapping error as a district
 * position, and either needs a person: an LEA measuring against its own reduced level after a
 * failure is exactly the ratchet-down the subsequent-years rule exists to prevent. OQ-22.
 */
function basisInconsistency(
  config: MoeVariantConfig,
  priorStatus: MoeYearStatus,
  basis: ComparisonBasis,
  comparisonFyStart: string,
  mostRecentAvailable: string | undefined,
  methodsMet: ReadonlySet<MoeMethod>,
): CalculatorWarning | undefined {
  const refusal = (why: string): CalculatorWarning =>
    blocking('COMPARISON_BASIS_INCONSISTENT', why, '34 CFR 300.203(c)');

  if (priorStatus === 'MET' && basis !== 'ACTUAL_EXPENDITURE') {
    return refusal(
      'The prior year is declared MET, so the comparison level is that year’s actual ' +
        `expenditure; the declared basis is ${basis}.`,
    );
  }
  if (priorStatus === 'NOT_MET' && basis !== 'REQUIRED_LEVEL_AFTER_FAILURE') {
    return refusal(
      'The prior year is declared NOT_MET, so the level carried forward is the level that ' +
        `would have been required absent the failure; the declared basis is ${basis}. ` +
        'Measuring against the failure year’s own actuals would carry the reduced level ' +
        'forward as the bar.',
    );
  }
  if (
    config.variant === 'ELIGIBILITY' &&
    priorStatus === 'MET' &&
    mostRecentAvailable !== undefined &&
    comparisonFyStart !== mostRecentAvailable
  ) {
    return refusal(
      `The comparison year ${comparisonFyStart} is not the most recent year for which final ` +
        `figures are available (${mostRecentAvailable}), yet that year is declared MET.`,
    );
  }
  if (config.variant === 'COMPLIANCE' && priorStatus === 'MET' && methodsMet.size === 0) {
    return refusal('The comparison year is declared MET but no measure is listed as met in it.');
  }
  if (config.variant === 'COMPLIANCE' && priorStatus === 'NOT_MET' && methodsMet.size > 0) {
    return refusal('The comparison year is declared NOT_MET but measures are listed as met in it.');
  }
  return undefined;
}

interface ReductionTotals {
  readonly total: Record<MoeSource, Amount>;
  readonly withoutEnrollment: Record<MoeSource, Amount>;
  readonly enrollmentClaim: Record<MoeSource, boolean>;
}

function reductionTotals(
  exceptions: readonly ExceptionClaim[],
  allowedAdjustment: Record<MoeSource, Amount>,
): ReductionTotals {
  const totalFor = (source: MoeSource, keepEnrollment: boolean): Amount =>
    add(
      sum(
        exceptions
          .filter(
            (claim) =>
              claim.source === source &&
              (keepEnrollment ||
                claim.ground !== 'DECREASE_IN_ENROLLMENT_OF_CHILDREN_WITH_DISABILITIES'),
          )
          .map((claim) => claim.amount),
      ),
      allowedAdjustment[source],
    );

  return {
    total: bySource((source) => totalFor(source, true)),
    withoutEnrollment: bySource((source) => totalFor(source, false)),
    enrollmentClaim: bySource((source) =>
      exceptions.some(
        (claim) =>
          claim.source === source &&
          claim.ground === 'DECREASE_IN_ENROLLMENT_OF_CHILDREN_WITH_DISABILITIES',
      ),
    ),
  };
}

function perCapitaDisplaySteps(
  config: MoeVariantConfig,
  comparisonBySource: Record<MoeSource, Amount | undefined>,
  currentBySource: Record<MoeSource, Amount | undefined>,
  comparisonCount: number | undefined,
  currentCount: number | undefined,
  comparisonInputBySource: Record<MoeSource, string>,
  currentInputBySource: Record<MoeSource, string>,
  comparisonCountInput: string,
): readonly CalculationStep[] {
  const produced: CalculationStep[] = [];
  for (const source of MOE_SOURCES) {
    const comparison = comparisonBySource[source];
    if (comparison !== undefined && comparisonCount !== undefined && comparisonCount > 0) {
      const quotient = divide(comparison, toCount(comparisonCount), PER_CHILD_DP);
      if (quotient !== undefined) {
        produced.push(
          step(
            `comparison_${SOURCE_KEY[source]}_per_capita`,
            `Comparison-year level per child, ${SOURCE_LABEL[source]}`,
            perChild(quotient),
            'USD_PER_CHILD',
            {
              citation: config.standardCitation,
              detail:
                `${formatUsd(comparison)} ÷ ${comparisonCount} — display only; the ` +
                'comparison itself is cross-multiplied',
              inputsUsed: [comparisonInputBySource[source], comparisonCountInput],
            },
          ),
        );
      }
    }
    const current = currentBySource[source];
    if (current !== undefined && currentCount !== undefined && currentCount > 0) {
      const quotient = divide(current, toCount(currentCount), PER_CHILD_DP);
      if (quotient !== undefined) {
        produced.push(
          step(
            `${config.currentStepPrefix}_${SOURCE_KEY[source]}_per_capita`,
            `${config.currentAmountLabel} level per child, ${SOURCE_LABEL[source]}`,
            perChild(quotient),
            'USD_PER_CHILD',
            {
              citation: config.standardCitation,
              detail: `${formatUsd(current)} ÷ ${currentCount} — display only`,
              inputsUsed: [currentInputBySource[source], 'current_child_count'],
            },
          ),
        );
      }
    }
  }
  return produced;
}

/**
 * The counterfactual the forward-looking outputs are computed against.
 *
 * Eligibility drops every reduction the LEA only expects to take; compliance drops every
 * claim with no evidence reference. Both are computed over the whole *set* at once rather
 * than one claim at a time: two unevidenced claims that are individually immaterial and
 * jointly decisive would otherwise be reported as a clean result on a year that passes only
 * because both were accepted.
 */
function shadowOutcomes(
  config: MoeVariantConfig,
  facts: MethodFacts,
  exceptions: readonly ExceptionClaim[],
  allowedAdjustment: Record<MoeSource, Amount>,
): Record<MoeMethod, MethodOutcome> {
  const kept = exceptions.filter((claim) =>
    config.variant === 'ELIGIBILITY' ? !claim.anticipated : claim.verified,
  );
  const reductions = reductionTotals(kept, allowedAdjustment);
  return evaluateMethods({
    ...facts,
    reductionBySource: reductions.total,
    reductionWithoutEnrollmentBySource: reductions.withoutEnrollment,
    enrollmentClaimBySource: reductions.enrollmentClaim,
  });
}

interface FinalizeSpec {
  readonly config: MoeVariantConfig;
  readonly status: EvaluationStatus;
  readonly steps: readonly CalculationStep[];
  readonly warnings: readonly CalculatorWarning[];
  readonly outcomes: Record<MoeMethod, MethodOutcome>;
  readonly shadow: Record<MoeMethod, MethodOutcome>;
  readonly comparisonYear: MoeComparisonYear;
  readonly reductions: Record<MoeSource, Amount>;
  readonly subgrant: Amount | undefined;
  readonly subgrantPresent: boolean;
  readonly setAsideInputs: readonly string[];
}

/**
 * An evaluation status as the determination the following year reads.
 *
 * Only `PASS` and `FAIL` are conclusions about whether effort was maintained. `INDETERMINATE`
 * and `MANUAL_REVIEW` mean the question was not answered, and `UNKNOWN` is exactly that in the
 * next year's vocabulary — a value the eligibility calculator handles explicitly, and not a
 * gap. Mapping either of them to `NOT_MET` would invent a failure; mapping them to `MET` would
 * invent compliance. `NOT_APPLICABLE` and `RISK` cannot arise from this calculator, and the
 * honest reading of anything that is not a decided pass or fail is the same: not known.
 */
function determinedStatus(status: EvaluationStatus): MoeDeterminedStatus {
  if (status === 'PASS') return 'MET';
  if (status === 'FAIL') return 'NOT_MET';
  return 'UNKNOWN';
}

function finalize(spec: FinalizeSpec): CalculatorResult<MoeOutput> {
  const { config, outcomes, shadow } = spec;
  const warnings = [...spec.warnings];
  let status = spec.status;

  const render = (value: Amount | null): string | null => (value === null ? null : usd(value));
  const renderPerChild = (value: Amount | null): string | null =>
    value === null ? null : perChild(value);

  const observedGaps = new Set<string>(spec.setAsideInputs);
  for (const method of MOE_METHODS)
    for (const name of outcomes[method].missing) observedGaps.add(name);

  const missingInputs = new Set<string>();
  if (status === 'INDETERMINATE') {
    for (const method of MOE_METHODS) {
      if (outcomes[method].status !== 'INDETERMINATE') continue;
      for (const name of outcomes[method].missing) missingInputs.add(name);
    }
  }

  const shortfallByMethod = byMethod<string | null>((method) => render(outcomes[method].shortfall));

  /* 11. Consequence — compliance only. */
  let smallestShortfall: string | null = null;
  let largestShortfall: string | null = null;
  let bounds: MoeRepaymentBounds | null = null;
  if (config.variant === 'COMPLIANCE' && status === 'FAIL') {
    const amounts = MOE_METHODS.map((method) => outcomes[method].shortfall).filter(
      (value): value is Amount => value !== null && !isZero(value),
    );
    if (amounts.length > 0) {
      const low = amounts.reduce((a, b) => (compare(a, b) <= 0 ? a : b));
      const high = amounts.reduce((a, b) => (compare(a, b) >= 0 ? a : b));
      smallestShortfall = usd(low);
      largestShortfall = usd(high);
      if (spec.subgrant === undefined) {
        // The finding is the failure and its consequence together, and the platform does not
        // publish half of it.
        status = 'INDETERMINATE';
        missingInputs.add('lea_part_b_subgrant_amount');
        warnings.push(
          advisory(
            'REPAYMENT_CANNOT_BE_BOUNDED',
            'A compliance failure carries a recovery of the lesser of the shortfall and the ' +
              'LEA’s Part B subgrant. With the subgrant absent the lesser cannot be taken ' +
              'and the exposure is unbounded above.',
            '34 CFR 300.203(d)',
          ),
        );
      } else {
        const cap = spec.subgrant;
        bounds = {
          low: usd(compare(low, cap) <= 0 ? low : cap),
          high: usd(compare(high, cap) <= 0 ? high : cap),
        };
        warnings.push(
          advisory(
            'REPAYMENT_METHOD_SELECTION_UNRESOLVED',
            'Which measure’s shortfall fixes the repayment is unresolved, and a per-capita ' +
              'dollar shortfall may not be commensurable with a total-amount one at all, so ' +
              'the exposure is reported as a range rather than as a figure. OQ-12.',
            '34 CFR 300.203(d)',
          ),
        );
      }
    }
  }
  if (config.variant === 'COMPLIANCE' && !spec.subgrantPresent && status !== 'INDETERMINATE') {
    observedGaps.add('lea_part_b_subgrant_amount');
  }

  const qualifyingMethods = MOE_METHODS.filter((method) => outcomes[method].status === 'PASS');
  const shadowQualifies = MOE_METHODS.some((method) => shadow[method].status === 'PASS');
  const dependsOnCounterfactual = qualifyingMethods.length > 0 && !shadowQualifies;
  const counterfactualShortfall = byMethod<string | null>((method) =>
    render(shadow[method].shortfall),
  );

  // The two tests lean on different counterfactuals — claims with no evidence on one side,
  // reductions not yet taken on the other — but a qualification that rests entirely on one is
  // the same thing to a reviewer, and a clean `warnings` list is what the finding-detail
  // screen and every triage query read.
  if (dependsOnCounterfactual) {
    warnings.push(
      config.variant === 'COMPLIANCE'
        ? advisory(
            'QUALIFICATION_DEPENDS_ON_UNVERIFIED_CLAIMS',
            'Every qualifying measure depends on reductions claimed without an evidence ' +
              'reference. Removing them as a set, which is the honest test, leaves no measure ' +
              'qualifying. This is reported as a figure, not as a status: the statute states ' +
              'the test as a single line and sets no band between compliance and failure.',
            '34 CFR 300.204',
          )
        : advisory(
            'QUALIFICATION_DEPENDS_ON_EXPECTED_REDUCTIONS',
            'Every qualifying measure depends on a reduction the LEA expects to take rather ' +
              'than one it has taken. Anticipating one is permitted, so this is not a ' +
              'failure — but the budget qualifies on an event that has not happened, and the ' +
              'projected shortfall is what the year looks like if it does not.',
            '34 CFR 300.203(a)(2)',
          ),
    );
  }

  const dataGapsObserved = sorted([...observedGaps].filter((name) => !missingInputs.has(name)));

  const base = {
    qualifyingMethods,
    methodStatus: byMethod<EvaluationStatus>((method) => outcomes[method].status),
    marginByMethod: byMethod<string | null>((method) => render(outcomes[method].margin)),
    shortfallByMethod,
    reductionBySource: bySource<string | null>((source) => usd(spec.reductions[source])),
    comparisonYear: spec.comparisonYear,
    dataGapsObserved,
  };

  const output: MoeOutput =
    config.variant === 'ELIGIBILITY'
      ? {
          ...base,
          marginPerChildByMethod: byMethod<string | null>((method) =>
            renderPerChild(outcomes[method].marginPerChild),
          ),
          projectedShortfallByMethod: counterfactualShortfall,
          projectedShortfallPerChildByMethod: byMethod<string | null>((method) =>
            renderPerChild(shadow[method].shortfallPerChild),
          ),
          qualifiesOnlyOnExpectedReductions: dependsOnCounterfactual,
        }
      : {
          ...base,
          moeStatus: determinedStatus(status),
          smallestShortfall,
          largestShortfall,
          repaymentExposureBounds: bounds,
          shortfallIfUnverifiedClaimsDisallowedByMethod: counterfactualShortfall,
          qualifyingMethodsDependOnUnverifiedClaims: dependsOnCounterfactual,
        };

  return {
    status,
    missingInputs: sorted(missingInputs),
    warnings: softenForPass(status, dedupeWarnings(warnings)),
    steps: spec.steps,
    output,
  };
}

interface ConcludeSpec {
  readonly steps: readonly CalculationStep[];
  readonly warnings: readonly CalculatorWarning[];
  readonly methodStatus: Record<MoeMethod, EvaluationStatus>;
  readonly missingInputs: readonly string[];
  readonly dataGaps: readonly string[];
  readonly comparisonYear: MoeComparisonYear | null;
  readonly reductionBySource: Record<MoeSource, string | null>;
  readonly marginByMethod: Record<MoeMethod, string | null>;
  readonly shortfallByMethod: Record<MoeMethod, string | null>;
}

/** A result that stopped at a gate, before any method was evaluated. */
function conclude(
  config: MoeVariantConfig,
  status: EvaluationStatus,
  spec: ConcludeSpec,
): CalculatorResult<MoeOutput> {
  const base = {
    qualifyingMethods: [] as readonly MoeMethod[],
    methodStatus: spec.methodStatus,
    marginByMethod: spec.marginByMethod,
    shortfallByMethod: spec.shortfallByMethod,
    reductionBySource: spec.reductionBySource,
    comparisonYear: spec.comparisonYear,
    dataGapsObserved: spec.dataGaps,
  };
  const output: MoeOutput =
    config.variant === 'ELIGIBILITY'
      ? {
          ...base,
          marginPerChildByMethod: byMethod<string | null>(() => null),
          projectedShortfallByMethod: null,
          projectedShortfallPerChildByMethod: null,
          qualifiesOnlyOnExpectedReductions: false,
        }
      : {
          ...base,
          // A run that stopped at a gate concluded nothing about whether effort was
          // maintained, and the field has to say so rather than be absent. An absent
          // `moeStatus` would let a caller carrying determinations forward find nothing and
          // move on, when what happened is that the question was never answered.
          moeStatus: determinedStatus(status),
          smallestShortfall: null,
          largestShortfall: null,
          repaymentExposureBounds: null,
          shortfallIfUnverifiedClaimsDisallowedByMethod: null,
          qualifyingMethodsDependOnUnverifiedClaims: false,
        };
  return {
    status,
    missingInputs: spec.missingInputs,
    warnings: dedupeWarnings(spec.warnings),
    steps: spec.steps,
    output,
  };
}

/**
 * A BLOCKING warning may not accompany a PASS under the calculator contract.
 *
 * Every whole-run refusal returns MANUAL_REVIEW, so the only way a BLOCKING warning can reach
 * a PASS is a *per-method* refusal on a run another measure carried — one measure's
 * comparison level is disputed while a different measure qualifies outright. The refusal
 * still has to be visible, so the code survives and only the severity is lowered: the
 * method's own MANUAL_REVIEW status remains the authoritative record that it was refused.
 */
function softenForPass(
  status: EvaluationStatus,
  warnings: readonly CalculatorWarning[],
): readonly CalculatorWarning[] {
  if (status !== 'PASS') return warnings;
  return warnings.map((warning) =>
    warning.severity === 'BLOCKING' ? { ...warning, severity: 'WARNING' as const } : warning,
  );
}
