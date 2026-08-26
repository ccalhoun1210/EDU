/**
 * The sentences an assessment page says about a run.
 *
 * Separated from the page because these are the claims the product makes, not markup. Each is
 * a statement a district could be misled by if it were slightly wrong — "nothing was
 * outstanding", "the calculation did not depend on any of these" — so each is tested.
 */

import { EVALUATION_STATUSES, type EvaluationStatus } from '@complianceos/domain';
import type { EvaluationResult } from '@complianceos/rules-engine';

/**
 * How each status reads to someone who is not the platform.
 *
 * `INDETERMINATE` is the one that has to be spelled out. A district reading the bare word will
 * assume the platform is broken or that they have failed; neither is what it means. The label
 * says what actually happened — the question could not be answered — and the finding page then
 * says which data would answer it.
 */
const LABELS: Readonly<Record<EvaluationStatus, string>> = {
  PASS: 'Satisfied',
  FAIL: 'Not satisfied',
  RISK: 'At risk',
  INDETERMINATE: 'Not determined',
  MANUAL_REVIEW: 'Needs review',
  NOT_APPLICABLE: 'Does not apply',
};

export function statusLabel(status: EvaluationStatus): string {
  return LABELS[status];
}

/** Statuses that need nothing further from anybody. */
const SETTLED: ReadonlySet<EvaluationStatus> = new Set<EvaluationStatus>([
  'PASS',
  'NOT_APPLICABLE',
]);

/**
 * The single line a district reads first.
 *
 * Built from the counts rather than written per status, because the roll-up rule is what needs
 * explaining: a question the platform could not answer never rolls up as compliance (section
 * 8.6, invariant 9), and a reader seeing "Not determined" over a mostly-green table deserves to
 * be told that is deliberate.
 */
export function rollUpSentence(
  // Structural rather than `EvaluationResult`: the same sentence has to be written about a
  // run read back out of the database, where all that survives of a result is its status.
  // Widening the parameter is how one wording serves both, instead of two that drift.
  results: readonly { readonly status: EvaluationStatus }[],
  status: EvaluationStatus,
): string {
  const counts = new Map<EvaluationStatus, number>();
  for (const result of results) counts.set(result.status, (counts.get(result.status) ?? 0) + 1);

  // In the vocabulary's own order rather than in whichever order the rules happened to
  // resolve, so the sentence does not reshuffle when a rule is added to the pack.
  const breakdown = EVALUATION_STATUSES.filter((value) => counts.has(value))
    .map((value) => `${counts.get(value) ?? 0} ${statusLabel(value).toLowerCase()}`)
    .join(', ');

  const because =
    status === 'FAIL'
      ? 'A requirement that is not satisfied decides the assessment on its own.'
      : status === 'INDETERMINATE'
        ? 'A requirement the platform could not answer outranks one it could: an unanswered ' +
          'question is never reported as compliance.'
        : 'Every requirement evaluated reached a conclusion.';

  const plural = results.length === 1 ? '' : 's';
  return `${results.length} requirement${plural} evaluated — ${breakdown}. ${because}`;
}

/**
 * One line saying what is still outstanding on a requirement, or nothing if it concluded.
 *
 * The first sentence of a blocking warning only. Those are written to be read in full on the
 * finding page, where there is room; three sentences of prose in a table cell push the rows a
 * reader is scanning off the screen. The link in the same row leads to the whole thing.
 */
export function outstanding(result: EvaluationResult): string | undefined {
  const blocking = result.warnings.find((warning) => warning.severity === 'BLOCKING');
  if (blocking !== undefined) {
    const [first = blocking.message, ...rest] = blocking.message.split(/(?<=\.)\s+/);
    return rest.length === 0 ? first : `${first} …`;
  }
  if (result.missingInputs.length > 0) {
    const plural = result.missingInputs.length === 1 ? '' : 's';
    return `Waiting on ${result.missingInputs.length} input${plural} the platform does not hold.`;
  }
  return undefined;
}

/**
 * Requirements needing attention first, then by rule id.
 *
 * Stable across runs on purpose: a monitor reading two assessments side by side compares like
 * with like, and an order that depended on how the packs happened to resolve would not.
 */
export function byAttention<
  T extends { readonly status: EvaluationStatus; readonly ruleId: string },
>(results: readonly T[]): readonly T[] {
  return [...results].sort((left, right) => {
    const leftSettled = SETTLED.has(left.status) ? 1 : 0;
    const rightSettled = SETTLED.has(right.status) ? 1 : 0;
    return leftSettled - rightSettled || left.ruleId.localeCompare(right.ruleId);
  });
}
