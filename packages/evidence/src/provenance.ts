/**
 * Where a number came from.
 *
 * This is the part that makes a run survive its own retention period. Federal programs are
 * monitored one to five years after the year of spending, and the person defending the
 * FY2026 excess cost calculation in FY2031 is usually not the person who ran it. A result
 * without provenance is a number nobody can stand behind.
 *
 * Spec: Master Technical Buildout section 8.4. CLAUDE.md invariants 3 and 9.
 */

import { z } from 'zod';
import {
  ContentHashSchema,
  DecimalStringSchema,
  InstantSchema,
  IsoDateSchema,
} from './primitives.js';

export const INPUT_SOURCE_KINDS = [
  'MANUAL_ENTRY',
  'UPLOADED_DOCUMENT',
  'SYSTEM_INTEGRATION',
  'STATE_PORTAL',
  'PRIOR_RUN',
  'RULE_DEFAULT',
] as const;

export type InputSourceKind = (typeof INPUT_SOURCE_KINDS)[number];

export const InputSourceSchema = z.object({
  kind: z.enum(INPUT_SOURCE_KINDS),
  /** Human-readable: "FY2025 Annual Financial Report, page 14, line 2300". */
  description: z.string().min(1),
  /** The stored artifact this value was read from, when there is one. */
  evidenceId: z.string().min(1).nullable().default(null),
  /** Who put this number into the system. A name, not a user id, so the record reads. */
  suppliedBy: z.string().min(1),
  retrievedAt: InstantSchema,
});

export type InputSource = z.infer<typeof InputSourceSchema>;

export const INPUT_UNITS = ['USD', 'COUNT', 'RATIO', 'DATE', 'TEXT', 'BOOLEAN'] as const;

export type InputUnit = (typeof INPUT_UNITS)[number];

/**
 * One declared rule input, frozen at the moment of the run.
 *
 * The value is always a string. Money is a decimal string (invariant 5) and dates are
 * calendar dates (invariant 6); widening this to `unknown` would reintroduce both bugs.
 */
export const InputValueSchema = z
  .object({
    /** Matches an entry in the rule's declared `inputs`. */
    name: z.string().min(1),
    unit: z.enum(INPUT_UNITS),
    value: z.string(),
    source: InputSourceSchema,
  })
  .superRefine((input, ctx) => {
    if (input.unit === 'USD' && !DecimalStringSchema.safeParse(input.value).success) {
      ctx.addIssue({ code: 'custom', message: 'USD inputs must be decimal strings, never floats' });
    }
    if (input.unit === 'DATE' && !IsoDateSchema.safeParse(input.value).success) {
      ctx.addIssue({ code: 'custom', message: 'DATE inputs must be YYYY-MM-DD' });
    }
    if (input.unit === 'BOOLEAN' && input.value !== 'true' && input.value !== 'false') {
      ctx.addIssue({ code: 'custom', message: 'BOOLEAN inputs must be the string true or false' });
    }
  });

export type InputValue = z.infer<typeof InputValueSchema>;

/**
 * The frozen set of inputs a run was computed from.
 *
 * `hash` covers the canonical serialization of the values, so a later reader can prove the
 * snapshot has not moved underneath the conclusion drawn from it.
 */
export const InputSnapshotSchema = z
  .object({
    capturedAt: InstantSchema,
    values: z.array(InputValueSchema),
    hash: ContentHashSchema,
  })
  .refine(
    (snapshot) => {
      const names = snapshot.values.map((v) => v.name);
      return new Set(names).size === names.length;
    },
    { message: 'an input may appear only once in a snapshot' },
  );

export type InputSnapshot = z.infer<typeof InputSnapshotSchema>;

/** Deterministic serialization: sort by name so hashing does not depend on insertion order. */
export function canonicalizeInputs(values: readonly InputValue[]): string {
  return JSON.stringify(
    [...values]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((v) => [v.name, v.unit, v.value] as const),
  );
}

/**
 * Inputs a rule declared but the snapshot does not supply.
 *
 * Invariant 9 — this is what produces INDETERMINATE rather than an artificial PASS. A
 * district is never told it is compliant on the strength of data that never arrived.
 */
export function missingInputs(
  declaredInputs: readonly string[],
  snapshot: InputSnapshot,
): readonly string[] {
  const supplied = new Set(snapshot.values.map((v) => v.name));
  return declaredInputs.filter((name) => !supplied.has(name));
}

/** Inputs present in the snapshot that no rule asked for. Not an error; worth surfacing. */
export function extraneousInputs(
  declaredInputs: readonly string[],
  snapshot: InputSnapshot,
): readonly string[] {
  const declared = new Set(declaredInputs);
  return snapshot.values.map((v) => v.name).filter((name) => !declared.has(name));
}
