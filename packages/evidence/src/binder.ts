/**
 * The artifact the district hands to the monitor.
 *
 * A binder is one section of one instrument, for one organization, for one fiscal year,
 * assembled in the state's own indicator order. It is the product's terminal output: not a
 * dashboard reading, but a document that stands on its own after the person who assembled
 * it has left the district.
 *
 * A binder finalizes whole or not at all. Every in-scope indicator must carry an attested
 * assertion first. That is the working agreement in CLAUDE.md — nothing partial ships —
 * expressed as a type guard rather than as a habit.
 */

import { z } from 'zod';
import { FiscalYearSchema, InstantSchema } from './primitives.js';
import { findSection, type Instrument, type Section } from './instrument.js';
import type { Assertion } from './assertion.js';

export const CoverageEntrySchema = z.object({
  indicatorId: z.string().min(1),
  title: z.string().min(1),
  conditional: z.boolean(),
  assertionId: z.string().min(1).nullable(),
  status: z.enum(['ATTESTED', 'DRAFT', 'MISSING']),
});

export type CoverageEntry = z.infer<typeof CoverageEntrySchema>;

export interface Coverage {
  readonly total: number;
  readonly attested: number;
  readonly draft: number;
  readonly missing: number;
  readonly entries: readonly CoverageEntry[];
  readonly complete: boolean;
}

/**
 * Live assertions only. A superseded assertion is history, not coverage — counting it
 * would let a corrected indicator look finished while its replacement is still a draft.
 */
function liveAssertionFor(
  assertions: readonly Assertion[],
  indicatorId: string,
): Assertion | undefined {
  const live = assertions.filter((a) => a.indicatorId === indicatorId && a.status !== 'SUPERSEDED');
  return live.find((a) => a.status === 'ATTESTED') ?? live[0];
}

export function coverageForSection(section: Section, assertions: readonly Assertion[]): Coverage {
  const entries: CoverageEntry[] = section.indicators.map((indicator) => {
    const assertion = liveAssertionFor(assertions, indicator.indicatorId);
    return {
      indicatorId: indicator.indicatorId,
      title: indicator.title,
      conditional: indicator.conditional,
      assertionId: assertion?.assertionId ?? null,
      status:
        assertion === undefined
          ? 'MISSING'
          : assertion.status === 'ATTESTED'
            ? 'ATTESTED'
            : 'DRAFT',
    };
  });

  const attested = entries.filter((e) => e.status === 'ATTESTED').length;
  const draft = entries.filter((e) => e.status === 'DRAFT').length;
  const missing = entries.filter((e) => e.status === 'MISSING').length;

  return {
    total: entries.length,
    attested,
    draft,
    missing,
    entries,
    complete: attested === entries.length,
  };
}

export const BinderSchema = z.object({
  binderId: z.string().min(1),
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  organizationName: z.string().min(1),
  instrumentId: z.string().min(1),
  instrumentVersion: z.string().min(1),
  sectionNumber: z.string().min(1),
  fiscalYear: FiscalYearSchema,
  assertionIds: z.array(z.string().min(1)).min(1),
  generatedAt: InstantSchema,
  generatedBy: z.string().min(1),
});

export type Binder = z.infer<typeof BinderSchema>;

export class BinderIncompleteError extends Error {
  constructor(
    readonly sectionNumber: string,
    readonly outstanding: readonly CoverageEntry[],
  ) {
    const detail = outstanding
      .map((e) => `${e.indicatorId} (${e.status.toLowerCase()})`)
      .join(', ');
    super(
      `Section ${sectionNumber} cannot be finalized: ${outstanding.length} indicator(s) ` +
        `outstanding — ${detail}. Attest them or record them as not applicable.`,
    );
    this.name = 'BinderIncompleteError';
  }
}

export interface FinalizeInput {
  readonly instrument: Instrument;
  readonly sectionNumber: string;
  readonly assertions: readonly Assertion[];
  readonly binder: Omit<Binder, 'assertionIds'>;
}

/**
 * Assemble a binder, or refuse.
 *
 * There is no partial binder and no override flag. A document that presents itself as a
 * district's monitoring record while silently omitting an indicator is worse than no
 * document, because it will be believed.
 */
export function finalizeBinder(input: FinalizeInput): Binder {
  const section = findSection(input.instrument, input.sectionNumber);
  if (section === undefined) {
    throw new Error(
      `Instrument ${input.instrument.instrumentId} ${input.instrument.version} has no section ${input.sectionNumber}`,
    );
  }

  const coverage = coverageForSection(section, input.assertions);
  if (!coverage.complete) {
    throw new BinderIncompleteError(
      input.sectionNumber,
      coverage.entries.filter((e) => e.status !== 'ATTESTED'),
    );
  }

  const assertionIds = coverage.entries
    .map((e) => e.assertionId)
    .filter((id): id is string => id !== null);

  return BinderSchema.parse({ ...input.binder, assertionIds });
}
