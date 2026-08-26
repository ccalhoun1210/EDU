/**
 * Behavioural tests for rule-pack layering and effective-date selection.
 *
 * Spec: Master Technical Buildout sections 8.1 and 2.5. CLAUDE.md invariants 3 and 4.
 *
 * Two properties matter here. The first is authority: a state overlay may supersede a
 * federal rule and must say so on the resolved rule, while a local pack may not quietly
 * rewrite a statutory requirement at all — a district that redefines
 * `IDEA-MOE-COMPLIANCE-001` and is then reported as compliant with the federal requirement
 * is the precise failure this resolver exists to prevent. The second is reproducibility:
 * the same stack of packs and the same as-of date must produce the same rules in the same
 * order, whatever order the packs were supplied in.
 */

import { describe, expect, it } from 'vitest';
import type { LoadedRulePack, Rule } from '@complianceos/rulepack-sdk';
import { RuleResolutionError, resolveRulePacks, type PackLayer } from './resolve.js';

// --- fixtures ---------------------------------------------------------------------------

const ASOF = '2026-10-15';

const OPEN_WINDOW = { start: '2020-07-01', end: null } as const;

function makeRule(
  ruleId: string,
  packId: string,
  effective: { readonly start: string; readonly end: string | null } = OPEN_WINDOW,
): Rule {
  return {
    ruleId,
    title: `Requirement ${ruleId}`,
    pack: packId,
    jurisdiction: 'US',
    program: 'IDEA_PART_B',
    subjectType: 'LEA',
    lifecycle: 'ACTIVE',
    authority: { citation: '34 CFR 300.203', sourceId: 'ecfr-34-300-203' },
    effective: { start: effective.start, end: effective.end },
    inputs: ['currentYearLocalExpenditure'],
    condition: {
      op: 'gte',
      left: { input: 'currentYearLocalExpenditure' },
      right: { literal: '0' },
    },
    outputSchema: { met: 'boolean' },
    severityOnFailure: 'HIGH',
    explanationTemplate: `${ruleId}.md`,
  };
}

function makePack(
  packId: string,
  layer: PackLayer,
  rules: readonly Rule[],
  extendsPack: string | null = null,
): LoadedRulePack {
  return {
    manifest: {
      packId,
      version: '1.0.0',
      jurisdiction: layer === 'FEDERAL' ? 'US' : 'US-AL',
      program: 'IDEA_PART_B',
      layer,
      extendsPack,
      effective: { start: '2020-07-01', end: null },
      description: `${layer} pack ${packId}`,
    },
    rules,
    explanations: new Map(),
  };
}

const MOE = 'IDEA-MOE-COMPLIANCE-001';

function federalPack(rules: readonly Rule[]): LoadedRulePack {
  return makePack('idea-federal', 'FEDERAL', rules);
}

function statePack(rules: readonly Rule[]): LoadedRulePack {
  return makePack('al-state', 'STATE', rules, 'idea-federal');
}

function localPack(rules: readonly Rule[], extendsPack = 'idea-federal'): LoadedRulePack {
  return makePack('bham-local', 'LOCAL', rules, extendsPack);
}

// --- layering ---------------------------------------------------------------------------

describe('layering', () => {
  it('lets a state overlay supersede the federal rule of the same id, and records which pack lost', () => {
    const federal = federalPack([makeRule(MOE, 'idea-federal')]);
    const state = statePack([makeRule(MOE, 'al-state')]);

    const resolved = resolveRulePacks([federal, state], ASOF);

    expect(resolved.rules).toHaveLength(1);
    expect(resolved.rules[0]?.rule.pack).toBe('al-state');
    expect(resolved.rules[0]?.pack).toEqual({
      packId: 'al-state',
      version: '1.0.0',
      layer: 'STATE',
    });
    expect(resolved.rules[0]?.supersedes).toEqual({
      packId: 'idea-federal',
      version: '1.0.0',
      layer: 'FEDERAL',
    });
  });

  // Resolution must not depend on the order the caller happened to load packs in, or the
  // same district would be assessed under different text on different runs.
  it('applies layer order regardless of the order the packs were supplied in', () => {
    const federal = federalPack([makeRule(MOE, 'idea-federal')]);
    const state = statePack([makeRule(MOE, 'al-state')]);

    const resolved = resolveRulePacks([state, federal], ASOF);

    expect(resolved.rules[0]?.rule.pack).toBe('al-state');
    expect(resolved.rules[0]?.supersedes?.packId).toBe('idea-federal');
    expect(resolved.packs.map((pack) => pack.layer)).toEqual(['FEDERAL', 'STATE']);
  });

  it('leaves supersedes unset on a rule no higher layer touched', () => {
    const federal = federalPack([
      makeRule(MOE, 'idea-federal'),
      makeRule('IDEA-EC-001', 'idea-federal'),
    ]);
    const state = statePack([makeRule(MOE, 'al-state')]);

    const resolved = resolveRulePacks([federal, state], ASOF);
    const excessCost = resolved.rules.find((entry) => entry.rule.ruleId === 'IDEA-EC-001');

    expect(excessCost?.supersedes).toBeUndefined();
    expect(excessCost?.pack.layer).toBe('FEDERAL');
  });

  it('records every contributing pack in layer order on the resolved set', () => {
    const resolved = resolveRulePacks(
      [
        localPack([makeRule('BHAM-WARN-001', 'bham-local')], 'al-state'),
        statePack([makeRule('AL-CHILD-FIND-001', 'al-state')]),
        federalPack([makeRule(MOE, 'idea-federal')]),
      ],
      ASOF,
    );

    expect(resolved.packs.map((pack) => pack.packId)).toEqual([
      'idea-federal',
      'al-state',
      'bham-local',
    ]);
    expect(resolved.asOf).toBe(ASOF);
  });
});

// --- what a local pack may and may not do -----------------------------------------------

describe('local packs may not rewrite a statutory requirement', () => {
  it('refuses a local pack that redefines a federal rule id', () => {
    const federal = federalPack([makeRule(MOE, 'idea-federal')]);
    const local = localPack([makeRule(MOE, 'bham-local')]);

    expect(() => resolveRulePacks([federal, local], ASOF)).toThrow(RuleResolutionError);
    expect(() => resolveRulePacks([federal, local], ASOF)).toThrow(/IDEA-MOE-COMPLIANCE-001/);
  });

  it('refuses a local pack that redefines a state rule id', () => {
    const federal = federalPack([makeRule(MOE, 'idea-federal')]);
    const state = statePack([makeRule('AL-CHILD-FIND-001', 'al-state')]);
    const local = localPack([makeRule('AL-CHILD-FIND-001', 'bham-local')], 'al-state');

    expect(() => resolveRulePacks([federal, state, local], ASOF)).toThrow(RuleResolutionError);
    expect(() => resolveRulePacks([federal, state, local], ASOF)).toThrow(/AL-CHILD-FIND-001/);
  });

  it('accepts a local pack that adds a control under its own rule id', () => {
    const federal = federalPack([makeRule(MOE, 'idea-federal')]);
    const local = localPack([makeRule('BHAM-MOE-EARLY-WARNING-001', 'bham-local')]);

    const resolved = resolveRulePacks([federal, local], ASOF);
    const warning = resolved.rules.find(
      (entry) => entry.rule.ruleId === 'BHAM-MOE-EARLY-WARNING-001',
    );

    expect(resolved.rules).toHaveLength(2);
    expect(warning?.pack.layer).toBe('LOCAL');
    expect(warning?.supersedes).toBeUndefined();
  });

  /**
   * DEFECT: the local-override guard sits inside the effective-date filter, so it only sees
   * rules that survived that filter. A LOCAL pack may therefore redefine a FEDERAL or STATE
   * rule id whose window has not opened yet (or has closed) on `asOf` — the higher-layer rule
   * was skipped with `continue` before it was ever entered in `byRuleId`, so there is nothing
   * for the guard to collide with, and the local rule silently takes the statutory id — the
   * federal rule then disappears from `notYetEffective` too, because the final sweep clears
   * every id that has a surviving rule. The same pack stack throws a RuleResolutionError the
   * day the federal window opens, so the fault surfaces as a broken run, not at publication.
   *
   * Correct behaviour: id ownership is checked across layers regardless of effective window —
   * a LOCAL pack that names a rule id any FEDERAL or STATE pack in the stack defines is a
   * resolution error whatever the as-of date.
   */
  it('refuses a local pack that redefines a federal rule id whose window has not opened', () => {
    // Ownership of a statutory rule id is a property of the content, not of the date a run
    // happens to ask about. If this were only checked among effective rules, the collision
    // would surface on the day the federal window opens — as a failed run rather than a
    // rejected publication.
    const federal = federalPack([
      makeRule(MOE, 'idea-federal', { start: '2099-07-01', end: null }),
    ]);
    const local = localPack([makeRule(MOE, 'bham-local')]);

    expect(() => resolveRulePacks([federal, local], ASOF)).toThrow(RuleResolutionError);
    expect(() => resolveRulePacks([federal, local], ASOF)).toThrow(/may not rewrite a statutory/);
  });

  it('refuses a local pack that redefines a federal rule id whose window has closed', () => {
    const federal = federalPack([
      makeRule(MOE, 'idea-federal', { start: '2000-07-01', end: '2001-06-30' }),
    ]);
    const local = localPack([makeRule(MOE, 'bham-local')]);

    expect(() => resolveRulePacks([federal, local], ASOF)).toThrow(RuleResolutionError);
  });
});

// --- stack validity ---------------------------------------------------------------------

describe('stack validity', () => {
  it('refuses an empty stack', () => {
    expect(() => resolveRulePacks([], ASOF)).toThrow(RuleResolutionError);
  });

  it('refuses a stack with no federal baseline, because an overlay has nothing to overlay', () => {
    const state = statePack([makeRule('AL-CHILD-FIND-001', 'al-state')]);

    expect(() => resolveRulePacks([state], ASOF)).toThrow(/federal baseline/);
  });

  it('refuses two federal baselines, which would hide which statutory text decided a finding', () => {
    const first = makePack('idea-federal', 'FEDERAL', [makeRule(MOE, 'idea-federal')]);
    const second = makePack('idea-federal-2026', 'FEDERAL', [makeRule(MOE, 'idea-federal-2026')]);

    expect(() => resolveRulePacks([first, second], ASOF)).toThrow(/two federal baselines/);
  });

  it('refuses an overlay whose parent pack was not supplied', () => {
    const federal = federalPack([makeRule(MOE, 'idea-federal')]);
    const orphan = makePack(
      'al-state',
      'STATE',
      [makeRule('AL-1', 'al-state')],
      'idea-federal-2027',
    );

    expect(() => resolveRulePacks([federal, orphan], ASOF)).toThrow(RuleResolutionError);
    expect(() => resolveRulePacks([federal, orphan], ASOF)).toThrow(/idea-federal-2027/);
  });

  it('refuses an overlay that names no pack to extend', () => {
    const federal = federalPack([makeRule(MOE, 'idea-federal')]);
    const rootless = makePack('al-state', 'STATE', [makeRule('AL-1', 'al-state')], null);

    expect(() => resolveRulePacks([federal, rootless], ASOF)).toThrow(/names no pack to extend/);
  });

  it('refuses a local overlay that names no pack to extend', () => {
    const federal = federalPack([makeRule(MOE, 'idea-federal')]);
    const rootless = makePack('bham-local', 'LOCAL', [makeRule('BHAM-1', 'bham-local')], null);

    expect(() => resolveRulePacks([federal, rootless], ASOF)).toThrow(/names no pack to extend/);
  });

  it('does not require the federal baseline itself to extend anything', () => {
    const federal = federalPack([makeRule(MOE, 'idea-federal')]);

    expect(() => resolveRulePacks([federal], ASOF)).not.toThrow();
  });
});

// --- effective dating ---------------------------------------------------------------------

describe('effective dating', () => {
  it('excludes a rule whose window has not opened and reports it as not yet effective', () => {
    const federal = federalPack([
      makeRule(MOE, 'idea-federal'),
      makeRule('IDEA-CCEIS-2027', 'idea-federal', { start: '2027-07-01', end: null }),
    ]);

    const resolved = resolveRulePacks([federal], ASOF);

    expect(resolved.rules.map((entry) => entry.rule.ruleId)).toEqual([MOE]);
    expect(resolved.notYetEffective).toEqual(['IDEA-CCEIS-2027']);
    expect(resolved.expired).toEqual([]);
  });

  it('excludes a rule whose window has closed and reports it as expired', () => {
    const federal = federalPack([
      makeRule(MOE, 'idea-federal'),
      makeRule('IDEA-ARRA-001', 'idea-federal', { start: '2009-07-01', end: '2013-06-30' }),
    ]);

    const resolved = resolveRulePacks([federal], ASOF);

    expect(resolved.rules.map((entry) => entry.rule.ruleId)).toEqual([MOE]);
    expect(resolved.expired).toEqual(['IDEA-ARRA-001']);
    expect(resolved.notYetEffective).toEqual([]);
  });

  it('includes a rule on the first and last day of its window', () => {
    const opensToday = federalPack([makeRule('OPENS', 'idea-federal', { start: ASOF, end: null })]);
    const closesToday = federalPack([
      makeRule('CLOSES', 'idea-federal', { start: '2020-07-01', end: ASOF }),
    ]);

    expect(resolveRulePacks([opensToday], ASOF).rules).toHaveLength(1);
    expect(resolveRulePacks([closesToday], ASOF).rules).toHaveLength(1);
  });

  it('excludes a rule the day after its window closes', () => {
    const federal = federalPack([
      makeRule('CLOSED', 'idea-federal', { start: '2020-07-01', end: '2026-10-14' }),
    ]);

    const resolved = resolveRulePacks([federal], ASOF);

    expect(resolved.rules).toEqual([]);
    expect(resolved.expired).toEqual(['CLOSED']);
  });

  // The superseded version losing to a higher layer says nothing about the surviving rule's
  // availability. Listing it would tell a district a requirement lapsed when it did not.
  it('does not report a rule as expired when a higher layer supplies an effective version of it', () => {
    const federal = federalPack([
      makeRule(MOE, 'idea-federal', { start: '2009-07-01', end: '2020-06-30' }),
    ]);
    const state = statePack([makeRule(MOE, 'al-state')]);

    const resolved = resolveRulePacks([federal, state], ASOF);

    expect(resolved.rules.map((entry) => entry.rule.pack)).toEqual(['al-state']);
    expect(resolved.expired).toEqual([]);
    expect(resolved.notYetEffective).toEqual([]);
  });

  it('does not report a rule as not yet effective when a lower layer supplies an effective version of it', () => {
    const federal = federalPack([makeRule(MOE, 'idea-federal')]);
    const state = statePack([makeRule(MOE, 'al-state', { start: '2027-07-01', end: null })]);

    const resolved = resolveRulePacks([federal, state], ASOF);

    expect(resolved.rules.map((entry) => entry.rule.pack)).toEqual(['idea-federal']);
    expect(resolved.notYetEffective).toEqual([]);
  });

  it('reports the excluded ids sorted', () => {
    const federal = federalPack([
      makeRule('Z-LATER', 'idea-federal', { start: '2027-07-01', end: null }),
      makeRule('A-LATER', 'idea-federal', { start: '2027-07-01', end: null }),
      makeRule('Z-GONE', 'idea-federal', { start: '2009-07-01', end: '2013-06-30' }),
      makeRule('A-GONE', 'idea-federal', { start: '2009-07-01', end: '2013-06-30' }),
      makeRule(MOE, 'idea-federal'),
    ]);

    const resolved = resolveRulePacks([federal], ASOF);

    expect(resolved.notYetEffective).toEqual(['A-LATER', 'Z-LATER']);
    expect(resolved.expired).toEqual(['A-GONE', 'Z-GONE']);
  });
});

// --- determinism ---------------------------------------------------------------------------

describe('output order', () => {
  it('sorts resolved rules by rule id, so a run does not depend on directory listing order', () => {
    const federal = federalPack([
      makeRule('IDEA-PS-001', 'idea-federal'),
      makeRule('IDEA-EC-001', 'idea-federal'),
      makeRule(MOE, 'idea-federal'),
    ]);
    const state = statePack([makeRule('AL-CHILD-FIND-001', 'al-state')]);

    const resolved = resolveRulePacks([federal, state], ASOF);

    expect(resolved.rules.map((entry) => entry.rule.ruleId)).toEqual([
      'AL-CHILD-FIND-001',
      'IDEA-EC-001',
      MOE,
      'IDEA-PS-001',
    ]);
  });

  it('produces the identical resolved set for the same stack supplied in a different order', () => {
    const federal = federalPack([
      makeRule(MOE, 'idea-federal'),
      makeRule('IDEA-EC-001', 'idea-federal'),
    ]);
    const state = statePack([makeRule(MOE, 'al-state')]);
    const local = localPack([makeRule('BHAM-WARN-001', 'bham-local')]);

    expect(resolveRulePacks([local, state, federal], ASOF)).toEqual(
      resolveRulePacks([federal, state, local], ASOF),
    );
  });
});
