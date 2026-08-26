/**
 * The golden corpus runner.
 *
 * Spec section 26.1. This file is deliberately thin: it loads the YAML corpora, runs each
 * case against the registered calculator, and asserts. All the regulatory content lives in
 * `packages/calculators/golden/`, where a domain reviewer can read it.
 *
 * The asymmetry in what it enforces is the point of the house rule "tests before
 * calculators": a corpus may exist without an implementation — that is a specification
 * waiting to be built — but an implementation may not exist without a corpus.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALCULATOR_REGISTRY, CALCULATORS } from './registry.js';
import { loadGoldenCorpora, missingRequiredIntents, type LoadedCorpus } from './golden.js';
import type { CalculationStep } from './types.js';

const GOLDEN_DIR = path.join(import.meta.dirname, '../golden');

const corpora: readonly LoadedCorpus[] = await loadGoldenCorpora(GOLDEN_DIR);

function stepValue(steps: readonly CalculationStep[], key: string): string | undefined {
  return steps.find((step) => step.key === key)?.value;
}

describe('the golden corpus', () => {
  it('covers every implemented calculator', () => {
    // An implementation with no corpus is a regulatory calculation nobody checked against the
    // statute. It is the one direction of this relationship that is never acceptable.
    const covered = new Set(corpora.map((corpus) => corpus.calculator));
    for (const name of CALCULATORS.keys()) {
      expect(covered, `${name} has no golden corpus`).toContain(name);
    }
  });

  it('names a calculator the allow-list permits', () => {
    // A corpus for a name no rule pack may reference tests something unreachable. Checked
    // against the allow-list rather than against the implementations, because a corpus
    // legitimately precedes its implementation.
    for (const corpus of corpora) {
      expect(CALCULATOR_REGISTRY, `${corpus.file}`).toContain(corpus.calculator);
    }
  });

  it('cites every provision its calculator implements', () => {
    // The corpus's authority list is what a domain reviewer reads to know what the cases are
    // derived from. When it is narrower than the calculator's, a provision is exercised by a
    // case — 34 CFR 300.704(c) is the ground behind HIGH_COST_FUND_ASSUMPTION — while the
    // document a reviewer checks never mentions it.
    for (const corpus of corpora) {
      const calculator = CALCULATORS.get(corpus.calculator as never);
      if (calculator === undefined) continue;
      const cited = new Set(corpus.authority);
      const uncited = calculator.authority.filter((provision) => !cited.has(provision));
      expect(uncited, `${corpus.file} does not cite`).toEqual([]);
    }
  });

  it('holds at most one corpus per calculator', () => {
    const names = corpora.map((corpus) => corpus.calculator);
    expect(new Set(names).size, `duplicate corpora: ${names.join(', ')}`).toBe(names.length);
  });
});

// Each corpus gets its own describe block so a failure names the calculator and the case
// rather than an index into an array.
for (const corpus of corpora) {
  const calculator = CALCULATORS.get(corpus.calculator as never);

  describe(`${corpus.calculator}`, () => {
    it('covers the case kinds section 26.1 requires', () => {
      expect(missingRequiredIntents(corpus)).toEqual([]);
    });

    it('cites the authority every case is derived from', () => {
      expect(corpus.authority.length).toBeGreaterThan(0);
    });

    if (calculator === undefined) {
      // The corpus is a specification for a calculator that has not been written yet. That is
      // the intended order of work, so it is reported rather than failed — but it is reported
      // loudly, because a corpus nobody ever implements is a specification nobody honoured.
      it.skip(`is not implemented yet — ${corpus.cases.length} cases are waiting`, () => {});
      return;
    }

    for (const testCase of corpus.cases) {
      it(`${testCase.case}: ${testCase.asserts}`, () => {
        const result = calculator.run(testCase.inputs);

        expect(result.status, testCase.derivation).toBe(testCase.expect.status);

        if (testCase.expect.missingInputs !== undefined) {
          expect([...result.missingInputs].sort()).toEqual(
            [...testCase.expect.missingInputs].sort(),
          );
        }

        if (testCase.expect.output !== undefined) {
          expect(result.output).toMatchObject(testCase.expect.output);
        }

        if (testCase.expect.steps !== undefined) {
          for (const [key, expected] of Object.entries(testCase.expect.steps)) {
            expect(stepValue(result.steps, key), `step "${key}"`).toBe(expected);
          }
        }

        if (testCase.expect.warnings !== undefined) {
          const codes = result.warnings.map((warning) => warning.code);
          for (const code of testCase.expect.warnings) {
            expect(codes, `warning "${code}"`).toContain(code);
          }
        }
      });
    }

    it('is deterministic: the same inputs produce an identical result twice', () => {
      // Section 26.3's repeatability property. A calculator that reached for the clock or for
      // randomness would break reproducibility (section 2.5) without failing any case above.
      for (const testCase of corpus.cases) {
        const first = calculator.run(testCase.inputs);
        const second = calculator.run(testCase.inputs);
        expect(JSON.stringify(second), testCase.case).toBe(JSON.stringify(first));
      }
    });

    it('exposes its intermediate steps on every conclusive case', () => {
      // Section 35 requires calculation intermediates to be exposed, and section 40 requires
      // a "Why" behind every material conclusion. A PASS with no shown work is a black box.
      for (const testCase of corpus.cases) {
        if (testCase.expect.status === 'INDETERMINATE') continue;
        const result = calculator.run(testCase.inputs);
        expect(result.steps.length, `${testCase.case} shows no work`).toBeGreaterThan(0);
      }
    });
  });
}
