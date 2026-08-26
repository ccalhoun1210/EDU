/**
 * Monitoring instruments and their indicators.
 *
 * A state monitoring instrument — Georgia's Cross-Functional Monitoring document, for
 * example — is the list of numbered things a district is actually scored against, issued
 * annually by the state agency. It is the vocabulary the customer already uses: a director
 * does not ask whether IDEA-EXCESS-COST-001 passed, they ask whether 18.2 will be Met.
 *
 * Instruments are content, not code, for the same reasons rule packs are (ADR 0003). They
 * change on the state's schedule, a district must be able to see the version they were
 * monitored against, and a domain reviewer has to be able to read one without reading
 * TypeScript.
 */

import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { AuthoritySchema, EffectiveWindowSchema, IsoDateSchema } from './primitives.js';

/**
 * The scoring vocabulary the state actually uses. Georgia's CFM report records exactly
 * three values per indicator; we do not invent a fourth.
 */
export const INDICATOR_RESULTS = ['MET', 'NOT_MET', 'NOT_APPLICABLE'] as const;

export type IndicatorResult = (typeof INDICATOR_RESULTS)[number];

export const IndicatorSchema = z.object({
  /** The state's own identifier, e.g. "18.2". Never renumbered by us. */
  indicatorId: z
    .string()
    .regex(/^\d+\.\d+$/, 'Indicator ids follow the state numbering, e.g. 18.2'),
  title: z.string().min(1),
  /** What the district must be able to show. Written in the state's language where possible. */
  requirement: z.string().min(1),
  authority: AuthoritySchema.nullable().default(null),
  /**
   * Rules whose workpapers stand as evidence for this indicator. Empty means the indicator
   * is satisfied by narrative and documents alone — which is the common case, and is why
   * the calculator cannot be the whole product.
   */
  satisfiedByRules: z.array(z.string().min(1)).default([]),
  /** True when a human statement is required even if every rule passes. */
  requiresNarrative: z.boolean().default(false),
  /** True when the indicator only applies in some years or to some districts. */
  conditional: z.boolean().default(false),
});

export type Indicator = z.infer<typeof IndicatorSchema>;

export const SectionSchema = z.object({
  /** The state's section number, e.g. "18". Sections are not sequential in the source. */
  sectionNumber: z.string().regex(/^\d+$/, 'Section numbers are the state’s own, e.g. 18'),
  title: z.string().min(1),
  indicators: z.array(IndicatorSchema).min(1),
});

export type Section = z.infer<typeof SectionSchema>;

export const InstrumentSchema = z
  .object({
    instrumentId: z.string().min(1),
    /** The state's edition, e.g. "FY2025". Instruments are reissued, not amended. */
    version: z.string().min(1),
    jurisdiction: z.string().min(1),
    issuingAgency: z.string().min(1),
    sourceUrl: z.url().optional(),
    effective: EffectiveWindowSchema,
    /** Cycle length in years, or null where the state does not publish one. */
    monitoringCycleYears: z.number().int().positive().nullable().default(null),
    description: z.string().min(1),
    sections: z.array(SectionSchema).min(1),
  })
  .refine((i) => i.effective.end === null || i.effective.end >= i.effective.start, {
    message: 'effective.end must not precede effective.start',
  })
  .refine(
    (i) => {
      const ids = i.sections.flatMap((s) => s.indicators.map((ind) => ind.indicatorId));
      return new Set(ids).size === ids.length;
    },
    { message: 'indicator ids must be unique within an instrument' },
  )
  .refine(
    (i) =>
      i.sections.every((s) =>
        s.indicators.every((ind) => ind.indicatorId.startsWith(`${s.sectionNumber}.`)),
      ),
    { message: 'each indicator id must be prefixed with its section number' },
  );

export type Instrument = z.infer<typeof InstrumentSchema>;

export class InstrumentValidationError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(`${file}: ${message}`);
    this.name = 'InstrumentValidationError';
  }
}

function issueText(issues: readonly z.core.$ZodIssue[]): string {
  return issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

export function validateInstrument(raw: unknown, file: string): Instrument {
  const parsed = InstrumentSchema.safeParse(raw);
  if (!parsed.success) throw new InstrumentValidationError(issueText(parsed.error.issues), file);
  return parsed.data;
}

export async function loadInstrument(file: string): Promise<Instrument> {
  return validateInstrument(parseYaml(await readFile(file, 'utf8')), file);
}

/** Spec 2.5 — an instrument applies only if the run's as-of date falls inside its window. */
export function isEffectiveOn(instrument: Instrument, asOf: string): boolean {
  IsoDateSchema.parse(asOf);
  if (asOf < instrument.effective.start) return false;
  return instrument.effective.end === null || asOf <= instrument.effective.end;
}

export function findSection(instrument: Instrument, sectionNumber: string): Section | undefined {
  return instrument.sections.find((s) => s.sectionNumber === sectionNumber);
}

export function allIndicators(instrument: Instrument): readonly Indicator[] {
  return instrument.sections.flatMap((s) => s.indicators);
}

/**
 * Rules referenced by an instrument that no loaded rule pack provides.
 *
 * An indicator that claims a rule stands behind it, when no such rule exists, is the
 * schema-level version of a menu item that 404s. CI fails on a non-empty result.
 */
export function unresolvedRuleReferences(
  instrument: Instrument,
  availableRuleIds: ReadonlySet<string>,
): readonly string[] {
  const referenced = new Set(allIndicators(instrument).flatMap((i) => i.satisfiedByRules));
  return [...referenced].filter((id) => !availableRuleIds.has(id)).sort();
}
