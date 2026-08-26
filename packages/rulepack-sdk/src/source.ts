/**
 * The regulatory source registry.
 *
 * Spec: Master Technical Buildout sections 9 and 41. A rule cites an authority; this is
 * where that authority is described, dated, and — critically — *verified against the
 * official text*.
 *
 * ## Why verification is a schema concern and not a process note
 *
 * Section 9 requires every source to carry a source-document hash and a retrieved date.
 * Section 41 requires retrieval metadata and a checksum for every source in the library.
 * The reason is the threat model's "stale regulation" row: a rule written from memory, or
 * from a regulation as it stood three years ago, produces confident findings that are
 * wrong, and nothing about the finding looks wrong.
 *
 * So `retrieval` is nullable, and a null means exactly one thing: **nobody has yet fetched
 * the official text, hashed it, and confirmed this rule says what the regulation says.**
 * A source in that state is usable for DRAFT authoring and for domain review. It is not
 * usable for a rule that evaluates a real district. `assertRuleSourcesVerified` is what
 * enforces that, and it runs in CI.
 *
 * This is deliberately inconvenient. An unverified citation is the cheapest possible way to
 * ship a wrong compliance determination.
 */

import { z } from 'zod';
import {
  EffectiveWindowSchema,
  IsoDateSchema,
  type Rule,
  type RuleLifecycleStatus,
} from './rule.js';

/**
 * Evidence that a human (or an automated fetcher) actually obtained the official text.
 *
 * `documentHash` is a SHA-256 over the retrieved document bytes. It exists so that a later
 * re-fetch can detect that the regulation changed underneath a rule that still claims to
 * implement it — which is the section 9 "source change detected" trigger.
 */
export const SourceRetrievalSchema = z.object({
  retrievedOn: IsoDateSchema,
  documentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'documentHash is a lowercase hex SHA-256 of the retrieved document'),
  /** Where the retrieved snapshot is archived, so the hash can be re-checked. */
  archiveRef: z.string().min(1),
  /** Who confirmed the retrieval. A person or a named automated job. */
  retrievedBy: z.string().min(1),
});

export type SourceRetrieval = z.infer<typeof SourceRetrievalSchema>;

export const RegulatorySourceSchema = z.object({
  sourceId: z.string().min(1),
  jurisdiction: z.string().min(1),
  /** The publishing body — "U.S. Department of Education", "Alabama State Board of Education". */
  publisher: z.string().min(1),
  title: z.string().min(1),
  citation: z.string().min(1),
  officialUrl: z.url(),
  publishedOn: IsoDateSchema.nullable().default(null),
  effective: EffectiveWindowSchema,
  programs: z.array(z.string().min(1)).min(1),
  /** The source this one replaced, so a historical run can find the text that applied then. */
  supersedes: z.string().min(1).nullable().default(null),
  retrieval: SourceRetrievalSchema.nullable().default(null),
  /**
   * Free text for the regulatory analyst. Use it to record what is known and, more
   * importantly, what is not. Never use it to paraphrase the regulation as if it were the
   * regulation.
   */
  notes: z.string().min(1).optional(),
});

export type RegulatorySource = z.infer<typeof RegulatorySourceSchema>;

export const SourceRegistrySchema = z.object({
  registryId: z.string().min(1),
  description: z.string().min(1),
  sources: z.array(RegulatorySourceSchema).min(1),
});

export type SourceRegistry = z.infer<typeof SourceRegistrySchema>;

/** A source is verified when someone has retrieved and hashed the official document. */
export function isVerified(source: RegulatorySource): boolean {
  return source.retrieval !== null;
}

/**
 * The lifecycle stages at which a rule is applied to something that matters.
 *
 * DRAFT through QA_APPROVED are authoring states — a rule there is being written and
 * reviewed, and an unverified citation is a normal work-in-progress condition. From STAGED
 * onward the rule is being evaluated against real tenant data (SHADOW runs it silently,
 * ACTIVE reports its findings), and at that point an unverified citation is a defect.
 */
export const STAGES_REQUIRING_VERIFIED_SOURCE: readonly RuleLifecycleStatus[] = [
  'STAGED',
  'SHADOW',
  'ACTIVE',
];

export function requiresVerifiedSource(lifecycle: RuleLifecycleStatus): boolean {
  return STAGES_REQUIRING_VERIFIED_SOURCE.includes(lifecycle);
}

export interface SourceVerificationProblem {
  readonly ruleId: string;
  readonly sourceId: string;
  readonly lifecycle: RuleLifecycleStatus;
  readonly reason: 'UNKNOWN_SOURCE' | 'UNVERIFIED_SOURCE';
  readonly message: string;
}

/**
 * Check every rule's citation against the registry.
 *
 * Two failures are possible and they are different problems. A rule citing a source id that
 * does not exist is a typo or a missing registry entry — a content bug. A rule citing a real
 * but unretrieved source is the honest case: the citation is probably right, but nobody has
 * proved it, so the rule may not leave the authoring stages.
 */
export function checkRuleSources(
  rules: readonly Rule[],
  registry: readonly RegulatorySource[],
): readonly SourceVerificationProblem[] {
  const byId = new Map(registry.map((source) => [source.sourceId, source]));
  const problems: SourceVerificationProblem[] = [];

  for (const rule of rules) {
    const sourceId = rule.authority.sourceId;
    const source = byId.get(sourceId);

    if (source === undefined) {
      problems.push({
        ruleId: rule.ruleId,
        sourceId,
        lifecycle: rule.lifecycle,
        reason: 'UNKNOWN_SOURCE',
        message:
          `cites source "${sourceId}", which is not in the regulatory source registry. ` +
          'Add the source before the rule, not after — the citation is the reason the rule exists.',
      });
      continue;
    }

    if (requiresVerifiedSource(rule.lifecycle) && !isVerified(source)) {
      problems.push({
        ruleId: rule.ruleId,
        sourceId,
        lifecycle: rule.lifecycle,
        reason: 'UNVERIFIED_SOURCE',
        message:
          `is at lifecycle ${rule.lifecycle}, which evaluates real district data, but source ` +
          `"${sourceId}" has no retrieval record. Fetch the official text at ` +
          `${source.officialUrl}, hash it, and record the retrieval before advancing this rule.`,
      });
    }
  }

  return problems;
}

export class SourceVerificationError extends Error {
  constructor(readonly problems: readonly SourceVerificationProblem[]) {
    super(
      `${problems.length} rule/source problem(s):\n` +
        problems.map((p) => `  - ${p.ruleId} ${p.message}`).join('\n'),
    );
    this.name = 'SourceVerificationError';
  }
}

export function assertRuleSourcesVerified(
  rules: readonly Rule[],
  registry: readonly RegulatorySource[],
): void {
  const problems = checkRuleSources(rules, registry);
  if (problems.length > 0) throw new SourceVerificationError(problems);
}
