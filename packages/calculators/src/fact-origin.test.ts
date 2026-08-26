/**
 * Every input an implemented calculator reads has a stated authority.
 *
 * `permittedOrigins` defaults an unregistered field to what a district may assert, which is
 * right for ordinary data and wrong for a determination. The danger is asymmetric: forgetting
 * to register an expenditure figure costs nothing, and forgetting to register a prior-year
 * compliance status lets a district declare its own failing year compliant.
 *
 * So the default stays permissive and this test carries the weight. A new platform-owned input
 * that nobody registers fails here rather than shipping as a hole.
 *
 * This lives in `packages/calculators` rather than beside the registry because it is the
 * calculators that know which inputs exist; `packages/domain` cannot see them without
 * depending upwards.
 */

import { describe, expect, it } from 'vitest';
import { authorityFor, mayOriginate, permittedOrigins } from '@complianceos/domain';
import { CALCULATORS } from './registry.js';

/**
 * Inputs a district is entitled to state, so an unregistered default is correct for them.
 *
 * Listed explicitly rather than inferred. The question "may the district assert this?" has to
 * be answered by a person for each input, and an allow-list is where that answer is recorded.
 */
const DISTRICT_MAY_ASSERT: ReadonlySet<string> = new Set([
  // What the district spent, budgeted, and served. Its own books and its own counts.
  'current_actual_local',
  'current_actual_state_local',
  'current_budget_local',
  'current_budget_state_local',
  'current_child_count',
  'comparison_actual_local',
  'comparison_actual_state_local',
  'comparison_child_count',
  // Which year is under test and which year it is measured against. The pipeline selects the
  // comparison year, but the calculator validates the declaration rather than trusting it, and
  // an inconsistent one is refused.
  'current_fiscal_year_start',
  'current_fiscal_year_end',
  'comparison_fiscal_year_start',
  'comparison_basis',
  'most_recent_available_fiscal_year_start',
  // The district's own claims and attestations. These are exactly the district speaking, and
  // nobody else can speak for it: an exception is the LEA's assertion about its own costs.
  'claimed_exceptions',
  'claimed_adjustments_300_205',
  'esea_use_condition_attested',
  'federal_funds_excluded',
  'ceis_amount_300_226',

  // Excess cost, 34 CFR 300.16 and Appendix A. Every figure is the district's own ledger and
  // its own head count, split by level because the regulation forbids combining them. Nothing
  // here is a determination: the calculator computes the threshold from these rather than
  // reading one somebody else concluded, which is what makes the whole set district-assertable
  // where the maintenance-of-effort prior-year status is not.
  'serves_elementary',
  'serves_secondary',
  'preceding_fiscal_year_start',
  ...['elementary', 'secondary'].flatMap((level) => [
    `${level}_total_expenditures`,
    `${level}_capital_outlay`,
    `${level}_debt_service`,
    `${level}_part_b_expenditures`,
    `${level}_esea_title_i_a_expenditures`,
    `${level}_esea_title_iii_expenditures`,
    `${level}_state_local_sped_expenditures`,
    `${level}_state_local_esea_expenditures`,
    `${level}_enrollment_preceding_year`,
    `${level}_children_with_disabilities`,
    `${level}_non_part_b_spend_on_children`,
  ]),
]);

const implemented = [...CALCULATORS.values()];

describe('fact origin authority', () => {
  it('covers at least one implemented calculator, so it cannot pass by finding nothing', () => {
    expect(implemented.length).toBeGreaterThan(0);
  });

  it('has an answer for every input every calculator reads', () => {
    const unanswered: string[] = [];
    for (const calculator of implemented) {
      for (const input of calculator.inputs) {
        const registered = authorityFor(input.name) !== undefined;
        if (!registered && !DISTRICT_MAY_ASSERT.has(input.name)) unanswered.push(input.name);
      }
    }
    expect(
      [...new Set(unanswered)].sort(),
      'each of these needs either an entry in AUTHORITIES or a line in DISTRICT_MAY_ASSERT — ' +
        'somebody has to decide whether a district may assert it',
    ).toEqual([]);
  });

  it('does not let a district export supply a determination about itself', () => {
    // The concrete attack. Each of these decides what bar the LEA is measured against, so an
    // LEA that could state one could lower its own.
    const determinations = [
      'comparison_year_moe_status',
      'most_recent_available_year_moe_status',
      'comparison_year_methods_met',
      'moe_status_source_run_id',
      'comparison_required_level_local',
      'comparison_required_level_state_local',
      'comparison_required_level_child_count',
    ];
    for (const field of determinations) {
      expect(mayOriginate(field, 'DISTRICT_EXPORT'), field).toBe(false);
      expect(mayOriginate(field, 'DISTRICT_ATTESTATION'), field).toBe(false);
      expect(mayOriginate(field, 'PLATFORM_DETERMINATION'), field).toBe(true);
    }
  });

  it('still lets a district state its own books', () => {
    for (const field of [
      'current_actual_local',
      'comparison_actual_local',
      'current_child_count',
    ]) {
      expect(mayOriginate(field, 'DISTRICT_EXPORT'), field).toBe(true);
    }
  });

  it('gives every registered field a reason a reviewer can read', () => {
    for (const calculator of implemented) {
      for (const input of calculator.inputs) {
        const authority = authorityFor(input.name);
        if (authority === undefined) continue;
        expect(authority.why.length, input.name).toBeGreaterThan(40);
        expect(authority.permittedOrigins.length, input.name).toBeGreaterThan(0);
      }
    }
  });

  it('never registers a field with an empty permission set', () => {
    // A field nothing may supply is unreachable, not secure.
    for (const calculator of implemented) {
      for (const input of calculator.inputs) {
        expect(permittedOrigins(input.name).length, input.name).toBeGreaterThan(0);
      }
    }
  });
});
