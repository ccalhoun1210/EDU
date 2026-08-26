import { describe, expect, it } from 'vitest';
import {
  ContentHashSchema,
  DecimalStringSchema,
  FiscalYearSchema,
  IsoDateSchema,
  sha256Hex,
} from './primitives.js';

describe('regulatory scalars', () => {
  it('accepts a calendar date and rejects a timestamp (invariant 6)', () => {
    expect(IsoDateSchema.parse('2026-06-30')).toBe('2026-06-30');
    expect(() => IsoDateSchema.parse('2026-06-30T00:00:00Z')).toThrow();
  });

  it('accepts decimal money and rejects formatted or exponent forms (invariant 5)', () => {
    expect(DecimalStringSchema.parse('40218773.42')).toBe('40218773.42');
    expect(() => DecimalStringSchema.parse('4.0218e7')).toThrow();
    expect(() => DecimalStringSchema.parse('$40,218,773.42')).toThrow();
  });

  it('requires fiscal years to be named', () => {
    expect(FiscalYearSchema.parse('FY2026')).toBe('FY2026');
    expect(() => FiscalYearSchema.parse('2026')).toThrow();
  });
});

describe('hashing', () => {
  it('is deterministic', () => {
    expect(sha256Hex('a')).toBe(sha256Hex('a'));
  });

  it('differs on any change', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
  });

  it('produces a digest the schema accepts', () => {
    expect(() => ContentHashSchema.parse(sha256Hex('a'))).not.toThrow();
  });
});
