/**
 * IDEA Part B maintenance of effort — LEA compliance, 34 CFR 300.203(b).
 *
 * Asked after the year closes: did the LEA in fact *spend* at least what it spent the year
 * before? Actuals against actuals. Failing it means non-Federal funds go back to the
 * Department, capped at the LEA's subgrant, so the finding severity is CRITICAL and the
 * calculator is correspondingly unwilling to conclude anything on an incomplete calculation:
 * two failing measures and two unanswerable ones is INDETERMINATE, never FAIL.
 *
 * The four measures, the exceptions at 34 CFR 300.204 and the adjustment at 34 CFR 300.205
 * are shared with the eligibility test and live in `moe-shared.ts`. What is specific to
 * compliance is here: the closed-year input names, the subgrant gate, the per-measure refusal
 * where the two readings of the subsequent-years rule give a measure different comparison
 * levels, and the bounded repayment exposure.
 *
 * Spec: `docs/regulatory-methodology/idea-moe.md`. Golden corpus:
 * `golden/idea_moe_compliance_v1.yaml`. Rule: `IDEA-MOE-COMPLIANCE-001`, held at DRAFT
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
  variant: 'COMPLIANCE',
  standardCitation: '34 CFR 300.203(b)',
  actualBasisAuthority: '34 CFR 300.203(b)',
  currentLocalInput: 'current_actual_local',
  currentStateLocalInput: 'current_actual_state_local',
  currentAmountLabel: 'Actual',
  currentStepPrefix: 'current',
  priorStatusInput: 'comparison_year_moe_status',
};

const COMPLIANCE_INPUTS: readonly CalculatorInputSpec[] = [
  ...SHARED_MOE_INPUTS,
  {
    name: 'current_fiscal_year_end',
    type: 'date',
    required: true,
    classification: 'INTERNAL',
    definition: 'Last day of the closed fiscal year under test.',
  },
  {
    name: 'lea_part_b_subgrant_amount',
    type: 'money',
    required: true,
    classification: 'INTERNAL',
    definition:
      'The LEA’s Part B subgrant for the year. Used only for the 34 CFR 300.203(d) cap; a ' +
      'decimal zero routes the year to review rather than answering OQ-15.',
  },
  {
    name: 'current_actual_local',
    type: 'money',
    required: true,
    classification: 'CONFIDENTIAL',
    definition: 'Actual expenditure for the year under test, local funds only.',
  },
  {
    name: 'current_actual_state_local',
    type: 'money',
    required: true,
    classification: 'CONFIDENTIAL',
    definition: 'Actual expenditure for the year under test, State and local funds combined.',
  },
  {
    name: 'current_child_count',
    type: 'count',
    required: false,
    classification: 'CONFIDENTIAL',
    definition:
      'Aggregate count of children with disabilities served in the year under test. Which ' +
      'count date is the per-capita denominator is OQ-19; the calculator trusts the caller.',
  },
  {
    name: 'comparison_year_moe_status',
    type: 'enum',
    required: true,
    classification: 'INTERNAL',
    definition: 'MET, NOT_MET or UNKNOWN for the comparison year.',
  },
  {
    name: 'comparison_year_methods_met',
    type: 'list',
    required: true,
    classification: 'INTERNAL',
    definition:
      'The measures under which the LEA met the standard in the comparison year. Empty is ' +
      'legal and meaningful. Used only to detect where the two readings of the ' +
      'subsequent-years rule can diverge for a measure — OQ-9.',
  },
];

export const ideaMoeComplianceV1: Calculator<MoeOutput> = {
  name: 'idea_moe_compliance_v1',
  title: 'IDEA Part B maintenance of effort — LEA compliance',
  authority: [
    '34 CFR 300.203(b)',
    '34 CFR 300.203(a)(3)',
    '34 CFR 300.203(c)',
    '34 CFR 300.203(d)',
    '34 CFR 300.204',
    '34 CFR 300.205',
    '34 CFR 300.226',
    '34 CFR 300.704(c)',
    '20 U.S.C. 1413(a)(2)',
  ],
  inputs: COMPLIANCE_INPUTS,
  run(inputs: CalculatorInputs): CalculatorResult<MoeOutput> {
    return runMoe(CONFIG, inputs);
  },
};
