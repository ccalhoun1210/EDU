/**
 * Purity, enforced by inspection rather than by trust.
 *
 * Spec: Master Technical Buildout section 8.5 — *"Calculator functions must be pure and
 * deterministic. No network calls. No database calls. Input object in, output object out."*
 * CLAUDE.md invariant 5 adds the arithmetic half.
 *
 * A calculator that reads the clock breaks section 2.5's reproducibility without failing any
 * golden case: every case would still pass on the day it was written. The failure appears
 * years later, when a finalized run cannot be reproduced and nobody can say why. So the
 * prohibition is checked against the source text, which is crude but is the only thing that
 * catches it before it matters.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = import.meta.dirname;

interface Banned {
  readonly pattern: RegExp;
  readonly why: string;
}

const BANNED: readonly Banned[] = [
  { pattern: /\bDate\.now\b/, why: 'reads the clock; a run must reproduce years later' },
  { pattern: /\bnew Date\b/, why: 'reads the clock, and drags a timezone into a calendar date' },
  { pattern: /\bMath\.random\b/, why: 'a compliance determination cannot be sampled' },
  { pattern: /\bperformance\.now\b/, why: 'reads the clock' },
  { pattern: /\bprocess\.env\b/, why: 'makes the result depend on deployment configuration' },
  { pattern: /\bfetch\s*\(/, why: 'section 8.5 forbids network calls in a calculator' },
  { pattern: /\bparseFloat\b/, why: 'invariant 5 — money and ratios are exact decimals' },
  { pattern: /\bNumber\.parseFloat\b/, why: 'invariant 5 — money and ratios are exact decimals' },
  { pattern: /\beval\s*\(/, why: 'invariant 2 — no arbitrary code execution, anywhere' },
  { pattern: /\bnew Function\b/, why: 'invariant 2 — no arbitrary code execution, anywhere' },
];

async function calculatorSources(): Promise<readonly { file: string; text: string }[]> {
  const entries = (await readdir(SRC)).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  );
  return Promise.all(
    entries.sort().map(async (name) => ({
      file: name,
      text: await readFile(path.join(SRC, name), 'utf8'),
    })),
  );
}

const sources = await calculatorSources();

describe('calculator purity', () => {
  it('has sources to check', () => {
    // Guards against the suite passing because the directory scan silently found nothing.
    expect(sources.length).toBeGreaterThan(0);
  });

  for (const { pattern, why } of BANNED) {
    it(`uses no ${pattern.source.replace(/\\b/g, '')} — ${why}`, () => {
      for (const { file, text } of sources) {
        // Strip comments first: this file and others legitimately name these constructs in
        // prose explaining why they are forbidden.
        const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(pattern.test(code), `${file} contains ${pattern.source}`).toBe(false);
      }
    });
  }
});
