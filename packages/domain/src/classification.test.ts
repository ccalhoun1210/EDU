/**
 * Behavioural tests for data classification and module data contracts.
 *
 * Spec: Master Technical Buildout sections 2.6 and 20. CLAUDE.md invariant 10 — minimize
 * student PII. The module's own comment states the point of these tests: a later change
 * that quietly introduces a student identifier into the fiscal module must fail here
 * rather than ship.
 */

import { describe, expect, it } from 'vitest';
import {
  DATA_CLASSIFICATIONS,
  MODULE_DATA_CONTRACTS,
  atLeastAsSensitive,
  highestClassification,
  moduleDataContract,
  moduleMayRead,
} from './classification.js';

/**
 * Adjacent pairs of the declared order, built rather than written out so that adding a
 * classification to the list extends the ordering test instead of leaving a gap in it.
 */
const ADJACENT_PAIRS = DATA_CLASSIFICATIONS.flatMap((lower, index) => {
  const higher = DATA_CLASSIFICATIONS[index + 1];
  return higher === undefined ? [] : [[lower, higher] as const];
});

describe('DATA_CLASSIFICATIONS ordering', () => {
  it('runs strictly from least to most sensitive', () => {
    // The order of the array is the ordering relation; nothing else encodes it.
    expect(ADJACENT_PAIRS).toHaveLength(DATA_CLASSIFICATIONS.length - 1);
    for (const [lower, higher] of ADJACENT_PAIRS) {
      expect(atLeastAsSensitive(higher, lower)).toBe(true);
      expect(atLeastAsSensitive(lower, higher)).toBe(false);
    }
  });

  it('places STUDENT_PII above the classifications a fiscal module needs', () => {
    expect(atLeastAsSensitive('STUDENT_PII', 'CONFIDENTIAL')).toBe(true);
    expect(atLeastAsSensitive('CONFIDENTIAL', 'STUDENT_PII')).toBe(false);
    expect(atLeastAsSensitive('HIGHLY_SENSITIVE', 'STUDENT_PII')).toBe(true);
  });

  it('is inclusive at equality, because a ceiling is a permitted level', () => {
    for (const classification of DATA_CLASSIFICATIONS) {
      expect(atLeastAsSensitive(classification, classification)).toBe(true);
    }
  });
});

describe('highestClassification', () => {
  it('returns PUBLIC for an empty set', () => {
    // A record with no classified fields carries no sensitivity to inherit.
    expect(highestClassification([])).toBe('PUBLIC');
  });

  it('returns the most sensitive member regardless of argument order', () => {
    expect(highestClassification(['PUBLIC', 'STUDENT_PII', 'INTERNAL'])).toBe('STUDENT_PII');
    expect(highestClassification(['STUDENT_PII', 'INTERNAL', 'PUBLIC'])).toBe('STUDENT_PII');
    expect(highestClassification(['HIGHLY_SENSITIVE', 'STUDENT_PII'])).toBe('HIGHLY_SENSITIVE');
  });

  it('returns the single member of a singleton set', () => {
    expect(highestClassification(['INTERNAL'])).toBe('INTERNAL');
    expect(highestClassification(['PUBLIC'])).toBe('PUBLIC');
  });

  it('never reports below the true maximum of a joined record', () => {
    // A derived record inherits the ceiling of everything it was joined from, so this is
    // the function that decides which module may read the join.
    const joined = highestClassification(['INTERNAL', 'CONFIDENTIAL', 'PUBLIC']);
    expect(moduleMayRead('IDEA_FISCAL', joined)).toBe(true);
    expect(moduleMayRead('IDEA_FISCAL', highestClassification(['INTERNAL', 'STUDENT_PII']))).toBe(
      false,
    );
  });
});

describe('moduleMayRead', () => {
  it('denies IDEA_FISCAL student PII (CLAUDE.md invariant 10)', () => {
    // IDEA Part B fiscal assurance computes MOE, excess cost, proportionate share and CEIS
    // from district-level aggregates and child counts. No student-level record is needed,
    // so none may be read — this test is the invariant, not a description of it.
    expect(moduleMayRead('IDEA_FISCAL', 'STUDENT_PII')).toBe(false);
    expect(moduleMayRead('IDEA_FISCAL', 'HIGHLY_SENSITIVE')).toBe(false);
  });

  it('lets a module read at exactly its ceiling', () => {
    expect(moduleMayRead('IDEA_FISCAL', 'CONFIDENTIAL')).toBe(true);
    expect(moduleMayRead('DISPROPORTIONALITY', 'STUDENT_PII')).toBe(true);
    expect(moduleMayRead('SPED_PROGRAMMATIC', 'STUDENT_PII')).toBe(true);
  });

  it('lets a module read anything below its ceiling', () => {
    expect(moduleMayRead('IDEA_FISCAL', 'PUBLIC')).toBe(true);
    expect(moduleMayRead('IDEA_FISCAL', 'INTERNAL')).toBe(true);
    expect(moduleMayRead('DISPROPORTIONALITY', 'CONFIDENTIAL')).toBe(true);
  });

  it('fails closed on an unknown module id', () => {
    // A typo in a module name must not open a path to student data, so the denial covers
    // even PUBLIC rather than defaulting to the least sensitive level.
    expect(moduleMayRead('IDEA_FISCLA', 'PUBLIC')).toBe(false);
    expect(moduleMayRead('IDEA_FISCAL ', 'CONFIDENTIAL')).toBe(false);
    expect(moduleMayRead('', 'PUBLIC')).toBe(false);
    expect(moduleMayRead('idea_fiscal', 'CONFIDENTIAL')).toBe(false);
  });

  it('grants no module HIGHLY_SENSITIVE today', () => {
    // Nothing in the current product needs it. If a ceiling is ever raised to this level,
    // this test should fail and force the rationale to be reviewed deliberately.
    for (const contract of MODULE_DATA_CONTRACTS) {
      expect(moduleMayRead(contract.moduleId, 'HIGHLY_SENSITIVE')).toBe(false);
    }
  });
});

describe('MODULE_DATA_CONTRACTS', () => {
  it('resolves every declared module by id and nothing else', () => {
    for (const contract of MODULE_DATA_CONTRACTS) {
      expect(moduleDataContract(contract.moduleId)).toBe(contract);
    }
    expect(moduleDataContract('NO_SUCH_MODULE')).toBeUndefined();
  });

  it('declares each module once, so no contract is shadowed in the lookup', () => {
    const ids = MODULE_DATA_CONTRACTS.map((contract) => contract.moduleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('states a rationale for every ceiling, for the district privacy reviewer', () => {
    for (const contract of MODULE_DATA_CONTRACTS) {
      expect(contract.title.length).toBeGreaterThan(0);
      expect(contract.rationale.length).toBeGreaterThan(0);
      expect(DATA_CLASSIFICATIONS).toContain(contract.maximumClassification);
    }
  });

  it('holds IDEA_FISCAL at CONFIDENTIAL', () => {
    expect(moduleDataContract('IDEA_FISCAL')?.maximumClassification).toBe('CONFIDENTIAL');
  });
});
