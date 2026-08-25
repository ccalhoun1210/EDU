/**
 * The restricted rule DSL.
 *
 * Spec: Master Technical Buildout section 8.4. Rules are declarative data, never
 * executable JavaScript. Anything a rule cannot express with these operators must be
 * implemented as an allow-listed, versioned calculator (section 8.5) that is pure,
 * deterministic, and reviewable on its own.
 */

import { z } from 'zod';

/** A leaf value a rule may reference: a named input, or a literal. */
export const OperandSchema = z.union([
  z.object({ input: z.string().min(1) }),
  z.object({ literal: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
  z.object({ literalList: z.array(z.union([z.string(), z.number(), z.boolean()])) }),
]);

export type Operand = z.infer<typeof OperandSchema>;

export const COMPARISON_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in'] as const;
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

export const DATE_UNITS = ['days', 'weeks', 'months', 'years'] as const;
export type DateUnit = (typeof DATE_UNITS)[number];

export type Expression =
  | { all: Expression[] }
  | { any: Expression[] }
  | { not: Expression }
  | { exists: Operand }
  | { op: ComparisonOperator; left: Operand; right: Operand }
  | { dateAdd: { base: Operand; amount: number; unit: DateUnit } }
  | { dateDiff: { from: Operand; to: Operand; unit: DateUnit } }
  | { within: { value: Operand; min: Operand; max: Operand } }
  | { calculator: { name: string; inputs: Record<string, Operand> } };

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
      }),
    }),
  ]),
);

/** Every input name an expression reads, so a rule's declared inputs can be checked against it. */
export function collectInputs(expression: Expression): Set<string> {
  const found = new Set<string>();

  const visitOperand = (operand: Operand): void => {
    if ('input' in operand) found.add(operand.input);
  };

  const visit = (node: Expression): void => {
    if ('all' in node) node.all.forEach(visit);
    else if ('any' in node) node.any.forEach(visit);
    else if ('not' in node) visit(node.not);
    else if ('exists' in node) visitOperand(node.exists);
    else if ('op' in node) {
      visitOperand(node.left);
      visitOperand(node.right);
    } else if ('dateAdd' in node) visitOperand(node.dateAdd.base);
    else if ('dateDiff' in node) {
      visitOperand(node.dateDiff.from);
      visitOperand(node.dateDiff.to);
    } else if ('within' in node) {
      visitOperand(node.within.value);
      visitOperand(node.within.min);
      visitOperand(node.within.max);
    } else {
      Object.values(node.calculator.inputs).forEach(visitOperand);
    }
  };

  visit(expression);
  return found;
}

/** Every calculator an expression invokes, so publication can check the allow-list. */
export function collectCalculators(expression: Expression): Set<string> {
  const found = new Set<string>();

  const visit = (node: Expression): void => {
    if ('all' in node) node.all.forEach(visit);
    else if ('any' in node) node.any.forEach(visit);
    else if ('not' in node) visit(node.not);
    else if ('calculator' in node) found.add(node.calculator.name);
  };

  visit(expression);
  return found;
}
