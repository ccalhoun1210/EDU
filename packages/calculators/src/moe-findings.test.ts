/**
 * Regressions for the adversarial review of the maintenance-of-effort calculators.
 *
 * An independent pass recomputed every golden case by hand and probed the branches the corpus
 * never reaches. It returned twenty findings, S1..S20. The golden corpus is the *specification*
 * — it says what the regulation requires — and these are something else: they pin behaviour at
 * the edges a specification does not talk about, and each one records a defect that actually
 * shipped rather than a rule anyone derived from the CFR.
 *
 * Keeping them apart matters. A domain reviewer reads the corpus and must not have to wade
 * through assertions about malformed decimal strings to find the arithmetic. An engineer
 * changing the engine reads this file and learns which edges are load-bearing.
 *
 * Every case here was reproduced against the broken code before the fix, so a regression is
 * caught by the same input that caught it the first time.
 */

import { describe, expect, it } from 'vitest';
import { ideaMoeComplianceV1 } from './idea-moe-compliance.js';
import { ideaMoeEligibilityV1 } from './idea-moe-eligibility.js';
import type { CalculatorInputs, CalculatorResult } from './types.js';

/* ----------------------------------------------------------------- fixtures -- */

/** A clean eligibility run: budget exactly matches the comparison level on both measures. */
const ELIGIBILITY: CalculatorInputs = {
  current_fiscal_year_start: '2027-07-01',
  most_recent_available_fiscal_year_start: '2025-07-01',
  most_recent_available_year_moe_status: 'MET',
  moe_status_source_run_id: 'RUN-MOE-COMPLIANCE-2025-0001',
  comparison_fiscal_year_start: '2025-07-01',
  comparison_basis: 'ACTUAL_EXPENDITURE',
  federal_funds_excluded: true,
  comparison_actual_local: '10000000.00',
  comparison_actual_state_local: '15000000.00',
  comparison_child_count: 1000,
  current_budget_local: '10000000.00',
  current_budget_state_local: '15000000.00',
  current_child_count: 1000,
};

/** A clean compliance run, qualifying on every measure. */
const COMPLIANCE: CalculatorInputs = {
  current_fiscal_year_start: '2025-07-01',
  current_fiscal_year_end: '2026-06-30',
  federal_funds_excluded: true,
  lea_part_b_subgrant_amount: '1450000.00',
  current_actual_local: '5000000.00',
  current_actual_state_local: '8000000.00',
  current_child_count: 1000,
  comparison_fiscal_year_start: '2024-07-01',
  comparison_basis: 'ACTUAL_EXPENDITURE',
  comparison_year_moe_status: 'MET',
  comparison_year_methods_met: [
    'LOCAL_ONLY',
    'STATE_AND_LOCAL',
    'LOCAL_PER_CAPITA',
    'STATE_AND_LOCAL_PER_CAPITA',
  ],
  moe_status_source_run_id: 'RUN-MOE-COMPLIANCE-2024-0001',
  comparison_actual_local: '5000000.00',
  comparison_actual_state_local: '8000000.00',
  comparison_child_count: 1000,
};

const codes = (result: CalculatorResult): readonly string[] =>
  result.warnings.map((warning) => warning.code);

const stepValue = (result: CalculatorResult, key: string): string | undefined =>
  result.steps.find((step) => step.key === key)?.value;

/* -------------------------------------------------------------------- S1 -- */

describe('S1 — one output key means one unit', () => {
  // The same key carried dollars-per-child on one calculator and whole-year dollars on the
  // other. A field naming the unit was rejected as the remedy: a careless consumer still reads
  // the wrong number. Distinct key names are the fix, so the collision cannot recur.
  it('reports every margin in dollars, on both calculators', () => {
    const eligibility = ideaMoeEligibilityV1.run({
      ...ELIGIBILITY,
      current_budget_local: '10100000.00',
    });
    const compliance = ideaMoeComplianceV1.run({
      ...COMPLIANCE,
      current_actual_local: '5100000.00',
    });

    for (const output of [eligibility.output, compliance.output]) {
      for (const value of Object.values(output.marginByMethod)) {
        // Two decimal places is money. Six would be a per-child quotient in a dollars column.
        if (value !== null) expect(value).toMatch(/^-?\d+\.\d{2}$/);
      }
    }
    expect(eligibility.output.marginByMethod['LOCAL_PER_CAPITA']).toBe('100000.00');
  });

  it('puts the per-child figures under their own name, eligibility only', () => {
    const eligibility = ideaMoeEligibilityV1.run({
      ...ELIGIBILITY,
      current_budget_local: '10100000.00',
    });
    const perChild = eligibility.output.marginPerChildByMethod;
    expect(perChild).toBeDefined();
    expect(perChild?.['LOCAL_PER_CAPITA']).toMatch(/^-?\d+\.\d{6}$/);
    // A total-amount measure has no per-child magnitude. Dividing one out would invent a
    // quantity the regulation does not describe.
    expect(perChild?.['LOCAL_ONLY']).toBeNull();
  });

  it('does not resurrect the unit field the documentation once promised', () => {
    const eligibility = ideaMoeEligibilityV1.run(ELIGIBILITY);
    expect(eligibility.output).not.toHaveProperty('perCapitaMagnitudeUnit');
  });
});

/* -------------------------------------------------------------------- S3 -- */

describe('S3 — the combined measure contains the local one, on both calculators', () => {
  // This validation ran on compliance only. The property belongs to the fund categories, not
  // to which test is being run, and both calculators read the same comparison pair.
  const inverted = { comparison_actual_state_local: '9000000.00' };

  it('refuses an inverted comparison pair on eligibility', () => {
    const result = ideaMoeEligibilityV1.run({ ...ELIGIBILITY, ...inverted });
    expect(result.status).toBe('MANUAL_REVIEW');
    expect(codes(result)).toContain('COMBINED_MEASURE_BELOW_LOCAL_MEASURE');
  });

  it('refuses it on compliance too, as it always did', () => {
    const result = ideaMoeComplianceV1.run({
      ...COMPLIANCE,
      comparison_actual_state_local: '4000000.00',
    });
    expect(result.status).toBe('MANUAL_REVIEW');
    expect(codes(result)).toContain('COMBINED_MEASURE_BELOW_LOCAL_MEASURE');
  });
});

/* -------------------------------------------------------------------- S6 -- */

describe('S6 — a budget resting on anticipated reductions says so', () => {
  // 34 CFR 300.203(a)(2) permits anticipating a reduction, so this is a PASS. But a consumer
  // reading `warnings` — which is what a triage query and the finding screen read — used to
  // see a clean year with nothing to indicate the budget balances only on an expectation.
  it('warns when every qualifying measure depends on a reduction not yet taken', () => {
    const result = ideaMoeEligibilityV1.run({
      ...ELIGIBILITY,
      current_budget_local: '9700000.00',
      current_budget_state_local: '14700000.00',
      claimed_exceptions: [
        {
          ground: 'TERMINATION_OF_LONG_TERM_PURCHASE',
          source: 'LOCAL',
          amount: '300000.00',
          timing: 'EXPECTED_BUDGET_YEAR',
          event_fiscal_year_start: '2026-07-01',
          evidence_ref: 'EV-204D-S6',
        },
      ],
    });
    expect(result.status).toBe('PASS');
    expect(result.output.qualifiesOnlyOnExpectedReductions).toBe(true);
    expect(codes(result)).toContain('QUALIFICATION_DEPENDS_ON_EXPECTED_REDUCTIONS');
  });

  it('stays silent when the reduction was already taken', () => {
    const result = ideaMoeEligibilityV1.run({
      ...ELIGIBILITY,
      current_budget_local: '9700000.00',
      claimed_exceptions: [
        {
          ground: 'TERMINATION_OF_LONG_TERM_PURCHASE',
          source: 'LOCAL',
          amount: '300000.00',
          timing: 'TAKEN_INTERVENING',
          event_fiscal_year_start: '2026-07-01',
          evidence_ref: 'EV-204D-S6B',
        },
      ],
    });
    expect(result.output.qualifiesOnlyOnExpectedReductions).toBe(false);
    expect(codes(result)).not.toContain('QUALIFICATION_DEPENDS_ON_EXPECTED_REDUCTIONS');
  });
});

/* -------------------------------------------------------------------- S7 -- */

describe('S7 — a prohibition with nothing to prohibit changes no answer', () => {
  // The evidence check fired on the ground alone. A prohibition can only reduce an allowed
  // adjustment to zero, so with no 300.205 claim it cannot affect any measure — and refusing
  // an otherwise clean year over it is the refusal policy inverted.
  it('does not refuse a clean run when no adjustment is claimed', () => {
    const result = ideaMoeEligibilityV1.run({
      ...ELIGIBILITY,
      sea_prohibition_300_205_ground: 'ENFORCEMENT_ACTION_UNDER_SECTION_616',
    });
    expect(result.status).toBe('PASS');
    expect(codes(result)).not.toContain('SEA_PROHIBITION_EVIDENCE_NOT_SUPPLIED');
  });

  it('still refuses when an adjustment is claimed and the determination is unevidenced', () => {
    const result = ideaMoeEligibilityV1.run({
      ...ELIGIBILITY,
      sea_prohibition_300_205_ground: 'ENFORCEMENT_ACTION_UNDER_SECTION_616',
      claimed_adjustments_300_205: [{ source: 'LOCAL', amount: '50000.00' }],
    });
    expect(result.status).toBe('MANUAL_REVIEW');
    expect(codes(result)).toContain('SEA_PROHIBITION_EVIDENCE_NOT_SUPPLIED');
  });
});

/* -------------------------------------------------------------------- S8 -- */

describe('S8 — a measure that failed never reports a shortfall of nothing', () => {
  // Reproduced at n=999 against nc=1000: the per-capita dollar shortfall rounded to 0.00 while
  // the status said FAIL. On the compliance side that figure feeds `smallestShortfall`, which
  // bounds the repayment — so the district's exposure would have been reported as zero.
  // $9.98 across 999 children against $9.99 across 1,000. Cross-multiplied: 9,980.00 against
  // 9,980.01, so the measure fails by one cent-child — and one cent spread over a thousand
  // children is $0.00001, which rounds to nothing at two places. Scale-invariant: the same
  // shape appears at district magnitudes wherever the counts are close and coprime.
  const HAIRLINE = {
    ...COMPLIANCE,
    current_actual_local: '9.98',
    current_actual_state_local: '9.98',
    current_child_count: 999,
    comparison_actual_local: '9.99',
    comparison_actual_state_local: '9.99',
    comparison_child_count: 1000,
  };

  it('floors a real per-capita shortfall above zero', () => {
    const result = ideaMoeComplianceV1.run(HAIRLINE);
    expect(result.output.methodStatus['LOCAL_PER_CAPITA']).toBe('FAIL');
    const shortfall = result.output.shortfallByMethod['LOCAL_PER_CAPITA'];
    expect(shortfall).not.toBe('0.00');
    expect(Number(shortfall)).toBeGreaterThan(0);
  });

  it('does not let a rounded-away shortfall zero out the repayment exposure', () => {
    // This is why the finding matters: `smallestShortfall` bounds what the district owes, so a
    // shortfall reported as nothing reports an exposure of nothing on a failing year.
    const result = ideaMoeComplianceV1.run(HAIRLINE);
    if (result.status !== 'FAIL') return;
    expect(result.output.smallestShortfall).not.toBe('0.00');
    const bounds = result.output.repaymentExposureBounds;
    expect(bounds).not.toBeNull();
    expect(Number((bounds as { low: string }).low)).toBeGreaterThan(0);
  });

  it('never pairs a FAIL with a zero shortfall on any measure', () => {
    // The general property, over counts close enough that the gap is sub-cent per child.
    for (const currentCount of [997, 998, 999, 1001, 1003]) {
      const result = ideaMoeComplianceV1.run({ ...HAIRLINE, current_child_count: currentCount });
      for (const [method, status] of Object.entries(result.output.methodStatus)) {
        if (status !== 'FAIL') continue;
        const shortfall = result.output.shortfallByMethod[method as never];
        expect(shortfall, `${method} at n=${String(currentCount)}`).not.toBe('0.00');
      }
    }
  });
});

/* -------------------------------------------------------------------- S9 -- */

describe('S9 — the claim count reports what was submitted', () => {
  // It counted successfully *parsed* entries, so the run refused because a claim was made
  // reported that no claims were made.
  it('counts a claim the parser rejected', () => {
    const result = ideaMoeEligibilityV1.run({
      ...ELIGIBILITY,
      claimed_exceptions: [
        {
          ground: 'GENERAL_BUDGET_REDUCTION',
          source: 'LOCAL',
          amount: '250000.00',
          timing: 'TAKEN_INTERVENING',
          event_fiscal_year_start: '2026-07-01',
        },
      ],
    });
    expect(result.status).toBe('MANUAL_REVIEW');
    expect(codes(result)).toContain('UNRECOGNISED_EXCEPTION_GROUND');
    expect(stepValue(result, 'claimed_exception_entries')).toBe('1');
    expect(stepValue(result, 'claimed_exception_entries_rejected')).toBe('1');
  });
});

/* ------------------------------------------------------------------- S10 -- */

describe('S10 — money is two decimal places, and the shown work proves it', () => {
  // Nothing constrained scale, so `12400000.005` decided the comparison at full precision
  // while every displayed operand rendered `12400000.01`. A business officer reconciling those
  // three numbers against a ledger was looking at figures the calculator did not use.
  it('refuses a comparison amount with more than two fractional digits', () => {
    const result = ideaMoeEligibilityV1.run({
      ...ELIGIBILITY,
      comparison_actual_local: '10000000.005',
    });
    expect(result.status).toBe('MANUAL_REVIEW');
    expect(codes(result)).toContain('MALFORMED_INPUT');
  });

  it('refuses an over-precise amount inside a claim entry', () => {
    const result = ideaMoeEligibilityV1.run({
      ...ELIGIBILITY,
      claimed_exceptions: [
        {
          ground: 'HIGH_COST_FUND_ASSUMPTION',
          source: 'LOCAL',
          amount: '1000.005',
          timing: 'TAKEN_INTERVENING',
          event_fiscal_year_start: '2026-07-01',
        },
      ],
    });
    expect(result.status).toBe('MANUAL_REVIEW');
  });

  it('accepts fewer than two places, which is the same amount written shorter', () => {
    const result = ideaMoeEligibilityV1.run({
      ...ELIGIBILITY,
      comparison_actual_local: '10000000',
    });
    expect(result.status).toBe('PASS');
  });
});

/* ------------------------------------------------------------------- S13 -- */

describe('S13 — the calculator describes no outcome it cannot produce', () => {
  it('has no unreachable no-method-computable branch', () => {
    // A total-amount measure is never NOT_APPLICABLE, so "every measure NOT_APPLICABLE" could
    // not occur. Both child counts zero is the closest reachable state, and it is a FAIL or a
    // PASS on the total measures rather than the dead branch.
    const result = ideaMoeComplianceV1.run({
      ...COMPLIANCE,
      current_child_count: 0,
      comparison_child_count: 0,
    });
    expect(codes(result)).not.toContain('NO_METHOD_COMPUTABLE');
    expect(result.output.methodStatus['LOCAL_PER_CAPITA']).toBe('NOT_APPLICABLE');
    expect(result.output.methodStatus['LOCAL_ONLY']).not.toBe('NOT_APPLICABLE');
  });

  it('names both zero counts rather than one per run', () => {
    const result = ideaMoeComplianceV1.run({
      ...COMPLIANCE,
      current_child_count: 0,
      comparison_child_count: 0,
    });
    expect(codes(result)).toContain('ZERO_CURRENT_CHILD_COUNT');
    expect(codes(result)).toContain('ZERO_COMPARISON_CHILD_COUNT');
  });
});

/* ------------------------------------------------------------------- S15 -- */

describe('S15 — a supplied field is never reported as missing', () => {
  // A wrong-typed `moe_status_source_run_id` returned INDETERMINATE naming it, which tells a
  // district to supply a field it already supplied and makes two different situations
  // indistinguishable. Present-but-invalid is a validation failure.
  it('treats a wrong-typed run reference as invalid, not absent', () => {
    const result = ideaMoeEligibilityV1.run({ ...ELIGIBILITY, moe_status_source_run_id: 12345 });
    expect(result.status).toBe('MANUAL_REVIEW');
    expect(result.missingInputs).not.toContain('moe_status_source_run_id');
  });

  it('still reports a genuinely absent one as missing', () => {
    const without = { ...ELIGIBILITY };
    delete (without as Record<string, unknown>)['moe_status_source_run_id'];
    const result = ideaMoeEligibilityV1.run(without);
    expect(result.status).toBe('INDETERMINATE');
    expect(result.missingInputs).toContain('moe_status_source_run_id');
  });
});

/* ------------------------------------------------------------------- S19 -- */

describe('S19 — both measures are named when both trip a refusal', () => {
  // The comparison-amount refusal returned inside the source loop, so LOCAL always won and a
  // simultaneous STATE_AND_LOCAL problem was never reported. Step 1 of the algorithm says
  // collect every problem rather than stopping at the first.
  it('reports a consuming claim on each measure', () => {
    const result = ideaMoeEligibilityV1.run({
      ...ELIGIBILITY,
      claimed_exceptions: [
        {
          ground: 'TERMINATION_OF_LONG_TERM_PURCHASE',
          source: 'LOCAL',
          amount: '10000000.00',
          timing: 'TAKEN_INTERVENING',
          event_fiscal_year_start: '2026-07-01',
          evidence_ref: 'EV-A',
        },
        {
          ground: 'HIGH_COST_FUND_ASSUMPTION',
          source: 'STATE_AND_LOCAL',
          amount: '15000000.00',
          timing: 'TAKEN_INTERVENING',
          event_fiscal_year_start: '2026-07-01',
          evidence_ref: 'EV-B',
        },
      ],
    });
    expect(result.status).toBe('MANUAL_REVIEW');
    const messages = result.warnings
      .filter((warning) => warning.code === 'REDUCTION_NOT_LESS_THAN_COMPARISON_AMOUNT')
      .map((warning) => warning.message)
      .join(' ');
    expect(messages).toMatch(/local/i);
    expect(messages).toMatch(/State and local/i);
  });
});

/* ------------------------------------- contract properties, over every case -- */

describe('the calculator contract holds on every input these findings reach', () => {
  const probes: readonly CalculatorInputs[] = [
    ELIGIBILITY,
    { ...ELIGIBILITY, current_budget_local: '9000000.00' },
    { ...ELIGIBILITY, comparison_actual_local: '10000000.005' },
    { ...ELIGIBILITY, sea_prohibition_300_205_ground: 'FAPE_CAPACITY_DETERMINATION' },
    COMPLIANCE,
    { ...COMPLIANCE, current_actual_local: '4000000.00' },
    { ...COMPLIANCE, current_child_count: 0, comparison_child_count: 0 },
    {},
  ];

  it('never puts a BLOCKING warning beside a PASS', () => {
    for (const inputs of probes) {
      for (const calculator of [ideaMoeEligibilityV1, ideaMoeComplianceV1]) {
        const result = calculator.run(inputs);
        if (result.status !== 'PASS') continue;
        const blocking = result.warnings.filter((warning) => warning.severity === 'BLOCKING');
        expect(
          blocking.map((warning) => warning.code),
          calculator.name,
        ).toEqual([]);
      }
    }
  });

  it('names a missing input only when the result was INDETERMINATE', () => {
    for (const inputs of probes) {
      for (const calculator of [ideaMoeEligibilityV1, ideaMoeComplianceV1]) {
        const result = calculator.run(inputs);
        if (result.status === 'INDETERMINATE') continue;
        expect(result.missingInputs, `${calculator.name} on ${result.status}`).toEqual([]);
      }
    }
  });

  it('shows its work on every conclusive result', () => {
    for (const inputs of probes) {
      for (const calculator of [ideaMoeEligibilityV1, ideaMoeComplianceV1]) {
        const result = calculator.run(inputs);
        if (result.status === 'INDETERMINATE') continue;
        expect(result.steps.length, calculator.name).toBeGreaterThan(0);
      }
    }
  });

  it('renders every step value at the precision its unit declares', () => {
    for (const inputs of probes) {
      for (const calculator of [ideaMoeEligibilityV1, ideaMoeComplianceV1]) {
        for (const step of calculator.run(inputs).steps) {
          if (step.unit === 'USD') expect(step.value, step.key).toMatch(/^-?\d+\.\d{2}$/);
          if (step.unit === 'USD_PER_CHILD') expect(step.value, step.key).toMatch(/^-?\d+\.\d{6}$/);
          if (step.unit === 'COUNT') expect(step.value, step.key).toMatch(/^\d+$/);
          // A rounded-away zero is unsigned. "-0.00" is a minus sign in front of nothing, and
          // two spellings of one figure inside a content hash.
          expect(step.value, step.key).not.toMatch(/^-0(\.0+)?$/);
        }
      }
    }
  });

  it('is reproducible byte for byte', () => {
    for (const inputs of probes) {
      for (const calculator of [ideaMoeEligibilityV1, ideaMoeComplianceV1]) {
        expect(JSON.stringify(calculator.run(inputs))).toBe(JSON.stringify(calculator.run(inputs)));
      }
    }
  });
});
