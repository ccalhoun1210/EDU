/**
 * Loading and validating rule packs from disk.
 *
 * Rule packs are content, not code (spec 2.4). They are authored as YAML under
 * /rulepacks, validated here, and only then compiled for the engine. Validation runs in
 * CI so an invalid rule cannot reach a published pack.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { collectCalculators, collectInputs } from './expression.js';
import { RulePackManifestSchema, RuleSchema, type Rule, type RulePackManifest } from './rule.js';
import { SourceRegistrySchema, type RegulatorySource, type SourceRegistry } from './source.js';

export interface LoadedRulePack {
  readonly manifest: RulePackManifest;
  readonly rules: readonly Rule[];
}

export class RulePackValidationError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(`${file}: ${message}`);
    this.name = 'RulePackValidationError';
  }
}

async function readYaml(file: string): Promise<unknown> {
  return parseYaml(await readFile(file, 'utf8'));
}

export function validateRule(
  raw: unknown,
  file: string,
  allowedCalculators: ReadonlySet<string>,
): Rule {
  const parsed = RuleSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RulePackValidationError(z_issues(parsed.error.issues), file);
  }
  const rule = parsed.data;

  // Every input a rule reads must be declared, so the engine knows what to snapshot
  // and can report missing inputs as INDETERMINATE rather than guessing.
  if (rule.condition) {
    const declared = new Set(rule.inputs);
    const undeclared = [...collectInputs(rule.condition)].filter((name) => !declared.has(name));
    if (undeclared.length > 0) {
      throw new RulePackValidationError(
        `condition reads undeclared inputs: ${undeclared.join(', ')}`,
        file,
      );
    }
  }

  // Calculators are allow-listed and versioned (spec 8.5). An unknown calculator name is
  // a publication failure, never a silent no-op at evaluation time.
  const invoked = new Set<string>(rule.calculator ? [rule.calculator] : []);
  if (rule.condition) for (const name of collectCalculators(rule.condition)) invoked.add(name);
  const unknown = [...invoked].filter((name) => !allowedCalculators.has(name));
  if (unknown.length > 0) {
    throw new RulePackValidationError(
      `references calculators outside the registry: ${unknown.join(', ')}`,
      file,
    );
  }

  return rule;
}

export async function loadRulePack(
  packDir: string,
  allowedCalculators: ReadonlySet<string>,
): Promise<LoadedRulePack> {
  const manifestFile = path.join(packDir, 'pack.yaml');
  const manifestResult = RulePackManifestSchema.safeParse(await readYaml(manifestFile));
  if (!manifestResult.success) {
    throw new RulePackValidationError(z_issues(manifestResult.error.issues), manifestFile);
  }
  const manifest = manifestResult.data;

  const rulesDir = path.join(packDir, 'rules');
  const entries = (await readdir(rulesDir)).filter((name) => name.endsWith('.yaml')).sort();

  const rules: Rule[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const file = path.join(rulesDir, entry);
    const rule = validateRule(await readYaml(file), file, allowedCalculators);

    if (rule.pack !== manifest.packId) {
      throw new RulePackValidationError(
        `declares pack "${rule.pack}" but sits in pack "${manifest.packId}"`,
        file,
      );
    }
    if (seen.has(rule.ruleId)) {
      throw new RulePackValidationError(`duplicate ruleId "${rule.ruleId}"`, file);
    }
    seen.add(rule.ruleId);
    rules.push(rule);
  }

  return { manifest, rules };
}

function z_issues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues.map((issue) => `${issue.path.join('.') || '(root)'} — ${issue.message}`).join('; ');
}

/** Load one regulatory source registry file (spec 9). */
export async function loadSourceRegistry(file: string): Promise<SourceRegistry> {
  const result = SourceRegistrySchema.safeParse(await readYaml(file));
  if (!result.success) {
    throw new RulePackValidationError(z_issues(result.error.issues), file);
  }
  return result.data;
}

/**
 * Load every registry under a directory into one flat source list.
 *
 * A duplicate source id across registries is an error rather than a last-one-wins merge: two
 * entries claiming the same id will eventually disagree about an effective date, and the
 * rule that cites the id would then mean different things depending on load order.
 */
export async function loadSourceRegistries(dir: string): Promise<readonly RegulatorySource[]> {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.yaml')).sort();
  const sources: RegulatorySource[] = [];
  const seen = new Map<string, string>();

  for (const name of files) {
    const file = path.join(dir, name);
    const registry = await loadSourceRegistry(file);
    for (const source of registry.sources) {
      const previous = seen.get(source.sourceId);
      if (previous !== undefined) {
        throw new RulePackValidationError(
          `duplicate sourceId "${source.sourceId}", already defined in ${previous}`,
          file,
        );
      }
      seen.set(source.sourceId, file);
      sources.push(source);
    }
  }

  return sources;
}
