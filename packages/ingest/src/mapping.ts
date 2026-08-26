/**
 * Versioned mapping templates.
 *
 * Spec: Master Technical Buildout section 10.4.
 *
 * A district administrator maps source columns onto canonical fields in a visual UI. What
 * that UI produces is one of these: pure data, versioned, reusable across imports from the
 * same source system, and recorded on every fact it produces so a value can be traced back
 * to the mapping that made it (§10.6).
 *
 * The template is data rather than an expression language for the same reason rules are
 * (invariant 2), and with more force: the author here is a customer, outside the
 * organisation, and a mapping that could compute would be customer-authored code running on
 * the server.
 */

import { z } from 'zod';
import { DATA_CLASSIFICATIONS, type DataClassification } from '@complianceos/domain';
import { lookupCell, type ParsedRow } from './csv.js';
import { applyTransforms, describeTransforms, type TransformStep } from './transform.js';
import type { FactProvenance } from './provenance.js';
import type { ValidationIssue } from './validate.js';

/** How several source columns combine into one canonical field (§10.4 "split/merge fields"). */
export const MERGE_STRATEGIES = ['first', 'concat', 'coalesce'] as const;
export type MergeStrategy = (typeof MERGE_STRATEGIES)[number];

/**
 * The canonical type of the mapped value.
 *
 * Declared rather than inferred from the transformation chain. Inference would guess, and the
 * difference between a count and a money amount decides whether the value reaches the engine
 * as an integer or as an exact decimal string, which is invariant 5 at the boundary where
 * district text becomes a fact.
 */
export const VALUE_TYPES = ['money', 'count', 'date', 'boolean', 'text'] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

export interface FieldMapping {
  readonly target: string;
  readonly valueType: ValueType;
  readonly sources: readonly string[];
  readonly merge?: MergeStrategy;
  readonly separator?: string;
  readonly transforms: readonly TransformStep[];
  readonly required: boolean;
  readonly classification: DataClassification;
  readonly description?: string;
}

export interface MappingTemplate {
  readonly templateId: string;
  readonly version: string;
  readonly sourceSystem: string;
  /** The canonical entity the mapped rows become — e.g. `expenditure_fact`. */
  readonly targetEntity: string;
  readonly fields: readonly FieldMapping[];
}

// The schema exists so a template arriving from the mapping UI, or from a stored template
// row, is validated before it is applied — a malformed template must fail at load rather
// than produce quietly wrong facts.
const TransformStepSchema: z.ZodType<TransformStep> = z.custom<TransformStep>(
  (value) => typeof value === 'object' && value !== null && 'transform' in value,
  { message: 'each transform step must name a transform' },
);

export const FieldMappingSchema = z.object({
  target: z.string().min(1),
  valueType: z.enum(VALUE_TYPES),
  sources: z.array(z.string().min(1)).min(1),
  merge: z.enum(MERGE_STRATEGIES).optional(),
  separator: z.string().optional(),
  transforms: z.array(TransformStepSchema).default([]),
  required: z.boolean(),
  classification: z.enum(DATA_CLASSIFICATIONS),
  description: z.string().min(1).optional(),
});

export const MappingTemplateSchema = z
  .object({
    templateId: z.string().min(1),
    version: z.string().min(1),
    sourceSystem: z.string().min(1),
    targetEntity: z.string().min(1),
    fields: z.array(FieldMappingSchema).min(1),
  })
  .refine(
    (template) => new Set(template.fields.map((f) => f.target)).size === template.fields.length,
    { message: 'two mappings write to the same canonical field; the later one would win silently' },
  );

export interface MappedValue {
  readonly target: string;
  readonly valueType: ValueType;
  readonly value: string | null;
  readonly classification: DataClassification;
  readonly provenance: FactProvenance;
}

export interface MappedRow {
  readonly sourceRow: number;
  readonly values: readonly MappedValue[];
  readonly issues: readonly ValidationIssue[];
}

export interface MappingContext {
  readonly importJobId: string;
  readonly sourceFileId: string;
  readonly sourceHash: string;
}

function combine(
  values: readonly (string | null)[],
  strategy: MergeStrategy,
  separator: string,
): string | null {
  switch (strategy) {
    case 'first':
      return values[0] ?? null;
    case 'coalesce':
      // The first source that actually carries something. For an export where the same
      // figure appears in one of two columns depending on the fund type.
      return values.find((value) => value !== null && value.trim() !== '') ?? null;
    case 'concat': {
      const present = values.filter((value): value is string => value !== null && value !== '');
      return present.length === 0 ? null : present.join(separator);
    }
  }
}

/** Apply one field mapping to one parsed row. */
export function applyFieldMapping(
  mapping: FieldMapping,
  row: ParsedRow,
  header: readonly string[],
  template: MappingTemplate,
  context: MappingContext,
): { value: MappedValue; issues: readonly ValidationIssue[] } {
  const issues: ValidationIssue[] = [];

  // Set when the value could not be read at all, so the required-value check below does not
  // report the same absence a second time under a different code. One renamed column
  // producing two entries in `missingRequiredFields` tells a district two fields are missing
  // when one is — and the reconciliation summary is their only evidence of what the platform
  // did with their file (spec 10.5).
  let unreadable = false;

  const rawValues = mapping.sources.map((column) => {
    const lookup = lookupCell(row, header, column);

    if (lookup.status === 'NO_SUCH_COLUMN') {
      // A renamed column in a district's export is the single most common cause of a
      // silently empty compliance figure, so this is reported rather than swallowed.
      unreadable = true;
      issues.push({
        severity: mapping.required ? 'ERROR' : 'WARNING',
        code: 'MISSING_COLUMN',
        message: `the file has no column "${column}"`,
        resolution:
          `Either the export changed shape or the mapping is out of date. Update template ` +
          `${template.templateId} to point at the column that now carries this value.`,
        sourceRow: row.rowNumber,
        sourceLine: row.lineNumber,
        sourceColumn: column,
        targetField: mapping.target,
      });
      return null;
    }

    if (lookup.status === 'ROW_TOO_SHORT') {
      unreadable = true;
      issues.push({
        severity: mapping.required ? 'ERROR' : 'WARNING',
        code: 'ROW_TOO_SHORT',
        message:
          `row ${row.rowNumber} has ${lookup.present} fields and stops before "${column}", ` +
          `which the header places at ${lookup.declared} columns wide`,
        resolution:
          'The mapping is correct; the export is not. A row shorter than its header usually ' +
          'means an unquoted delimiter or a truncated write. Fix the export and re-import.',
        sourceRow: row.rowNumber,
        sourceLine: row.lineNumber,
        sourceColumn: column,
        targetField: mapping.target,
      });
      return null;
    }

    return lookup.value;
  });

  const merged = combine(rawValues, mapping.merge ?? 'first', mapping.separator ?? ' ');
  const outcome = applyTransforms(merged, mapping.transforms);

  if (outcome.issue !== undefined) {
    issues.push({
      severity: mapping.required ? 'ERROR' : 'WARNING',
      code: outcome.issue.code,
      message: outcome.issue.message,
      resolution:
        'Correct the value in the source export, or add a transformation to the mapping that ' +
        'recognises this format. The value was not guessed at.',
      sourceRow: row.rowNumber,
      sourceLine: row.lineNumber,
      sourceColumn: mapping.sources.join(', '),
      targetField: mapping.target,
    });
  } else if (mapping.required && outcome.value === null && !unreadable) {
    issues.push({
      severity: 'ERROR',
      code: 'MISSING_REQUIRED_VALUE',
      message: `${mapping.target} is required and this row supplies no value for it`,
      resolution:
        'Supply the value in the source export, or mark the field optional if the ' +
        'requirement it feeds genuinely does not apply to this district.',
      sourceRow: row.rowNumber,
      sourceLine: row.lineNumber,
      sourceColumn: mapping.sources.join(', '),
      targetField: mapping.target,
    });
  }

  const provenance: FactProvenance = {
    importJobId: context.importJobId,
    sourceFileId: context.sourceFileId,
    sourceHash: context.sourceHash,
    sourceRow: row.rowNumber,
    sourceLine: row.lineNumber,
    sourceFields: mapping.sources,
    sourceValues: rawValues,
    mappingTemplateId: template.templateId,
    mappingVersion: template.version,
    transformation: describeTransforms(mapping.transforms),
  };

  return {
    value: {
      target: mapping.target,
      valueType: mapping.valueType,
      value: outcome.value,
      classification: mapping.classification,
      provenance,
    },
    issues,
  };
}

export function applyMapping(
  template: MappingTemplate,
  row: ParsedRow,
  header: readonly string[],
  context: MappingContext,
): MappedRow {
  const values: MappedValue[] = [];
  const issues: ValidationIssue[] = [];

  for (const mapping of template.fields) {
    const applied = applyFieldMapping(mapping, row, header, template, context);
    values.push(applied.value);
    issues.push(...applied.issues);
  }

  return { sourceRow: row.rowNumber, values, issues };
}

/**
 * Columns in the file that no mapping reads.
 *
 * Informational, never an error — district exports carry all sorts of columns this platform
 * has no use for. It is surfaced because an unmapped column named something like
 * `LOCAL_ACTUAL_REVISED` is usually the one the mapping should have been pointing at.
 */
export function unmappedColumns(
  template: MappingTemplate,
  header: readonly string[],
): readonly string[] {
  const used = new Set(template.fields.flatMap((field) => field.sources));
  return header.filter((column) => column !== '' && !used.has(column));
}
