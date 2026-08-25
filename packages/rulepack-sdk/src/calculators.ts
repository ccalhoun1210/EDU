/**
 * The calculator allow-list.
 *
 * Spec 8.5. Names are versioned; a change in statutory arithmetic gets a new version
 * rather than an edit, so a historical run can still be reproduced. Adding a name here is
 * a deliberate act reviewed alongside the calculator implementation and its golden tests.
 */

export const CALCULATOR_REGISTRY = [
  'idea_moe_eligibility_v1',
  'idea_moe_compliance_v1',
  'idea_excess_cost_v1',
  'idea_proportionate_share_v1',
  'idea_cceis_v1',
  'risk_ratio_v1',
  'alternate_risk_ratio_v1',
  'state_child_find_deadline_al_v1',
] as const;

export type CalculatorName = (typeof CALCULATOR_REGISTRY)[number];

export const ALLOWED_CALCULATORS: ReadonlySet<string> = new Set(CALCULATOR_REGISTRY);
