/**
 * A district's claim against one indicator, and the evidence behind it.
 *
 * An assertion is the unit a monitor reads: for indicator 18.2, in FY2026, this district
 * says it performed the annual excess cost calculation, here is the workpaper that
 * computed it, here are the documents behind the inputs, and here is who signed it.
 *
 * Attestation freezes the record. A correction never edits an attested assertion; it
 * supersedes it, exactly as a rule change publishes a new rule version rather than
 * mutating an ACTIVE one (ADR 0003, CLAUDE.md invariant 4).
 */

import { z } from 'zod';
import { rollUpStatus, type EvaluationStatus } from '@complianceos/domain';
import { ContentHashSchema, FiscalYearSchema, InstantSchema } from './primitives.js';
import { INDICATOR_RESULTS } from './instrument.js';
import type { Workpaper } from './workpaper.js';

export const EVIDENCE_KINDS = [
  'UPLOADED_DOCUMENT',
  'SYSTEM_EXPORT',
  'WORKPAPER',
  'NARRATIVE_STATEMENT',
  'EXTERNAL_LINK',
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EvidenceSchema = z.object({
  evidenceId: z.string().min(1),
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  fiscalYear: FiscalYearSchema,
  kind: z.enum(EVIDENCE_KINDS),
  /** What this artifact is, in the words a monitor would use. */
  title: z.string().min(1),
  /** Blob storage key, or null for narrative statements held inline. */
  storageKey: z.string().min(1).nullable().default(null),
  filename: z.string().min(1).nullable().default(null),
  mediaType: z.string().min(1).nullable().default(null),
  byteLength: z.number().int().nonnegative().nullable().default(null),
  capturedAt: InstantSchema,
  capturedBy: z.string().min(1),
  contentHash: ContentHashSchema,
});

export type Evidence = z.infer<typeof EvidenceSchema>;

export const ASSERTION_STATUSES = ['DRAFT', 'ATTESTED', 'SUPERSEDED'] as const;

export type AssertionStatus = (typeof ASSERTION_STATUSES)[number];

/** The point past which an assertion is immutable. Mirrors rule lifecycle IMMUTABLE_FROM. */
export const IMMUTABLE_FROM: AssertionStatus = 'ATTESTED';

export const AttestationSchema = z.object({
  /** The person who is accountable if this is wrong. A name and a role, not a user id. */
  name: z.string().min(1),
  role: z.string().min(1),
  at: InstantSchema,
  /** What they affirmed, stored verbatim so it can be reproduced years later. */
  statement: z.string().min(1),
});

export type Attestation = z.infer<typeof AttestationSchema>;

export const AssertionSchema = z
  .object({
    assertionId: z.string().min(1),
    tenantId: z.string().min(1),
    organizationId: z.string().min(1),
    instrumentId: z.string().min(1),
    instrumentVersion: z.string().min(1),
    indicatorId: z.string().min(1),
    fiscalYear: FiscalYearSchema,
    status: z.enum(ASSERTION_STATUSES),
    /** The district's own claim about how this indicator would score. */
    claimedResult: z.enum(INDICATOR_RESULTS),
    workpaperIds: z.array(z.string().min(1)).default([]),
    evidenceIds: z.array(z.string().min(1)).default([]),
    narrative: z.string().min(1).nullable().default(null),
    attestation: AttestationSchema.nullable().default(null),
    supersedes: z.string().min(1).nullable().default(null),
    supersededBy: z.string().min(1).nullable().default(null),
  })
  .refine((a) => (a.status === 'ATTESTED' ? a.attestation !== null : true), {
    message: 'an ATTESTED assertion must carry an attestation',
  })
  .refine((a) => (a.status === 'DRAFT' ? a.attestation === null : true), {
    message: 'a DRAFT assertion must not carry an attestation',
  })
  .refine((a) => (a.status === 'SUPERSEDED' ? a.supersededBy !== null : true), {
    message: 'a SUPERSEDED assertion must name the assertion that replaced it',
  })
  .refine((a) => a.assertionId !== a.supersedes && a.assertionId !== a.supersededBy, {
    message: 'an assertion cannot supersede itself',
  });

export type Assertion = z.infer<typeof AssertionSchema>;

export function isMutable(assertion: Assertion): boolean {
  return assertion.status === 'DRAFT';
}

export class AssertionImmutableError extends Error {
  constructor(readonly assertionId: string) {
    super(
      `Assertion ${assertionId} is attested and cannot be edited. ` +
        'Publish a superseding assertion instead.',
    );
    this.name = 'AssertionImmutableError';
  }
}

/** Guard for any write path. Invariant 4 expressed in code rather than only in prose. */
export function assertMutable(assertion: Assertion): void {
  if (!isMutable(assertion)) throw new AssertionImmutableError(assertion.assertionId);
}

/**
 * The status an indicator carries given the workpapers behind it.
 *
 * Delegates precedence to the domain roll-up, so an INDETERMINATE workpaper outranks a
 * passing one here for exactly the reason it does everywhere else: a district cannot be
 * told an indicator is satisfied on the strength of data that never arrived.
 */
export function indicatorStatus(workpapers: readonly Workpaper[]): EvaluationStatus {
  return rollUpStatus(workpapers.map((w) => w.status));
}

/**
 * Whether the computed evidence supports the result the district claims.
 *
 * A district may legitimately claim MET where no rule applies — most indicators are
 * satisfied by narrative and documents. What it may not do is claim MET while a rule that
 * stands behind the indicator says FAIL, or while any input is still missing.
 */
export function claimIsSupported(
  claimed: (typeof INDICATOR_RESULTS)[number],
  workpapers: readonly Workpaper[],
): boolean {
  if (workpapers.length === 0) return true;
  const status = indicatorStatus(workpapers);
  if (claimed === 'MET') return status === 'PASS' || status === 'NOT_APPLICABLE';
  if (claimed === 'NOT_APPLICABLE') return status === 'NOT_APPLICABLE';
  return true;
}
