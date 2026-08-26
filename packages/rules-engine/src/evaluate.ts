/**
 * The rule DSL evaluator.
 *
 * Spec: Master Technical Buildout sections 8.4 and 8.6. CLAUDE.md invariants 2 and 9.
 *
 * ## Three-valued logic, and why it is not optional
 *
 * A rule evaluated against incomplete data has three possible answers, not two: satisfied,
 * violated, and *unanswerable*. Two-valued logic collapses the third into the second, and a
 * district then reads a FAIL it did not earn — or worse, a rule written as "not (overspend)"
 * collapses it into a PASS, and a district reads an assurance nobody computed.
 *
 * So evaluation is Kleene three-valued. The interesting cases are the ones where an unknown
 * *does not* propagate:
 *
 * - `all` containing a FALSE is FALSE even if a sibling is UNKNOWN. The conjunction is
 *   already decided; the missing datum cannot rescue it.
 * - `any` containing a TRUE is TRUE even if a sibling is UNKNOWN. Same reasoning inverted.
 *
 * That asymmetry is what stops the engine reporting INDETERMINATE for a district whose
 * answer was never in doubt, which is the failure mode that makes an assurance product
 * useless: a wall of "we could not tell" on data that was sufficient.
 *
 * `exists` is the deliberate exception to missing-input tracking. Asking whether a value is
 * present is not the same as needing it, so a bare `exists` on an absent input answers FALSE
 * and records nothing as missing.
 */

import {
  amount,
  compareCalendarDates,
  isAmountString,
  isCalendarDate,
  addDays,
  addMonths,
  addWeeks,
  addYears,
  diffDays,
  diffMonths,
  diffWeeks,
  diffYears,
} from '@complianceos/domain';
import type { CalculatorResult, CalculatorValue } from '@complianceos/calculators';
import type { Calculator } from '@complianceos/calculators';
import type { DateUnit, Expression, Operand } from '@complianceos/rulepack-sdk';

/** Kleene truth value. UNKNOWN means "the data does not decide this", not "false". */
export const TRI = ['TRUE', 'FALSE', 'UNKNOWN'] as const;
export type Tri = (typeof TRI)[number];

export type CalculatorRegistry = ReadonlyMap<string, Calculator>;

export interface EvaluationContext {
  /** The declared inputs, projected from the data snapshot. */
  readonly facts: Readonly<Record<string, CalculatorValue | undefined>>;
  readonly calculators: CalculatorRegistry;
}

/** One calculator invocation, kept so a finding can show which calculation produced it. */
export interface CalculatorInvocation {
  readonly name: string;
  readonly select: string;
  readonly result: CalculatorResult;
}

/**
 * What an evaluation accumulated on its way to an answer.
 *
 * Collected rather than returned per node because the interesting facts — which inputs were
 * missing, which calculators ran — are spread across the tree and all of them belong on the
 * finding.
 */
export class EvaluationTrace {
  readonly #missing = new Set<string>();
  readonly #notes: string[] = [];
  readonly #invocations: CalculatorInvocation[] = [];

  recordMissing(name: string): void {
    this.#missing.add(name);
  }

  note(message: string): void {
    if (!this.#notes.includes(message)) this.#notes.push(message);
  }

  recordInvocation(invocation: CalculatorInvocation): void {
    this.#invocations.push(invocation);
  }

  /** Sorted, so an evaluation hash does not depend on tree walk order. */
  get missingInputs(): readonly string[] {
    return [...this.#missing].sort();
  }

  get notes(): readonly string[] {
    return [...this.#notes];
  }

  get invocations(): readonly CalculatorInvocation[] {
    return [...this.#invocations];
  }
}

/** `undefined` is the unknown value; `null` is a value the district supplied as empty. */
type Value = CalculatorValue | undefined;

function selectPath(result: CalculatorResult, path: string): Value {
  let current: unknown = { status: result.status, output: result.output, steps: result.steps };
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current === undefined ? undefined : (current as CalculatorValue);
}

function evaluateOperand(
  operand: Operand,
  context: EvaluationContext,
  trace: EvaluationTrace,
  options: { readonly recordMissing: boolean },
): Value {
  if ('literal' in operand) return operand.literal;
  if ('literalList' in operand) return operand.literalList;

  if ('input' in operand) {
    const value = context.facts[operand.input];
    if (value === undefined) {
      if (options.recordMissing) trace.recordMissing(operand.input);
      return undefined;
    }
    return value;
  }

  return evaluateExpression(operand.compute, context, trace);
}

const DATE_ADDERS: Record<DateUnit, (base: string, n: number) => string> = {
  days: addDays,
  weeks: addWeeks,
  months: addMonths,
  years: addYears,
};

const DATE_DIFFERS: Record<DateUnit, (from: string, to: string) => number> = {
  days: diffDays,
  weeks: diffWeeks,
  months: diffMonths,
  years: diffYears,
};

/**
 * Evaluate an expression to a value.
 *
 * Boolean-producing nodes return a boolean here; `evaluateBoolean` is the wrapper that turns
 * that into a `Tri`.
 */
export function evaluateExpression(
  expression: Expression,
  context: EvaluationContext,
  trace: EvaluationTrace,
): Value {
  if ('all' in expression || 'any' in expression || 'not' in expression || 'op' in expression) {
    const tri = evaluateBoolean(expression, context, trace);
    return tri === 'UNKNOWN' ? undefined : tri === 'TRUE';
  }

  if ('exists' in expression) {
    const value = evaluateOperand(expression.exists, context, trace, { recordMissing: false });
    return value !== undefined && value !== null;
  }

  if ('within' in expression) {
    const tri = evaluateBoolean(expression, context, trace);
    return tri === 'UNKNOWN' ? undefined : tri === 'TRUE';
  }

  if ('dateAdd' in expression) {
    const base = evaluateOperand(expression.dateAdd.base, context, trace, { recordMissing: true });
    if (typeof base !== 'string' || !isCalendarDate(base)) {
      if (base !== undefined) trace.note(`dateAdd expects a calendar date, got "${String(base)}"`);
      return undefined;
    }
    return DATE_ADDERS[expression.dateAdd.unit](base, expression.dateAdd.amount);
  }

  if ('dateDiff' in expression) {
    const from = evaluateOperand(expression.dateDiff.from, context, trace, { recordMissing: true });
    const to = evaluateOperand(expression.dateDiff.to, context, trace, { recordMissing: true });
    if (typeof from !== 'string' || typeof to !== 'string') return undefined;
    if (!isCalendarDate(from) || !isCalendarDate(to)) {
      trace.note('dateDiff expects two calendar dates');
      return undefined;
    }
    return DATE_DIFFERS[expression.dateDiff.unit](from, to);
  }

  // A calculator invocation. The name has already been checked against the allow-list at
  // publication; an absent registry entry here means the deployed engine is older than the
  // rule pack, which is a deployment fault and must not silently evaluate to anything.
  const { name, inputs, select = 'status' } = expression.calculator;
  const calculator = context.calculators.get(name);
  if (calculator === undefined) {
    trace.note(`calculator "${name}" is not registered in this engine build`);
    return undefined;
  }

  const resolved: Record<string, CalculatorValue | undefined> = {};
  for (const [key, operand] of Object.entries(inputs)) {
    resolved[key] = evaluateOperand(operand, context, trace, { recordMissing: true });
  }

  const result = calculator.run(resolved);
  trace.recordInvocation({ name, select, result });
  for (const missing of result.missingInputs) trace.recordMissing(missing);

  return selectPath(result, select);
}

type Comparison = number | undefined;

/**
 * Order two values.
 *
 * Money arrives as a decimal string and must compare numerically — lexically, "9" exceeds
 * "10". Calendar dates in `YYYY-MM-DD` do sort lexically, but are routed through the date
 * comparison anyway so that a malformed one is caught rather than quietly ordered.
 */
function orderValues(left: Value, right: Value, trace: EvaluationTrace): Comparison {
  if (left === undefined || right === undefined || left === null || right === null)
    return undefined;

  if (typeof left === 'number' && typeof right === 'number') return left - right;

  if (typeof left === 'string' && typeof right === 'string') {
    if (isAmountString(left) && isAmountString(right)) {
      return amount(left).comparedTo(amount(right));
    }

    const leftIsDate = isCalendarDate(left);
    const rightIsDate = isCalendarDate(right);
    if (leftIsDate && rightIsDate) return compareCalendarDates(left, right);

    // Exactly one side is a real date. The other is date-shaped but names no day —
    // `2027-13-45`, or a US-format date that never went through the mapping's date parser.
    // Falling through to the lexical branch would order it confidently ("2027-13-45" sorts
    // after "2027-01-01") and return a TRUE or FALSE built on a date that does not exist.
    if (leftIsDate !== rightIsDate) {
      trace.note(
        `cannot order the calendar date against "${leftIsDate ? right : left}", which is not a ` +
          'calendar date. Fix the mapping that produced it rather than comparing it as text.',
      );
      return undefined;
    }

    return left < right ? -1 : left > right ? 1 : 0;
  }

  // A number against a decimal string is the shape a float-vs-exact bug takes. Refuse it
  // rather than coerce: invariant 5 says amounts are exact, and coercing one side to a
  // double here would undo that at the last step.
  trace.note(
    `cannot order ${typeof left} against ${typeof right} — compare like with like, and keep ` +
      'money as decimal strings on both sides',
  );
  return undefined;
}

function valuesEqual(left: Value, right: Value): boolean | undefined {
  if (left === undefined || right === undefined) return undefined;
  if (left === null || right === null) return left === right;

  if (typeof left === 'string' && typeof right === 'string') {
    if (isAmountString(left) && isAmountString(right)) return amount(left).equals(amount(right));
    return left === right;
  }
  if (typeof left === 'number' && typeof right === 'number') return left === right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return left === right;
  return false;
}

function fromBoolean(value: boolean | undefined): Tri {
  if (value === undefined) return 'UNKNOWN';
  return value ? 'TRUE' : 'FALSE';
}

/** Evaluate an expression in boolean context, under Kleene three-valued logic. */
export function evaluateBoolean(
  expression: Expression,
  context: EvaluationContext,
  trace: EvaluationTrace,
): Tri {
  // Neither connective short-circuits. A district owes the same missing data whether or not
  // one conjunct already settled the question, and reporting the gaps one field per run is
  // how a two-week import becomes a two-month one. Calculators are pure, so evaluating a
  // branch that cannot change the answer costs only time.
  if ('all' in expression) {
    const results = expression.all.map((child) => evaluateBoolean(child, context, trace));
    if (results.includes('FALSE')) return 'FALSE';
    return results.includes('UNKNOWN') ? 'UNKNOWN' : 'TRUE';
  }

  if ('any' in expression) {
    const results = expression.any.map((child) => evaluateBoolean(child, context, trace));
    if (results.includes('TRUE')) return 'TRUE';
    return results.includes('UNKNOWN') ? 'UNKNOWN' : 'FALSE';
  }

  if ('not' in expression) {
    const tri = evaluateBoolean(expression.not, context, trace);
    if (tri === 'UNKNOWN') return 'UNKNOWN';
    return tri === 'TRUE' ? 'FALSE' : 'TRUE';
  }

  if ('exists' in expression) {
    const value = evaluateOperand(expression.exists, context, trace, { recordMissing: false });
    return value !== undefined && value !== null ? 'TRUE' : 'FALSE';
  }

  if ('within' in expression) {
    const value = evaluateOperand(expression.within.value, context, trace, { recordMissing: true });
    const min = evaluateOperand(expression.within.min, context, trace, { recordMissing: true });
    const max = evaluateOperand(expression.within.max, context, trace, { recordMissing: true });
    const lower = orderValues(value, min, trace);
    const upper = orderValues(value, max, trace);
    if (lower === undefined || upper === undefined) return 'UNKNOWN';
    // Regulatory windows are inclusive at both ends unless a rule says otherwise.
    return lower >= 0 && upper <= 0 ? 'TRUE' : 'FALSE';
  }

  if ('op' in expression) {
    const left = evaluateOperand(expression.left, context, trace, { recordMissing: true });
    const right = evaluateOperand(expression.right, context, trace, { recordMissing: true });

    switch (expression.op) {
      case 'eq':
        return fromBoolean(valuesEqual(left, right));
      case 'neq': {
        const equal = valuesEqual(left, right);
        return fromBoolean(equal === undefined ? undefined : !equal);
      }
      case 'in': {
        if (left === undefined || right === undefined) return 'UNKNOWN';
        if (!Array.isArray(right)) {
          trace.note('the right operand of `in` must be a list');
          return 'UNKNOWN';
        }
        return right.some((candidate) => valuesEqual(left, candidate) === true) ? 'TRUE' : 'FALSE';
      }
      default: {
        const order = orderValues(left, right, trace);
        if (order === undefined) return 'UNKNOWN';
        switch (expression.op) {
          case 'gt':
            return order > 0 ? 'TRUE' : 'FALSE';
          case 'gte':
            return order >= 0 ? 'TRUE' : 'FALSE';
          case 'lt':
            return order < 0 ? 'TRUE' : 'FALSE';
          case 'lte':
            return order <= 0 ? 'TRUE' : 'FALSE';
        }
      }
    }
  }

  // dateAdd, dateDiff and calculator are value nodes. Publication validation rejects them as
  // a rule's top-level condition, but they can be reached through `not` in a malformed pack.
  const value = evaluateExpression(expression, context, trace);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  trace.note('a value expression was used where a boolean was required');
  return 'UNKNOWN';
}
