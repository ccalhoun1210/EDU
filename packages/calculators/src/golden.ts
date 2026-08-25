/**
 * The regulatory golden test corpus.
 *
 * Spec: Master Technical Buildout section 26.1 — *"This is the most important test suite in
 * the company."* CLAUDE.md: *"Tests before calculators. A regulatory calculator gets its
 * golden test corpus written from the statute first. The test set is the specification; the
 * function is the implementation."*
 *
 * ## Why the corpus is YAML and not TypeScript
 *
 * The audience is a domain reviewer and eventually a reviewing attorney, neither of whom
 * should have to read TypeScript to check that the platform computes maintenance of effort
 * correctly. A case is a statement about the law: *given these figures, the statute produces
 * this answer, and here is the arithmetic.* That belongs in a form a non-engineer can read,
 * argue with, and sign off.
 *
 * It also means the corpus can be written before the implementation exists, which is the
 * order the house rules require and the only order in which the tests are genuinely a
 * specification rather than a description of whatever the code happened to do.
 *
 * ## The `derivation` field
 *
 * Every case shows its arithmetic in prose. Nothing executes it — it is there so a reviewer
 * can check an expected value by hand without running anything, and so that a case whose
 * expected number was quietly adjusted to match a buggy implementation becomes obvious: the
 * derivation and the expectation stop agreeing.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { EVALUATION_STATUSES } from '@complianceos/domain';

/** Section 26.1's required case kinds. */
export const CASE_INTENTS = [
  'pass',
  'fail',
  'boundary',
  'missing-data',
  'exception',
  'historical',
  'not-applicable',
  'risk',
  'manual-review',
] as const;

export type CaseIntent = (typeof CASE_INTENTS)[number];

/**
 * The kinds every calculator must cover before it is done.
 *
 * Section 26.1 lists passing, failing, exact boundary, missing data, exception, and
 * historical/effective-date. The first four are required of every calculator here; exception
 * and historical are required only where the statute has one, which cannot be determined
 * mechanically, so they are covered per calculator rather than universally enforced.
 */
export const REQUIRED_INTENTS: readonly CaseIntent[] = ['pass', 'fail', 'boundary', 'missing-data'];

const CaseValue: z.ZodType<unknown> = z.unknown();

export const GoldenCaseSchema = z.object({
  case: z.string().min(1),
  intent: z.enum(CASE_INTENTS),
  /** The regulatory point this case pins down, in one sentence. */
  asserts: z.string().min(1),
  inputs: z.record(z.string(), CaseValue),
  expect: z.object({
    status: z.enum(EVALUATION_STATUSES),
    /** Matched exactly, sorted. Present on any case whose point is that data was absent. */
    missingInputs: z.array(z.string()).optional(),
    /** Subset match: a case pins the outputs it is about, not the whole object. */
    output: z.record(z.string(), CaseValue).optional(),
    /** Subset match on the shown work, keyed by step key. Values compared as strings. */
    steps: z.record(z.string(), z.string()).optional(),
    /** Warning codes the case requires. Subset — extra warnings do not fail a case. */
    warnings: z.array(z.string()).optional(),
  }),
  /** The arithmetic, shown, so a reviewer can check the expectation by hand. */
  derivation: z.string().min(1),
});

export type GoldenCase = z.infer<typeof GoldenCaseSchema>;

export const GoldenCorpusSchema = z.object({
  calculator: z.string().min(1),
  /** The provisions these cases are derived from. */
  authority: z.array(z.string().min(1)).min(1),
  /**
   * Anything a reviewer must know before reading the cases — in particular, any place the
   * corpus encodes a platform interpretation rather than a settled reading of the regulation.
   */
  notes: z.string().min(1).optional(),
  cases: z.array(GoldenCaseSchema).min(1),
});

export type GoldenCorpus = z.infer<typeof GoldenCorpusSchema>;

export class GoldenCorpusError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(`${file}: ${message}`);
    this.name = 'GoldenCorpusError';
  }
}

export interface LoadedCorpus extends GoldenCorpus {
  readonly file: string;
}

export async function loadGoldenCorpus(file: string): Promise<LoadedCorpus> {
  const parsed = GoldenCorpusSchema.safeParse(parseYaml(await readFile(file, 'utf8')));
  if (!parsed.success) {
    throw new GoldenCorpusError(
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'} — ${issue.message}`)
        .join('; '),
      file,
    );
  }

  const seen = new Set<string>();
  for (const testCase of parsed.data.cases) {
    if (seen.has(testCase.case)) {
      throw new GoldenCorpusError(`duplicate case id "${testCase.case}"`, file);
    }
    seen.add(testCase.case);
  }

  return { ...parsed.data, file };
}

export async function loadGoldenCorpora(dir: string): Promise<readonly LoadedCorpus[]> {
  const entries = (await readdir(dir)).filter((name) => name.endsWith('.yaml')).sort();
  return Promise.all(entries.map((name) => loadGoldenCorpus(path.join(dir, name))));
}

/** Which of the required case kinds a corpus is missing. */
export function missingRequiredIntents(corpus: GoldenCorpus): readonly CaseIntent[] {
  const present = new Set(corpus.cases.map((testCase) => testCase.intent));
  return REQUIRED_INTENTS.filter((intent) => !present.has(intent));
}
