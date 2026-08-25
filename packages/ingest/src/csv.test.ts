/**
 * Behavioural tests for delimited-text parsing.
 *
 * Spec: Master Technical Buildout sections 10.1, 10.2, 10.5 and 10.6. This is the first thing
 * a district's data touches, and the module makes two promises that everything downstream
 * leans on: nothing is silently discarded (§10.5), and every cell keeps its physical position
 * in the file the district actually uploaded (§10.6). These tests are written against those
 * two promises rather than against the shape of the implementation — a ragged row must come
 * back with the cells it really had, and a record that follows an embedded newline must report
 * the line it really starts on.
 */

import { describe, expect, it } from 'vitest';
import type { CsvIssue, ParsedRow } from './csv.js';
import { DELIMITERS, cellAt, parseCsv } from './csv.js';

/** Issues of one code, in the order the parser reported them. */
function issuesOf(issues: readonly CsvIssue[], code: CsvIssue['code']): readonly CsvIssue[] {
  return issues.filter((candidate) => candidate.code === code);
}

/** The cells of one row, or undefined when the row does not exist. */
function cellsOf(rows: readonly ParsedRow[], index: number): readonly string[] | undefined {
  return rows[index]?.cells;
}

describe('RFC 4180 quoting', () => {
  it('keeps a delimiter that appears inside a quoted field as data', () => {
    // The near-miss regex parsers fail on exactly this file: an account description with a
    // comma in it. Splitting it would shift every later column by one.
    const parsed = parseCsv('code,description,amount\n100,"Salaries, certificated",1250.00\n');

    expect(parsed.header).toEqual(['code', 'description', 'amount']);
    expect(cellsOf(parsed.rows, 0)).toEqual(['100', 'Salaries, certificated', '1250.00']);
    expect(parsed.issues).toEqual([]);
  });

  it('keeps a newline that appears inside a quoted field as data', () => {
    const parsed = parseCsv('code,note\n100,"line one\nline two"\n');

    expect(cellsOf(parsed.rows, 0)).toEqual(['100', 'line one\nline two']);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.issues).toEqual([]);
  });

  it('reads a doubled quote inside a quoted field as one literal quote', () => {
    const parsed = parseCsv('code,note\n100,"she said ""yes"" twice"\n');

    expect(cellsOf(parsed.rows, 0)).toEqual(['100', 'she said "yes" twice']);
    expect(parsed.issues).toEqual([]);
  });

  it('treats a quote that appears mid-cell as ordinary text rather than opening a field', () => {
    // 12" conduit is a real line item. Only a quote at the start of a cell opens a quoted
    // field; anywhere else it is a character the district typed.
    const parsed = parseCsv('code,note\n100,12" conduit\n200,ends with a quote"\n');

    expect(cellsOf(parsed.rows, 0)).toEqual(['100', '12" conduit']);
    expect(cellsOf(parsed.rows, 1)).toEqual(['200', 'ends with a quote"']);
    expect(parsed.issues).toEqual([]);
  });

  it('honours a non-default quote character', () => {
    const parsed = parseCsv("code,note\n100,'Salaries, certificated'\n", { quote: "'" });

    expect(cellsOf(parsed.rows, 0)).toEqual(['100', 'Salaries, certificated']);
  });

  it('reads an empty quoted field as an empty cell, not as a missing one', () => {
    const parsed = parseCsv('code,note,amount\n100,"",1250.00\n');

    expect(cellsOf(parsed.rows, 0)).toEqual(['100', '', '1250.00']);
    expect(issuesOf(parsed.issues, 'RAGGED_ROW')).toEqual([]);
  });
});

describe('physical position (§10.6)', () => {
  it('reports the real file line for a record that follows an embedded newline', () => {
    // Physical lines:
    //   1  code,note,amount
    //   2  100,"a
    //   3  b
    //   4  c",1
    //   5  200,plain,2
    // Row 2 is the second *data row* but the fifth *line*. A finding traced back to "row 2"
    // has to land on line 5 when the district opens the file in a text editor.
    const parsed = parseCsv('code,note,amount\n100,"a\nb\nc",1\n200,plain,2\n');

    expect(parsed.rows).toEqual([
      { rowNumber: 1, lineNumber: 2, cells: ['100', 'a\nb\nc', '1'] },
      { rowNumber: 2, lineNumber: 5, cells: ['200', 'plain', '2'] },
    ]);
    expect(parsed.recordsRead).toBe(3);
  });

  it('counts data rows and file lines independently when blank lines intervene', () => {
    // Lines: 1 header, 2 blank, 3 data, 4 blank, 5 data. Row numbers must not count the
    // blanks; line numbers must.
    const parsed = parseCsv('a,b\n\n1,2\n\n3,4\n');

    expect(parsed.rows).toEqual([
      { rowNumber: 1, lineNumber: 3, cells: ['1', '2'] },
      { rowNumber: 2, lineNumber: 5, cells: ['3', '4'] },
    ]);
    // The blank lines were read — reconciliation starts from recordsRead — but they are not
    // rows and they are not ragged.
    expect(parsed.recordsRead).toBe(5);
    expect(parsed.issues).toEqual([]);
  });

  it('numbers every line of a plain file from one, header included', () => {
    const parsed = parseCsv('a,b\n1,2\n3,4\n5,6\n');

    expect(parsed.rows.map((row) => row.lineNumber)).toEqual([2, 3, 4]);
    expect(parsed.rows.map((row) => row.rowNumber)).toEqual([1, 2, 3]);
  });
});

describe('line endings', () => {
  it('parses LF, CRLF and lone-CR files to the same rows', () => {
    // Classic-Mac lone CR still arrives from older district systems, and Windows exports are
    // CRLF. Neither may leave a stray carriage return glued to the last cell of a row.
    const lf = parseCsv('a,b\n1,2\n3,4\n');
    const crlf = parseCsv('a,b\r\n1,2\r\n3,4\r\n');
    const cr = parseCsv('a,b\r1,2\r3,4\r');

    for (const parsed of [lf, crlf, cr]) {
      expect(parsed.header).toEqual(['a', 'b']);
      expect(parsed.rows).toEqual([
        { rowNumber: 1, lineNumber: 2, cells: ['1', '2'] },
        { rowNumber: 2, lineNumber: 3, cells: ['3', '4'] },
      ]);
      expect(parsed.recordsRead).toBe(3);
      expect(parsed.issues).toEqual([]);
    }
  });

  it('produces no phantom final row from a trailing newline', () => {
    for (const text of ['a,b\n1,2\n', 'a,b\r\n1,2\r\n', 'a,b\r1,2\r']) {
      const parsed = parseCsv(text);
      expect(parsed.rows).toHaveLength(1);
      expect(parsed.recordsRead).toBe(2);
    }
  });

  it('still yields the last row when the file has no trailing newline', () => {
    const parsed = parseCsv('a,b\n1,2');

    expect(parsed.rows).toEqual([{ rowNumber: 1, lineNumber: 2, cells: ['1', '2'] }]);
    expect(parsed.recordsRead).toBe(2);
  });

  // A lone CR is a record terminator outside quotes (see the module comment), so in a
  // classic-Mac file a CR inside a quoted field is a physical line break too. The line
  // counter is only advanced for '\n' while inQuotes, so every record after a quoted
  // embedded CR reports a line number that is short by one per embedded CR. Correct
  // behaviour: while inQuotes, a '\r' not followed by '\n' advances the line counter, the
  // same way '\n' does — otherwise the §10.6 promise that a cell keeps its physical position
  // fails on exactly the files the CR branch exists to support.
  it.todo('counts a CR inside a quoted field as a physical line in a lone-CR file');

  it('does not split a quoted field on an embedded CRLF', () => {
    const parsed = parseCsv('code,note\r\n100,"line one\r\nline two"\r\n200,plain\r\n');

    expect(parsed.rows.map((row) => row.rowNumber)).toEqual([1, 2]);
    // Line 4 in the file: header, then a record spanning lines 2 and 3.
    expect(parsed.rows.map((row) => row.lineNumber)).toEqual([2, 4]);
    expect(cellsOf(parsed.rows, 1)).toEqual(['200', 'plain']);
    expect(issuesOf(parsed.issues, 'RAGGED_ROW')).toEqual([]);
  });
});

describe('byte-order mark', () => {
  it('strips a UTF-8 BOM so the first header name matches its mapping', () => {
    // Excel writes one. Left in place it becomes part of the first header name and the
    // column silently fails to map, which looks like missing data rather than a bad file.
    const parsed = parseCsv('﻿Fund Code,Amount\n100,1250.00\n');

    expect(parsed.header).toEqual(['Fund Code', 'Amount']);
    const [first] = parsed.header;
    expect(first?.charCodeAt(0)).toBe('F'.charCodeAt(0));

    const [row] = parsed.rows;
    expect(row === undefined ? undefined : cellAt(row, parsed.header, 'Fund Code')).toBe('100');
  });

  it('strips the BOM only from the start of the file', () => {
    const parsed = parseCsv('a,b\n1,﻿2\n');

    expect(cellsOf(parsed.rows, 0)).toEqual(['1', '﻿2']);
  });
});

describe('ragged rows (§10.5)', () => {
  it('returns a short row with the cells it actually had, unpadded, and reports it', () => {
    const parsed = parseCsv('code,description,amount\n100,short\n200,fine,1250.00\n');

    // Padding would invent an amount the district never supplied; a fiscal total computed
    // over invented empties is a finding about data that does not exist.
    expect(cellsOf(parsed.rows, 0)).toEqual(['100', 'short']);
    expect(cellsOf(parsed.rows, 1)).toEqual(['200', 'fine', '1250.00']);

    const ragged = issuesOf(parsed.issues, 'RAGGED_ROW');
    expect(ragged).toHaveLength(1);
    expect(ragged[0]?.rowNumber).toBe(1);
    expect(ragged[0]?.lineNumber).toBe(2);
    expect(ragged[0]?.message).toContain('row 1');
    expect(ragged[0]?.message).toContain('2 fields');
    expect(ragged[0]?.message).toContain('3');
  });

  it('returns a long row with every cell it had, untruncated, and reports it', () => {
    const parsed = parseCsv('code,description,amount\n100,extra,1250.00,surprise\n');

    expect(cellsOf(parsed.rows, 0)).toEqual(['100', 'extra', '1250.00', 'surprise']);

    const ragged = issuesOf(parsed.issues, 'RAGGED_ROW');
    expect(ragged).toHaveLength(1);
    expect(ragged[0]?.rowNumber).toBe(1);
    expect(ragged[0]?.message).toContain('4 fields');
  });

  it('reports every ragged row rather than the first, and still returns them all', () => {
    // "14,246 rows accepted" while 35 vanished is the failure mode this defends against.
    const parsed = parseCsv('a,b,c\n1\n1,2,3\n1,2\n1,2,3,4\n');

    expect(parsed.rows).toHaveLength(4);
    const ragged = issuesOf(parsed.issues, 'RAGGED_ROW');
    expect(ragged.map((entry) => entry.rowNumber)).toEqual([1, 3, 4]);
    expect(parsed.recordsRead).toBe(5);
  });

  it('reports a ragged row against its physical line, not its row number', () => {
    const parsed = parseCsv('a,b,c\n1,"x\ny",3\n1,2\n');

    const ragged = issuesOf(parsed.issues, 'RAGGED_ROW');
    expect(ragged).toHaveLength(1);
    expect(ragged[0]?.rowNumber).toBe(2);
    expect(ragged[0]?.lineNumber).toBe(4);
  });
});

describe('header problems', () => {
  it('reports a duplicate header name and still returns both columns', () => {
    const parsed = parseCsv('amount,amount,code\n1,2,3\n');

    expect(parsed.header).toEqual(['amount', 'amount', 'code']);
    const duplicates = issuesOf(parsed.issues, 'DUPLICATE_HEADER');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.column).toBe('amount');
    expect(duplicates[0]?.lineNumber).toBe(1);
    expect(duplicates[0]?.message).toContain('column 1');
    expect(duplicates[0]?.message).toContain('column 2');
  });

  it('reports each further repetition of a duplicated name', () => {
    const parsed = parseCsv('amount,amount,amount\n1,2,3\n');

    expect(issuesOf(parsed.issues, 'DUPLICATE_HEADER')).toHaveLength(2);
  });

  it('reports a blank header by column position, since it cannot be named', () => {
    const parsed = parseCsv('code,,amount\n1,2,3\n');

    expect(parsed.header).toEqual(['code', '', 'amount']);
    const blanks = issuesOf(parsed.issues, 'BLANK_HEADER');
    expect(blanks).toHaveLength(1);
    expect(blanks[0]?.message).toContain('column 2');
    expect(blanks[0]?.lineNumber).toBe(1);
  });

  it('treats a whitespace-only header name as blank, not as a name of spaces', () => {
    const parsed = parseCsv('code,   ,amount\n1,2,3\n');

    expect(parsed.header).toEqual(['code', '', 'amount']);
    expect(issuesOf(parsed.issues, 'BLANK_HEADER')).toHaveLength(1);
    // Two blank names are two unmappable columns, not a duplicate pair.
    const two = parseCsv('code,,,amount\n1,2,3,4\n');
    expect(issuesOf(two.issues, 'BLANK_HEADER')).toHaveLength(2);
    expect(issuesOf(two.issues, 'DUPLICATE_HEADER')).toEqual([]);
  });

  it('trims surrounding whitespace from header names so mappings match', () => {
    const parsed = parseCsv(' Fund Code , Amount \n100,1250.00\n');

    expect(parsed.header).toEqual(['Fund Code', 'Amount']);
    // Data cells are returned as read; only the header is normalised.
    expect(cellsOf(parsed.rows, 0)).toEqual(['100', '1250.00']);
  });

  it('reports an empty file rather than an empty success', () => {
    for (const text of ['', '   ', '\n\n', ' \r\n \r\n']) {
      const parsed = parseCsv(text);
      expect(parsed.issues).toEqual([{ code: 'EMPTY_FILE', message: 'the file is empty' }]);
      expect(parsed.header).toEqual([]);
      expect(parsed.rows).toEqual([]);
      expect(parsed.recordsRead).toBe(0);
    }
  });

  it('reports a file whose only records are blank as having no data rows', () => {
    const parsed = parseCsv(',,\n,,\n');

    expect(issuesOf(parsed.issues, 'EMPTY_FILE')).toHaveLength(1);
    expect(parsed.rows).toEqual([]);
    // The records were still counted, so reconciliation can see that two lines were read.
    expect(parsed.recordsRead).toBe(2);
  });

  it('accepts a header-only file as a valid file with no data rows', () => {
    const parsed = parseCsv('code,description,amount\n');

    expect(parsed.header).toEqual(['code', 'description', 'amount']);
    expect(parsed.rows).toEqual([]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.recordsRead).toBe(1);
  });
});

describe('unclosed quote', () => {
  it('names the line the quote opened on, not the line the record started on', () => {
    // Physical lines:
    //   1  h1,h2,h3
    //   2  a,"multi
    //   3  line","never closed
    // The record starts on line 2; the stray quote is on line 3. Pointing at line 2 would
    // send the district to the wrong place in a 14,000-line export.
    const parsed = parseCsv('h1,h2,h3\na,"multi\nline","never closed\n');

    const unclosed = issuesOf(parsed.issues, 'UNCLOSED_QUOTE');
    expect(unclosed).toHaveLength(1);
    expect(unclosed[0]?.lineNumber).toBe(3);
    expect(unclosed[0]?.message).toContain('line 3');
    expect(parsed.rows[0]?.lineNumber).toBe(2);
  });

  it('still returns the partial record so the district can see what was swallowed', () => {
    const parsed = parseCsv('code,note\n100,"oops\n200,also swallowed\n');

    expect(parsed.rows).toHaveLength(1);
    expect(cellsOf(parsed.rows, 0)).toEqual(['100', 'oops\n200,also swallowed\n']);
    expect(issuesOf(parsed.issues, 'UNCLOSED_QUOTE')[0]?.lineNumber).toBe(2);
  });

  it('reports nothing when every quoted field is properly closed', () => {
    const parsed = parseCsv('code,note\n100,"closed"\n200,"also\nclosed"');

    expect(issuesOf(parsed.issues, 'UNCLOSED_QUOTE')).toEqual([]);
  });
});

describe('alternate delimiters', () => {
  it.each([
    ['tab', DELIMITERS.tab],
    ['semicolon', DELIMITERS.semicolon],
    ['pipe', DELIMITERS.pipe],
  ])('parses a %s-delimited file, quoting included', (_label, delimiter) => {
    const text = `code${delimiter}note\n100${delimiter}"a${delimiter}b"\n`;
    const parsed = parseCsv(text, { delimiter });

    expect(parsed.header).toEqual(['code', 'note']);
    expect(cellsOf(parsed.rows, 0)).toEqual(['100', `a${delimiter}b`]);
    expect(parsed.issues).toEqual([]);
  });

  it('does not split on a comma when another delimiter is configured', () => {
    const parsed = parseCsv('code;description\n100;Salaries, certificated\n', {
      delimiter: DELIMITERS.semicolon,
    });

    expect(cellsOf(parsed.rows, 0)).toEqual(['100', 'Salaries, certificated']);
  });
});

describe('header: false', () => {
  it('treats every record as a data row and takes the width from the first', () => {
    const parsed = parseCsv('1,2\n3,4\n', { header: false });

    expect(parsed.header).toEqual([]);
    expect(parsed.rows).toEqual([
      { rowNumber: 1, lineNumber: 1, cells: ['1', '2'] },
      { rowNumber: 2, lineNumber: 2, cells: ['3', '4'] },
    ]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.recordsRead).toBe(2);
  });

  it('still reports a row whose width differs from the first record', () => {
    const parsed = parseCsv('1,2\n3\n', { header: false });

    const ragged = issuesOf(parsed.issues, 'RAGGED_ROW');
    expect(ragged).toHaveLength(1);
    expect(ragged[0]?.rowNumber).toBe(2);
    expect(cellsOf(parsed.rows, 1)).toEqual(['3']);
  });
});

describe('cellAt', () => {
  const parsed = parseCsv('code,description,amount\n100,Salaries,1250.00\n200,short\n');

  it('looks a cell up by column name', () => {
    const [row] = parsed.rows;
    expect(row === undefined ? undefined : cellAt(row, parsed.header, 'amount')).toBe('1250.00');
    expect(row === undefined ? undefined : cellAt(row, parsed.header, 'code')).toBe('100');
  });

  it('returns undefined for a column the header does not contain', () => {
    const [row] = parsed.rows;
    expect(row === undefined ? undefined : cellAt(row, parsed.header, 'fund')).toBeUndefined();
  });

  it('returns undefined rather than an empty string when the row is short', () => {
    // A short row means the district did not supply the value. Returning '' would let a
    // downstream parser turn "not supplied" into a value, and invariant 9 requires missing
    // data to stay missing so a rule can answer INDETERMINATE.
    const short = parsed.rows[1];
    expect(short === undefined ? 'row missing' : cellAt(short, parsed.header, 'amount')).toBe(
      undefined,
    );
  });

  it('resolves a duplicated column name to the first of the pair', () => {
    const duplicated = parseCsv('amount,amount\n1,2\n');
    const [row] = duplicated.rows;
    expect(row === undefined ? undefined : cellAt(row, duplicated.header, 'amount')).toBe('1');
  });
});
