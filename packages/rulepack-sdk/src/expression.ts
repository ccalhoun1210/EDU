/**
 * The restricted rule DSL.
 *
 * Spec: Master Technical Buildout section 8.4. Rules are declarative data, never executable
 * JavaScript. Anything a rule cannot express with these operators must be implemented as an
 * allow-listed, versioned calculator (section 8.5) that is pure, deterministic, and
 * reviewable on its own.
 *
 * ## Value operands and boolean expressions
 *
 * Section 8.4 lists `date_add`, `date_diff` and `calculator` alongside `gt` and `lte`, which
 * only makes sense if the arithmetic ones can appear *inside* a comparison — "is the
 * evaluation date within 60 days of consent" is `dateDiff(...) <= 60`, not a standalone
 * assertion. An operand may therefore be a nested expression via `compute`, which is what
 * makes the date operators usable at all. The nesting is still pure data: there is no
 * operator here that evaluates a string as code, and there is no escape hatch to add one.
 */

import { z } from 'zod';

export const COMPARISON_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in'] as const;
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

export const DATE_UNITS = ['days', 'weeks', 'months', 'years'] as const;
export type DateUnit = (typeof DATE_UNITS)[number];

/** A leaf value a rule may reference: a named input, a literal, or a nested computation. */
export type Operand =
  | { input: string }
  | { literal: string | number | boolean | null }
  | { literalList: (string | number | boolean)[] }
  | { compute: Expression };

export type Expression =
  | { all: Expression[] }
  | { any: Expression[] }
  | { not: Expression }
  | { exists: Operand }
  | { op: ComparisonOperator; left: Operand; right: Operand }
  | { dateAdd: { base: Operand; amount: number; unit: DateUnit } }
  | { dateDiff: { from: Operand; to: Operand; unit: DateUnit } }
  | { within: { value: Operand; min: Operand; max: Operand } }
  // `select?: string | undefined` rather than `select?: string`: under
  // `exactOptionalPropertyTypes` the hand-written union has to match what Zod infers from
  // `.optional()`, which admits an explicit undefined.
  | { calculator: { name: string; inputs: Record<string, Operand>; select?: string | undefined } };

export const OperandSchema: z.ZodType<Operand> = z.lazy(() =>
  z.union([
    z.object({ input: z.string().min(1) }),
    z.object({ literal: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
    z.object({ literalList: z.array(z.union([z.string(), z.number(), z.boolean()])) }),
    z.object({ compute: ExpressionSchema }),
  ]),
);

export const ExpressionSchema: z.ZodType<Expression> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ExpressionSchema).min(1) }),
    z.object({ any: z.array(ExpressionSchema).min(1) }),
    z.object({ not: ExpressionSchema }),
    z.object({ exists: OperandSchema }),
    z.object({
      op: z.enum(COMPARISON_OPERATORS),
      left: OperandSchema,
      right: OperandSchema,
    }),
    z.object({
      dateAdd: z.object({
        base: OperandSchema,
        amount: z.number().int(),
        unit: z.enum(DATE_UNITS),
      }),
    }),
    z.object({
      dateDiff: z.object({ from: OperandSchema, to: OperandSchema, unit: z.enum(DATE_UNITS) }),
    }),
    z.object({
      within: z.object({ value: OperandSchema, min: OperandSchema, max: OperandSchema }),
    }),
    z.object({
      calculator: z.object({
        name: z.string().min(1),
        inputs: z.record(z.string(), OperandSchema),
        /**
         * Which part of the calculator's result to read: `status`, or a dotted path into its
         * output such as `output.qualifyingMethodCount`. Defaults to `status`.
         */
        select: z.string().min(1).optional(),
      }),
    }),
  ]),
);

/**
 * The node kinds that yield a boolean.
 *
 * A rule's `condition` decides whether the rule is satisfied, so it must produce a boolean. A
 * condition whose top node is `dateAdd` produces a date, which is not an answer to anything —
 * catching that at publication is better than discovering it when a run returns a date where
 * a status belonged.
 */
const BOOLEAN_NODE_KEYS = ['all', 'any', 'not', 'exists', 'op', 'within'] as const;

export function isBooleanExpression(expression: Expression): boolean {
  return BOOLEAN_NODE_KEYS.some((key) => key in expression);
}

/** The operands attached directly to a node — not those belonging to its children. */
function ownOperands(node: Expression): readonly Operand[] {
  if ('all' in node || 'any' in node || 'not' in node) return [];
  if ('exists' in node) return [node.exists];
  if ('op' in node) return [node.left, node.right];
  if ('dateAdd' in node) return [node.dateAdd.base];
  if ('dateDiff' in node) return [node.dateDiff.from, node.dateDiff.to];
  if ('within' in node) return [node.within.value, node.within.min, node.within.max];
  return Object.values(node.calculator.inputs);
}

/**
 * Visit every expression node in a tree, including those reached through a `compute` operand.
 *
 * Both walks below depend on this covering the nested path. A calculator invoked inside a
 * `compute` operand that the walk failed to reach would evade the allow-list check at
 * publication — and that check is the whole of what keeps a rule pack from performing
 * arbitrary named dispatch at evaluation time.
 */
function walk(node: Expression, visit: (node: Expression) => void): void {
  visit(node);

  if ('all' in node) node.all.forEach((child) => walk(child, visit));
  else if ('any' in node) node.any.forEach((child) => walk(child, visit));
  else if ('not' in node) walk(node.not, visit);

  for (const operand of ownOperands(node)) {
    if ('compute' in operand) walk(operand.compute, visit);
  }
}

/** Every input name an expression reads, so a rule's declared inputs can be checked against it. */
export function collectInputs(expression: Expression): Set<string> {
  const found = new Set<string>();
  walk(expression, (node) => {
    for (const operand of ownOperands(node)) {
      if ('input' in operand) found.add(operand.input);
    }
  });
  return found;
}

/** Every calculator an expression invokes, so publication can check the allow-list. */
export function collectCalculators(expression: Expression): Set<string> {
  const found = new Set<string>();
  walk(expression, (node) => {
    if ('calculator' in node) found.add(node.calculator.name);
  });
  return found;
}
