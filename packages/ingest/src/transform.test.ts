/**
 * Behavioural tests for the transformation library.
 *
 * Spec: Master Technical Buildout sections 10.4, 10.5 and 10.6. The set of transformations is
 * closed on purpose — a mapping is authored by a district administrator, so a transformation
 * that could be an arbitrary expression would be customer-authored code running on our server
 * (CLAUDE.md invariant 2). These tests defend the three properties the rest of ingestion leans
 * on: that a value the parser does not recognise becomes a reported issue rather than a zero
 * or a dropped row (§10.5), that every accepted value is canonical for its type (invariants 5
 * and 6), and that the `applied` trail is a faithful record of what happened (§10.6).
 */

import { describe, expect, it } from 'vitest';
import type { DateFormat, TransformName, TransformStep } from './transform.js';
import {
  DATE_FORMATS,
  TRANSFORM_NAMES,
  applyTransforms,
  describeTransforms,
  isCanonicalDate,
  isCanonicalMoney,
} from './transform.js';

/** Run one step and return its outcome. Every transform is reached through the chain. */
function one(input: string | null, step: TransformStep) {
  return applyTransforms(input, [step]);
}

const currency: TransformStep = { transform: 'parseCurrency' };

describe('parseCurrency — accepted forms', () => {
  it.each([
    ['a bare integer', '1250', '1250'],
    ['grouped thousands', '1,250.00', '1250.00'],
    ['a leading currency symbol', '$1,250.00', '1250.00'],
    ['a symbol with no grouping', '$1250', '1250'],
    ['a symbol followed by a space', '$ 1250.75', '1250.75'],
    ['accounting parentheses', '(1,250.00)', '-1250.00'],
    ['a trailing minus', '1250-', '-1250'],
    ['a leading minus', '-1250', '-1250'],
    ['millions', '1,234,567.89', '1234567.89'],
    ['surrounding whitespace', '  1,250.00  ', '1250.00'],
    ['zero', '0', '0'],
    ['sub-dollar cents', '0.07', '0.07'],
    ['more than two decimal places', '1250.005', '1250.005'],
  ])('accepts %s', (_label, raw, expected) => {
    const outcome = one(raw, currency);

    expect(outcome.value).toBe(expected);
    expect(outcome.issue).toBeUndefined();
  });

  it('produces a canonical amount string for every accepted form', () => {
    // Canonical here means what packages/domain accepts without further cleaning: no commas,
    // no symbol, no parentheses. If ingestion emitted "1,250.00" the money parser downstream
    // would throw on data that had already been declared good.
    const raws = ['1250', '1,250.00', '$1,250.00', '(1,250.00)', '1250-', '-1250', '0.07'];
    for (const raw of raws) {
      const outcome = one(raw, currency);
      expect(isCanonicalMoney(outcome.value)).toBe(true);
    }
  });

  it('does not produce negative zero from parenthesised zero', () => {
    // "-0.00" is not a canonical amount and reads, on a shortfall screen, as a minus sign in
    // front of nothing.
    for (const raw of ['(0.00)', '(0)', '(0.0000)', '0-', '-0.00']) {
      const outcome = one(raw, currency);
      expect(outcome.value).not.toMatch(/^-/);
      expect(isCanonicalMoney(outcome.value)).toBe(true);
    }
    expect(one('(0.00)', currency).value).toBe('0.00');
  });

  it('honours allowParentheses and allowSymbol when they are switched off', () => {
    expect(one('(1250)', { transform: 'parseCurrency', allowParentheses: false }).value).toBeNull();
    expect(one('$1250', { transform: 'parseCurrency', allowSymbol: false }).value).toBeNull();
    // …and they default to on, because district ERP exports contain both.
    expect(one('(1250)', currency).value).toBe('-1250');
    expect(one('$1250', currency).value).toBe('1250');
  });
});

describe('parseCurrency — rejected forms', () => {
  it.each([
    ['European decimal grouping', '1.234,56'],
    ['grouping that is not thousands', '1,23,4'],
    ['an oversized group', '1,2500.00'],
    ['a trailing currency code', '1250 USD'],
    ['a bare word', 'abc'],
    ['a numeral with no leading digit', '.50'],
    ['a numeral with a trailing point', '1250.'],
    ['a doubled sign', '--1250'],
    ['an unmatched parenthesis', '(1250'],
    ['whitespace inside the number', '1 250.00'],
  ])('rejects %s with an issue rather than a value', (_label, raw) => {
    const outcome = one(raw, currency);

    // §10.5: never a zero, never a dropped row. A reported problem on a named row and column.
    expect(outcome.value).toBeNull();
    expect(outcome.issue?.transform).toBe('parseCurrency');
    expect(outcome.issue?.code).toBe('UNRECOGNISED_FORMAT');
    expect(outcome.issue?.message).toContain(raw);
  });

  it('rejects "1.234,56" specifically rather than reading it as 1.234', () => {
    // A permissive parser turns a European-locale thousand into one and a quarter, and a
    // maintenance-of-effort finding goes wrong by three orders of magnitude.
    const outcome = one('1.234,56', currency);
    expect(outcome.value).toBeNull();
    expect(outcome.value).not.toBe('1.234');
  });

  it('reports an empty string as blank rather than as an unreadable format', () => {
    const outcome = one('', currency);

    expect(outcome.value).toBeNull();
    expect(outcome.issue?.code).toBe('BLANK');
    expect(outcome.issue?.transform).toBe('parseCurrency');
  });

  it('reports a whitespace-only cell as blank, not as zero', () => {
    expect(one('   ', currency).issue?.code).toBe('BLANK');
    expect(one('   ', currency).value).toBeNull();
  });
});

describe('parseDate', () => {
  it.each([
    ['YYYY-MM-DD' as const, '2026-06-30', '2026-06-30'],
    ['MM/DD/YYYY' as const, '06/30/2026', '2026-06-30'],
    ['M/D/YYYY' as const, '6/3/2026', '2026-06-03'],
    ['DD/MM/YYYY' as const, '30/06/2026', '2026-06-30'],
    ['YYYYMMDD' as const, '20260630', '2026-06-30'],
  ])('parses %s', (format, raw, expected) => {
    const outcome = one(raw, { transform: 'parseDate', formats: [format] });

    expect(outcome.value).toBe(expected);
    expect(outcome.issue).toBeUndefined();
    expect(isCanonicalDate(outcome.value)).toBe(true);
  });

  it('has a working branch for every declared format', () => {
    // Guards against a layout being added to DATE_FORMATS with no branch to parse it, which
    // would make it selectable in the mapping UI and unparseable at run time.
    const SAMPLES: Record<DateFormat, string> = {
      'YYYY-MM-DD': '2026-06-30',
      'MM/DD/YYYY': '06/30/2026',
      'M/D/YYYY': '6/30/2026',
      'DD/MM/YYYY': '30/06/2026',
      YYYYMMDD: '20260630',
    };

    expect(Object.keys(SAMPLES).sort()).toEqual([...DATE_FORMATS].sort());
    for (const format of DATE_FORMATS) {
      expect(one(SAMPLES[format], { transform: 'parseDate', formats: [format] }).value).toBe(
        '2026-06-30',
      );
    }
  });

  it('zero-pads a single-digit month or day into the canonical form', () => {
    expect(one('2026-6-3', { transform: 'parseDate', formats: ['YYYY-MM-DD'] }).value).toBe(
      '2026-06-03',
    );
    expect(one('6/3/2026', { transform: 'parseDate', formats: ['M/D/YYYY'] }).value).toBe(
      '2026-06-03',
    );
  });

  it('trims surrounding whitespace before matching', () => {
    expect(one('  2026-06-30 ', { transform: 'parseDate', formats: ['YYYY-MM-DD'] }).value).toBe(
      '2026-06-30',
    );
  });

  it('lets the order of the format list decide an ambiguous date', () => {
    // 03/04/2026 is March 4th to a US export and April 3rd to a UK one. The mapping states
    // which, and the first format that matches wins.
    const usFirst = one('03/04/2026', {
      transform: 'parseDate',
      formats: ['MM/DD/YYYY', 'DD/MM/YYYY'],
    });
    const ukFirst = one('03/04/2026', {
      transform: 'parseDate',
      formats: ['DD/MM/YYYY', 'MM/DD/YYYY'],
    });

    expect(usFirst.value).toBe('2026-03-04');
    expect(ukFirst.value).toBe('2026-04-03');
  });

  it('falls through to a later format when an earlier one yields an impossible date', () => {
    const outcome = one('13/04/2026', {
      transform: 'parseDate',
      formats: ['MM/DD/YYYY', 'DD/MM/YYYY'],
    });

    expect(outcome.value).toBe('2026-04-13');
  });

  it('rejects 02/30/2027 rather than rolling it into March', () => {
    // CLAUDE.md invariant 6 at the ingestion boundary. `new Date(2027, 1, 30)` silently
    // becomes 2 March; a statutory deadline that moves itself two days later is a compliance
    // defect that no downstream check can detect, because the date it sees is valid.
    const outcome = one('02/30/2027', { transform: 'parseDate', formats: ['MM/DD/YYYY'] });

    expect(outcome.value).toBeNull();
    expect(outcome.value).not.toBe('2027-03-02');
    expect(outcome.issue?.code).toBe('UNRECOGNISED_DATE');
    expect(outcome.issue?.transform).toBe('parseDate');
  });

  it.each([
    ['a non-leap 29 February', '2026-02-29'],
    ['a month of thirteen', '2026-13-01'],
    ['a day of zero', '2026-06-00'],
    ['a two-digit year', '06/30/26'],
    ['a mistyped year in the first century', '0026-06-30'],
    ['a date with slashes where dashes belong', '2026/06/30'],
    ['a bare word', 'not a date'],
    ['an empty cell', ''],
  ])('rejects %s', (_label, raw) => {
    const outcome = one(raw, { transform: 'parseDate', formats: [...DATE_FORMATS] });

    expect(outcome.value).toBeNull();
    expect(outcome.issue?.code).toBe('UNRECOGNISED_DATE');
  });

  it('accepts 29 February in a leap year', () => {
    expect(one('2028-02-29', { transform: 'parseDate', formats: ['YYYY-MM-DD'] }).value).toBe(
      '2028-02-29',
    );
  });

  it('rejects everything when the format list is empty, rather than guessing', () => {
    const outcome = one('2026-06-30', { transform: 'parseDate', formats: [] });

    expect(outcome.value).toBeNull();
    expect(outcome.issue?.code).toBe('UNRECOGNISED_DATE');
  });

  it('names the formats it tried, so the district can see what the mapping expected', () => {
    const outcome = one('30/06/2026', {
      transform: 'parseDate',
      formats: ['YYYY-MM-DD', 'MM/DD/YYYY'],
    });

    expect(outcome.issue?.message).toContain('YYYY-MM-DD');
    expect(outcome.issue?.message).toContain('MM/DD/YYYY');
  });
});

describe('parseBoolean', () => {
  it.each(['true', 'TRUE', 'True', 'yes', 'Y', '1', 't', '  yes  '])(
    'reads %s as true with the default vocabulary',
    (raw) => {
      expect(one(raw, { transform: 'parseBoolean' }).value).toBe('true');
    },
  );

  it.each(['false', 'FALSE', 'no', 'N', '0', 'f', '  no  '])(
    'reads %s as false with the default vocabulary',
    (raw) => {
      expect(one(raw, { transform: 'parseBoolean' }).value).toBe('false');
    },
  );

  it('uses custom value lists case-insensitively when the mapping supplies them', () => {
    const step: TransformStep = {
      transform: 'parseBoolean',
      trueValues: ['Served'],
      falseValues: ['Not Served'],
    };

    expect(one('served', step).value).toBe('true');
    expect(one('NOT SERVED', step).value).toBe('false');
  });

  it('replaces the default vocabulary rather than extending it', () => {
    // A mapping that declares its own vocabulary means the column is not a yes/no column.
    // Silently also accepting "yes" would let a stray value through unnoticed.
    const step: TransformStep = {
      transform: 'parseBoolean',
      trueValues: ['Served'],
      falseValues: ['Not Served'],
    };

    expect(one('yes', step).value).toBeNull();
    expect(one('yes', step).issue?.code).toBe('NOT_A_BOOLEAN');
  });

  it.each(['maybe', '', '   ', '2', 'y/n'])(
    'reports %s as neither true nor false rather than defaulting it',
    (raw) => {
      const outcome = one(raw, { transform: 'parseBoolean' });

      expect(outcome.value).toBeNull();
      expect(outcome.issue?.code).toBe('NOT_A_BOOLEAN');
      expect(outcome.issue?.transform).toBe('parseBoolean');
    },
  );
});

describe('parseInteger', () => {
  it.each([
    ['a bare integer', '42', '42'],
    ['a grouped integer', '1,234', '1234'],
    ['a negative', '-1234', '-1234'],
    ['zero', '0', '0'],
    ['surrounding whitespace', ' 42 ', '42'],
    ['leading zeroes', '007', '7'],
  ])('accepts %s', (_label, raw, expected) => {
    const outcome = one(raw, { transform: 'parseInteger' });

    expect(outcome.value).toBe(expected);
    expect(outcome.issue).toBeUndefined();
  });

  it('keeps a count that exceeds double precision exactly', () => {
    // Not a realistic child count, but it proves the parser is not routing through a float.
    expect(one('9007199254740993', { transform: 'parseInteger' }).value).toBe('9007199254740993');
  });

  it.each([
    ['a decimal', '1.5'],
    ['a word', 'abc'],
    ['an empty cell', ''],
    ['whitespace only', '   '],
    ['a lone minus', '-'],
    ['a trailing minus', '1234-'],
    ['a leading plus', '+5'],
    ['a numeral with a unit', '42 students'],
  ])('rejects %s rather than rounding or coercing it', (_label, raw) => {
    const outcome = one(raw, { transform: 'parseInteger' });

    expect(outcome.value).toBeNull();
    expect(outcome.issue?.code).toBe('NOT_AN_INTEGER');
    expect(outcome.issue?.transform).toBe('parseInteger');
  });

  it('does not truncate 1.5 to 1', () => {
    expect(one('1.5', { transform: 'parseInteger' }).value).not.toBe('1');
  });
});

describe('mapEnum', () => {
  const step: TransformStep = {
    transform: 'mapEnum',
    values: { 'Resource Room': 'RESOURCE_ROOM', 'Self-Contained': 'SELF_CONTAINED' },
  };

  it('maps a declared value', () => {
    expect(one('Resource Room', step).value).toBe('RESOURCE_ROOM');
    expect(one('  Self-Contained  ', step).value).toBe('SELF_CONTAINED');
  });

  it('reports an unmapped value instead of letting it through', () => {
    // An unrecognised category silently excluded from a count is a wrong denominator, and a
    // wrong denominator is a wrong compliance percentage that nobody can see is wrong.
    const outcome = one('Consultative', step);

    expect(outcome.value).toBeNull();
    expect(outcome.issue?.code).toBe('UNMAPPED_VALUE');
    expect(outcome.issue?.transform).toBe('mapEnum');
    expect(outcome.issue?.message).toContain('Consultative');
  });

  it('is case-sensitive, so a mapping states the exact source spelling', () => {
    expect(one('resource room', step).value).toBeNull();
  });

  it('reports an empty cell rather than mapping it to a category', () => {
    expect(one('', step).value).toBeNull();
    expect(one('', step).issue?.code).toBe('UNMAPPED_VALUE');
  });

  it('treats an inherited Object.prototype member name as unmapped, not as a mapping', () => {
    // A bare index read finds a function on Object.prototype, returns it as the mapped value
    // with no issue, and sends a non-string into the provenance record — the wrong-denominator
    // failure this branch exists to prevent, with a type hole attached.
    for (const name of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      const mapped = applyTransforms(name, [{ transform: 'mapEnum', values: { A: 'X' } }]);
      expect(mapped.value).toBeNull();
      expect(mapped.issue?.code).toBe('UNMAPPED_VALUE');

      const crossed = applyTransforms(name, [{ transform: 'crosswalk', codes: { A: 'X' } }]);
      expect(crossed.value).toBeNull();
      expect(crossed.issue?.code).toBe('UNKNOWN_CODE');
    }
  });
});

describe('crosswalk', () => {
  const step: TransformStep = { transform: 'crosswalk', codes: { '100': '1000', '200': '2000' } };

  it('translates a known code', () => {
    expect(one('100', step).value).toBe('1000');
    expect(one(' 200 ', step).value).toBe('2000');
  });

  it('reports an unknown code by default rather than passing it through', () => {
    const outcome = one('999', step);

    expect(outcome.value).toBeNull();
    expect(outcome.issue?.code).toBe('UNKNOWN_CODE');
    expect(outcome.issue?.transform).toBe('crosswalk');
    expect(outcome.issue?.message).toContain('999');
  });

  it('passes an unknown code through only when the mapping asks for it', () => {
    const permissive: TransformStep = {
      transform: 'crosswalk',
      codes: { '100': '1000' },
      passThroughUnknown: true,
    };

    expect(one('999', permissive).value).toBe('999');
    expect(one('999', permissive).issue).toBeUndefined();
    // A known code is still translated.
    expect(one('100', permissive).value).toBe('1000');
  });

  it('treats passThroughUnknown: false as the strict default', () => {
    const strict: TransformStep = {
      transform: 'crosswalk',
      codes: { '100': '1000' },
      passThroughUnknown: false,
    };

    expect(one('999', strict).issue?.code).toBe('UNKNOWN_CODE');
  });
});

describe('requireOneOf', () => {
  const step: TransformStep = { transform: 'requireOneOf', values: ['FEDERAL', 'STATE', 'LOCAL'] };

  it('passes a permitted value through unchanged', () => {
    expect(one('STATE', step).value).toBe('STATE');
    expect(one('STATE', step).issue).toBeUndefined();
  });

  it('reports a value outside the permitted set, naming the set', () => {
    const outcome = one('PRIVATE', step);

    expect(outcome.value).toBeNull();
    expect(outcome.issue?.code).toBe('NOT_PERMITTED');
    expect(outcome.issue?.message).toContain('FEDERAL, STATE, LOCAL');
  });

  it('does not trim before checking, so a padded cell is reported', () => {
    // requireOneOf is a gate, not a cleaner. Chain `trim` in front of it when the source has
    // padded cells — that way the trim is recorded as a transformation in the provenance.
    expect(one(' STATE', step).value).toBeNull();
  });
});

describe('string shaping', () => {
  it('trims and collapses whitespace', () => {
    expect(one('  Fund 100  ', { transform: 'trim' }).value).toBe('Fund 100');
    expect(one('  Fund\t\n 100  ', { transform: 'collapseWhitespace' }).value).toBe('Fund 100');
  });

  it('changes case', () => {
    expect(one('Fund', { transform: 'upperCase' }).value).toBe('FUND');
    expect(one('Fund', { transform: 'lowerCase' }).value).toBe('fund');
  });

  it('title-cases across spaces and hyphens', () => {
    expect(one('special education services', { transform: 'titleCase' }).value).toBe(
      'Special Education Services',
    );
    expect(one('jean-luc picard', { transform: 'titleCase' }).value).toBe('Jean-Luc Picard');
    expect(one('TITLE I, PART A', { transform: 'titleCase' }).value).toBe('Title I, Part A');
  });

  it('title-cases a value that is already shouting, rather than leaving it', () => {
    expect(one('RESOURCE-ROOM', { transform: 'titleCase' }).value).toBe('Resource-Room');
  });

  it('leaves an empty string alone when title-casing', () => {
    expect(one('', { transform: 'titleCase' }).value).toBe('');
  });

  it('turns a blank cell into null with nullIfBlank, and leaves a real value alone', () => {
    expect(one('   ', { transform: 'nullIfBlank' }).value).toBeNull();
    expect(one('', { transform: 'nullIfBlank' }).value).toBeNull();
    // Not a cleaner: a value with padding keeps its padding. Chain `trim` if you want it gone.
    expect(one('  x  ', { transform: 'nullIfBlank' }).value).toBe('  x  ');
  });

  it('strips a prefix and a suffix only when they are present', () => {
    expect(one('FUND-100', { transform: 'stripPrefix', prefix: 'FUND-' }).value).toBe('100');
    expect(one('100', { transform: 'stripPrefix', prefix: 'FUND-' }).value).toBe('100');
    expect(one('1250.00', { transform: 'stripSuffix', suffix: '.00' }).value).toBe('1250');
    expect(one('1250.50', { transform: 'stripSuffix', suffix: '.00' }).value).toBe('1250.50');
  });

  it('leaves the value unchanged when stripSuffix is given an empty suffix', () => {
    // `-0 === 0`, so `slice(0, -0)` is `slice(0, 0)` and returns the empty string. An
    // administrator leaving the suffix box blank in the mapping UI would silently empty the
    // whole column, with no issue raised.
    const outcome = applyTransforms('1250.00', [{ transform: 'stripSuffix', suffix: '' }]);

    expect(outcome.value).toBe('1250.00');
    expect(outcome.issue).toBeUndefined();
  });

  it('pads to a fixed width without truncating a value that is already long enough', () => {
    expect(one('42', { transform: 'padStart', length: 5, fill: '0' }).value).toBe('00042');
    expect(one('123456', { transform: 'padStart', length: 5, fill: '0' }).value).toBe('123456');
    expect(one('', { transform: 'padStart', length: 3, fill: '0' }).value).toBe('000');
  });
});

describe('null handling', () => {
  it.each<[string, TransformStep]>([
    ['trim', { transform: 'trim' }],
    ['upperCase', { transform: 'upperCase' }],
    ['titleCase', { transform: 'titleCase' }],
    ['parseCurrency', { transform: 'parseCurrency' }],
    ['parseInteger', { transform: 'parseInteger' }],
    ['parseBoolean', { transform: 'parseBoolean' }],
    ['parseDate', { transform: 'parseDate', formats: ['YYYY-MM-DD'] }],
    ['mapEnum', { transform: 'mapEnum', values: { a: 'A' } }],
    ['crosswalk', { transform: 'crosswalk', codes: { a: 'A' } }],
    ['requireOneOf', { transform: 'requireOneOf', values: ['A'] }],
    ['padStart', { transform: 'padStart', length: 3, fill: '0' }],
  ])('passes null through %s untouched and without an issue', (_label, step) => {
    const outcome = one(null, step);

    // Invariant 9: missing data must stay missing so a rule can answer INDETERMINATE. A null
    // is not a parse failure — there was nothing to parse — so it must not raise an issue
    // either, or every absent optional column would fill the report with noise.
    expect(outcome.value).toBeNull();
    expect(outcome.issue).toBeUndefined();
    expect(outcome.applied).toEqual([{ transform: step.transform, from: null, to: null }]);
  });

  it('fills a null with defaultValue — the documented exception', () => {
    const outcome = one(null, { transform: 'defaultValue', value: 'UNKNOWN' });

    expect(outcome.value).toBe('UNKNOWN');
    expect(outcome.applied).toEqual([{ transform: 'defaultValue', from: null, to: 'UNKNOWN' }]);
  });

  it('fills a blank or whitespace-only cell with defaultValue but leaves a real value', () => {
    const step: TransformStep = { transform: 'defaultValue', value: 'UNKNOWN' };

    expect(one('', step).value).toBe('UNKNOWN');
    expect(one('   ', step).value).toBe('UNKNOWN');
    expect(one('LOCAL', step).value).toBe('LOCAL');
  });

  it('lets nullIfBlank and defaultValue compose into "blank means this"', () => {
    const outcome = applyTransforms('   ', [
      { transform: 'nullIfBlank' },
      { transform: 'defaultValue', value: '0' },
      { transform: 'parseCurrency' },
    ]);

    expect(outcome.value).toBe('0');
    expect(outcome.issue).toBeUndefined();
    expect(outcome.applied.map((step) => step.transform)).toEqual([
      'nullIfBlank',
      'defaultValue',
      'parseCurrency',
    ]);
  });
});

describe('applyTransforms — the provenance trail (§10.6)', () => {
  it('records each step with the value going in and the value coming out', () => {
    const outcome = applyTransforms(' $1,250.00 ', [
      { transform: 'trim' },
      { transform: 'parseCurrency' },
    ]);

    expect(outcome.value).toBe('1250.00');
    expect(outcome.issue).toBeUndefined();
    expect(outcome.applied).toEqual([
      { transform: 'trim', from: ' $1,250.00 ', to: '$1,250.00' },
      { transform: 'parseCurrency', from: '$1,250.00', to: '1250.00' },
    ]);
  });

  it('stops at the first failure and runs no later step', () => {
    // Continuing would compound one problem into several and bury the one the district can
    // act on — and padStart would turn a null into "000", manufacturing a value.
    const outcome = applyTransforms('abc', [
      { transform: 'trim' },
      { transform: 'parseCurrency' },
      { transform: 'padStart', length: 8, fill: '0' },
    ]);

    expect(outcome.value).toBeNull();
    expect(outcome.issue?.transform).toBe('parseCurrency');
    expect(outcome.applied).toEqual([
      { transform: 'trim', from: 'abc', to: 'abc' },
      { transform: 'parseCurrency', from: 'abc', to: null },
    ]);
  });

  it('includes the failing step in the trail, so the failure has a recorded input', () => {
    const outcome = applyTransforms('  02/30/2027  ', [
      { transform: 'trim' },
      { transform: 'parseDate', formats: ['MM/DD/YYYY'] },
    ]);

    const last = outcome.applied[outcome.applied.length - 1];
    expect(last?.transform).toBe('parseDate');
    expect(last?.from).toBe('02/30/2027');
    expect(last?.to).toBeNull();
  });

  it('returns the input unchanged for an empty chain, with an empty trail', () => {
    const outcome = applyTransforms('1250.00', []);

    expect(outcome.value).toBe('1250.00');
    expect(outcome.applied).toEqual([]);
    expect('issue' in outcome).toBe(false);
  });

  it('omits the issue key entirely on success rather than setting it undefined', () => {
    // exactOptionalPropertyTypes: an absent issue and an issue of undefined are different
    // things once this outcome is serialised into a provenance record.
    expect('issue' in applyTransforms(null, [{ transform: 'trim' }])).toBe(false);
    expect('issue' in applyTransforms('x', [{ transform: 'trim' }])).toBe(false);
  });

  it('runs a realistic fiscal chain end to end', () => {
    const outcome = applyTransforms('  fund-100  ', [
      { transform: 'trim' },
      { transform: 'upperCase' },
      { transform: 'stripPrefix', prefix: 'FUND-' },
      { transform: 'padStart', length: 5, fill: '0' },
      { transform: 'crosswalk', codes: { '00100': '1000' }, passThroughUnknown: false },
    ]);

    expect(outcome.value).toBe('1000');
    expect(outcome.applied.map((step) => step.to)).toEqual([
      'fund-100',
      'FUND-100',
      '100',
      '00100',
      '1000',
    ]);
  });
});

describe('describeTransforms', () => {
  it('describes an empty chain as identity rather than as an empty string', () => {
    // The provenance field is never blank: "identity" says the value arrived as it is stored.
    expect(describeTransforms([])).toBe('identity');
  });

  it('joins the chain in the order it runs', () => {
    expect(
      describeTransforms([
        { transform: 'trim' },
        { transform: 'parseCurrency' },
        { transform: 'padStart', length: 5, fill: '0' },
      ]),
    ).toBe('trim → parseCurrency → padStart');
  });

  it('names a single step on its own', () => {
    expect(describeTransforms([{ transform: 'nullIfBlank' }])).toBe('nullIfBlank');
  });
});

describe('canonical-form predicates', () => {
  it('recognises a canonical amount and refuses anything needing further cleaning', () => {
    expect(isCanonicalMoney('1250.00')).toBe(true);
    expect(isCanonicalMoney('-1250')).toBe(true);
    expect(isCanonicalMoney('1,250.00')).toBe(false);
    expect(isCanonicalMoney('$1250')).toBe(false);
    expect(isCanonicalMoney('')).toBe(false);
    expect(isCanonicalMoney(null)).toBe(false);
  });

  it('recognises a calendar date and refuses a locale-formatted one', () => {
    expect(isCanonicalDate('2026-06-30')).toBe(true);
    expect(isCanonicalDate('06/30/2026')).toBe(false);
    expect(isCanonicalDate('2026-02-30')).toBe(false);
    expect(isCanonicalDate(null)).toBe(false);
  });
});

describe('the closed set of transforms', () => {
  // Every name in TRANSFORM_NAMES must be executable. A name in the list with no branch in
  // applyStep would be a mapping a district could author and the server could not run.
  const SAMPLES: Record<TransformName, TransformStep> = {
    trim: { transform: 'trim' },
    collapseWhitespace: { transform: 'collapseWhitespace' },
    upperCase: { transform: 'upperCase' },
    lowerCase: { transform: 'lowerCase' },
    titleCase: { transform: 'titleCase' },
    nullIfBlank: { transform: 'nullIfBlank' },
    defaultValue: { transform: 'defaultValue', value: 'X' },
    parseCurrency: { transform: 'parseCurrency' },
    parseInteger: { transform: 'parseInteger' },
    parseBoolean: { transform: 'parseBoolean' },
    parseDate: { transform: 'parseDate', formats: ['YYYY-MM-DD'] },
    mapEnum: { transform: 'mapEnum', values: { '1': 'ONE' } },
    crosswalk: { transform: 'crosswalk', codes: { '1': 'ONE' } },
    stripPrefix: { transform: 'stripPrefix', prefix: 'X' },
    stripSuffix: { transform: 'stripSuffix', suffix: 'X' },
    padStart: { transform: 'padStart', length: 3, fill: '0' },
    requireOneOf: { transform: 'requireOneOf', values: ['1'] },
  };

  it('has a runnable step for every declared name', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...TRANSFORM_NAMES].sort());

    for (const name of TRANSFORM_NAMES) {
      const step = SAMPLES[name];
      const outcome = applyTransforms('1', [step]);
      expect(outcome.applied).toHaveLength(1);
      expect(outcome.applied[0]?.transform).toBe(name);
      expect(outcome.applied[0]?.from).toBe('1');
    }
  });

  it('never throws, whatever the input, because a failure is a value not an exception', () => {
    for (const name of TRANSFORM_NAMES) {
      const step = SAMPLES[name];
      for (const input of [null, '', '   ', 'abc', '1,2,3', '(())', '\u0000']) {
        expect(() => applyTransforms(input, [step])).not.toThrow();
      }
    }
  });
});
