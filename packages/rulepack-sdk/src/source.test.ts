import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_CALCULATORS } from './calculators.js';
import { loadRulePack, loadSourceRegistries } from './load.js';
import {
  assertRuleSourcesVerified,
  checkRuleSources,
  isVerified,
  requiresVerifiedSource,
  type RegulatorySource,
} from './source.js';
import type { Rule } from './rule.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const SOURCES_DIR = path.join(REPO_ROOT, 'rulepacks/sources');

function source(overrides: Partial<RegulatorySource> = {}): RegulatorySource {
  return {
    sourceId: 'REG-TEST-1',
    jurisdiction: 'US-FED',
    publisher: 'U.S. Department of Education',
    title: 'A regulation',
    citation: '34 CFR 300.1',
    officialUrl: 'https://www.ecfr.gov/current/title-34/part-300/section-300.1',
    publishedOn: null,
    effective: { start: '2006-10-13', end: null },
    programs: ['IDEA_PART_B'],
    supersedes: null,
    retrieval: null,
    ...overrides,
  };
}

const RETRIEVED = {
  retrievedOn: '2026-08-25',
  documentHash: 'a'.repeat(64),
  archiveRef: 'blob://regulatory/REG-TEST-1/2026-08-25.xml',
  retrievedBy: 'regulatory-source-monitor',
};

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    ruleId: 'TEST-001',
    pack: 'TEST-PACK',
    jurisdiction: 'US-FED',
    program: 'IDEA_PART_B',
    subjectType: 'LEA_FISCAL_YEAR',
    lifecycle: 'DRAFT',
    authority: { citation: '34 CFR 300.1', sourceId: 'REG-TEST-1' },
    effective: { start: '2015-07-01', end: null },
    inputs: ['a'],
    outputSchema: { status: 'enum' },
    severityOnFailure: 'HIGH',
    explanationTemplate: 'test_v1',
    condition: { exists: { input: 'a' } },
    ...overrides,
  } as Rule;
}

describe('source verification gating', () => {
  it('treats a source with no retrieval record as unverified', () => {
    expect(isVerified(source())).toBe(false);
    expect(isVerified(source({ retrieval: RETRIEVED }))).toBe(true);
  });

  it('permits authoring stages to cite an unretrieved source', () => {
    for (const lifecycle of [
      'DRAFT',
      'DOMAIN_REVIEWED',
      'LEGAL_REVIEWED',
      'QA_APPROVED',
    ] as const) {
      expect(requiresVerifiedSource(lifecycle)).toBe(false);
      expect(checkRuleSources([rule({ lifecycle })], [source()])).toHaveLength(0);
    }
  });

  it('refuses to let a rule evaluate district data on an unverified citation', () => {
    for (const lifecycle of ['STAGED', 'SHADOW', 'ACTIVE'] as const) {
      const problems = checkRuleSources([rule({ lifecycle })], [source()]);
      expect(problems).toHaveLength(1);
      expect(problems[0]?.reason).toBe('UNVERIFIED_SOURCE');
    }
  });

  it('clears a rule once its source has been retrieved and hashed', () => {
    const problems = checkRuleSources(
      [rule({ lifecycle: 'ACTIVE' })],
      [source({ retrieval: RETRIEVED })],
    );
    expect(problems).toHaveLength(0);
  });

  it('reports a citation that names no registered source, at any lifecycle', () => {
    const problems = checkRuleSources([rule()], []);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toBe('UNKNOWN_SOURCE');
  });

  it('names the offending rules when asserting', () => {
    expect(() => assertRuleSourcesVerified([rule({ lifecycle: 'ACTIVE' })], [source()])).toThrow(
      /TEST-001/,
    );
  });
});

describe('the committed regulatory source registry', () => {
  it('parses, and rejects a duplicate source id across registry files', async () => {
    const sources = await loadSourceRegistries(SOURCES_DIR);
    expect(sources.length).toBeGreaterThan(0);
    expect(new Set(sources.map((s) => s.sourceId)).size).toBe(sources.length);
  });

  it('gives every committed rule a citation that resolves to a registered source', async () => {
    const sources = await loadSourceRegistries(SOURCES_DIR);
    const pack = await loadRulePack(
      path.join(REPO_ROOT, 'rulepacks/federal/idea-b/us-fed-idea-b-2026'),
      ALLOWED_CALCULATORS,
    );

    const unknown = checkRuleSources(pack.rules, sources).filter(
      (problem) => problem.reason === 'UNKNOWN_SOURCE',
    );
    expect(unknown).toEqual([]);
  });

  // This is the gate described in rulepacks/sources/us-federal.yaml. It fails the moment
  // someone advances a rule to STAGED, SHADOW or ACTIVE without first retrieving and hashing
  // the official text it claims to implement.
  it('holds every rule at an authoring stage while its source is unverified', async () => {
    const sources = await loadSourceRegistries(SOURCES_DIR);
    const pack = await loadRulePack(
      path.join(REPO_ROOT, 'rulepacks/federal/idea-b/us-fed-idea-b-2026'),
      ALLOWED_CALCULATORS,
    );

    expect(() => assertRuleSourcesVerified(pack.rules, sources)).not.toThrow();
  });
});
