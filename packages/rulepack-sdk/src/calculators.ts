/**
 * The calculator allow-list.
 *
 * Spec 8.5. Names are versioned; a change in statutory arithmetic gets a new version
 * rather than an edit, so a historical run can still be reproduced.
 *
 * SCOPE, deliberately narrow. This list holds only the calculators the current release
 * ships rules for. It is not a roadmap. A name sitting here with no rule referencing it is
 * a promise the product has not kept, which is why `calculators.test.ts` fails the build on
 * an orphan — the same standard as the working agreement in CLAUDE.md: no menu items that
 * 404, at the schema level as well as in the interface.
 *
 * Names deferred out of this release are recorded in `docs/roadmap/calculators.md` with
 * what each one blocks. Move a name back here in the same change that adds its
 * implementation and its golden test corpus, never before.
 *
 * IMPLEMENTATION STATUS: none of the three names below is implemented yet. Membership here
 * permits a rule to reference the name; it does not make the rule runnable. A rule whose
 * calculator has no implementation and no golden corpus must not leave `DRAFT`.
 */

export const CALCULATOR_REGISTRY = [
  'idea_moe_eligibility_v1',
  'idea_moe_compliance_v1',
  'idea_excess_cost_v1',
] as const;

export type CalculatorName = (typeof CALCULATOR_REGISTRY)[number];

export const ALLOWED_CALCULATORS: ReadonlySet<string> = new Set(CALCULATOR_REGISTRY);
