/**
 * Evaluation vocabulary for the compliance engine.
 *
 * Spec: Master Technical Buildout section 8.6. Missing required data produces
 * INDETERMINATE — never an artificial PASS or FAIL.
 */

export const EVALUATION_STATUSES = [
  'PASS',
  'FAIL',
  'RISK',
  'INDETERMINATE',
  'MANUAL_REVIEW',
  'NOT_APPLICABLE',
] as const;

export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

export const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type Severity = (typeof SEVERITIES)[number];

/** Statuses that represent an answered question, as opposed to an unanswerable one. */
const CONCLUSIVE: ReadonlySet<EvaluationStatus> = new Set<EvaluationStatus>([
  'PASS',
  'FAIL',
  'RISK',
  'NOT_APPLICABLE',
]);

export function isConclusive(status: EvaluationStatus): boolean {
  return CONCLUSIVE.has(status);
}

/**
 * Resolve the status of a subject from the statuses of the rules evaluated against it.
 *
 * Precedence is deliberate: an unanswerable rule outranks a passing one, because a
 * district cannot be told it is compliant on the strength of data that never arrived.
 */
const PRECEDENCE: readonly EvaluationStatus[] = [
  'FAIL',
  'RISK',
  'INDETERMINATE',
  'MANUAL_REVIEW',
  'PASS',
  'NOT_APPLICABLE',
];

export function rollUpStatus(statuses: readonly EvaluationStatus[]): EvaluationStatus {
  if (statuses.length === 0) return 'NOT_APPLICABLE';
  for (const candidate of PRECEDENCE) {
    if (statuses.includes(candidate)) return candidate;
  }
  return 'NOT_APPLICABLE';
}
