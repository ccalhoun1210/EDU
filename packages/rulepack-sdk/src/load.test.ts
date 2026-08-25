import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALLOWED_CALCULATORS } from './calculators.js';
import { loadRulePack, validateRule, RulePackValidationError } from './load.js';
import { isEffectiveOn } from './rule.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FEDERAL_PACK = path.resolve(here, '../../../rulepacks/federal/idea-b/us-fed-idea-b-2026');

describe('the shipped federal IDEA Part B pack', () => {
  it('loads and validates every rule', async () => {
    const pack = await loadRulePack(FEDERAL_PACK, ALLOWED_CALCULATORS);
    expect(pack.manifest.packId).toBe('US-FED-IDEA-B-2026');
    expect(pack.manifest.layer).toBe('FEDERAL');
    expect(pack.rules.length).toBeGreaterThan(0);
  });

  it('gives every rule a citation and a source id', async () => {
    const pack = await loadRulePack(FEDERAL_PACK, ALLOWED_CALCULATORS);
    for (const rule of pack.rules) {
      expect(rule.authority.citation).not.toHaveLength(0);
      expect(rule.authority.sourceId).not.toHaveLength(0);
    }
  });

  it('starts every rule in DRAFT until it has been through review', async () => {
    const pack = await loadRulePack(FEDERAL_PACK, ALLOWED_CALCULATORS);
    for (const rule of pack.rules) expect(rule.lifecycle).toBe('DRAFT');
  });
});

const baseRule = {
  ruleId: 'TEST-001',
  pack: 'US-FED-IDEA-B-2026',
  jurisdiction: 'US-FED',
  program: 'IDEA_PART_B',
  subjectType: 'LEA_FISCAL_YEAR',
  authority: { citation: '34 CFR 300.203(a)', sourceId: 'REG-US-IDEA-300-203' },
  effective: { start: '2015-07-01', end: null },
  inputs: ['current_child_count'],
  calculator: 'idea_moe_eligibility_v1',
  outputSchema: { status: 'enum' },
  severityOnFailure: 'CRITICAL',
  explanationTemplate: 'moe_eligibility_v1',
};

describe('validateRule', () => {
  it('rejects a calculator that is not on the allow-list', () => {
    expect(() =>
      validateRule(
        { ...baseRule, calculator: 'made_up_calculator' },
        'x.yaml',
        ALLOWED_CALCULATORS,
      ),
    ).toThrow(RulePackValidationError);
  });

  it('rejects a condition that reads an input the rule never declared', () => {
    expect(() =>
      validateRule(
        {
          ...baseRule,
          calculator: undefined,
          condition: {
            op: 'gt',
            left: { input: 'undeclared_input' },
            right: { literal: 0 },
          },
        },
        'x.yaml',
        ALLOWED_CALCULATORS,
      ),
    ).toThrow(/undeclared inputs/);
  });

  it('rejects a rule with neither a calculator nor a condition', () => {
    expect(() =>
      validateRule({ ...baseRule, calculator: undefined }, 'x.yaml', ALLOWED_CALCULATORS),
    ).toThrow(RulePackValidationError);
  });

  it('rejects a regulatory date expressed as a timestamp', () => {
    expect(() =>
      validateRule(
        { ...baseRule, effective: { start: '2015-07-01T00:00:00Z', end: null } },
        'x.yaml',
        ALLOWED_CALCULATORS,
      ),
    ).toThrow(/calendar dates/);
  });

  it('rejects an effective window that ends before it starts', () => {
    expect(() =>
      validateRule(
        { ...baseRule, effective: { start: '2020-07-01', end: '2019-06-30' } },
        'x.yaml',
        ALLOWED_CALCULATORS,
      ),
    ).toThrow(/must not precede/);
  });
});

describe('isEffectiveOn', () => {
  const rule = validateRule(baseRule, 'x.yaml', ALLOWED_CALCULATORS);

  it('excludes dates before the rule took effect', () => {
    expect(isEffectiveOn(rule, '2015-06-30')).toBe(false);
  });

  it('includes the first day the rule took effect', () => {
    expect(isEffectiveOn(rule, '2015-07-01')).toBe(true);
  });

  it('treats an open-ended rule as still in force', () => {
    expect(isEffectiveOn(rule, '2030-01-01')).toBe(true);
  });
});
