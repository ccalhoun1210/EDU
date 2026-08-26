/**
 * The allow-list is checked in both directions.
 *
 * `validateRule` already fails a rule that invokes a calculator the list does not contain.
 * This closes the other direction: a name on the list that no shipped rule invokes is an
 * unkept promise, and it fails the build here rather than being discovered by a customer.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { CALCULATOR_REGISTRY } from './calculators.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RULE_DIRS = [
  path.join(REPO_ROOT, 'rulepacks/federal/idea-b/us-fed-idea-b-2026/rules'),
  path.join(REPO_ROOT, 'rulepacks/state/ga/us-ga-idea-b-2026/rules'),
];

async function invokedCalculators(): Promise<ReadonlySet<string>> {
  const invoked = new Set<string>();
  for (const dir of RULE_DIRS) {
    for (const entry of await readdir(dir)) {
      if (!entry.endsWith('.yaml')) continue;
      const text = await readFile(path.join(dir, entry), 'utf8');
      const raw = parseYaml(text) as { calculator?: string };
      if (raw.calculator) invoked.add(raw.calculator);
      // Calculators can also be invoked from inside a condition expression.
      for (const match of text.matchAll(/name:\s*([a-z0-9_]+_v\d+)/g)) {
        if (match[1]) invoked.add(match[1]);
      }
    }
  }
  return invoked;
}

describe('calculator allow-list', () => {
  it('contains no name that a shipped rule does not invoke', async () => {
    const invoked = await invokedCalculators();
    const orphans = CALCULATOR_REGISTRY.filter((name) => !invoked.has(name));
    expect(orphans).toEqual([]);
  });

  it('contains every calculator a shipped rule invokes', async () => {
    const allowed = new Set<string>(CALCULATOR_REGISTRY);
    const unlisted = [...(await invokedCalculators())].filter((name) => !allowed.has(name));
    expect(unlisted).toEqual([]);
  });

  it('versions every name, so statutory arithmetic can change without rewriting history', () => {
    for (const name of CALCULATOR_REGISTRY) expect(name).toMatch(/_v\d+$/);
  });
});
