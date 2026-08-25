/**
 * The seam between a rule file and the calculator it names.
 *
 * Nothing in the golden corpus can catch a break here, because a golden case calls the
 * calculator directly with a hand-written input object. The engine does not: it hands the
 * calculator `projectInputs(rule.inputs, facts)` — only the inputs the *rule* declares, on
 * purpose, so that a calculator cannot read and decide on a fact its rule never named
 * (invariant 3, and the reason a finding's `computedInputs` is the provenance record).
 *
 * The consequence of drift is silent and total. A rule that declares six of the twenty-four
 * inputs its calculator reads produces INDETERMINATE on every real district, forever, while
 * every golden case still passes. That is the defect this file exists to prevent.
 *
 * The effective window has the same shape. A pure calculator cannot read its own rule, so the
 * date it refuses below is a constant in the source. If the rule's window moves and the
 * constant does not, determinations get made under the wrong text — with a citation, a
 * provenance chain and a reproducible hash, all of them pointing at the wrong version.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_CALCULATORS, loadRulePack, type Rule } from '@complianceos/rulepack-sdk';
import { CALCULATORS } from './registry.js';
import { MOE_RULE_EFFECTIVE_START } from './moe-shared.js';

const PACK_DIR = path.join(
  import.meta.dirname,
  '../../../rulepacks/federal/idea-b/us-fed-idea-b-2026',
);

const pack = await loadRulePack(PACK_DIR, ALLOWED_CALCULATORS);

/** Rules whose calculator this package actually implements. */
const wired: readonly Rule[] = pack.rules.filter(
  (rule) => rule.calculator !== undefined && CALCULATORS.has(rule.calculator as never),
);

describe('every rule wired to an implemented calculator', () => {
  it('has at least one such rule, so the suite cannot pass by finding nothing', () => {
    expect(wired.length).toBeGreaterThan(0);
  });

  for (const rule of wired) {
    const calculator = CALCULATORS.get(rule.calculator as never);

    describe(`${rule.ruleId} → ${String(rule.calculator)}`, () => {
      it('declares every input the calculator reads', () => {
        // A superset is permitted: a rule may declare a fact for the explanation template or
        // for a future version of the arithmetic. A subset is not — those inputs never arrive.
        const declared = new Set(rule.inputs);
        const undeclared = (calculator?.inputs ?? [])
          .map((input) => input.name)
          .filter((name) => !declared.has(name));
        expect(undeclared, `${rule.ruleId} would never receive these`).toEqual([]);
      });

      it('declares nothing the calculator does not read', () => {
        // Not a correctness failure, but a declared-and-unused input widens the fact set a
        // finding claims to rest on, which makes the provenance record overstate itself.
        const read = new Set((calculator?.inputs ?? []).map((input) => input.name));
        expect(rule.inputs.filter((name) => !read.has(name))).toEqual([]);
      });

      it('declares an output schema matching what the calculator emits', () => {
        // Section 8.7: the declared schema and the emitted object have to agree or provenance
        // breaks at the rule boundary. Checked against a real run rather than against a list,
        // so a field renamed in the implementation fails here.
        const emitted = new Set(Object.keys(calculator?.run({}).output ?? {}));
        const declaredOnly = Object.keys(rule.outputSchema).filter((key) => !emitted.has(key));
        expect(declaredOnly, 'declared but never emitted').toEqual([]);
      });
    });
  }
});

describe('the maintenance-of-effort effective window', () => {
  const moeRules = pack.rules.filter((rule) => rule.ruleId.startsWith('IDEA-MOE-'));

  it('covers both maintenance-of-effort rules', () => {
    expect(moeRules.map((rule) => rule.ruleId).sort()).toEqual([
      'IDEA-MOE-COMPLIANCE-001',
      'IDEA-MOE-ELIGIBILITY-001',
    ]);
  });

  for (const rule of moeRules) {
    it(`${rule.ruleId} starts on the date the calculator refuses below`, () => {
      expect(rule.effective.start).toBe(MOE_RULE_EFFECTIVE_START);
    });
  }
});
