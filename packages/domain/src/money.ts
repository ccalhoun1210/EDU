/**
 * Exact decimal arithmetic for money, counts and ratios.
 *
 * Spec: Master Technical Buildout section 4. CLAUDE.md invariant 5. A rounding artifact in
 * a fiscal finding is a compliance defect, so nothing in this platform computes money with
 * IEEE-754 doubles. `parseFloat` is banned by ESLint; this module is what replaces it.
 *
 * The canonical representation of an amount, everywhere it crosses a boundary — database
 * column, JSON payload, rule-pack YAML, golden test corpus — is a plain decimal numeral
 * *string*. It becomes an `Amount` only for the duration of a calculation. That keeps the
 * wire format free of binary floating point and makes a snapshot hash stable.
 */

import { Decimal } from 'decimal.js';

/**
 * A private Decimal constructor. Cloned rather than configured globally: a library that
 * mutates shared global precision would silently change arithmetic for every consumer.
 *
 * 34 significant digits is far more than district finance needs and leaves room for
 * intermediate products (an amount multiplied by a child count) without loss.
 */
const Num = Decimal.clone({
  defaults: true,
  precision: 34,
  rounding: Decimal.ROUND_HALF_UP,
  // Never switch to exponential notation in any range this platform will see, so
  // `toString()` is always a readable numeral.
  toExpNeg: -1_000_000_000,
  toExpPos: 1_000_000_000,
});

/** An exact decimal value. Money, a per-capita amount, or a ratio. */
export type Amount = Decimal;

/** Cents. Money is presented and stored to two places unless a caller says otherwise. */
export const MONEY_DP = 2;

/**
 * Ratios are carried to ten places. Deliberately more than anyone displays: a risk ratio
 * or a proportionate share is rounded for presentation, never before a comparison against
 * a regulatory threshold.
 */
export const RATIO_DP = 10;

/** A plain decimal numeral. No exponent, no separators, no leading `+`, no whitespace. */
const DECIMAL_NUMERAL = /^-?\d+(\.\d+)?$/;

/**
 * Render a rejected value for an error message.
 *
 * Not `JSON.stringify`: it renders NaN and Infinity as `null`, so an error about a NaN
 * count would name a value the caller never passed. When the whole point of the error is to
 * tell someone what they handed us, it has to be the thing they handed us.
 */
function describeRaw(raw: unknown): string {
  if (typeof raw === 'number' || typeof raw === 'bigint') return String(raw);
  if (raw === undefined) return 'undefined';
  try {
    return JSON.stringify(raw) ?? String(raw);
  } catch {
    return Object.prototype.toString.call(raw);
  }
}

export class AmountParseError extends Error {
  constructor(
    readonly raw: unknown,
    reason: string,
  ) {
    super(`Cannot read ${describeRaw(raw)} as an exact amount: ${reason}`);
    this.name = 'AmountParseError';
  }
}

/**
 * Read a canonical decimal string.
 *
 * Strict on purpose. `"1,250.00"`, `"$1250"`, `" 1250 "` and `"1.25e3"` are all rejected
 * here rather than coerced, because coercion is how a currency-parsing bug becomes a
 * finding. Cleaning raw district input into this form is the ingestion layer's job, where
 * the transformation is recorded as provenance and a failure becomes a validation issue.
 */
export function amount(raw: string): Amount {
  if (typeof raw !== 'string') throw new AmountParseError(raw, 'expected a string');
  if (!DECIMAL_NUMERAL.test(raw)) {
    throw new AmountParseError(raw, 'expected a plain decimal numeral such as "1250.00"');
  }
  return new Num(raw);
}

/** Read a decimal string, or return undefined when the value is absent. */
export function optionalAmount(raw: string | null | undefined): Amount | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  return amount(raw);
}

/** Lift a whole-number count (a child count, an enrollment) into exact arithmetic. */
export function count(value: number): Amount {
  if (!Number.isSafeInteger(value)) {
    throw new AmountParseError(value, 'a count must be a safe integer');
  }
  if (value < 0) throw new AmountParseError(value, 'a count cannot be negative');
  return new Num(value);
}

export const ZERO: Amount = new Num(0);

export function add(a: Amount, b: Amount): Amount {
  return a.plus(b);
}

export function subtract(a: Amount, b: Amount): Amount {
  return a.minus(b);
}

export function multiply(a: Amount, b: Amount): Amount {
  return a.times(b);
}

/**
 * Divide, rounding the result to `dp` places.
 *
 * `dp` is required rather than defaulted. Division is the only operation here that can
 * lose information, so the precision policy is a decision the caller states explicitly and
 * a reviewer can see — a per-capita expenditure and a risk ratio do not round alike.
 *
 * Returns undefined for division by zero. A calculator turns that into INDETERMINATE with
 * a stated reason; it must never surface as Infinity or NaN.
 */
export function divide(a: Amount, b: Amount, dp: number): Amount | undefined {
  if (b.isZero()) return undefined;
  return a.dividedBy(b).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
}

export function sum(values: readonly Amount[]): Amount {
  return values.reduce<Amount>((total, value) => total.plus(value), ZERO);
}

/** Negative when a < b, zero when equal, positive when a > b. */
export function compare(a: Amount, b: Amount): number {
  return a.comparedTo(b);
}

export function isNegative(value: Amount): boolean {
  return value.isNegative() && !value.isZero();
}

export function isZero(value: Amount): boolean {
  return value.isZero();
}

/** Greater than or equal. Named because statutory thresholds are usually inclusive. */
export function meetsOrExceeds(value: Amount, threshold: Amount): boolean {
  return value.comparedTo(threshold) >= 0;
}

/** Round to `dp` places, half away from zero. */
export function round(value: Amount, dp: number): Amount {
  return value.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
}

/**
 * Canonical string form. This is what gets stored, hashed and compared.
 *
 * Fixed to `dp` places so that "1250" and "1250.00" cannot both appear in a snapshot and
 * produce two different hashes for the same fiscal reality.
 */
export function formatAmount(value: Amount, dp: number = MONEY_DP): string {
  return value.toFixed(dp, Decimal.ROUND_HALF_UP);
}

/** Presentation only. Never store, hash or compare this form. */
export function formatUsd(value: Amount, dp: number = MONEY_DP): string {
  // Round first, then read the sign. Taking the sign from the unrounded value renders an
  // amount smaller than half a cent as "-$0.00" — a minus sign in front of nothing, on a
  // screen where a district is deciding whether it has a shortfall.
  const rounded = round(value, dp);
  const negative = isNegative(rounded);
  const digits = formatAmount(negative ? rounded.negated() : rounded, dp);
  const [whole = '0', fraction] = digits.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = fraction === undefined ? `$${grouped}` : `$${grouped}.${fraction}`;
  return negative ? `-${body}` : body;
}

/** True when a string is already in canonical amount form. */
export function isAmountString(raw: unknown): raw is string {
  return typeof raw === 'string' && DECIMAL_NUMERAL.test(raw);
}
