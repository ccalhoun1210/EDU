/**
 * Validation issues.
 *
 * Spec: Master Technical Buildout sections 10.5 and 19. Threat model row "import poisoning".
 *
 * The governing rule is §10.5: **never silently discard records.** Every problem found
 * anywhere in the pipeline becomes an issue on this shape, carrying enough location for a
 * district to go and fix the source — and every issue is counted in the reconciliation
 * summary, so the arithmetic of what came in and what was accepted always balances.
 */

export const ISSUE_SEVERITIES = ['ERROR', 'WARNING', 'INFO'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export interface ValidationIssue {
  readonly severity: IssueSeverity;
  readonly code: string;
  readonly message: string;
  /** What the district should do about it. An issue with no remedy is a complaint. */
  readonly resolution?: string;
  readonly sourceRow?: number;
  readonly sourceLine?: number;
  readonly sourceColumn?: string;
  readonly targetField?: string;
}

/**
 * An ERROR quarantines its row; a WARNING does not.
 *
 * The distinction is whether the platform can proceed *honestly*. A row whose required
 * expenditure amount will not parse cannot contribute to a maintenance-of-effort figure, so
 * it is quarantined and counted. A row with an unexpected extra column is odd but harmless,
 * so it is a warning and the row is used.
 */
export function quarantines(issue: ValidationIssue): boolean {
  return issue.severity === 'ERROR';
}

export function issuesBySeverity(
  issues: readonly ValidationIssue[],
): Readonly<Record<IssueSeverity, number>> {
  const counts: Record<IssueSeverity, number> = { ERROR: 0, WARNING: 0, INFO: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}
