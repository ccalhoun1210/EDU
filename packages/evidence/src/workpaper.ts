/**
 * What a rule run hands to a human.
 *
 * A workpaper is the audit-facing artifact a rule produces: the citation it was decided
 * under, the pack version in force on the as-of date, every input and where it came from,
 * which statutory method was used, the result, and the rendered explanation. The
 * pass/fail is a field on it, not the product of it.
 *
 * Spec: Master Technical Buildout sections 8.3-8.6. CLAUDE.md invariants 3 and 4.
 */

import { z } from 'zod';
import { EVALUATION_STATUSES, SEVERITIES } from '@complianceos/domain';
import { InputSnapshotSchema, canonicalizeInputs } from './provenance.js';
import {
  AuthoritySchema,
  ContentHashSchema,
  InstantSchema,
  IsoDateSchema,
  sha256Hex,
} from './primitives.js';

/**
 * The provenance chain required by invariant 3.
 *
 * Note: `RuleSchema` carries no per-rule version field — a rule's version is the version of
 * the pack that published it, and packs are immutable once ACTIVE (ADR 0003). We record
 * both ids so the chain resolves without ambiguity. See ADR 0006 for why this substitution
 * is deliberate rather than an omission.
 */
export const RuleProvenanceSchema = z.object({
  packId: z.string().min(1),
  packVersion: z.string().min(1),
  ruleId: z.string().min(1),
  /** Copied from the rule at run time so a later edit upstream cannot rewrite history. */
  authority: AuthoritySchema,
  calculator: z.string().min(1).nullable().default(null),
});

export type RuleProvenance = z.infer<typeof RuleProvenanceSchema>;

export const WorkpaperSchema = z.object({
  workpaperId: z.string().min(1),
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  runId: z.string().min(1),
  /** The date rule selection was made against — not the date the button was pressed. */
  asOf: IsoDateSchema,
  rule: RuleProvenanceSchema,
  inputs: InputSnapshotSchema,
  /**
   * Which statutory alternative was applied, where the regulation offers several. IDEA
   * MOE at 34 CFR 300.203 permits four; a workpaper that does not say which one was used
   * cannot be reviewed.
   */
  method: z.string().min(1).nullable().default(null),
  /** Keys correspond to the rule's declared `outputSchema`. Values are strings (invariant 5). */
  result: z.record(z.string(), z.string()),
  status: z.enum(EVALUATION_STATUSES),
  severity: z.enum(SEVERITIES).nullable().default(null),
  /** The rule's explanationTemplate, rendered against the result. Plain language. */
  explanation: z.string().min(1),
  computedAt: InstantSchema,
  contentHash: ContentHashSchema,
});

export type Workpaper = z.infer<typeof WorkpaperSchema>;

/**
 * The bytes a workpaper's hash covers.
 *
 * Deliberately excludes ids and timestamps that vary between environments, and covers
 * exactly the things a reviewer would care had changed: the rule, the inputs, the method,
 * the result and the conclusion.
 */
export function canonicalizeWorkpaper(
  workpaper: Pick<Workpaper, 'asOf' | 'rule' | 'inputs' | 'method' | 'result' | 'status'>,
): string {
  return JSON.stringify({
    asOf: workpaper.asOf,
    pack: [workpaper.rule.packId, workpaper.rule.packVersion],
    ruleId: workpaper.rule.ruleId,
    citation: workpaper.rule.authority.citation,
    method: workpaper.method,
    inputs: canonicalizeInputs(workpaper.inputs.values),
    result: Object.entries(workpaper.result).sort(([a], [b]) => a.localeCompare(b)),
    status: workpaper.status,
  });
}

export function hashWorkpaper(
  workpaper: Pick<Workpaper, 'asOf' | 'rule' | 'inputs' | 'method' | 'result' | 'status'>,
): string {
  return sha256Hex(canonicalizeWorkpaper(workpaper));
}

/** True when the stored hash still matches the content. Cheap tamper check on read. */
export function isIntact(workpaper: Workpaper): boolean {
  return workpaper.contentHash === hashWorkpaper(workpaper);
}
