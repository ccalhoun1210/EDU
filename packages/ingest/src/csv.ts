/**
 * Delimited-text parsing.
 *
 * Spec: Master Technical Buildout sections 10.1, 10.2 and 10.5.
 *
 * Districts start from exports, not APIs — §10.1 is explicit that the product must not depend
 * on vendor integrations to be useful. So this is the first thing a district's data touches,
 * and it sets the tone for everything downstream.
 *
 * Two decisions shape it.
 *
 * **Nothing is silently discarded.** §10.5 says so directly. A row with the wrong number of
 * cells is returned *and* reported, never dropped and never padded to fit. A district whose
 * export has 35 malformed rows must see 35 problems, because the alternative — an import that
 * says "14,246 rows accepted" while 35 vanished — produces a compliance finding computed on
 * data the district does not know is missing.
 *
 * **Every cell keeps its physical position.** §10.6 requires a finding to be traceable to the
 * exact source row and field. That means the line number as it appears in the file the
 * district actually uploaded, which is not the same as the record index once quoted fields
 * contain embedded newlines.
 *
 * Written rather than taken from a library because the provenance requirement needs per-cell
 * source positions that general-purpose parsers do not surface, and because this is the code
 * path that handles untrusted uploaded files.
 */

export const DELIMITERS = { comma: ',', tab: '\t', semicolon: ';', pipe: '|' } as const;
export type DelimiterName = keyof typeof DELIMITERS;

export interface CsvParseOptions {
  readonly delimiter?: string;
  readonly quote?: string;
  /** Treat the first record as a header row. Almost always true for district exports. */
  readonly header?: boolean;
}

export interface ParsedRow {
  /** 1-based index among data rows, excluding the header. What a user calls "row 42". */
  readonly rowNumber: number;
  /** 1-based physical line in the file where this record begins. Differs from rowNumber
   *  whenever an earlier record contained a quoted newline. */
  readonly lineNumber: number;
  readonly cells: readonly string[];
}

export const CSV_ISSUE_CODES = [
  'RAGGED_ROW',
  'UNCLOSED_QUOTE',
  'EMPTY_FILE',
  'MISSING_HEADER',
  'DUPLICATE_HEADER',
  'BLANK_HEADER',
] as const;

export type CsvIssueCode = (typeof CSV_ISSUE_CODES)[number];

export interface CsvIssue {
  readonly code: CsvIssueCode;
  readonly message: string;
  readonly lineNumber?: number;
  readonly rowNumber?: number;
  readonly column?: string;
}

export interface ParsedCsv {
  readonly header: readonly string[];
  readonly rows: readonly ParsedRow[];
  readonly issues: readonly CsvIssue[];
  /** Records read from the file, header included. Reconciliation starts from this. */
  readonly recordsRead: number;
}

interface RawRecord {
  readonly lineNumber: number;
  readonly cells: string[];
}

/**
 * Split the text into records and cells.
 *
 * A hand-written state machine rather than a regex: RFC 4180 quoting — where `""` inside a
 * quoted field is a literal quote and a newline inside quotes is data — is not a regular
 * language, and the near-miss regex versions of this fail on exactly the files that matter,
 * the ones with an address or a comment field containing a comma.
 */
function splitRecords(
  text: string,
  delimiter: string,
  quote: string,
): {
  records: RawRecord[];
  unclosedQuoteAt: number | undefined;
} {
  const records: RawRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let recordStartLine = 1;
  let sawAnyContent = false;
  let unclosedQuoteAt: number | undefined;

  const endCell = (): void => {
    cells.push(cell);
    cell = '';
  };

  const endRecord = (): void => {
    endCell();
    records.push({ lineNumber: recordStartLine, cells });
    cells = [];
    sawAnyContent = false;
    recordStartLine = line;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === quote) {
        if (text[index + 1] === quote) {
          cell += quote;
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === '\n') line += 1;
        cell += char;
      }
      continue;
    }

    if (char === quote && cell === '') {
      inQuotes = true;
      sawAnyContent = true;
      // The line the quote opened on, not the line the record started on: for a record with
      // an embedded newline those differ, and it is the opening quote the district needs
      // pointing at.
      unclosedQuoteAt = line;
      continue;
    }

    if (char === delimiter) {
      endCell();
      sawAnyContent = true;
      continue;
    }

    if (char === '\r') {
      // Consume CRLF as one terminator; a lone CR is treated as a terminator too, because
      // classic-Mac line endings still arrive from older district systems.
      if (text[index + 1] === '\n') index += 1;
      line += 1;
      endRecord();
      unclosedQuoteAt = undefined;
      continue;
    }

    if (char === '\n') {
      line += 1;
      endRecord();
      unclosedQuoteAt = undefined;
      continue;
    }

    sawAnyContent = true;
    cell += char;
  }

  if (inQuotes) {
    // The file ended mid-quote. Keep what was read — the district needs to see the partial
    // record to find the stray quote — and report it.
    endRecord();
    return { records, unclosedQuoteAt };
  }

  // A trailing newline produces no final record; anything else does.
  if (sawAnyContent || cell !== '' || cells.length > 0) endRecord();

  return { records, unclosedQuoteAt: undefined };
}

/** True for a record that is entirely empty — a blank line, which carries no data. */
function isBlank(record: RawRecord): boolean {
  return record.cells.every((value) => value.trim() === '');
}

export function parseCsv(text: string, options: CsvParseOptions = {}): ParsedCsv {
  const delimiter = options.delimiter ?? DELIMITERS.comma;
  const quote = options.quote ?? '"';
  const hasHeader = options.header ?? true;

  // Strip a UTF-8 BOM. Excel writes one, and left in place it becomes part of the first
  // header name, so the column "Fund Code" silently fails to match its mapping.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const issues: CsvIssue[] = [];

  if (body.trim() === '') {
    return {
      header: [],
      rows: [],
      issues: [{ code: 'EMPTY_FILE', message: 'the file is empty' }],
      recordsRead: 0,
    };
  }

  const { records, unclosedQuoteAt } = splitRecords(body, delimiter, quote);

  if (unclosedQuoteAt !== undefined) {
    issues.push({
      code: 'UNCLOSED_QUOTE',
      message:
        `a quoted field beginning on line ${unclosedQuoteAt} is never closed. Everything after ` +
        'it was read as part of that one field.',
      lineNumber: unclosedQuoteAt,
    });
  }

  const meaningful = records.filter((record) => !isBlank(record));

  if (meaningful.length === 0) {
    return {
      header: [],
      rows: [],
      issues: [{ code: 'EMPTY_FILE', message: 'the file has no data rows' }],
      recordsRead: records.length,
    };
  }

  let header: string[] = [];
  let dataRecords = meaningful;

  if (hasHeader) {
    const [first, ...rest] = meaningful;
    header = (first?.cells ?? []).map((name) => name.trim());
    dataRecords = rest;

    const seen = new Map<string, number>();
    header.forEach((name, index) => {
      if (name === '') {
        issues.push({
          code: 'BLANK_HEADER',
          message: `column ${index + 1} has no name; it cannot be mapped`,
          lineNumber: first?.lineNumber ?? 1,
        });
        return;
      }
      const previous = seen.get(name);
      if (previous !== undefined) {
        issues.push({
          code: 'DUPLICATE_HEADER',
          message:
            `"${name}" appears as both column ${previous + 1} and column ${index + 1}. A mapping ` +
            'referring to it would be ambiguous.',
          lineNumber: first?.lineNumber ?? 1,
          column: name,
        });
      } else {
        seen.set(name, index);
      }
    });

    if (header.length === 0) {
      issues.push({ code: 'MISSING_HEADER', message: 'no header row was found' });
    }
  }

  const width = hasHeader ? header.length : (meaningful[0]?.cells.length ?? 0);

  const rows: ParsedRow[] = dataRecords.map((record, index) => {
    const rowNumber = index + 1;
    if (record.cells.length !== width) {
      issues.push({
        code: 'RAGGED_ROW',
        message: `row ${rowNumber} has ${record.cells.length} fields; the header declares ${width}`,
        lineNumber: record.lineNumber,
        rowNumber,
      });
    }
    // Returned exactly as read. Padding a short row would invent empty values that the
    // district never supplied, and truncating a long one would discard data — §10.5.
    return { rowNumber, lineNumber: record.lineNumber, cells: record.cells };
  });

  return { header, rows, issues, recordsRead: records.length };
}

/** Look a cell up by column name. Returns undefined when the row is short. */
export function cellAt(
  row: ParsedRow,
  header: readonly string[],
  column: string,
): string | undefined {
  const index = header.indexOf(column);
  if (index < 0) return undefined;
  return row.cells[index];
}
