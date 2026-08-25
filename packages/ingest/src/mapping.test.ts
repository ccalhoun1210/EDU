/**
 * Behavioural tests for versioned mapping templates.
 *
 * Spec: Master Technical Buildout sections 10.4 and 10.6. CLAUDE.md invariants 2 and 3.
 *
 * A mapping template is customer-authored data, so the properties worth defending are the
 * ones that stop a district's renamed column from becoming a quietly empty compliance
 * figure: a missing column is reported with the column name and a remedy, a required field
 * that produces nothing is an error rather than a blank, and every value that survives
 * carries the chain back to the raw text it came from.
 *
 * Fixtures are synthetic. No real district appears here.
 */

import { describe, expect, it } from 'vitest';
import { parseCsv, type ParsedRow } from './csv.js';
import {
  MappingTemplateSchema,
  applyFieldMapping,
  applyMapping,
  unmappedColumns,
  type FieldMapping,
  type MappingContext,
  type MappingTemplate,
  type MergeStrategy,
  type ValueType,
} from './mapping.js';
import type { TransformStep } from './transform.js';

const CONTEXT: MappingContext = {
  importJobId: 'job_2028_q1_expenditures',
  sourceFileId: 'file_expenditures_fy2028',
  sourceHash: 'f'.repeat(64),
};

interface FieldSpec {
  readonly target: string;
  readonly sources: readonly string[];
  readonly valueType?: ValueType;
  readonly required?: boolean;
  readonly transforms?: readonly TransformStep[];
  readonly merge?: MergeStrategy;
  readonly separator?: string;
}

function field(spec: FieldSpec): FieldMapping {
  return {
    target: spec.target,
    valueType: spec.valueType ?? 'text',
    sources: spec.sources,
    transforms: spec.transforms ?? [],
    required: spec.required ?? false,
    classification: 'INTERNAL',
    ...(spec.merge === undefined ? {} : { merge: spec.merge }),
    ...(spec.separator === undefined ? {} : { separator: spec.separator }),
  };
}

function template(fields: readonly FieldMapping[]): MappingTemplate {
  return {
    templateId: 'tpl_fiscal_expenditure',
    version: '3.1.0',
    sourceSystem: 'Meadowvale Regional ERP',
    targetEntity: 'expenditure_fact',
    fields,
  };
}

/** Parse a fixture and hand back the header plus one data row. */
function rowOf(csv: string, index = 0): { header: readonly string[]; row: ParsedRow } {
  const parsed = parseCsv(csv);
  const row = parsed.rows[index];
  if (row === undefined) throw new Error(`fixture has no data row at index ${index}`);
  return { header: parsed.header, row };
}

const EXPENDITURES = `LEA_ID,LEA_NAME,FISCAL_YEAR,FUND_CODE,LOCAL_ACTUAL,STATE_ACTUAL,CHILD_COUNT
LEA-4412,Larkspur Hollow USD,FY2028,3310,"1,250,000.00","480,000.00",412
`;

describe('applyFieldMapping — a column the file does not have', () => {
  it('is an ERROR when the field is required', () => {
    const { header, row } = rowOf(EXPENDITURES);
    const mapping = field({
      target: 'federal_actual_expenditure',
      sources: ['FEDERAL_ACTUAL'],
      valueType: 'money',
      required: true,
    });

    const { issues } = applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT);

    expect(issues[0]?.severity).toBe('ERROR');
    expect(issues[0]?.code).toBe('MISSING_COLUMN');
  });

  // One absent column currently yields two issues for the same root cause: MISSING_COLUMN
  // from the lookup, then MISSING_REQUIRED_VALUE because the merged value is null.
  // `reconcile` counts both codes into `missingRequiredFields`, so a district is told two
  // fields are missing when one column was renamed — and the same summary is their only
  // evidence of what the platform did with their file (§10.5). The transform-failure branch
  // already guards against this with `else if`; the missing-column branch does not.
  // Correct behaviour: a row that has already reported MISSING_COLUMN for a field must not
  // also report MISSING_REQUIRED_VALUE for that field.
  it.todo('reports one absent required column as a single issue, not two');

  it('currently reports both MISSING_COLUMN and MISSING_REQUIRED_VALUE (double count)', () => {
    const { header, row } = rowOf(EXPENDITURES);
    const mapping = field({
      target: 'federal_actual_expenditure',
      sources: ['FEDERAL_ACTUAL'],
      valueType: 'money',
      required: true,
    });

    const codes = applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT).issues.map(
      (issue) => issue.code,
    );

    expect(codes).toEqual(['MISSING_COLUMN', 'MISSING_REQUIRED_VALUE']);
  });

  it('is only a WARNING when the field is optional', () => {
    const { header, row } = rowOf(EXPENDITURES);
    const mapping = field({
      target: 'federal_actual_expenditure',
      sources: ['FEDERAL_ACTUAL'],
      valueType: 'money',
      required: false,
    });

    const { issues } = applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('WARNING');
    expect(issues[0]?.code).toBe('MISSING_COLUMN');
    // An optional field that produces nothing is not additionally a missing-value error.
  });

  it('names the missing column and tells the district to update the named template', () => {
    const { header, row } = rowOf(EXPENDITURES);
    const mapping = field({
      target: 'federal_actual_expenditure',
      sources: ['FEDERAL_ACTUAL'],
      required: true,
    });
    const tpl = template([mapping]);

    const issue = applyFieldMapping(mapping, row, header, tpl, CONTEXT).issues[0];

    // The message has to be actionable without opening the file: the column that is absent,
    // the field it feeds, the row it was looked for on, and the template to correct.
    expect(issue?.message).toContain('FEDERAL_ACTUAL');
    expect(issue?.sourceColumn).toBe('FEDERAL_ACTUAL');
    expect(issue?.targetField).toBe('federal_actual_expenditure');
    expect(issue?.sourceRow).toBe(1);
    expect(issue?.resolution).toContain(tpl.templateId);
    expect(issue?.resolution).toMatch(/update template/i);
  });

  it('reports one issue per missing source when several are named', () => {
    const { header, row } = rowOf(EXPENDITURES);
    const mapping = field({
      target: 'federal_actual_expenditure',
      sources: ['FEDERAL_ACTUAL', 'FEDERAL_ACTUAL_REVISED'],
      merge: 'coalesce',
      required: true,
    });

    const { issues, value } = applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT);

    expect(
      issues.filter((issue) => issue.code === 'MISSING_COLUMN').map((issue) => issue.sourceColumn),
    ).toEqual(['FEDERAL_ACTUAL', 'FEDERAL_ACTUAL_REVISED']);
    // Nothing was guessed at: an absent column contributes null, not an empty string.
    expect(value.value).toBeNull();
    expect(value.provenance.sourceValues).toEqual([null, null]);
  });

  // The file DOES have the column; the row is short, so `cellAt` returns undefined for a
  // different reason and the mapper cannot tell the two apart. Reported as
  // MISSING_COLUMN ("the file has no column CHILD_COUNT"), which sends a business officer to
  // edit a template that is in fact correct. Correct behaviour: when the column exists in
  // the header but the row has too few cells, raise a distinct code (the row is short /
  // truncated) naming the row, so the remedy points at the export rather than the mapping.
  it.todo('distinguishes a short row from a column the file genuinely lacks');

  it('still reports the column as absent when the row is short (current behaviour)', () => {
    // Documents the conflation above so the fix has a baseline to change.
    const ragged = `LEA_ID,FISCAL_YEAR,CHILD_COUNT\nLEA-4412,FY2028\n`;
    const { header, row } = rowOf(ragged);
    const mapping = field({ target: 'child_count', sources: ['CHILD_COUNT'], required: true });

    const { issues } = applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT);

    expect(issues[0]?.code).toBe('MISSING_COLUMN');
    expect(header).toContain('CHILD_COUNT');
  });
});

describe('merge strategies', () => {
  const TWO_COLUMNS = `LEA_ID,PRIMARY_AMOUNT,FALLBACK_AMOUNT
LEA-4412,,"9,900.00"
`;

  it('"first" takes the first named source even when it is blank and a later one is not', () => {
    const { header, row } = rowOf(TWO_COLUMNS);
    const mapping = field({
      target: 'amount',
      sources: ['PRIMARY_AMOUNT', 'FALLBACK_AMOUNT'],
      merge: 'first',
    });

    const { value } = applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT);

    // "first" is positional, not a preference: it must not quietly behave like coalesce.
    expect(value.value).toBe('');
  });

  it('"coalesce" picks the first source that actually carries something', () => {
    const { header, row } = rowOf(TWO_COLUMNS);
    const mapping = field({
      target: 'amount',
      sources: ['PRIMARY_AMOUNT', 'FALLBACK_AMOUNT'],
      merge: 'coalesce',
    });

    const { value } = applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT);

    expect(value.value).toBe('9,900.00');
  });

  it('"coalesce" treats a whitespace-only cell as carrying nothing', () => {
    const csv = `LEA_ID,PRIMARY_AMOUNT,FALLBACK_AMOUNT\nLEA-4412,"   ","9,900.00"\n`;
    const { header, row } = rowOf(csv);
    const mapping = field({
      target: 'amount',
      sources: ['PRIMARY_AMOUNT', 'FALLBACK_AMOUNT'],
      merge: 'coalesce',
    });

    expect(applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT).value.value).toBe(
      '9,900.00',
    );
  });

  it('"coalesce" yields null when no source carries anything', () => {
    const csv = `LEA_ID,PRIMARY_AMOUNT,FALLBACK_AMOUNT\nLEA-4412,,\n`;
    const { header, row } = rowOf(csv);
    const mapping = field({
      target: 'amount',
      sources: ['PRIMARY_AMOUNT', 'FALLBACK_AMOUNT'],
      merge: 'coalesce',
    });

    expect(
      applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT).value.value,
    ).toBeNull();
  });

  it('"concat" joins the present sources with the declared separator', () => {
    const csv = `FUND_CODE,OBJECT_CODE\n3310,5810\n`;
    const { header, row } = rowOf(csv);
    const mapping = field({
      target: 'account_code',
      sources: ['FUND_CODE', 'OBJECT_CODE'],
      merge: 'concat',
      separator: '-',
    });

    expect(applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT).value.value).toBe(
      '3310-5810',
    );
  });

  it('"concat" skips an empty source rather than leaving a dangling separator', () => {
    const csv = `FUND_CODE,OBJECT_CODE\n3310,\n`;
    const { header, row } = rowOf(csv);
    const mapping = field({
      target: 'account_code',
      sources: ['FUND_CODE', 'OBJECT_CODE'],
      merge: 'concat',
      separator: '-',
    });

    expect(applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT).value.value).toBe(
      '3310',
    );
  });

  it('"concat" yields null, not an empty string, when every source is empty', () => {
    // A leading identifier keeps the record from being read as a blank line.
    const csv = `LEA_ID,FUND_CODE,OBJECT_CODE\nLEA-4412,,\n`;
    const { header, row } = rowOf(csv);
    const mapping = field({
      target: 'account_code',
      sources: ['FUND_CODE', 'OBJECT_CODE'],
      merge: 'concat',
      separator: '-',
    });

    expect(
      applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT).value.value,
    ).toBeNull();
  });

  it('defaults to "first" with a single space separator when neither is declared', () => {
    const { header, row } = rowOf(EXPENDITURES);
    const mapping = field({ target: 'fund_code', sources: ['FUND_CODE', 'LEA_ID'] });

    expect(applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT).value.value).toBe(
      '3310',
    );
  });
});

describe('required fields', () => {
  it('raises MISSING_REQUIRED_VALUE when the transform chain yields null', () => {
    const csv = `LEA_ID,LOCAL_ACTUAL\nLEA-4412,   \n`;
    const { header, row } = rowOf(csv);
    const mapping = field({
      target: 'local_actual_expenditure',
      sources: ['LOCAL_ACTUAL'],
      valueType: 'money',
      required: true,
      transforms: [{ transform: 'nullIfBlank' }],
    });

    const { issues, value } = applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT);

    expect(value.value).toBeNull();
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('MISSING_REQUIRED_VALUE');
    expect(issues[0]?.severity).toBe('ERROR');
    expect(issues[0]?.targetField).toBe('local_actual_expenditure');
    expect(issues[0]?.sourceRow).toBe(1);
  });

  it('raises no MISSING_REQUIRED_VALUE for an optional field that yields null', () => {
    const csv = `LEA_ID,NOTE\nLEA-4412,\n`;
    const { header, row } = rowOf(csv);
    const mapping = field({
      target: 'note',
      sources: ['NOTE'],
      required: false,
      transforms: [{ transform: 'nullIfBlank' }],
    });

    expect(applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT).issues).toEqual([]);
  });

  // transform.ts is explicit that null means "no value" and the empty string is a value, so a
  // required field with no nullIfBlank step accepts a blank cell. Recorded as designed
  // behaviour rather than a defect: making blank mean missing is the template author's job.
  it('treats a blank cell as a supplied value unless the template says otherwise', () => {
    const csv = `LEA_ID,LOCAL_ACTUAL\nLEA-4412,\n`;
    const { header, row } = rowOf(csv);
    const mapping = field({
      target: 'local_actual_expenditure',
      sources: ['LOCAL_ACTUAL'],
      required: true,
      transforms: [{ transform: 'trim' }],
    });

    const { issues, value } = applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT);

    expect(value.value).toBe('');
    expect(issues).toEqual([]);
  });

  it('reports a failed transform as an ERROR for a required field and never guesses a value', () => {
    // European grouping. The parser refuses it rather than reading 1.234,56 as 1.234.
    const csv = `LEA_ID,LOCAL_ACTUAL\nLEA-4412,"1.234,56"\n`;
    const { header, row } = rowOf(csv);
    const mapping = field({
      target: 'local_actual_expenditure',
      sources: ['LOCAL_ACTUAL'],
      valueType: 'money',
      required: true,
      transforms: [{ transform: 'trim' }, { transform: 'parseCurrency' }],
    });

    const { issues, value } = applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT);

    expect(value.value).toBeNull();
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('ERROR');
    expect(issues[0]?.code).toBe('UNRECOGNISED_FORMAT');
    expect(issues[0]?.resolution).toMatch(/not guessed at/i);
    // A failed transform is reported once — not also as MISSING_REQUIRED_VALUE, which would
    // double-count one problem in the reconciliation summary.
    expect(issues.map((issue) => issue.code)).not.toContain('MISSING_REQUIRED_VALUE');
  });

  it('demotes a failed transform to a WARNING for an optional field', () => {
    const csv = `LEA_ID,NOTE_AMOUNT\nLEA-4412,"1.234,56"\n`;
    const { header, row } = rowOf(csv);
    const mapping = field({
      target: 'note_amount',
      sources: ['NOTE_AMOUNT'],
      valueType: 'money',
      required: false,
      transforms: [{ transform: 'parseCurrency' }],
    });

    expect(
      applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT).issues[0]?.severity,
    ).toBe('WARNING');
  });
});

describe('provenance on every mapped value', () => {
  it('records the row, line, source fields, RAW values, template, version and chain', () => {
    const csv = `LEA_ID,FUND_CODE,OBJECT_CODE\nLEA-4412,"3310","5810"\n`;
    const { header, row } = rowOf(csv);
    const mapping = field({
      target: 'account_code',
      sources: ['FUND_CODE', 'OBJECT_CODE'],
      merge: 'concat',
      separator: '-',
      transforms: [{ transform: 'trim' }, { transform: 'upperCase' }],
    });
    const tpl = template([mapping]);

    const { value } = applyFieldMapping(mapping, row, header, tpl, CONTEXT);

    expect(value.provenance).toEqual({
      importJobId: CONTEXT.importJobId,
      sourceFileId: CONTEXT.sourceFileId,
      sourceHash: CONTEXT.sourceHash,
      sourceRow: 1,
      sourceLine: 2,
      sourceFields: ['FUND_CODE', 'OBJECT_CODE'],
      sourceValues: ['3310', '5810'],
      mappingTemplateId: 'tpl_fiscal_expenditure',
      mappingVersion: '3.1.0',
      transformation: 'trim → upperCase',
    });
  });

  it('keeps the raw text as it appeared, not the transformed result', () => {
    const csv = `LEA_ID,LOCAL_ACTUAL\nLEA-4412,"  $1,250,000.00 "\n`;
    const { header, row } = rowOf(csv);
    const mapping = field({
      target: 'local_actual_expenditure',
      sources: ['LOCAL_ACTUAL'],
      valueType: 'money',
      transforms: [{ transform: 'trim' }, { transform: 'parseCurrency' }],
    });

    const { value } = applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT);

    // The whole point of §10.6: the monitor is shown the cell as the district typed it,
    // alongside the number the platform computed from it.
    expect(value.provenance.sourceValues).toEqual(['  $1,250,000.00 ']);
    expect(value.value).toBe('1250000.00');
    expect(value.provenance.transformation).toBe('trim → parseCurrency');
  });

  it('describes an empty transform chain as "identity" rather than leaving it blank', () => {
    const { header, row } = rowOf(EXPENDITURES);
    const mapping = field({ target: 'fund_code', sources: ['FUND_CODE'] });

    expect(
      applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT).value.provenance
        .transformation,
    ).toBe('identity');
  });

  it('carries the physical line, which diverges from the row once a field embeds a newline', () => {
    const csv = `LEA_ID,LEA_NAME,FUND_CODE\nLEA-4412,"Larkspur\nHollow USD",3310\nLEA-7781,Beacon Ridge SD,3315\n`;
    const { header, row } = rowOf(csv, 1);
    const mapping = field({ target: 'fund_code', sources: ['FUND_CODE'] });

    const { value } = applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT);

    expect(value.provenance.sourceRow).toBe(2);
    expect(value.provenance.sourceLine).toBe(4);
  });

  it('provenances a value even when the mapping failed, so the failure is traceable too', () => {
    const csv = `LEA_ID,LOCAL_ACTUAL\nLEA-4412,not-a-number\n`;
    const { header, row } = rowOf(csv);
    const mapping = field({
      target: 'local_actual_expenditure',
      sources: ['LOCAL_ACTUAL'],
      valueType: 'money',
      required: true,
      transforms: [{ transform: 'parseCurrency' }],
    });

    const { value } = applyFieldMapping(mapping, row, header, template([mapping]), CONTEXT);

    expect(value.value).toBeNull();
    expect(value.provenance.sourceValues).toEqual(['not-a-number']);
    expect(value.provenance.sourceRow).toBe(1);
  });
});

describe('applyMapping', () => {
  it('produces one value per declared field, in template order, with the row number', () => {
    const { header, row } = rowOf(EXPENDITURES);
    const tpl = template([
      field({ target: 'lea_id', sources: ['LEA_ID'], required: true }),
      field({
        target: 'local_actual_expenditure',
        sources: ['LOCAL_ACTUAL'],
        valueType: 'money',
        required: true,
        transforms: [{ transform: 'parseCurrency' }],
      }),
      field({
        target: 'child_count',
        sources: ['CHILD_COUNT'],
        valueType: 'count',
        required: true,
        transforms: [{ transform: 'parseInteger' }],
      }),
    ]);

    const mapped = applyMapping(tpl, row, header, CONTEXT);

    expect(mapped.sourceRow).toBe(1);
    expect(mapped.values.map((value) => value.target)).toEqual([
      'lea_id',
      'local_actual_expenditure',
      'child_count',
    ]);
    expect(mapped.values.map((value) => value.value)).toEqual(['LEA-4412', '1250000.00', '412']);
    expect(mapped.issues).toEqual([]);
  });

  it('accumulates the issues of every field rather than stopping at the first', () => {
    const csv = `LEA_ID,LOCAL_ACTUAL,CHILD_COUNT\nLEA-4412,"1.234,56",\n`;
    const { header, row } = rowOf(csv);
    const tpl = template([
      field({
        target: 'local_actual_expenditure',
        sources: ['LOCAL_ACTUAL'],
        valueType: 'money',
        required: true,
        transforms: [{ transform: 'parseCurrency' }],
      }),
      field({
        target: 'child_count',
        sources: ['CHILD_COUNT'],
        valueType: 'count',
        required: true,
        transforms: [{ transform: 'parseInteger' }],
      }),
      field({ target: 'federal_actual', sources: ['FEDERAL_ACTUAL'], required: false }),
    ]);

    const mapped = applyMapping(tpl, row, header, CONTEXT);

    expect(mapped.issues.map((issue) => issue.targetField)).toEqual([
      'local_actual_expenditure',
      'child_count',
      'federal_actual',
    ]);
  });

  it('carries the declared classification onto the mapped value', () => {
    const { header, row } = rowOf(EXPENDITURES);
    const mapping: FieldMapping = {
      target: 'lea_name',
      valueType: 'text',
      sources: ['LEA_NAME'],
      transforms: [],
      required: false,
      classification: 'CONFIDENTIAL',
    };

    expect(
      applyMapping(template([mapping]), row, header, CONTEXT).values[0]?.classification,
    ).toBe('CONFIDENTIAL');
  });
});

describe('unmappedColumns', () => {
  it('reports the columns no mapping reads and excludes every mapped one', () => {
    const parsed = parseCsv(EXPENDITURES);
    const tpl = template([
      field({ target: 'lea_id', sources: ['LEA_ID'] }),
      field({ target: 'fiscal_year', sources: ['FISCAL_YEAR'] }),
      field({
        target: 'total_actual',
        sources: ['LOCAL_ACTUAL', 'STATE_ACTUAL'],
        merge: 'concat',
      }),
    ]);

    expect(unmappedColumns(tpl, parsed.header)).toEqual(['LEA_NAME', 'FUND_CODE', 'CHILD_COUNT']);
  });

  it('excludes a merge source, not just the first source of a field', () => {
    const parsed = parseCsv(EXPENDITURES);
    const tpl = template([
      field({ target: 'total_actual', sources: ['LOCAL_ACTUAL', 'STATE_ACTUAL'] }),
    ]);

    expect(unmappedColumns(tpl, parsed.header)).not.toContain('STATE_ACTUAL');
  });

  it('ignores a blank column name, which cannot be mapped and is reported by the parser', () => {
    const parsed = parseCsv(`LEA_ID,,CHILD_COUNT\nLEA-4412,x,412\n`);
    const tpl = template([field({ target: 'lea_id', sources: ['LEA_ID'] })]);

    expect(unmappedColumns(tpl, parsed.header)).toEqual(['CHILD_COUNT']);
  });

  it('is empty when every column is read', () => {
    const parsed = parseCsv(`LEA_ID,CHILD_COUNT\nLEA-4412,412\n`);
    const tpl = template([
      field({ target: 'lea_id', sources: ['LEA_ID'] }),
      field({ target: 'child_count', sources: ['CHILD_COUNT'] }),
    ]);

    expect(unmappedColumns(tpl, parsed.header)).toEqual([]);
  });

  it('does not invent an entry for a mapped source the file does not contain', () => {
    const parsed = parseCsv(`LEA_ID\nLEA-4412\n`);
    const tpl = template([field({ target: 'x', sources: ['NOT_IN_FILE'] })]);

    expect(unmappedColumns(tpl, parsed.header)).toEqual(['LEA_ID']);
  });
});

describe('MappingTemplateSchema', () => {
  const valid = {
    templateId: 'tpl_fiscal_expenditure',
    version: '3.1.0',
    sourceSystem: 'Meadowvale Regional ERP',
    targetEntity: 'expenditure_fact',
    fields: [
      {
        target: 'local_actual_expenditure',
        valueType: 'money',
        sources: ['LOCAL_ACTUAL'],
        transforms: [{ transform: 'parseCurrency' }],
        required: true,
        classification: 'INTERNAL',
      },
    ],
  };

  it('accepts a well-formed template', () => {
    expect(MappingTemplateSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects two mappings writing to the same canonical field', () => {
    const duplicated = {
      ...valid,
      fields: [
        valid.fields[0],
        {
          target: 'local_actual_expenditure',
          valueType: 'money',
          sources: ['LOCAL_ACTUAL_REVISED'],
          transforms: [{ transform: 'parseCurrency' }],
          required: true,
          classification: 'INTERNAL',
        },
      ],
    };

    const result = MappingTemplateSchema.safeParse(duplicated);

    expect(result.success).toBe(false);
    // The refusal must explain the danger: the second mapping would overwrite the first with
    // no trace, so a district would see a figure sourced from a column they did not intend.
    expect(result.error?.issues[0]?.message).toMatch(/same canonical field/i);
  });

  it('rejects a template with no fields at all', () => {
    expect(MappingTemplateSchema.safeParse({ ...valid, fields: [] }).success).toBe(false);
  });

  it('rejects a field with no source column', () => {
    const noSources = {
      ...valid,
      fields: [{ ...valid.fields[0], sources: [] }],
    };
    expect(MappingTemplateSchema.safeParse(noSources).success).toBe(false);
  });

  it('rejects an unknown value type rather than defaulting it to text', () => {
    const badType = { ...valid, fields: [{ ...valid.fields[0], valueType: 'currency' }] };
    expect(MappingTemplateSchema.safeParse(badType).success).toBe(false);
  });

  it('rejects an unknown merge strategy', () => {
    const badMerge = { ...valid, fields: [{ ...valid.fields[0], merge: 'last' }] };
    expect(MappingTemplateSchema.safeParse(badMerge).success).toBe(false);
  });

  it('rejects a classification outside the domain vocabulary', () => {
    const badClass = { ...valid, fields: [{ ...valid.fields[0], classification: 'SECRET' }] };
    expect(MappingTemplateSchema.safeParse(badClass).success).toBe(false);
  });

  it('rejects a transform step that names no transform', () => {
    const badStep = { ...valid, fields: [{ ...valid.fields[0], transforms: [{ op: 'trim' }] }] };
    expect(MappingTemplateSchema.safeParse(badStep).success).toBe(false);
  });

  it('rejects a blank templateId or version, which would break provenance', () => {
    expect(MappingTemplateSchema.safeParse({ ...valid, templateId: '' }).success).toBe(false);
    expect(MappingTemplateSchema.safeParse({ ...valid, version: '' }).success).toBe(false);
  });

  it('defaults an omitted transform chain to empty rather than failing', () => {
    const noTransforms = {
      ...valid,
      fields: [
        {
          target: 'fund_code',
          valueType: 'text',
          sources: ['FUND_CODE'],
          required: false,
          classification: 'INTERNAL',
        },
      ],
    };

    const result = MappingTemplateSchema.safeParse(noTransforms);

    expect(result.success).toBe(true);
    expect(result.data?.fields[0]?.transforms).toEqual([]);
  });
});
