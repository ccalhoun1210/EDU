import { describe, expect, it } from 'vitest';
import { isConclusive, rollUpStatus } from './evaluation.js';

describe('isConclusive', () => {
  it('treats INDETERMINATE and MANUAL_REVIEW as unanswered', () => {
    expect(isConclusive('INDETERMINATE')).toBe(false);
    expect(isConclusive('MANUAL_REVIEW')).toBe(false);
  });

  it('treats PASS, FAIL, RISK and NOT_APPLICABLE as answered', () => {
    expect(isConclusive('PASS')).toBe(true);
    expect(isConclusive('FAIL')).toBe(true);
    expect(isConclusive('RISK')).toBe(true);
    expect(isConclusive('NOT_APPLICABLE')).toBe(true);
  });
});

describe('rollUpStatus', () => {
  it('returns NOT_APPLICABLE for an empty rule set', () => {
    expect(rollUpStatus([])).toBe('NOT_APPLICABLE');
  });

  it('lets FAIL outrank everything', () => {
    expect(rollUpStatus(['PASS', 'RISK', 'FAIL', 'INDETERMINATE'])).toBe('FAIL');
  });

  it('lets RISK outrank INDETERMINATE and PASS', () => {
    expect(rollUpStatus(['PASS', 'INDETERMINATE', 'RISK'])).toBe('RISK');
  });

  it('never reports PASS when a rule could not be evaluated', () => {
    expect(rollUpStatus(['PASS', 'PASS', 'INDETERMINATE'])).toBe('INDETERMINATE');
    expect(rollUpStatus(['PASS', 'MANUAL_REVIEW'])).toBe('MANUAL_REVIEW');
  });

  it('reports PASS only when every rule is satisfied', () => {
    expect(rollUpStatus(['PASS', 'PASS', 'NOT_APPLICABLE'])).toBe('PASS');
  });
});
