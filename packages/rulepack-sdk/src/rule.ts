/**
 * Rule and rule-pack schemas.
 *
 * Spec: Master Technical Buildout sections 8.1-8.3. A rule carries its own regulatory
 * authority and effective dates so that a finding can always be traced back to a citation,
 * and so a run can be reproduced later against the rule versions that were active on the
 * date it happened.
 */

import { z } from 'zod';
import { SEVERITIES } from '@complianceos/domain';
import { ExpressionSchema } from './expression.js';

/** Spec 8.2 — never mutate an ACTIVE rule version; publish a new one. */
export const RULE_LIFECYCLE_STATUSES = [
  'DRAFT',
  'DOMAIN_REVIEWED',
  'LEGAL_REVIEWED',
  'QA_APPROVED',
  'STAGED',
  'SHADOW',
  'ACTIVE',
  'SUPERSEDED',
] as const;

export type RuleLifecycleStatus = (typeof RULE_LIFECYCLE_STATUSES)[number];

/** Statuses at which a rule version becomes immutable. */
export const IMMUTABLE_FROM: RuleLifecycleStatus = 'ACTIVE';

/**
 * Invariant 6: a regulatory date is a calendar date. Exported because the regulatory source
 * registry needs the identical rule — a publication date that round-trips through a UTC
 * timestamp can land on the wrong day, and an effective date off by one is a wrong finding.
 */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Regulatory dates are calendar dates (YYYY-MM-DD), not timestamps');

const IsoDate = IsoDateSchema;

export const AuthoritySchema = z.object({
  citation: z.string().min(1),
  sourceId: z.string().min(1),
  url: z.url().optional(),
});

export const EffectiveWindowSchema = z.object({
  start: IsoDate,
  end: IsoDate.nullable().default(null),
});

export const RuleSchema = z
  .object({
    ruleId: z.string().min(1),
    pack: z.string().min(1),
    jurisdiction: z.string().min(1),
    program: z.string().min(1),
    subjectType: z.string().min(1),
    lifecycle: z.enum(RULE_LIFECYCLE_STATUSES).default('DRAFT'),
    authority: AuthoritySchema,
    effective: EffectiveWindowSchema,
    inputs: z.array(z.string().min(1)).min(1),
    calculator: z.string().min(1).optional(),
    condition: ExpressionSchema.optional(),
    /**
     * An optional guard deciding whether the rule applies to this subject at all.
     *
     * Separate from `condition` on purpose. "Does this LEA receive a Part B subgrant" and
     * "did this LEA maintain its effort" are different questions, and collapsing them makes
     * NOT_APPLICABLE indistinguishable from PASS — a district that is out of scope would be
     * reported as compliant with a requirement that never applied to it.
     */
    applicability: ExpressionSchema.optional(),
    outputSchema: z.record(z.string(), z.string()),
    severityOnFailure: z.enum(SEVERITIES),
    explanationTemplate: z.string().min(1),
  })
  .refine((rule) => rule.calculator !== undefined || rule.condition !== undefined, {
    message: 'A rule must declare either a calculator or a condition expression',
  })
  .refine((rule) => rule.effective.end === null || rule.effective.end >= rule.effective.start, {
    message: 'effective.end must not precede effective.start',
  });

export type Rule = z.infer<typeof RuleSchema>;

export const RulePackManifestSchema = z.object({
  packId: z.string().min(1),
  version: z.string().min(1),
  jurisdiction: z.string().min(1),
  program: z.string().min(1),
  /** Spec 8.1 — federal baseline, then state overlay, then district overlay. */
  layer: z.enum(['FEDERAL', 'STATE', 'LOCAL']),
  extendsPack: z.string().min(1).nullable().default(null),
  effective: EffectiveWindowSchema,
  description: z.string().min(1),
});

export type RulePackManifest = z.infer<typeof RulePackManifestSchema>;

/** Spec 2.5 — a rule applies only if the run's as-of date falls inside its effective window. */
export function isEffectiveOn(rule: Rule, asOf: string): boolean {
  if (asOf < rule.effective.start) return false;
  return rule.effective.end === null || asOf <= rule.effective.end;
}
