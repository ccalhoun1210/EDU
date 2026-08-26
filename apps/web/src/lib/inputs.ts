import { calculatorFor, type CalculatorInputSpec } from '@complianceos/calculators';

const EMPTY: ReadonlyMap<string, CalculatorInputSpec> = new Map();

/**
 * What each declared input means, keyed by name.
 *
 * A finding screen that prints `most_recent_available_year_moe_status` and stops has told a
 * business officer nothing they can act on. The calculator already carries a definition for
 * every input it reads, written for exactly this audience, so the screen shows that rather
 * than inventing wording of its own — which would be a second, drifting description of a
 * regulatory input, maintained in a page component.
 *
 * A rule whose arithmetic is not yet written has no calculator and therefore no definitions.
 * Then the raw name is all there is, and the screen says so rather than guessing.
 */
export function inputSpecs(
  calculator: string | undefined,
): ReadonlyMap<string, CalculatorInputSpec> {
  if (calculator === undefined) return EMPTY;
  const implementation = calculatorFor(calculator);
  if (implementation === undefined) return EMPTY;
  return new Map(implementation.inputs.map((input) => [input.name, input]));
}
