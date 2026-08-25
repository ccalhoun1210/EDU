/**
 * The import pipeline.
 *
 * Spec: Master Technical Buildout section 10.2:
 *
 * ```text
 * UPLOAD/CONNECT -> QUARANTINE -> MALWARE SCAN -> HASH/MANIFEST -> PARSE
 *   -> SCHEMA DETECTION -> FIELD MAPPING -> VALIDATION -> NORMALIZATION
 *   -> RECONCILIATION -> CANONICAL FACT PROJECTION -> DATA SNAPSHOT -> RULE EVALUATION
 * ```
 *
 * ## What this module does and does not do
 *
 * Quarantine and malware scanning are infrastructure, not arithmetic, and this package does
 * not pretend to implement them. But they are not omitted either: `ImportRequest` requires a
 * `ScanResult`, and a file that is not `CLEAN` never reaches the parser. The scan is
 * therefore a precondition the type system enforces, rather than a step in a diagram that
 * nothing checks. When a scanning service is wired up it fills that field; until then the
 * pipeline cannot be called without a caller stating explicitly what the scan concluded.
 *
 * Everything from PARSE to DATA SNAPSHOT is here and is real.
 */

import type { CanonicalValue } from '@complianceos/domain';
import { parseCsv, type CsvParseOptions } from './csv.js';
import {
  applyMapping,
  unmappedColumns,
  type MappedValue,
  type MappingContext,
  type MappingTemplate,
} from './mapping.js';
import type { FactProvenance, SourceFileRef } from './provenance.js';
import { reconcile, type ReconciliationSummary } from './reconcile.js';
import { buildSnapshot, type CanonicalFact, type DataSnapshot } from './snapshot.js';
import { quarantines, type ValidationIssue } from './validate.js';

export const SCAN_STATUSES = ['CLEAN', 'INFECTED', 'FAILED', 'PENDING'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export interface ScanResult {
  readonly status: ScanStatus;
  readonly scanner: string;
  readonly scannedAt: string;
}

/**
 * How a mapped row identifies the thing it is about.
 *
 * A district's fiscal export is one row per (LEA, fiscal year); a programmatic export is one
 * row per case event. The key fields are mapped targets, so the subject is identified after
 * transformation: a fiscal year written `FY2028` in the file and normalised to `2028` keys
 * the same subject as one written `2028`.
 */
export interface SubjectBinding {
  readonly subjectType: string;
  readonly keyFields: readonly string[];
  readonly separator?: string;
}

export interface ImportRequest {
  readonly importJobId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly snapshotId: string;
  /** Supplied by the caller; this package never reads the clock. */
  readonly createdAt: string;
  readonly file: SourceFileRef;
  readonly scan: ScanResult;
  readonly content: string;
  readonly template: MappingTemplate;
  readonly subject: SubjectBinding;
  readonly parseOptions?: CsvParseOptions;
}

export const IMPORT_OUTCOMES = ['REJECTED_AT_SCAN', 'PARSE_FAILED', 'COMPLETED'] as const;
export type ImportOutcomeKind = (typeof IMPORT_OUTCOMES)[number];

export interface ImportOutcome {
  readonly kind: ImportOutcomeKind;
  readonly importJobId: string;
  readonly issues: readonly ValidationIssue[];
  readonly reconciliation?: ReconciliationSummary;
  readonly snapshot?: DataSnapshot;
}

/**
 * Convert a mapped string into its canonical value.
 *
 * Money stays a decimal string all the way into the snapshot, never a number at any point
 * (invariant 5). A count becomes an integer because that is what it is, and because
 * `canonicalize` accepts whole numbers precisely so counts need not be stringly typed.
 */
function toCanonicalValue(mapped: MappedValue): CanonicalValue | undefined {
  if (mapped.value === null) return undefined;

  switch (mapped.valueType) {
    case 'count': {
      const parsed = Number(mapped.value);
      return Number.isSafeInteger(parsed) ? parsed : undefined;
    }
    case 'boolean':
      return mapped.value === 'true';
    case 'money':
    case 'date':
    case 'text':
      return mapped.value;
  }
}

function subjectKey(values: readonly MappedValue[], binding: SubjectBinding): string | undefined {
  const parts: string[] = [];
  for (const field of binding.keyFields) {
    const value = values.find((candidate) => candidate.target === field)?.value;
    if (value === null || value === undefined || value === '') return undefined;
    parts.push(value);
  }
  return parts.join(binding.separator ?? '/');
}

export function runImport(request: ImportRequest): ImportOutcome {
  // MALWARE SCAN gate. A file that has not been cleared never reaches the parser, and the
  // refusal names the status rather than reporting a generic failure.
  if (request.scan.status !== 'CLEAN') {
    return {
      kind: 'REJECTED_AT_SCAN',
      importJobId: request.importJobId,
      issues: [
        {
          severity: 'ERROR',
          code: 'SCAN_NOT_CLEAN',
          message: `${request.file.originalFilename} has scan status ${request.scan.status}`,
          resolution:
            request.scan.status === 'PENDING'
              ? 'The scan has not finished. Retry the import once it has.'
              : 'The file cannot be imported. Upload a clean export.',
        },
      ],
    };
  }

  // PARSE.
  const parsed = parseCsv(request.content, request.parseOptions);
  const issues: ValidationIssue[] = parsed.issues.map((issue) => ({
    severity: issue.code === 'RAGGED_ROW' ? 'ERROR' : 'WARNING',
    code: issue.code,
    message: issue.message,
    ...(issue.lineNumber === undefined ? {} : { sourceLine: issue.lineNumber }),
    ...(issue.rowNumber === undefined ? {} : { sourceRow: issue.rowNumber }),
    ...(issue.column === undefined ? {} : { sourceColumn: issue.column }),
  }));

  if (parsed.header.length === 0 || parsed.rows.length === 0) {
    return { kind: 'PARSE_FAILED', importJobId: request.importJobId, issues };
  }

  const context: MappingContext = {
    importJobId: request.importJobId,
    sourceFileId: request.file.sourceFileId,
    sourceHash: request.file.sourceHash,
  };

  // FIELD MAPPING, VALIDATION, NORMALIZATION.
  const facts: CanonicalFact[] = [];
  const seen = new Map<string, { value: CanonicalValue; provenance: FactProvenance }>();
  let accepted = 0;
  let quarantined = 0;
  let duplicateCandidates = 0;

  const keyFieldSet = new Set(request.subject.keyFields);

  for (const row of parsed.rows) {
    const mapped = applyMapping(request.template, row, parsed.header, context);
    const rowIssues = [...mapped.issues];

    const key = subjectKey(mapped.values, request.subject);
    if (key === undefined) {
      rowIssues.push({
        severity: 'ERROR',
        code: 'UNIDENTIFIED_SUBJECT',
        message:
          `the row supplies no value for ${request.subject.keyFields.join(', ')}, so there is ` +
          'nothing to attribute its figures to',
        resolution: 'Ensure every row carries the identifying columns the mapping names.',
        sourceRow: row.rowNumber,
        sourceLine: row.lineNumber,
      });
    }

    const rowRejected = rowIssues.some(quarantines);
    issues.push(...rowIssues);

    if (rowRejected || key === undefined) {
      quarantined += 1;
      continue;
    }

    let conflicted = false;

    for (const value of mapped.values) {
      if (keyFieldSet.has(value.target)) continue;
      const canonical = toCanonicalValue(value);
      if (canonical === undefined) continue;

      const identity = `${key} ${value.target}`;
      const previous = seen.get(identity);

      if (previous !== undefined) {
        if (previous.value === canonical) {
          // The same figure stated twice. Harmless, but reported: section 10.5 counts
          // duplicate candidates so a district can tell whether their export repeats itself.
          duplicateCandidates += 1;
          continue;
        }
        // Two different values for one fact. Never resolved by picking one: the finding
        // would be internally consistent and computed from an arbitrary half of the data.
        conflicted = true;
        issues.push({
          severity: 'ERROR',
          code: 'CONFLICTING_VALUE',
          message:
            `row ${row.rowNumber} sets ${value.target} for ${key} to a value that disagrees ` +
            `with row ${previous.provenance.sourceRow}`,
          resolution:
            'Decide which row is correct in the source export and re-import. The platform ' +
            'will not choose between them.',
          sourceRow: row.rowNumber,
          sourceLine: row.lineNumber,
          targetField: value.target,
        });
        continue;
      }

      seen.set(identity, { value: canonical, provenance: value.provenance });
      facts.push({
        subjectType: request.subject.subjectType,
        subjectId: key,
        field: value.target,
        value: canonical,
        classification: value.classification,
        provenance: value.provenance,
      });
    }

    if (conflicted) quarantined += 1;
    else accepted += 1;
  }

  // RECONCILIATION. Throws if the arithmetic does not balance.
  const reconciliation = reconcile({
    rowsReceived: parsed.rows.length,
    acceptedRows: accepted,
    quarantinedRows: quarantined,
    issues,
    duplicateCandidates,
    unmappedColumns: unmappedColumns(request.template, parsed.header),
    parseIssues: parsed.issues,
  });

  // CANONICAL FACT PROJECTION, then DATA SNAPSHOT.
  const snapshot = buildSnapshot({
    snapshotId: request.snapshotId,
    tenantId: request.tenantId,
    organizationId: request.organizationId,
    createdAt: request.createdAt,
    sourceFiles: [request.file],
    facts,
  });

  return { kind: 'COMPLETED', importJobId: request.importJobId, issues, reconciliation, snapshot };
}
