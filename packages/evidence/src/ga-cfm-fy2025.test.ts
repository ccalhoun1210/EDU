/**
 * Content check for the shipped Georgia instrument.
 *
 * This runs in CI for the same reason rule packs are validated in CI: an instrument that
 * references a rule nobody wrote is the schema-level version of a menu item that 404s, and
 * it should fail the build rather than surface as an empty indicator in front of a monitor.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  allIndicators,
  findSection,
  loadInstrument,
  unresolvedRuleReferences,
} from './instrument.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const INSTRUMENT = path.join(REPO_ROOT, 'instruments/ga-gadoe-cfm/fy2025/instrument.yaml');
const RULE_DIRS = [
  path.join(REPO_ROOT, 'rulepacks/federal/idea-b/us-fed-idea-b-2026/rules'),
  path.join(REPO_ROOT, 'rulepacks/state/ga/us-ga-idea-b-2026/rules'),
];

async function availableRuleIds(): Promise<ReadonlySet<string>> {
  const ids = new Set<string>();
  for (const dir of RULE_DIRS) {
    for (const entry of await readdir(dir)) {
      if (!entry.endsWith('.yaml')) continue;
      const raw = parseYaml(await readFile(path.join(dir, entry), 'utf8')) as { ruleId?: string };
      if (raw.ruleId) ids.add(raw.ruleId);
    }
  }
  return ids;
}

describe('GaDOE Cross-Functional Monitoring FY2025', () => {
  it('parses against the instrument schema', async () => {
    const instrument = await loadInstrument(INSTRUMENT);
    expect(instrument.instrumentId).toBe('GA-GADOE-CFM');
    expect(instrument.version).toBe('FY2025');
    expect(instrument.monitoringCycleYears).toBe(4);
  });

  it('models Section 18 as the five IDEA fiscal indicators GaDOE scores', async () => {
    const instrument = await loadInstrument(INSTRUMENT);
    const section = findSection(instrument, '18');
    expect(section?.indicators.map((i) => i.indicatorId)).toEqual([
      '18.1',
      '18.2',
      '18.3',
      '18.4',
      '18.5',
    ]);
  });

  it('references only rules that a shipped pack actually provides', async () => {
    const instrument = await loadInstrument(INSTRUMENT);
    expect(unresolvedRuleReferences(instrument, await availableRuleIds())).toEqual([]);
  });

  it('carries the Georgia-only parent mentor indicator, which has no federal analogue', async () => {
    const instrument = await loadInstrument(INSTRUMENT);
    const indicator = allIndicators(instrument).find((i) => i.indicatorId === '18.5');
    expect(indicator?.satisfiedByRules).toEqual(['GA-IDEA-PARENT-MENTOR-001']);
  });

  it('marks the indicators that only apply in some years as conditional', async () => {
    const instrument = await loadInstrument(INSTRUMENT);
    const conditional = allIndicators(instrument)
      .filter((i) => i.conditional)
      .map((i) => i.indicatorId);
    expect(conditional).toEqual(['18.3', '18.4']);
  });
});
