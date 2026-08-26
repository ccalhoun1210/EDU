/**
 * IDEA Part B maintenance of effort — LEA eligibility, 34 CFR 300.203(a).
 *
 * Asked before the year runs: has the LEA *budgeted* at least what it *spent* in the most
 * recent year for which it has final figures? Budgeted amounts against actuals,
 * prospectively. Failing it means the LEA is not eligible for its subgrant until the budget
 * is fixed — which is a different consequence from the compliance test's repayment, and the
 * reason the two are separate calculators rather than one with a flag.
 *
 * The four measures, the exceptions at 34 CFR 300.204 and the adjustment at 34 CFR 300.205
 * are shared with the compliance test and live in `moe-shared.ts`. What is specific to
 * eligibility is here: the budget-year input names, the permission at 34 CFR 300.203(a)(2)
 * to anticipate a reduction, and the projection that shows what the year looks like if an
 * anticipated reduction never materialises.
 *
 * This is also the calculator that reports per-child magnitudes, under
 * `marginPerChildByMethod` and `projectedShortfallPerChildByMethod`. They are additional to
 * the dollar figures both calculators report, never a different quantity under a shared name:
 * a budget officer comparing this year's eligibility result against last year's compliance
 * result reads one column and gets one unit.
 *
 * Spec: `docs/regulatory-methodology/idea-moe.md`. Golden corpus:
 * `golden/idea_moe_eligibility_v1.yaml`. Rule: `IDEA-MOE-ELIGIBILITY-001`, held at DRAFT
 * because no regulatory text was retrievable when this was written (ADR 0006).
 */

import { SHARED_MOE_INPUTS, runMoe, type MoeOutput, type MoeVariantConfig } from './moe-shared.js';
import type {
  Calculator,
  CalculatorInputSpec,
  CalculatorInputs,
  CalculatorResult,
} from './types.js';

const CONFIG: MoeVariantConfig = {
  variant: 'ELIGIBILITY',
  standardCitation: '34 CFR 300.203(a)',
  actualBasisAuthority: '34 CFR 300.203(a)(1)',
  currentLocalInput: 'current_budget_local',
  currentStateLocalInput: 'current_budget_state_local',
  currentAmountLabel: 'Budgeted',
  currentStepPrefix: 'budget',
  priorStatusInput: 'most_recent_available_year_moe_status',
};

const ELIGIBILITY_INPUTS: readonly CalculatorInputSpec[] = [
  ...SHARED_MOE_INPUTS,
  {
    name: 'most_recent_available_fiscal_year_start',
    type: 'date',
    required: true,
    classification: 'INTERNAL',
    definition:
      'First day of the most recent fiscal year for which the LEA has final expenditure ' +
      'information. What makes information available is OQ-8; the platform accepts the ' +
      'LEA’s assertion with no test.',
  },
  {
    name: 'most_recent_available_year_moe_status',
    type: 'enum',
    required: true,
    classification: 'INTERNAL',
    definition:
      'MET, NOT_MET or UNKNOWN — the compliance outcome for that year. UNKNOWN is a value, ' +
      'not a gap, and routes the run to review with a named remedy.',
  },
  {
    name: 'current_budget_local',
    type: 'money',
    required: true,
    classification: 'CONFIDENTIAL',
    definition: 'Amount budgeted from local funds only for the budget year.',
  },
  {
    name: 'current_budget_state_local',
    type: 'money',
    required: true,
    classification: 'CONFIDENTIAL',
    definition: 'Amount budgeted from State and local funds combined for the budget year.',
  },
  {
    name: 'current_child_count',
    type: 'count',
    required: false,
    classification: 'CONFIDENTIAL',
    definition:
      'Aggregate count of children with disabilities projected or officially adopted for the ' +
      'budget year. Whether a projected count is admissible against an actual comparison ' +
      'count is OQ-20.',
  },
];

export const ideaMoeEligibilityV1: Calculator<MoeOutput> = {
  name: 'idea_moe_eligibility_v1',
  title: 'IDEA Part B maintenance of effort — LEA eligibility',
  authority: [
    '34 CFR 300.203(a)',
    '34 CFR 300.203(a)(2)',
    '34 CFR 300.203(a)(3)',
    '34 CFR 300.203(c)',
    '34 CFR 300.204',
    '34 CFR 300.205',
    '34 CFR 300.226',
    '20 U.S.C. 1413(a)(2)',
  ],
  inputs: ELIGIBILITY_INPUTS,
  run(inputs: CalculatorInputs): CalculatorResult<MoeOutput> {
    return runMoe(CONFIG, inputs);
  },
};
