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

import { isAmountString, isCalendarDate, type CanonicalValue } from '@complianceos/domain';
import { parseCsv, type CsvParseOptions } from './csv.js';
import {
  applyMapping,
  unmappedColumns,
  type MappedValue,
  type MappingContext,
  type MappingTemplate,
} from './mapping.js';
import type { SourceFileRef } from './provenance.js';
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
 * The three ways a mapped value can turn into a canonical one.
 *
 * `INVALID` is the case that matters. A value the pipeline cannot convert used to vanish —
 * the fact never reached the snapshot, the row was still counted as accepted, and no issue
 * was raised anywhere, so the reconciliation summary told the district their row was fine.
 * That is exactly the silent discard section 10.5 forbids.
 */
type Conversion =
  | { readonly kind: 'ABSENT' }
  | { readonly kind: 'VALUE'; readonly value: CanonicalValue }
  | { readonly kind: 'INVALID'; readonly reason: string };

/**
 * Convert a mapped string into its canonical value.
 *
 * Money stays a decimal string all the way into the snapshot, never a number at any point
 * (invariant 5). A count becomes an integer because that is what it is, and because
 * `canonicalize` accepts whole numbers precisely so counts need not be stringly typed.
 *
 * Each type is validated rather than coerced. `Number('')` is `0`, so a count field whose
 * template happens to omit `parseInteger` would otherwise turn an empty cell into a child
 * count of zero — a figure the district never supplied, recorded as fact, with provenance
 * pointing at an empty cell.
 */
function toCanonicalValue(mapped: MappedValue): Conversion {
  if (mapped.value === null) return { kind: 'ABSENT' };

  switch (mapped.valueType) {
    case 'count': {
      const text = mapped.value.trim();
      if (!/^\d+$/.test(text)) {
        return { kind: 'INVALID', reason: `"${mapped.value}" is not a whole, non-negative count` };
      }
      const parsed = Number(text);
      if (!Number.isSafeInteger(parsed)) {
        return { kind: 'INVALID', reason: `"${mapped.value}" is too large to count exactly` };
      }
      return { kind: 'VALUE', value: parsed };
    }

    case 'boolean': {
      if (mapped.value === 'true') return { kind: 'VALUE', value: true };
      if (mapped.value === 'false') return { kind: 'VALUE', value: false };
      return { kind: 'INVALID', reason: `"${mapped.value}" is neither true nor false` };
    }

    case 'money': {
      if (!isAmountString(mapped.value)) {
        return {
          kind: 'INVALID',
          reason:
            `"${mapped.value}" is not a canonical amount. The mapping for this field needs a ` +
            'currency-parsing step.',
        };
      }
      return { kind: 'VALUE', value: mapped.value };
    }

    case 'date': {
      if (!isCalendarDate(mapped.value)) {
        return {
          kind: 'INVALID',
          reason:
            `"${mapped.value}" is not a YYYY-MM-DD calendar date. The mapping for this field ` +
            'needs a date-parsing step.',
        };
      }
      return { kind: 'VALUE', value: mapped.value };
    }

    case 'text':
      return { kind: 'VALUE', value: mapped.value };
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

interface FactCandidate {
  readonly identity: string;
  readonly fact: CanonicalFact;
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

  const issues: ValidationIssue[] = [];
  // Parse problems that name a row are held back and merged into that row's own issue list,
  // so they reach the quarantine decision. Pushing them straight onto the outcome meant a
  // ragged row could be reported as an ERROR and then accepted anyway — the summary condemning
  // a row whose figures the platform went on to use.
  const parseIssuesByRow = new Map<number, ValidationIssue[]>();

  for (const issue of parsed.issues) {
    const mapped: ValidationIssue = {
      severity: issue.code === 'RAGGED_ROW' ? 'ERROR' : 'WARNING',
      code: issue.code,
      message: issue.message,
      ...(issue.code === 'RAGGED_ROW'
        ? {
            resolution:
              'A row whose field count differs from the header usually means an unquoted ' +
              'delimiter, which shifts every column after it. Fix the export and re-import.',
          }
        : {}),
      ...(issue.lineNumber === undefined ? {} : { sourceLine: issue.lineNumber }),
      ...(issue.rowNumber === undefined ? {} : { sourceRow: issue.rowNumber }),
      ...(issue.column === undefined ? {} : { sourceColumn: issue.column }),
    };

    if (issue.rowNumber === undefined) issues.push(mapped);
    else {
      const existing = parseIssuesByRow.get(issue.rowNumber);
      if (existing === undefined) parseIssuesByRow.set(issue.rowNumber, [mapped]);
      else existing.push(mapped);
    }
  }

  if (parsed.header.length === 0 || parsed.rows.length === 0) {
    // Never a bare failure. A district shown a failed import with no stated reason has been
    // told less than nothing. Only added when the parser said nothing of its own — an empty
    // file already reports EMPTY_FILE, and repeating it under a second code would inflate the
    // problem count in the one summary the district uses to judge what happened to their file.
    if (issues.length === 0) {
      issues.push({
        severity: 'ERROR',
        code: parsed.header.length === 0 ? 'NO_HEADER_ROW' : 'NO_DATA_ROWS',
        message:
          parsed.header.length === 0
            ? `${request.file.originalFilename} has no header row, so no column can be mapped`
            : `${request.file.originalFilename} has a header row but no data rows`,
        resolution:
          'Check that the export ran over the intended fiscal period and produced records, ' +
          'then upload it again.',
      });
    }
    return { kind: 'PARSE_FAILED', importJobId: request.importJobId, issues };
  }

  const context: MappingContext = {
    importJobId: request.importJobId,
    sourceFileId: request.file.sourceFileId,
    sourceHash: request.file.sourceHash,
  };

  // FIELD MAPPING, VALIDATION, NORMALIZATION.
  const committed = new Map<string, CanonicalFact>();
  // Facts the file states two different values for. Withdrawn entirely at the end rather than
  // resolved: see the note at the conflict branch.
  const disputed = new Set<string>();

  let accepted = 0;
  let quarantined = 0;
  let duplicateCandidates = 0;

  const keyFieldSet = new Set(request.subject.keyFields);

  for (const row of parsed.rows) {
    const mapped = applyMapping(request.template, row, parsed.header, context);
    const rowIssues: ValidationIssue[] = [
      ...mapped.issues,
      ...(parseIssuesByRow.get(row.rowNumber) ?? []),
    ];

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

    // Build this row's facts without committing any of them. Nothing a row produces reaches
    // the snapshot until the whole row is known to be acceptable — otherwise a row rejected
    // half way through leaves the facts it had already emitted behind.
    const candidates: FactCandidate[] = [];

    if (key !== undefined) {
      for (const value of mapped.values) {
        if (keyFieldSet.has(value.target)) continue;

        const conversion = toCanonicalValue(value);
        if (conversion.kind === 'ABSENT') continue;

        if (conversion.kind === 'INVALID') {
          rowIssues.push({
            severity: 'ERROR',
            code: 'UNCONVERTIBLE_VALUE',
            message: `${value.target}: ${conversion.reason}`,
            resolution:
              'Correct the value in the source export, or add the transformation the mapping ' +
              'is missing. Nothing was substituted for it.',
            sourceRow: row.rowNumber,
            sourceLine: row.lineNumber,
            targetField: value.target,
          });
          continue;
        }

        candidates.push({
          identity: `${key} ${value.target}`,
          fact: {
            subjectType: request.subject.subjectType,
            subjectId: key,
            field: value.target,
            value: conversion.value,
            classification: value.classification,
            // Everything this pipeline produces came out of a file a district uploaded. It is
            // not a parameter: an import cannot elect to speak with the platform's authority,
            // which is the whole point of recording origin at all.
            origin: 'DISTRICT_EXPORT',
            provenance: value.provenance,
          },
        });
      }
    }

    let rowDuplicates = 0;

    for (const candidate of candidates) {
      const previous = committed.get(candidate.identity);
      if (previous === undefined) continue;

      if (previous.value === candidate.fact.value) {
        // The same figure stated twice. Harmless, but reported: section 10.5 counts duplicate
        // candidates so a district can tell whether their export repeats itself.
        rowDuplicates += 1;
        continue;
      }

      // Two different values for one fact. The field is withdrawn entirely — not resolved by
      // keeping whichever arrived first, which is choosing, just choosing badly. With no fact
      // at all the rule evaluates to INDETERMINATE for want of data (invariant 9) instead of
      // returning a confident answer computed from an arbitrary half of the district's file.
      disputed.add(candidate.identity);
      rowIssues.push({
        severity: 'ERROR',
        code: 'CONFLICTING_VALUE',
        message:
          `row ${row.rowNumber} sets ${candidate.fact.field} for ${key} to a value that ` +
          `disagrees with row ${previous.provenance.sourceRow}`,
        resolution:
          'Decide which row is correct in the source export and re-import. The platform will ' +
          'not choose between them, so this figure is absent until you do.',
        sourceRow: row.rowNumber,
        sourceLine: row.lineNumber,
        targetField: candidate.fact.field,
      });
    }

    issues.push(...rowIssues);

    if (key === undefined || rowIssues.some(quarantines)) {
      quarantined += 1;
      continue;
    }

    for (const candidate of candidates) {
      if (!committed.has(candidate.identity)) committed.set(candidate.identity, candidate.fact);
    }
    duplicateCandidates += rowDuplicates;
    accepted += 1;
  }

  // Withdraw every disputed field, including the value committed by the row that arrived
  // first. Done after the loop because the disagreement is only visible once both rows exist.
  for (const identity of disputed) committed.delete(identity);

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
    facts: [...committed.values()],
  });

  return { kind: 'COMPLETED', importJobId: request.importJobId, issues, reconciliation, snapshot };
}
