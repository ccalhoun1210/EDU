/**
 * The calculator contract.
 *
 * Spec: Master Technical Buildout sections 8.5 and 8.7. CLAUDE.md invariants 1, 2, 5 and 9.
 *
 * A calculator is where statutory arithmetic lives. The restricted rule DSL deliberately
 * cannot express it, so anything a regulation actually computes — a maintenance-of-effort
 * comparison, an excess-cost per-pupil average, a risk ratio — arrives here instead, as a
 * pure function that is versioned, allow-listed and independently testable.
 *
 * Three properties are load-bearing:
 *
 * **Purity.** Object in, object out. No network, no database, no clock, no randomness. A
 * finalized run must reproduce byte-for-byte years later (section 2.5), which is impossible
 * if a calculator can read `Date.now()`. `determinism.test.ts` enforces this by inspection
 * rather than by trust.
 *
 * **Exposed intermediates.** Section 35 requires that calculation intermediates are visible,
 * and section 40 requires that every material conclusion has a "Why". A calculator therefore
 * returns an ordered list of named steps, each carrying the citation it derives from and the
 * declared inputs it consumed. The finding-detail screen is rendered from that list; it is
 * not a debug log, it is the product.
 *
 * **Honest absence.** A missing input yields INDETERMINATE with the missing names, never a
 * default of zero. `InputReader` exists so that every calculator tracks absence the same way
 * — a zero substituted for an absent expenditure figure is how a district gets told it
 * passed a test that was never run.
 */

import type { DataClassification, EvaluationStatus } from '@complianceos/domain';
import { amount, count as toCount, type Amount } from '@complianceos/domain';
import type { CalculatorName } from '@complianceos/rulepack-sdk';

/** A value as it arrives from a canonical fact. Money and ratios are decimal strings. */
export type CalculatorScalar = string | number | boolean | null;

export type CalculatorValue =
  CalculatorScalar | readonly CalculatorValue[] | { readonly [key: string]: CalculatorValue };

export type CalculatorInputs = Readonly<Record<string, CalculatorValue | undefined>>;

/**
 * The shape of a calculator's output object.
 *
 * A property may be absent, which is how a calculator declines to report a quantity it never
 * computes — an eligibility result carries no repayment bounds at all, rather than carrying
 * them as `null`, which would read as "a liability was computed and came out at nothing".
 * `canonicalize()` drops an undefined property rather than encoding it, so an optional field
 * cannot change an evaluation hash by being absent in one run and present in the next.
 */
export type CalculatorOutput = { readonly [key: string]: CalculatorValue | undefined };

/** The unit a step's value is expressed in, so the UI can format without guessing. */
export const STEP_UNITS = [
  'USD',
  'USD_PER_CHILD',
  'COUNT',
  'RATIO',
  'PERCENT',
  'DATE',
  'BOOLEAN',
  'TEXT',
] as const;

export type StepUnit = (typeof STEP_UNITS)[number];

/**
 * Decimal places for a per-child amount.
 *
 * Six rather than two because a per-capita level is a quotient, not money: a district with
 * a thousand children and a dollar of difference is four decimal places away from its
 * neighbour, and a display rounded to cents would show two different levels as one figure.
 * The comparison itself never touches this form — it is cross-multiplied — so the precision
 * chosen here cannot decide a case.
 */
export const PER_CHILD_DP = 6;

/**
 * One line of the shown work.
 *
 * `detail` carries the arithmetic in words — "5,250,000.00 − 84,231.00" — because a district
 * business officer checking a figure against their ledger needs the operands, not just the
 * result. `inputsUsed` names the declared inputs the step consumed, which is what lets the
 * finding-detail screen walk from a number on the page back to the source file and row it
 * came from.
 */
export interface CalculationStep {
  readonly key: string;
  readonly label: string;
  /**
   * Canonical string form, fixed to the number of places `unit` prescribes: `USD` two,
   * `USD_PER_CHILD` six, `RATIO` ten, `COUNT` none. A quantity is rounded to that form once,
   * for display, and never re-read as an operand — two per-child levels differing in the
   * seventh place render as the same string.
   */
  readonly value: string;
  readonly unit: StepUnit;
  readonly citation?: string;
  readonly detail?: string;
  readonly inputsUsed?: readonly string[];
}

export const WARNING_SEVERITIES = ['INFO', 'WARNING', 'BLOCKING'] as const;
export type WarningSeverity = (typeof WARNING_SEVERITIES)[number];

/**
 * Something a reviewer must know that is not the result itself.
 *
 * A BLOCKING warning means the arithmetic ran but its premise is unsound — a claimed
 * exception that names no statutory ground, a comparison year that is not prior. These
 * accompany MANUAL_REVIEW, never a PASS.
 */
export interface CalculatorWarning {
  readonly code: string;
  readonly message: string;
  readonly severity: WarningSeverity;
  readonly citation?: string;
}

export interface CalculatorResult<TOutput extends CalculatorOutput = CalculatorOutput> {
  readonly status: EvaluationStatus;
  /** Declared inputs that were absent and that the result depended on. */
  readonly missingInputs: readonly string[];
  readonly warnings: readonly CalculatorWarning[];
  readonly steps: readonly CalculationStep[];
  readonly output: TOutput;
}

export interface CalculatorInputSpec {
  readonly name: string;
  /** `string` is an opaque reference — a run id, an evidence reference — never free text. */
  readonly type: 'money' | 'count' | 'date' | 'enum' | 'boolean' | 'string' | 'list' | 'object';
  readonly required: boolean;
  readonly classification: DataClassification;
  readonly definition: string;
}

export interface Calculator<TOutput extends CalculatorOutput = CalculatorOutput> {
  readonly name: CalculatorName;
  readonly title: string;
  /** Every provision this calculator implements. Rendered on the finding-detail screen. */
  readonly authority: readonly string[];
  readonly inputs: readonly CalculatorInputSpec[];
  run(inputs: CalculatorInputs): CalculatorResult<TOutput>;
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads declared inputs, recording every absent or malformed one.
 *
 * The reader accumulates rather than throwing so a calculator can report *all* the data a
 * district still owes in one pass. A district told "you are missing the prior-year local
 * expenditure" three times in three runs, when four figures were missing all along, will
 * reasonably conclude the platform is wasting their time.
 *
 * A malformed value is recorded separately from an absent one. They are different problems:
 * absence is a gap in the district's export, malformation is a bug in the mapping.
 */
export class InputReader {
  readonly #inputs: CalculatorInputs;
  readonly #missing = new Set<string>();
  readonly #malformed = new Map<string, string>();

  constructor(inputs: CalculatorInputs) {
    this.#inputs = inputs;
  }

  /** Present and non-null. An explicit null is treated as absent — the district has no value. */
  has(name: string): boolean {
    const value = this.#inputs[name];
    return value !== undefined && value !== null && value !== '';
  }

  raw(name: string): CalculatorValue | undefined {
    const value = this.#inputs[name];
    return value === null ? undefined : value;
  }

  money(name: string): Amount | undefined {
    const value = this.raw(name);
    if (value === undefined || value === '') {
      this.#missing.add(name);
      return undefined;
    }
    if (typeof value !== 'string') {
      this.#malformed.set(name, 'money must arrive as a decimal string, never a number');
      return undefined;
    }
    try {
      return amount(value);
    } catch {
      this.#malformed.set(name, `"${value}" is not a plain decimal numeral`);
      return undefined;
    }
  }

  count(name: string): number | undefined {
    const value = this.raw(name);
    if (value === undefined || value === '') {
      this.#missing.add(name);
      return undefined;
    }
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(numeric) || numeric < 0) {
      this.#malformed.set(name, `"${String(value)}" is not a non-negative whole count`);
      return undefined;
    }
    return numeric;
  }

  /** A count lifted into exact arithmetic, for use as a divisor or multiplicand. */
  countAmount(name: string): Amount | undefined {
    const value = this.count(name);
    return value === undefined ? undefined : toCount(value);
  }

  /** Invariant 6: a regulatory date is a `YYYY-MM-DD` calendar date. */
  date(name: string): string | undefined {
    const value = this.raw(name);
    if (value === undefined || value === '') {
      this.#missing.add(name);
      return undefined;
    }
    if (typeof value !== 'string' || !CALENDAR_DATE.test(value)) {
      this.#malformed.set(name, `"${String(value)}" is not a YYYY-MM-DD calendar date`);
      return undefined;
    }
    return value;
  }

  boolean(name: string): boolean | undefined {
    const value = this.raw(name);
    if (value === undefined) {
      this.#missing.add(name);
      return undefined;
    }
    if (typeof value !== 'boolean') {
      this.#malformed.set(name, `"${String(value)}" is not a boolean`);
      return undefined;
    }
    return value;
  }

  enumValue<T extends string>(name: string, permitted: readonly T[]): T | undefined {
    const value = this.raw(name);
    if (value === undefined || value === '') {
      this.#missing.add(name);
      return undefined;
    }
    if (typeof value !== 'string' || !permitted.includes(value as T)) {
      this.#malformed.set(name, `"${String(value)}" is not one of ${permitted.join(', ')}`);
      return undefined;
    }
    return value as T;
  }

  list(name: string): readonly CalculatorValue[] | undefined {
    const value = this.raw(name);
    if (value === undefined) {
      this.#missing.add(name);
      return undefined;
    }
    if (!Array.isArray(value)) {
      this.#malformed.set(name, 'expected a list');
      return undefined;
    }
    return value;
  }

  /** Sorted so that a result — and therefore its evaluation hash — is order-stable. */
  get missing(): readonly string[] {
    return [...this.#missing].sort();
  }

  get malformed(): readonly { readonly name: string; readonly reason: string }[] {
    return [...this.#malformed]
      .map(([name, reason]) => ({ name, reason }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  get hasProblems(): boolean {
    return this.#missing.size > 0 || this.#malformed.size > 0;
  }

  /** Malformed inputs rendered as warnings, for a result that reports them alongside gaps. */
  malformedWarnings(): readonly CalculatorWarning[] {
    return this.malformed.map(({ name, reason }) => ({
      code: 'MALFORMED_INPUT',
      message: `${name}: ${reason}`,
      severity: 'BLOCKING' as const,
    }));
  }
}

/** The result shape for a calculation that could not run because data was missing. */
export function indeterminate<TOutput extends CalculatorOutput>(
  reader: InputReader,
  output: TOutput,
  steps: readonly CalculationStep[] = [],
  extraWarnings: readonly CalculatorWarning[] = [],
): CalculatorResult<TOutput> {
  return {
    status: 'INDETERMINATE',
    missingInputs: reader.missing,
    warnings: [...reader.malformedWarnings(), ...extraWarnings],
    steps,
    output,
  };
}

/** A step builder that keeps the optional fields out of the object when they are absent. */
export function step(
  key: string,
  label: string,
  value: string,
  unit: StepUnit,
  extras: {
    readonly citation?: string;
    readonly detail?: string;
    readonly inputsUsed?: readonly string[];
  } = {},
): CalculationStep {
  return {
    key,
    label,
    value,
    unit,
    ...(extras.citation === undefined ? {} : { citation: extras.citation }),
    ...(extras.detail === undefined ? {} : { detail: extras.detail }),
    ...(extras.inputsUsed === undefined ? {} : { inputsUsed: extras.inputsUsed }),
  };
}
