import { describe, expect, it } from 'vitest';
import { humanizeKey } from './display.js';

describe('humanizeKey', () => {
  it('turns a calculator output name into a heading', () => {
    expect(humanizeKey('shortfallIfUnverifiedClaimsDisallowedByMethod')).toBe(
      'Shortfall if unverified claims disallowed by method',
    );
    expect(humanizeKey('comparisonYear')).toBe('Comparison year');
  });

  it('leaves a defined regulatory term exactly as the rule pack spells it', () => {
    // Rewriting `LOCAL_ONLY` to "Local only" would put a second spelling of a defined term on
    // screen, and a reader reconciling the page against a rule pack needs the pack's own.
    expect(humanizeKey('LOCAL_ONLY')).toBe('LOCAL_ONLY');
    expect(humanizeKey('STATE_AND_LOCAL_PER_CAPITA')).toBe('STATE_AND_LOCAL_PER_CAPITA');
    expect(humanizeKey('MET')).toBe('MET');
  });

  it('handles a snake_case field name', () => {
    expect(humanizeKey('fiscal_year_start')).toBe('Fiscal year start');
  });
});
