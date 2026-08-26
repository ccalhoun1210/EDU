/**
 * The reconciliation summary.
 *
 * Spec: Master Technical Buildout section 10.5. *"Never silently discard records."*
 *
 * Every import ends with this. It is a small object and it carries most of the trust in the
 * ingestion pipeline, because it is the district's only evidence that the platform saw what
 * they sent.
 *
 * `assertBalanced` is the part that matters. Rows received must equal rows accepted plus rows
 * quarantined, exactly. A summary that does not balance means a row went somewhere
 * unaccounted for, and an import that reports "14,246 accepted" while 35 rows vanished is
 * how a maintenance-of-effort figure ends up short by an amount nobody can find.
 */

import type { CsvIssue } from './csv.js';
import { issuesBySeverity, type ValidationIssue } from './validate.js';

export interface ReconciliationSummary {
  readonly rowsReceived: number;
  readonly rowsAccepted: number;
  readonly rowsQuarantined: number;
  readonly warnings: number;
  readonly duplicateCandidates: number;
  readonly missingRequiredFields: number;
  readonly unmappedColumns: readonly string[];
  readonly parseIssues: readonly CsvIssue[];
}

export class ReconciliationImbalanceError extends Error {
  constructor(summary: ReconciliationSummary) {
    super(
      `reconciliation does not balance: ${summary.rowsReceived} received but ` +
        `${summary.rowsAccepted} accepted + ${summary.rowsQuarantined} quarantined = ` +
        `${summary.rowsAccepted + summary.rowsQuarantined}. Some rows are unaccounted for, ` +
        'which means the import cannot honestly report what it did with the district’s data.',
    );
    this.name = 'ReconciliationImbalanceError';
  }
}

export function assertBalanced(summary: ReconciliationSummary): void {
  if (summary.rowsAccepted + summary.rowsQuarantined !== summary.rowsReceived) {
    throw new ReconciliationImbalanceError(summary);
  }
}

export interface ReconcileRequest {
  readonly rowsReceived: number;
  readonly acceptedRows: number;
  readonly quarantinedRows: number;
  readonly issues: readonly ValidationIssue[];
  readonly duplicateCandidates: number;
  readonly unmappedColumns: readonly string[];
  readonly parseIssues: readonly CsvIssue[];
}

export function reconcile(request: ReconcileRequest): ReconciliationSummary {
  const counts = issuesBySeverity(request.issues);

  const summary: ReconciliationSummary = {
    rowsReceived: request.rowsReceived,
    rowsAccepted: request.acceptedRows,
    rowsQuarantined: request.quarantinedRows,
    warnings: counts.WARNING,
    duplicateCandidates: request.duplicateCandidates,
    missingRequiredFields: request.issues.filter(
      (issue) => issue.code === 'MISSING_REQUIRED_VALUE' || issue.code === 'MISSING_COLUMN',
    ).length,
    unmappedColumns: request.unmappedColumns,
    parseIssues: request.parseIssues,
  };

  assertBalanced(summary);
  return summary;
}

/** The §10.5 report, rendered the way the spec shows it. */
export function formatReconciliation(summary: ReconciliationSummary): string {
  const rows: readonly (readonly [string, number])[] = [
    ['Rows received', summary.rowsReceived],
    ['Rows accepted', summary.rowsAccepted],
    ['Rows quarantined', summary.rowsQuarantined],
    ['Warnings', summary.warnings],
    ['Duplicate candidates', summary.duplicateCandidates],
    ['Missing required fields', summary.missingRequiredFields],
  ];
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  return rows
    .map(([label, value]) => `${`${label}:`.padEnd(width)}${String(value).padStart(10)}`)
    .join('\n');
}
