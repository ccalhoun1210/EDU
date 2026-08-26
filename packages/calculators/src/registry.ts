/**
 * The calculator registry.
 *
 * Spec: Master Technical Buildout section 8.5. ADR 0003 names the seam this file closes:
 * *"Two things now have to be kept in sync: the rule schema and the calculator registry."*
 *
 * `CALCULATOR_REGISTRY` in the rule-pack SDK is the allow-list — the names a rule pack is
 * permitted to reference, checked at publication. This file holds the implementations. The
 * two are different things and they drift, so `registry.test.ts` asserts their relationship
 * exactly, and `NOT_YET_IMPLEMENTED` below is the deliberate, reviewed record of the gap
 * between them.
 *
 * A name in the allow-list with no implementation is not a bug. A rule may legitimately be
 * authored and reviewed before the arithmetic behind it exists — that is the order the house
 * rules require. What must never happen is for the gap to be invisible: a rule reaching
 * ACTIVE while its calculator is a name nobody wrote would evaluate to INDETERMINATE forever,
 * and a district would see "we could not tell" with no explanation of why.
 */

import { CALCULATOR_REGISTRY, type CalculatorName } from '@complianceos/rulepack-sdk';
import { ideaExcessCostV1 } from './idea-excess-cost.js';
import { ideaMoeComplianceV1 } from './idea-moe-compliance.js';
import { ideaMoeEligibilityV1 } from './idea-moe-eligibility.js';
import type { Calculator } from './types.js';

/**
 * Every implemented calculator.
 *
 * Adding one here means removing its name from `NOT_YET_IMPLEMENTED`; the test enforces it,
 * so the two lists cannot silently disagree.
 */
const IMPLEMENTATIONS: readonly Calculator[] = [
  ideaMoeEligibilityV1,
  ideaMoeComplianceV1,
  ideaExcessCostV1,
];

export const CALCULATORS: ReadonlyMap<CalculatorName, Calculator> = new Map(
  IMPLEMENTATIONS.map((calculator) => [calculator.name, calculator]),
);

/**
 * Allow-listed names with no implementation yet, and why.
 *
 * This list shrinks. It is in code rather than in a tracker because the test reads it: a name
 * cannot quietly stay unimplemented, and an implementation cannot quietly appear without
 * someone editing this comment.
 */
export const NOT_YET_IMPLEMENTED: readonly CalculatorName[] = [
  // IDEA fiscal — specifications and golden corpora authored; implementations in progress.
  'idea_proportionate_share_v1',
  'idea_cceis_v1',
  // Significant disproportionality — Phase 5. Every threshold is a State parameter and must
  // arrive from a State rule pack, so these cannot be implemented before state packs exist.
  'risk_ratio_v1',
  'alternate_risk_ratio_v1',
  // Programmatic SPED — Phase 4. Needs the timeline engine and Alabama's school calendar.
  'state_child_find_deadline_al_v1',
];

export function calculatorFor(name: string): Calculator | undefined {
  return CALCULATORS.get(name as CalculatorName);
}

/** The allow-list, re-exported so a consumer needs one import rather than two. */
export { CALCULATOR_REGISTRY };
