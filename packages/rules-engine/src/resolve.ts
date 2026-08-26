/**
 * Rule-pack layering and effective-date selection.
 *
 * Spec: Master Technical Buildout sections 8.1 and 2.5.
 *
 * ```text
 * Federal baseline  →  State overlay  →  District/local control overlay
 * ```
 *
 * ## What each layer is allowed to do
 *
 * Section 8.1 says a state pack may add a requirement, define a state timeline or threshold,
 * add evidence requirements, supersede a parameter where legally appropriate, and impose a
 * stricter requirement. A local pack may define internal controls and earlier warning
 * thresholds, "but should not silently rewrite the statutory/legal requirement".
 *
 * That last clause is enforced here rather than left as guidance: a LOCAL pack redefining a
 * rule id that a FEDERAL or STATE pack already defines is a resolution error. A district
 * that wants an earlier warning writes its own rule with its own id and its own severity;
 * what it cannot do is quietly relax `IDEA-MOE-COMPLIANCE-001` and have the platform report
 * compliance with a federal requirement it has locally redefined.
 *
 * A STATE pack overriding a FEDERAL rule id *is* permitted — that is what an overlay is for —
 * and the supersession is recorded on the resolved rule so a finding can show which layer's
 * text it was decided under.
 */

import { isEffectiveOn, type LoadedRulePack, type Rule } from '@complianceos/rulepack-sdk';

export const PACK_LAYERS = ['FEDERAL', 'STATE', 'LOCAL'] as const;
export type PackLayer = (typeof PACK_LAYERS)[number];

const LAYER_ORDER: Record<PackLayer, number> = { FEDERAL: 0, STATE: 1, LOCAL: 2 };

/**
 * Order packs federal, then state, then local.
 *
 * Exported so that everything which layers packs uses the same order. Anything that instead
 * iterates the caller's array applies overlays in whatever order the argument happened to be
 * built in, and then a result depends on how someone wrote a function call.
 */
export function sortPacksByLayer<T extends { readonly manifest: { readonly layer: PackLayer } }>(
  packs: readonly T[],
): readonly T[] {
  return [...packs].sort((a, b) => LAYER_ORDER[a.manifest.layer] - LAYER_ORDER[b.manifest.layer]);
}

export interface PackRef {
  readonly packId: string;
  readonly version: string;
  readonly layer: PackLayer;
}

export interface ResolvedRule {
  readonly rule: Rule;
  readonly pack: PackRef;
  /** Set when this rule replaced one of the same id from a lower layer. */
  readonly supersedes?: PackRef;
}

export interface ResolvedRuleSet {
  /** The date the rule selection was made as of. Rules outside their window are excluded. */
  readonly asOf: string;
  /** Every pack that contributed, in layer order. Recorded on the assessment run. */
  readonly packs: readonly PackRef[];
  readonly rules: readonly ResolvedRule[];
  /** Rules excluded because `asOf` fell outside their effective window. */
  readonly notYetEffective: readonly string[];
  readonly expired: readonly string[];
}

export class RuleResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleResolutionError';
  }
}

function packRef(pack: LoadedRulePack): PackRef {
  return {
    packId: pack.manifest.packId,
    version: pack.manifest.version,
    layer: pack.manifest.layer,
  };
}

/**
 * Resolve a stack of packs into the rule set in force on a date.
 *
 * `asOf` is a calendar date, and it is the run's as-of date rather than today: reproducing
 * what the platform concluded on 15 October 2027 means selecting the rules that were in force
 * then, which is section 2.5's whole requirement.
 */
export function resolveRulePacks(packs: readonly LoadedRulePack[], asOf: string): ResolvedRuleSet {
  if (packs.length === 0) throw new RuleResolutionError('no rule packs supplied');

  const ordered = sortPacksByLayer(packs);

  const federalCount = ordered.filter((pack) => pack.manifest.layer === 'FEDERAL').length;
  if (federalCount === 0) {
    throw new RuleResolutionError(
      'a resolved stack needs a federal baseline; an overlay alone has nothing to overlay',
    );
  }
  if (federalCount > 1) {
    throw new RuleResolutionError(
      'two federal baselines were supplied. Overlaying one baseline on another hides which ' +
        'statutory text a finding was decided under.',
    );
  }

  // An overlay must name the pack it extends, and that pack must be present. A pack that
  // silently applies on its own would resolve differently depending on what happened to be
  // loaded, which is not reproducible.
  const present = new Set(ordered.map((pack) => pack.manifest.packId));
  for (const pack of ordered) {
    const parent = pack.manifest.extendsPack;
    if (pack.manifest.layer === 'FEDERAL') continue;
    if (parent === null) {
      throw new RuleResolutionError(
        `${pack.manifest.packId} is a ${pack.manifest.layer} overlay but names no pack to extend`,
      );
    }
    if (!present.has(parent)) {
      throw new RuleResolutionError(
        `${pack.manifest.packId} extends "${parent}", which was not supplied`,
      );
    }
  }

  // Which rule ids belong to a statutory layer, computed across every rule in the stack and
  // deliberately BEFORE any effective-date filtering.
  //
  // Ownership is a property of the content, not of the date a run happens to be asking about.
  // Checking it after the filter would let a local pack claim a federal rule id whose window
  // has not opened yet — and the collision would then surface on the day the federal rule
  // becomes effective, as a failed run rather than a rejected publication.
  const statutoryOwners = new Map<string, PackRef>();
  for (const pack of ordered) {
    if (pack.manifest.layer === 'LOCAL') continue;
    const ref = packRef(pack);
    for (const rule of pack.rules) statutoryOwners.set(rule.ruleId, ref);
  }

  const byRuleId = new Map<string, ResolvedRule>();
  const notYetEffective = new Set<string>();
  const expired = new Set<string>();

  for (const pack of ordered) {
    const ref = packRef(pack);

    for (const rule of pack.rules) {
      if (ref.layer === 'LOCAL') {
        const owner = statutoryOwners.get(rule.ruleId);
        if (owner !== undefined) {
          throw new RuleResolutionError(
            `local pack ${ref.packId} redefines "${rule.ruleId}", which ${owner.packId} ` +
              `(${owner.layer}) defines. A local pack may add its own controls and earlier ` +
              'warning thresholds, but it may not rewrite a statutory requirement. Give the ' +
              'local rule its own id.',
          );
        }
      }

      if (!isEffectiveOn(rule, asOf)) {
        if (asOf < rule.effective.start) notYetEffective.add(rule.ruleId);
        else expired.add(rule.ruleId);
        continue;
      }

      const existing = byRuleId.get(rule.ruleId);
      byRuleId.set(
        rule.ruleId,
        existing === undefined
          ? { rule, pack: ref }
          : { rule, pack: ref, supersedes: existing.pack },
      );
    }
  }

  // A rule superseded by a higher layer is no longer "not yet effective" or "expired" on the
  // strength of the version that lost — report only ids with no surviving rule.
  for (const ruleId of byRuleId.keys()) {
    notYetEffective.delete(ruleId);
    expired.delete(ruleId);
  }

  return {
    asOf,
    packs: ordered.map(packRef),
    // Sorted by rule id so a run's result order — and therefore any hash over it — does not
    // depend on directory listing order.
    rules: [...byRuleId.values()].sort((a, b) => (a.rule.ruleId < b.rule.ruleId ? -1 : 1)),
    notYetEffective: [...notYetEffective].sort(),
    expired: [...expired].sort(),
  };
}
