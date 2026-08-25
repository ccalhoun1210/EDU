/**
 * Behavioural tests for exact decimal arithmetic.
 *
 * Spec: Master Technical Buildout section 4. CLAUDE.md invariant 5 — money is never a
 * float, and a rounding artifact in a fiscal finding is a compliance defect. These tests
 * defend the two properties the rest of the platform leans on: that a malformed numeral is
 * refused at the boundary rather than coerced, and that an amount which survives that
 * boundary is arithmetically exact and canonically representable.
 */

import { describe, expect, it } from 'vitest';
import {
  AmountParseError,
  MONEY_DP,
  RATIO_DP,
  ZERO,
  add,
  amount,
  compare,
  count,
  divide,
  formatAmount,
  formatUsd,
  isAmountString,
  isNegative,
  isZero,
  meetsOrExceeds,
  multiply,
  optionalAmount,
  round,
  roundTowardZero,
  subtract,
  sum,
} from './money.js';

describe('amount', () => {
  it('accepts the canonical numeral forms', () => {
    expect(amount('1250').toString()).toBe('1250');
    expect(amount('1250.00').toString()).toBe('1250');
    expect(amount('0').toString()).toBe('0');
    expect(amount('-1250.50').toString()).toBe('-1250.5');
    // Ratios and per-capita figures share this parser, so many places must survive it.
    expect(amount('0.0000000001').toString()).toBe('0.0000000001');
  });

  // Each of these is a form the module comment promises to reject rather than clean up.
  // Cleaning belongs to ingestion, where the transformation is recorded as provenance.
  it.each([
    ['a thousands separator', '1,250.00'],
    ['a currency symbol', '$1250'],
    ['surrounding whitespace', ' 1250 '],
    ['exponent notation', '1.25e3'],
    ['a leading plus', '+1250'],
    ['an empty string', ''],
  ])('rejects %s', (_label, raw) => {
    expect(() => amount(raw)).toThrow(AmountParseError);
  });

  it('rejects a non-string argument rather than coercing it', () => {
    // The signature says string, but the value arrives from JSON at runtime and a number
    // that looks like money is exactly the coercion this module exists to prevent.
    expect(() => amount(1250 as unknown as string)).toThrow(AmountParseError);
    expect(() => amount(null as unknown as string)).toThrow(AmountParseError);
    expect(() => amount(undefined as unknown as string)).toThrow(AmountParseError);
  });

  it('rejects a numeral missing digits on either side of the point', () => {
    expect(() => amount('.5')).toThrow(AmountParseError);
    expect(() => amount('1.')).toThrow(AmountParseError);
  });

  it('carries the offending value on the error for the ingestion validation issue', () => {
    try {
      amount('$1250');
      expect.unreachable('a currency symbol must not parse');
    } catch (error) {
      expect(error).toBeInstanceOf(AmountParseError);
      expect((error as AmountParseError).raw).toBe('$1250');
      expect((error as AmountParseError).name).toBe('AmountParseError');
    }
  });
});

describe('optionalAmount', () => {
  it('treats absent and empty as undefined, not as zero', () => {
    // Invariant 9: missing data must reach the engine as missing, so a rule can return
    // INDETERMINATE. A silent zero would manufacture a PASS or a FAIL.
    expect(optionalAmount(null)).toBeUndefined();
    expect(optionalAmount(undefined)).toBeUndefined();
    expect(optionalAmount('')).toBeUndefined();
  });

  it('still refuses a malformed present value', () => {
    expect(() => optionalAmount(' ')).toThrow(AmountParseError);
    expect(optionalAmount('0')?.toString()).toBe('0');
  });
});

describe('exactness', () => {
  it('adds tenths without the IEEE-754 error that makes 0.1 + 0.2 !== 0.3', () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the defect this module exists to prevent
    expect(formatAmount(add(amount('0.10'), amount('0.20')))).toBe('0.30');
  });

  it('keeps a long addition chain exact where a double drifts', () => {
    let drifting = 0;
    for (let i = 0; i < 10; i += 1) drifting += 0.1;
    expect(drifting).not.toBe(1);

    const chain = sum(Array.from({ length: 10 }, () => amount('0.10')));
    expect(formatAmount(chain)).toBe('1.00');
  });

  it('holds cents exactly at district scale, where double precision frays', () => {
    // Tens of millions with cents is an ordinary IDEA Part B allocation total. In doubles
    // this sum lands on 70370358.25999999; a one-cent drift in an MOE comparison is a
    // finding that should not exist.
    const lines = ['12345678.91', '23456789.12', '34567890.23'].map(amount);
    expect(12345678.91 + 23456789.12 + 34567890.23).not.toBe(70370358.26);
    expect(formatAmount(sum(lines))).toBe('70370358.26');
  });

  it('sums an empty ledger to zero', () => {
    expect(formatAmount(sum([]))).toBe('0.00');
    expect(isZero(ZERO)).toBe(true);
  });

  it('subtracts and multiplies without introducing a fractional cent', () => {
    expect(formatAmount(subtract(amount('1000000.00'), amount('999999.99')))).toBe('0.01');
    expect(formatAmount(multiply(amount('1234.56'), count(3)))).toBe('3703.68');
  });
});

describe('divide', () => {
  it('returns undefined on a zero divisor and never NaN or Infinity', () => {
    // A calculator turns undefined into INDETERMINATE with a stated reason. Infinity or
    // NaN would propagate into a finding.
    expect(divide(amount('1250.00'), ZERO, MONEY_DP)).toBeUndefined();
    expect(divide(ZERO, ZERO, MONEY_DP)).toBeUndefined();
    expect(divide(amount('-1250.00'), amount('0.00'), RATIO_DP)).toBeUndefined();
  });

  it('produces a finite result for every non-zero divisor', () => {
    const quotient = divide(amount('9876543.21'), count(1234), MONEY_DP);
    expect(quotient).toBeDefined();
    expect(quotient?.isFinite()).toBe(true);
    expect(quotient?.isNaN()).toBe(false);
    expect(formatAmount(quotient ?? ZERO)).toBe('8003.68');
  });

  it('lets dp govern the rounding rather than a module default', () => {
    expect(divide(amount('1'), amount('8'), 3)?.toString()).toBe('0.125');
    expect(divide(amount('1'), amount('8'), 2)?.toString()).toBe('0.13');
    expect(divide(amount('1'), amount('8'), 0)?.toString()).toBe('0');
    expect(divide(amount('1'), amount('3'), RATIO_DP)?.toString()).toBe('0.3333333333');
  });

  it('rounds half away from zero at an exact .5', () => {
    // 1/8 is exactly 0.125, so dp=2 is a true half case rather than a floating artifact.
    expect(divide(amount('1'), amount('8'), 2)?.toString()).toBe('0.13');
    expect(divide(amount('-1'), amount('8'), 2)?.toString()).toBe('-0.13');
    expect(divide(amount('3'), amount('2'), 0)?.toString()).toBe('2');
    expect(divide(amount('-3'), amount('2'), 0)?.toString()).toBe('-2');
  });
});

describe('round', () => {
  it('rounds half away from zero symmetrically', () => {
    expect(round(amount('2.345'), 2).toString()).toBe('2.35');
    expect(round(amount('-2.345'), 2).toString()).toBe('-2.35');
    expect(round(amount('2.344'), 2).toString()).toBe('2.34');
  });
});

describe('roundTowardZero', () => {
  it('never rounds a magnitude up, in either direction', () => {
    // A ceiling rounded to nearest can authorise a fraction of a cent the regulation does
    // not. Toward zero is the only direction that cannot.
    expect(roundTowardZero(amount('2.349'), 2).toString()).toBe('2.34');
    expect(roundTowardZero(amount('2.345'), 2).toString()).toBe('2.34');
    expect(roundTowardZero(amount('-2.349'), 2).toString()).toBe('-2.34');
  });

  it('leaves a value already at dp untouched', () => {
    expect(roundTowardZero(amount('150000.00'), 2).toString()).toBe('150000');
    expect(formatAmount(roundTowardZero(amount('150000.00'), 2))).toBe('150000.00');
  });
});

describe('formatAmount', () => {
  it('gives one canonical string to values that denote the same amount', () => {
    // This is what makes a snapshot hash reproducible: "1250" and "1250.00" describe the
    // same fiscal reality and must not hash two ways.
    expect(formatAmount(amount('1250'))).toBe(formatAmount(amount('1250.00')));
    expect(formatAmount(amount('1250'))).toBe('1250.00');
    expect(formatAmount(amount('0'))).toBe('0.00');
    expect(formatAmount(amount('-0.00'))).toBe('0.00');
  });

  it('emits a rounded-away zero unsigned', () => {
    // -0.001 at two places is zero. Rendering it "-0.00" would put a minus sign in front of
    // nothing and give one fiscal reality two spellings inside a content hash.
    expect(formatAmount(amount('-0.001'))).toBe('0.00');
    expect(formatAmount(amount('-0.0000001'), 6)).toBe('0.000000');
    expect(formatAmount(amount('-0.004'))).toBe('0.00');
    // A magnitude that survives the rounding keeps its sign.
    expect(formatAmount(amount('-0.005'))).toBe('-0.01');
  });

  it('is idempotent, so a stored amount re-read formats identically', () => {
    const once = formatAmount(amount('1250.005'));
    expect(formatAmount(amount(once))).toBe(once);
  });

  it('honours an explicit dp for ratios', () => {
    expect(formatAmount(amount('0.5'), RATIO_DP)).toBe('0.5000000000');
    expect(formatAmount(amount('1250.567'), 0)).toBe('1251');
  });

  it('never emits exponent notation at either extreme of the platform range', () => {
    expect(formatAmount(amount('999999999999.99'))).toBe('999999999999.99');
    expect(formatAmount(amount('0.0000000001'), RATIO_DP)).toBe('0.0000000001');
  });
});

describe('formatUsd', () => {
  it('groups thousands and millions', () => {
    expect(formatUsd(amount('1250'))).toBe('$1,250.00');
    expect(formatUsd(amount('12345678.91'))).toBe('$12,345,678.91');
    expect(formatUsd(amount('999.99'))).toBe('$999.99');
  });

  it('puts the sign outside the currency symbol for a negative amount', () => {
    expect(formatUsd(amount('-1250.50'))).toBe('-$1,250.50');
    expect(formatUsd(amount('-12345678.91'))).toBe('-$12,345,678.91');
  });

  it('renders an amount below one dollar with a leading zero', () => {
    expect(formatUsd(amount('0.07'))).toBe('$0.07');
    expect(formatUsd(amount('0'))).toBe('$0.00');
  });

  it('drops the fraction when dp is zero', () => {
    expect(formatUsd(amount('1234567'), 0)).toBe('$1,234,567');
  });

  // A negative amount smaller than half a cent must not render as "-$0.00": a minus sign in
  // front of nothing, on a screen where a district is deciding whether it has a shortfall.
  it('renders a negative amount that rounds to zero as $0.00, without a sign', () => {
    expect(formatUsd(amount('-0.001'))).toBe('$0.00');
    expect(formatUsd(amount('-0.004'))).toBe('$0.00');
    // Half a cent still rounds away from zero, so the sign is real there.
    expect(formatUsd(amount('-0.005'))).toBe('-$0.01');
    expect(formatUsd(amount('-0.4'), 0)).toBe('$0');
  });
});

describe('count', () => {
  it('lifts a whole child count into exact arithmetic', () => {
    expect(count(0).toString()).toBe('0');
    expect(count(1234).toString()).toBe('1234');
    expect(count(Number.MAX_SAFE_INTEGER).toString()).toBe(String(Number.MAX_SAFE_INTEGER));
  });

  it('rejects a non-integer count', () => {
    expect(() => count(1.5)).toThrow(AmountParseError);
    expect(() => count(0.1)).toThrow(AmountParseError);
  });

  it('rejects a negative count', () => {
    // A child count below zero is a broken extraction, not a small number.
    expect(() => count(-1)).toThrow(/cannot be negative/);
  });

  it('rejects an unsafe integer', () => {
    // Beyond 2^53 a JavaScript number has already lost the value; accepting it would make
    // the exactness guarantee a lie about data that arrived wrong.
    expect(() => count(Number.MAX_SAFE_INTEGER + 2)).toThrow(AmountParseError);
    expect(() => count(Number.NaN)).toThrow(AmountParseError);
    expect(() => count(Number.POSITIVE_INFINITY)).toThrow(AmountParseError);
  });

  // An error whose whole job is to tell the caller what they handed us has to name the
  // thing they handed us. JSON.stringify renders NaN and Infinity as "null".
  it('names NaN in the parse error message rather than reporting null', () => {
    expect(() => count(Number.NaN)).toThrow(/NaN/);
    expect(() => count(Number.POSITIVE_INFINITY)).toThrow(/Infinity/);
    expect(() => count(Number.NaN)).not.toThrow(/null/);
  });
});

describe('comparison', () => {
  it('treats a threshold as inclusive at exact equality', () => {
    // Statutory thresholds are written "at least", so equality satisfies them.
    expect(meetsOrExceeds(amount('1000.00'), amount('1000'))).toBe(true);
    expect(meetsOrExceeds(amount('1000.01'), amount('1000.00'))).toBe(true);
    expect(meetsOrExceeds(amount('999.99'), amount('1000.00'))).toBe(false);
  });

  it('orders amounts by value, not by written form', () => {
    expect(compare(amount('1000.00'), amount('1000'))).toBe(0);
    expect(compare(amount('999.99'), amount('1000'))).toBeLessThan(0);
    expect(compare(amount('1000.01'), amount('1000'))).toBeGreaterThan(0);
  });

  it('does not call negative zero a negative amount', () => {
    expect(isNegative(amount('-0.00'))).toBe(false);
    expect(isNegative(amount('-0.01'))).toBe(true);
    expect(isZero(amount('-0.00'))).toBe(true);
  });
});

describe('isAmountString', () => {
  it('accepts exactly what amount() accepts', () => {
    expect(isAmountString('1250.00')).toBe(true);
    expect(isAmountString('-1250')).toBe(true);
    expect(isAmountString('1,250.00')).toBe(false);
    expect(isAmountString('')).toBe(false);
    expect(isAmountString(1250)).toBe(false);
    expect(isAmountString(null)).toBe(false);
  });
});
