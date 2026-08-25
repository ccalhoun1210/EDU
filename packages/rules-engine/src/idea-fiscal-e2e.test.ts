/**
 * The real rule pack, the real calculators, one district-shaped fact bag.
 *
 * Every other suite in this repository tests one seam. This one tests the path a district's
 * data actually travels: pack on disk → rule resolution by lifecycle and effective date →
 * input projection → statutory calculator → explanation → evaluation hash. The defects it
 * exists to catch are the ones each component is individually right about and the assembly is
 * wrong about.
 *
 * The first of them has already happened once. The two maintenance-of-effort rules declared
 * six of the twenty-four inputs their calculator reads, so `projectInputs` would have handed
 * it a fact bag with no comparison basis and no federal-funds attestation, and the engine
 * would have reported INDETERMINATE for every district in the country — while all forty-two
 * golden cases passed, because a golden case calls the calculator directly.
 *
 * The pack is at DRAFT and stays there: no cited source has been retrieved (ADR 0006), so
 * `includeLifecycles` naming DRAFT is what makes this an authoring exercise rather than a
 * compliance determination. `official` is asserted false for exactly that reason.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALCULATORS } from '@complianceos/calculators';
import { ALLOWED_CALCULATORS, loadRulePack } from '@complianceos/rulepack-sdk';
import { runAssessment, type FactBag, type RunContext } from './run.js';

const PACK_DIR = path.join(
  import.meta.dirname,
  '../../../rulepacks/federal/idea-b/us-fed-idea-b-2026',
);

const pack = await loadRulePack(PACK_DIR, ALLOWED_CALCULATORS);

const CONTEXT: RunContext = {
  tenantId: 'TEN-0001',
  organizationId: 'LEA-0001',
  assessmentRunId: 'RUN-0001',
  dataSnapshotId: 'SNAP-0001',
  // Supplied, never read from the clock: a finalized run must reproduce years later.
  evaluatedAt: '2026-09-01T00:00:00.000Z',
};

const SUBJECT = { subjectType: 'LEA_FISCAL_YEAR', subjectId: 'LEA-0001:2025-07-01' } as const;

/**
 * A synthetic district that fails the compliance test on its local measures and passes on its
 * State-and-local ones. Every figure is invented; none comes from a real LEA.
 */
const FACTS: FactBag = {
  // Shared
  current_fiscal_year_start: '2025-07-01',
  federal_funds_excluded: true,
  comparison_fiscal_year_start: '2024-07-01',
  comparison_basis: 'ACTUAL_EXPENDITURE',
  moe_status_source_run_id: 'RUN-MOE-COMPLIANCE-2024-0001',
  comparison_actual_local: '5000000.00',
  comparison_actual_state_local: '8000000.00',
  comparison_child_count: 1000,

  // Compliance
  current_fiscal_year_end: '2026-06-30',
  lea_part_b_subgrant_amount: '1450000.00',
  current_actual_local: '4900000.00',
  current_actual_state_local: '8100000.00',
  current_child_count: 1000,
  comparison_year_moe_status: 'MET',
  comparison_year_methods_met: [
    'LOCAL_ONLY',
    'STATE_AND_LOCAL',
    'LOCAL_PER_CAPITA',
    'STATE_AND_LOCAL_PER_CAPITA',
  ],

  // Eligibility, for the following budget year
  most_recent_available_fiscal_year_start: '2024-07-01',
  most_recent_available_year_moe_status: 'MET',
  current_budget_local: '5100000.00',
  current_budget_state_local: '8200000.00',
};

function run(facts: FactBag = FACTS) {
  return runAssessment({
    context: CONTEXT,
    subject: SUBJECT,
    asOf: '2026-09-01',
    packs: [pack],
    facts,
    calculators: CALCULATORS,
    includeLifecycles: ['DRAFT'],
  });
}

describe('an IDEA fiscal assessment run end to end', () => {
  const outcome = run();

  it('evaluates the maintenance-of-effort rules rather than skipping them', () => {
    const ids = outcome.results.map((result) => result.ruleId);
    expect(ids).toContain('IDEA-MOE-COMPLIANCE-001');
    expect(ids).toContain('IDEA-MOE-ELIGIBILITY-001');
  });

  it('reaches a conclusive status on facts a district could actually supply', () => {
    // The regression this file was written for: an under-declared `inputs` array starves the
    // calculator and every rule comes back INDETERMINATE with a full fact bag in hand.
    for (const ruleId of ['IDEA-MOE-COMPLIANCE-001', 'IDEA-MOE-ELIGIBILITY-001']) {
      const result = outcome.results.find((candidate) => candidate.ruleId === ruleId);
      expect(result?.status, `${ruleId} — ${JSON.stringify(result?.missingInputs)}`).toBe('PASS');
      expect(result?.missingInputs).toEqual([]);
    }
  });

  it('agrees with the calculator called directly', () => {
    // The engine must not reinterpret a statutory result. If these ever diverge, the rule's
    // declared inputs and the calculator's have drifted apart.
    const compliance = outcome.results.find((r) => r.ruleId === 'IDEA-MOE-COMPLIANCE-001');
    const direct = CALCULATORS.get('idea_moe_compliance_v1')?.run(FACTS);
    expect(compliance?.status).toBe(direct?.status);
    expect(compliance?.output).toEqual(direct?.output);
  });

  it('records the whole provenance chain on every result', () => {
    for (const result of outcome.results) {
      expect(result.ruleId).toBeTruthy();
      expect(result.authority.citation).toBeTruthy();
      expect(result.authority.sourceId).toBeTruthy();
      expect(result.dataSnapshotId).toBe(CONTEXT.dataSnapshotId);
      expect(result.assessmentRunId).toBe(CONTEXT.assessmentRunId);
      expect(result.evaluationHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('carries only the facts the rule declared into the result', () => {
    // Invariant 3 and invariant 10 together: the finding's `computedInputs` is what the
    // provenance panel walks back from, and a fact the rule never named has no chain.
    const compliance = outcome.results.find((r) => r.ruleId === 'IDEA-MOE-COMPLIANCE-001');
    const declared = new Set(
      pack.rules.find((r) => r.ruleId === 'IDEA-MOE-COMPLIANCE-001')?.inputs ?? [],
    );
    for (const name of Object.keys(compliance?.computedInputs ?? {})) {
      expect(declared.has(name), `${name} was not declared by the rule`).toBe(true);
    }
    // And the eligibility-only budget figures must not reach the compliance rule.
    expect(compliance?.computedInputs).not.toHaveProperty('current_budget_local');
  });

  it('explains every conclusion in words, with the arithmetic behind it', () => {
    // Section 40: a material conclusion without a "Why" is a black box. Neither rule ships an
    // authored template yet, so this is the engine's generated step listing — which is still
    // required to name the operands, not just the answer.
    for (const result of outcome.results) {
      expect(result.explanation.length).toBeGreaterThan(40);
      expect(result.explanation).not.toContain('{{');
    }
  });

  it('is not an official determination while the pack is at DRAFT', () => {
    // The source-verification gate in one property: nothing here has a retrieved citation, so
    // no result may be presented to a district or an SEA as a finding.
    expect(outcome.official).toBe(false);
  });

  it('reproduces byte for byte on a second run of the same inputs', () => {
    // Spec 2.5. The hash deliberately excludes `evaluatedAt` and `assessmentRunId`, so
    // re-running and comparing hashes is a valid audit procedure.
    const again = run();
    expect(again.results.map((r) => r.evaluationHash)).toEqual(
      outcome.results.map((r) => r.evaluationHash),
    );
  });

  it('produces a different hash when a figure that decided the result changes', () => {
    // The other half of the property: a hash that never moves is not evidence of anything.
    const changed = run({ ...FACTS, current_actual_state_local: '7000000.00' });
    const before = outcome.results.find((r) => r.ruleId === 'IDEA-MOE-COMPLIANCE-001');
    const after = changed.results.find((r) => r.ruleId === 'IDEA-MOE-COMPLIANCE-001');
    expect(after?.status).not.toBe(before?.status);
    expect(after?.evaluationHash).not.toBe(before?.evaluationHash);
  });
});

describe('an IDEA fiscal run on an incomplete extract', () => {
  it('reports what the district owes rather than a failure', () => {
    // Invariant 9 at its sharpest on the compliance side: the platform will not assert a
    // repayment obligation on a calculation it could not complete.
    const { comparison_child_count, current_actual_state_local, ...thin } = FACTS;
    void comparison_child_count;
    void current_actual_state_local;

    const result = run({ ...thin, current_actual_local: '4000000.00' }).results.find(
      (candidate) => candidate.ruleId === 'IDEA-MOE-COMPLIANCE-001',
    );

    expect(result?.status).toBe('INDETERMINATE');
    expect(result?.missingInputs.length).toBeGreaterThan(0);
    expect(result?.explanation).not.toContain('{{');
  });
});
