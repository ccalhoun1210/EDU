/**
 * Shared scalar schemas for the evidence model.
 *
 * Spec: Master Technical Buildout section 8.6 and CLAUDE.md invariants 5 and 6. Money is
 * never a float and regulatory dates are never timestamps, so both get a schema here
 * rather than being re-expressed at each use site.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Invariant 6 — regulatory dates are calendar dates. */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Regulatory dates are calendar dates (YYYY-MM-DD), not timestamps');

/** An instant, for things that happened rather than things the law fixes to a day. */
export const InstantSchema = z.iso.datetime({ offset: true });

/**
 * Invariant 5 — never float money. Amounts cross this boundary as decimal strings and are
 * stored as PostgreSQL NUMERIC. A JavaScript number would silently lose cents on a
 * district's $40,000,000 special education expenditure total.
 */
export const DecimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'Amounts are decimal strings, never floats (invariant 5)');

/** Fiscal years are named, not numbered, because states disagree about which year it is. */
export const FiscalYearSchema = z.string().regex(/^FY\d{4}$/, 'Fiscal years are written FY2026');

/** A lowercase hex SHA-256 digest. */
export const ContentHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'contentHash is a lowercase hex SHA-256 digest');

export const AuthoritySchema = z.object({
  citation: z.string().min(1),
  sourceId: z.string().min(1),
  url: z.url().optional(),
});

export type Authority = z.infer<typeof AuthoritySchema>;

export const EffectiveWindowSchema = z.object({
  start: IsoDateSchema,
  end: IsoDateSchema.nullable().default(null),
});

export type EffectiveWindow = z.infer<typeof EffectiveWindowSchema>;

/**
 * Tamper evidence for a stored artifact.
 *
 * Hashing at capture time is what lets a monitor in FY2031 be told that the FY2026
 * workpaper in front of them is byte-identical to the one that was attested. It is not a
 * substitute for write-once storage; it is what makes write-once storage checkable.
 */
export function sha256Hex(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
