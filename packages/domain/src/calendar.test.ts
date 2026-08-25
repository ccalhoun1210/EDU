/**
 * Behavioural tests for calendar-date arithmetic.
 *
 * Spec: Master Technical Buildout section 4. CLAUDE.md invariant 6 — a regulatory deadline
 * is a calendar date, not an instant, and must never be routed through a UTC timestamp.
 *
 * The module under test makes two promises that these tests exist to hold it to. First, that
 * a date which does not exist is refused at the boundary rather than silently normalised the
 * way `Date` would. Second, that every answer it gives is a function of the arguments alone —
 * not of the machine's clock, locale, or time zone. The last describe block tests the second
 * promise directly, because it is the reason the module was written by hand instead of
 * delegating to `Date`.
 */

import { afterAll, describe, expect, it } from 'vitest';
import type { CalendarParts } from './calendar.js';
import {
  CalendarDateError,
  addDays,
  addMonths,
  addWeeks,
  addYears,
  compareCalendarDates,
  daysInMonth,
  diffDays,
  diffMonths,
  diffWeeks,
  diffYears,
  formatCalendarDate,
  fromDayNumber,
  isCalendarDate,
  isLeapYear,
  isWithin,
  parseCalendarDate,
  toDayNumber,
} from './calendar.js';

/**
 * An independent day-advance oracle, written out longhand rather than delegating to the
 * module. A round-trip test that uses the module to check itself proves only that it is
 * self-consistent; this gives the sweep below something external to disagree with.
 */
const LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function lengthOfMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
    return leap ? 29 : 28;
  }
  return LENGTHS[month - 1] ?? 0;
}

function nextDay(date: CalendarParts): CalendarParts {
  if (date.day < lengthOfMonth(date.year, date.month)) {
    return { year: date.year, month: date.month, day: date.day + 1 };
  }
  if (date.month < 12) return { year: date.year, month: date.month + 1, day: 1 };
  return { year: date.year + 1, month: 1, day: 1 };
}

describe('parseCalendarDate', () => {
  it('accepts a well-formed date and returns its components as numbers', () => {
    expect(parseCalendarDate('2027-03-16')).toEqual({ year: 2027, month: 3, day: 16 });
    // A leading zero must not be read as octal, and the day must not be a string.
    expect(parseCalendarDate('2027-08-09')).toEqual({ year: 2027, month: 8, day: 9 });
  });

  // Each of these is a date `Date` would silently normalise into a different, real day —
  // 2027-02-30 becomes 2 March. A typo in a district export that becomes a deadline two days
  // late, with nothing anywhere reporting a problem, is exactly the failure this rejects.
  it.each([
    ['a day past the end of February', '2027-02-30'],
    ['a month past December', '2027-13-01'],
    ['month zero', '2027-00-10'],
    ['29 February in a common year', '2023-02-29'],
    ['31 April', '2027-04-31'],
    ['31 June', '2027-06-31'],
    ['31 November', '2027-11-31'],
    ['day zero', '2027-01-00'],
    ['day 32', '2027-01-32'],
  ])('refuses to normalise %s', (_label, raw) => {
    expect(() => parseCalendarDate(raw)).toThrow(CalendarDateError);
  });

  it.each([
    ['an unpadded month', '2027-1-01'],
    ['a two-digit year', '27-01-01'],
    ['slash separators', '2027/01/01'],
    ['a timestamp', '2027-01-01T00:00:00Z'],
    ['leading whitespace', ' 2027-01-01'],
    ['trailing whitespace', '2027-01-01 '],
    ['a compact numeral', '20270101'],
    ['an empty string', ''],
  ])('rejects %s rather than repairing it', (_label, raw) => {
    expect(() => parseCalendarDate(raw)).toThrow(CalendarDateError);
  });

  it('carries the offending input on the error so a source record can be cited', () => {
    // Provenance (invariant 3) needs the raw value that failed, not just a message.
    try {
      parseCalendarDate('2023-02-29');
      expect.unreachable('an impossible date must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CalendarDateError);
      expect((error as CalendarDateError).raw).toBe('2023-02-29');
      expect((error as CalendarDateError).name).toBe('CalendarDateError');
    }
  });

  it('accepts the leap days that do exist', () => {
    expect(parseCalendarDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseCalendarDate('2000-02-29')).toEqual({ year: 2000, month: 2, day: 29 });
  });

  // A four-digit-year regex accepts '0026-06-30', which in a district export is a mistyped
  // 2026. Silently placing a due date two millennia in the past would make every deadline
  // appear met, so the parser bounds the year even though the arithmetic does not need it.
  it.each([
    ['a mistyped two-digit year padded to four', '0026-06-30'],
    ['year zero', '0000-01-01'],
    ['the year before the Gregorian calendar existed', '1582-12-31'],
  ])('refuses %s as implausible rather than accepting it as a date', (_label, raw) => {
    expect(() => parseCalendarDate(raw)).toThrow(CalendarDateError);
    expect(isCalendarDate(raw)).toBe(false);
  });

  it('accepts both ends of the plausible year range', () => {
    expect(parseCalendarDate('1583-01-01')).toEqual({ year: 1583, month: 1, day: 1 });
    expect(parseCalendarDate('9999-12-31')).toEqual({ year: 9999, month: 12, day: 31 });
  });
});

describe('isCalendarDate', () => {
  it('narrows only strings that parse as real days', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2023-02-29')).toBe(false);
    expect(isCalendarDate('20270101')).toBe(false);
  });

  it('rejects a non-string rather than coercing it', () => {
    // Dates arrive from JSON, where a numeric-looking date is a real possibility.
    expect(isCalendarDate(20270101)).toBe(false);
    expect(isCalendarDate(null)).toBe(false);
    expect(isCalendarDate(undefined)).toBe(false);
    expect(isCalendarDate({ year: 2027, month: 1, day: 1 })).toBe(false);
  });
});

describe('isLeapYear and daysInMonth', () => {
  it('applies the full Gregorian rule, not just the divisible-by-four shortcut', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2023)).toBe(false);
    // The century exceptions are where a hand-rolled rule usually goes wrong.
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2400)).toBe(true);
  });

  it('gives February the length its year actually has', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2023, 2)).toBe(28);
  });

  it('gives every other month a length independent of the year', () => {
    const expected = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let month = 1; month <= 12; month++) {
      if (month === 2) continue;
      expect(daysInMonth(2023, month)).toBe(expected[month - 1]);
      expect(daysInMonth(2024, month)).toBe(expected[month - 1]);
    }
  });
});

describe('toDayNumber and fromDayNumber', () => {
  it('anchors day zero at the Unix epoch date', () => {
    expect(toDayNumber({ year: 1970, month: 1, day: 1 })).toBe(0);
    expect(formatCalendarDate(fromDayNumber(0))).toBe('1970-01-01');
  });

  it('counts backwards through negative day numbers before the epoch', () => {
    // Floor division, not truncation: `-1 / 400` truncated toward zero puts pre-1600 dates
    // in the wrong era and shifts them by a leap day.
    expect(toDayNumber({ year: 1969, month: 12, day: 31 })).toBe(-1);
    expect(formatCalendarDate(fromDayNumber(-1))).toBe('1969-12-31');
    expect(toDayNumber({ year: 1899, month: 12, day: 31 })).toBe(-25568);
    expect(toDayNumber({ year: 1900, month: 1, day: 1 })).toBe(-25567);
  });

  it.each([
    '1600-02-29',
    '1899-12-31',
    '1900-01-01',
    '1900-02-28',
    '1900-03-01',
    '1970-01-01',
    '1999-12-31',
    '2000-01-01',
    '2000-02-29',
    '2000-03-01',
    '2023-02-28',
    '2024-02-29',
    '2024-12-31',
    '2027-07-04',
    '2099-12-31',
    '2100-01-01',
    '2100-02-28',
    '2100-03-01',
  ])('round-trips %s through a day number unchanged', (raw) => {
    expect(formatCalendarDate(fromDayNumber(toDayNumber(parseCalendarDate(raw))))).toBe(raw);
  });

  /**
   * Spot checks catch the dates you thought to list. This walks every consecutive day across
   * the four boundaries where leap-year logic is most likely to be off by one, checking
   * against the independent `nextDay` oracle above, and checks that the encode direction
   * agrees with the decode direction at each step.
   */
  it.each([
    ['the non-leap century 1900', '1899-11-01', '1901-02-01'],
    ['the leap century 2000', '1999-11-01', '2001-02-01'],
    ['the non-leap century 2100', '2099-11-01', '2101-02-01'],
    ['the ordinary leap year 2024', '2023-11-01', '2025-02-01'],
  ])('assigns strictly consecutive day numbers across %s', (_label, from, to) => {
    const last = toDayNumber(parseCalendarDate(to));
    let expected = parseCalendarDate(from);
    for (let n = toDayNumber(expected); n <= last; n++) {
      expect(fromDayNumber(n)).toEqual(expected);
      expect(toDayNumber(expected)).toBe(n);
      expected = nextDay(expected);
    }
  });

  it('formats single-digit months and days with a leading zero', () => {
    // Zero-padding is what makes the string form sort chronologically, which
    // `compareCalendarDates` and every ORDER BY in the platform rely on.
    expect(formatCalendarDate({ year: 2027, month: 1, day: 2 })).toBe('2027-01-02');
    expect(formatCalendarDate({ year: 2027, month: 12, day: 9 })).toBe('2027-12-09');
  });
});

describe('addDays', () => {
  it('carries across a month end', () => {
    expect(addDays('2027-01-31', 1)).toBe('2027-02-01');
    expect(addDays('2027-04-30', 1)).toBe('2027-05-01');
  });

  it('carries across a year end', () => {
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01');
    expect(addDays('2028-01-01', -1)).toBe('2027-12-31');
  });

  it('counts the leap day in a leap year and skips it in a common year', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    // 365 days from a leap day lands short of the anniversary, because 2024 has 366.
    expect(addDays('2024-02-29', 365)).toBe('2025-02-28');
  });

  it('moves backwards for a negative argument', () => {
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2027-01-01', -365)).toBe('2026-01-01');
  });

  it('returns the same date when adding nothing', () => {
    expect(addDays('2027-06-15', 0)).toBe('2027-06-15');
  });

  it('rejects an unparseable starting date instead of computing from a guess', () => {
    expect(() => addDays('2027-02-30', 60)).toThrow(CalendarDateError);
  });

  /**
   * DEFECT (do not fix here — reported to the orchestrator).
   *
   * `addDays` and `addMonths` validate their input string but never validate the numeric
   * offset, and `formatCalendarDate` never checks that the components it is handed are
   * integers. The result is a *malformed output string*:
   *
   *   addDays('2027-01-01', 1.5)   === '2027-01-2.5'
   *   addDays('2027-01-01', NaN)   === '0NaN-NaN-NaN'
   *   addMonths('2027-01-01', 1.5) === '2027-2.5-00'
   *
   * A non-integer or NaN offset is reachable in practice: a duration read from JSON, a
   * rulepack parameter, or `Number(undefined)`. The module's entire premise is that a value
   * which is not a calendar date is refused at the boundary rather than passed on; here it
   * manufactures one and hands it downstream, where it will be written to a DATE column or
   * shown as a statutory deadline.
   *
   * The same missing output check lets arithmetic walk out of the year range the parser
   * declares: `addDays('9999-12-31', 1)` is '10000-01-01' and `addMonths('1583-01-01', -1)`
   * is '1582-12-01', both of which `parseCalendarDate` rejects — so the module emits values
   * it would refuse to read back.
   *
   * Correct behaviour: reject an offset that is not a finite integer (a `RangeError`, or a
   * `CalendarDateError`-style error naming the offset), and validate the computed result
   * before returning it, so that no caller can ever receive a string this module would
   * refuse to parse.
   */
  it('rejects a non-integer or non-finite offset instead of emitting a malformed date', () => {
    expect(() => addDays('2026-06-30', 1.5)).toThrow(CalendarDateError);
    expect(() => addDays('2026-06-30', Number.NaN)).toThrow(CalendarDateError);
    expect(() => addDays('2026-06-30', Number.POSITIVE_INFINITY)).toThrow(CalendarDateError);
    expect(() => addMonths('2026-06-30', 0.5)).toThrow(CalendarDateError);
    expect(() => addYears('2026-06-30', 1.5)).toThrow(CalendarDateError);
  });
});

describe('addWeeks', () => {
  it('is exactly seven days per week across a month boundary', () => {
    expect(addWeeks('2027-01-01', 8)).toBe('2027-02-26');
    expect(addWeeks('2027-01-01', -1)).toBe('2026-12-25');
    expect(addWeeks('2024-02-26', 1)).toBe('2024-03-04');
  });
});

describe('addMonths', () => {
  it('clamps to the last day of a shorter target month rather than overflowing', () => {
    // 31 January plus one month is the end of February, not 3 March.
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2027-03-31', 1)).toBe('2027-04-30');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
  });

  it('carries across a year boundary in both directions', () => {
    expect(addMonths('2027-12-31', 1)).toBe('2028-01-31');
    expect(addMonths('2027-01-15', -1)).toBe('2026-12-15');
    expect(addMonths('2027-01-15', -14)).toBe('2025-11-15');
    expect(addMonths('2027-01-31', 13)).toBe('2028-02-29');
  });

  it('preserves the day of month when the target month is long enough', () => {
    expect(addMonths('2027-01-15', 1)).toBe('2027-02-15');
    expect(addMonths('2027-02-28', -1)).toBe('2027-01-28');
    expect(addMonths('2027-06-30', 0)).toBe('2027-06-30');
  });

  /**
   * Clamping is lossy, and a rule that adds a month and later subtracts one does not get its
   * original date back. Documented rather than hidden: a fiscal period boundary computed by
   * round-tripping through `addMonths` will drift, so calendar windows must be derived from
   * the anchor date each time, never by walking forwards and back.
   */
  it('does not round-trip: adding then subtracting a month is not the identity', () => {
    expect(addMonths(addMonths('2027-01-31', 1), -1)).toBe('2027-01-28');
    expect(addMonths(addMonths('2024-01-31', 1), -1)).toBe('2024-01-29');
    expect(addMonths(addMonths('2027-01-30', 1), -1)).toBe('2027-01-28');
    // It is the identity whenever the intermediate month is long enough to hold the day.
    expect(addMonths(addMonths('2027-01-28', 1), -1)).toBe('2027-01-28');
  });
});

describe('addYears', () => {
  it('moves a leap day to 28 February in a common year', () => {
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
    expect(addYears('2024-02-29', -1)).toBe('2023-02-28');
  });

  it('keeps a leap day intact when the target year is also a leap year', () => {
    expect(addYears('2024-02-29', 4)).toBe('2028-02-29');
    expect(addYears('2000-02-29', -400)).toBe('1600-02-29');
  });

  it('crosses a non-leap century without inventing a 29 February', () => {
    expect(addYears('2096-02-29', 4)).toBe('2100-02-28');
  });

  it('preserves every other date exactly', () => {
    expect(addYears('2027-07-04', 3)).toBe('2030-07-04');
    expect(addYears('2027-07-04', -3)).toBe('2024-07-04');
  });
});

describe('diffDays', () => {
  it('counts a leap year as 366 days and a common year as 365', () => {
    expect(diffDays('2024-01-01', '2025-01-01')).toBe(366);
    expect(diffDays('2023-01-01', '2024-01-01')).toBe(365);
    // 1900 is not a leap year despite being divisible by four.
    expect(diffDays('1900-01-01', '1901-01-01')).toBe(365);
    expect(diffDays('2000-01-01', '2001-01-01')).toBe(366);
  });

  it('is zero for the same date and one for adjacent dates', () => {
    expect(diffDays('2027-05-05', '2027-05-05')).toBe(0);
    expect(diffDays('2027-05-05', '2027-05-06')).toBe(1);
  });

  it('is negative and equal in magnitude when the arguments are reversed', () => {
    expect(diffDays('2027-01-01', '2027-03-16')).toBe(74);
    expect(diffDays('2027-03-16', '2027-01-01')).toBe(-74);
    expect(diffDays('1899-12-31', '2100-01-01')).toBe(-diffDays('2100-01-01', '1899-12-31'));
  });

  it('is exact across the epoch, where the sign of the day number changes', () => {
    expect(diffDays('1969-12-31', '1970-01-02')).toBe(2);
  });
});

describe('diffMonths', () => {
  it('counts only whole months, truncating toward zero', () => {
    expect(diffMonths('2027-01-15', '2027-03-15')).toBe(2);
    expect(diffMonths('2027-01-15', '2027-03-14')).toBe(1);
    expect(diffMonths('2027-01-15', '2027-03-16')).toBe(2);
  });

  /**
   * The day-of-month adjustment: 31 January to 28 February has not completed a month by the
   * day-number comparison this function uses, even though `addMonths('2027-01-31', 1)` clamps
   * to that very date. The two functions are deliberately not inverses; a rule that needs
   * "one month has elapsed" must pick one convention and say which.
   */
  it('does not count a month that ended only because of clamping', () => {
    expect(diffMonths('2027-01-31', '2027-02-28')).toBe(0);
    expect(diffMonths('2027-03-31', '2027-04-30')).toBe(0);
    expect(diffMonths('2024-02-29', '2025-02-28')).toBe(11);
  });

  it('truncates toward zero on the negative side too, not downward', () => {
    expect(diffMonths('2027-03-15', '2027-01-15')).toBe(-2);
    expect(diffMonths('2027-03-15', '2027-01-16')).toBe(-1);
    expect(diffMonths('2027-01-15', '2026-11-20')).toBe(-1);
    expect(diffMonths('2027-02-28', '2027-01-31')).toBe(0);
  });

  it('is zero within a single month regardless of direction', () => {
    expect(diffMonths('2027-05-01', '2027-05-31')).toBe(0);
    expect(diffMonths('2027-05-31', '2027-05-01')).toBe(0);
  });
});

describe('diffYears', () => {
  it('counts only completed years, truncating toward zero', () => {
    expect(diffYears('2020-06-01', '2024-06-01')).toBe(4);
    expect(diffYears('2020-06-01', '2024-05-31')).toBe(3);
    expect(diffYears('2020-06-01', '2021-05-31')).toBe(0);
  });

  it('truncates toward zero rather than downward for a negative span', () => {
    expect(diffYears('2024-05-31', '2020-06-01')).toBe(-3);
    expect(diffYears('2024-06-01', '2020-06-01')).toBe(-4);
    // Eleven months backwards is zero whole years, not minus one — and positive zero, so
    // that a zero-length span does not read as though it had a direction.
    expect(diffYears('2027-01-01', '2026-02-01')).toBe(0);
  });

  /**
   * DEFECT (do not fix here — reported to the orchestrator).
   *
   * `diffYears` and `diffWeeks` round a negative fraction with `Math.ceil`, so a span shorter
   * than one whole unit in the backwards direction returns `-0` rather than `0`:
   *
   *   diffYears('2027-01-01', '2026-02-01')  is -0
   *   diffWeeks('2027-01-07', '2027-01-01')  is -0
   *
   * Harmless under `===`, `<` and `>`, but `Object.is(-0, 0)` is false, so it breaks equality
   * checks, snapshot and golden-corpus comparisons, and `Map`/`Set` keying — the places a
   * regulatory calculator's expected output actually gets compared. `diffMonths`, which does
   * its arithmetic in integers, correctly returns `+0` for the same span, so the three
   * functions disagree. Correct behaviour: normalise the result to `+0` (e.g. `result || 0`)
   * so that a zero-length span has one representation across all three.
   */
  it('returns positive zero, not negative zero, for a backwards span shorter than a year', () => {
    expect(Object.is(diffYears('2027-01-01', '2026-02-01'), 0)).toBe(true);
    expect(Object.is(diffWeeks('2026-06-30', '2026-06-27'), 0)).toBe(true);
  });

  it('applies the same clamping-blind day comparison as diffMonths at a leap day', () => {
    expect(diffYears('2024-02-29', '2025-02-28')).toBe(0);
    expect(diffYears('2024-02-29', '2028-02-29')).toBe(4);
  });
});

describe('diffWeeks', () => {
  it('counts only whole weeks, truncating toward zero in both directions', () => {
    expect(diffWeeks('2027-01-01', '2027-01-13')).toBe(1);
    expect(diffWeeks('2027-01-01', '2027-01-15')).toBe(2);
    expect(diffWeeks('2027-01-13', '2027-01-01')).toBe(-1);
    expect(diffWeeks('2027-01-01', '2027-01-07')).toBe(0);
    // Magnitude, not sign: the backwards short span currently yields -0. See diffYears.
    expect(Math.abs(diffWeeks('2027-01-07', '2027-01-01'))).toBe(0);
  });
});

describe('compareCalendarDates', () => {
  it('orders chronologically and reports equality as zero', () => {
    expect(compareCalendarDates('2027-01-01', '2027-01-02')).toBeLessThan(0);
    expect(compareCalendarDates('2027-01-02', '2027-01-01')).toBeGreaterThan(0);
    expect(compareCalendarDates('2027-01-01', '2027-01-01')).toBe(0);
  });

  it('validates both operands, unlike the lexical comparison it replaces', () => {
    // '2027-13-45' sorts fine as a string; it is not a date, and ordering against it would
    // silently succeed with a comparator that only looked at characters.
    expect(() => compareCalendarDates('2027-13-45', '2027-01-01')).toThrow(CalendarDateError);
    expect(() => compareCalendarDates('2027-01-01', '2027-02-30')).toThrow(CalendarDateError);
  });

  it('sorts a list into calendar order across century and epoch boundaries', () => {
    const sorted = ['2100-01-01', '1899-12-31', '1970-01-01', '2000-02-29'].sort(
      compareCalendarDates,
    );
    expect(sorted).toEqual(['1899-12-31', '1970-01-01', '2000-02-29', '2100-01-01']);
  });
});

describe('isWithin', () => {
  it('includes both endpoints, as a regulatory window does', () => {
    expect(isWithin('2027-07-01', '2027-07-01', '2028-06-30')).toBe(true);
    expect(isWithin('2028-06-30', '2027-07-01', '2028-06-30')).toBe(true);
  });

  it('excludes the day either side of the window', () => {
    expect(isWithin('2027-06-30', '2027-07-01', '2028-06-30')).toBe(false);
    expect(isWithin('2028-07-01', '2027-07-01', '2028-06-30')).toBe(false);
  });

  it('is true for a single-day window containing exactly that day', () => {
    expect(isWithin('2027-07-01', '2027-07-01', '2027-07-01')).toBe(true);
  });

  it('is false for an inverted window rather than silently swapping the bounds', () => {
    // A reversed fiscal period is a configuration error; answering "yes, in range" would
    // hide it behind a PASS.
    expect(isWithin('2027-02-01', '2027-03-01', '2027-01-01')).toBe(false);
  });

  it('rejects an unparseable bound instead of treating the window as open', () => {
    expect(() => isWithin('2027-02-01', '2027-02-30', '2027-12-31')).toThrow(CalendarDateError);
    expect(() => isWithin('2027-02-30', '2027-01-01', '2027-12-31')).toThrow(CalendarDateError);
  });
});

/**
 * The invariant the module exists for (CLAUDE.md invariant 6).
 *
 * 34 CFR 300.301(c)(1)(i): an initial evaluation must be conducted within 60 days of
 * receiving parental consent. That deadline is a square on a wall calendar. If it is routed
 * through a `Date`, a district in Hawaii and a reviewer in Berlin computing from the same
 * consent date get different days, and one of them files a finding that does not exist.
 */
describe('timezone independence of a statutory deadline', () => {
  const originalTz = process.env.TZ;

  afterAll(() => {
    // Leave the process as we found it — other suites share this worker.
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  const zones = [
    'UTC',
    'Pacific/Kiritimati',
    'Pacific/Niue',
    'America/Los_Angeles',
    'Asia/Kolkata',
  ];

  it('lands on the same calendar day in every time zone', () => {
    const consent = '2027-01-15';
    const results = zones.map((zone) => {
      process.env.TZ = zone;
      return addDays(consent, 60);
    });
    expect(new Set(results)).toEqual(new Set(['2027-03-16']));
  });

  it('is unaffected by the zone when the window crosses a leap day', () => {
    const results = zones.map((zone) => {
      process.env.TZ = zone;
      return { deadline: addDays('2024-01-15', 60), span: diffDays('2024-01-15', '2024-03-15') };
    });
    for (const result of results) {
      expect(result).toEqual({ deadline: '2024-03-15', span: 60 });
    }
  });

  /**
   * Guards against the previous two tests passing vacuously. If setting `process.env.TZ` had
   * no effect in this runtime, they would prove nothing at all. `Date` — the thing the module
   * refuses to use — does move between these two zones, which is precisely the hazard.
   */
  it('moves a Date across the two zones it is compared against, proving the switch is live', () => {
    process.env.TZ = 'Pacific/Kiritimati';
    const east = new Date('2027-01-15T00:00:00Z').getDate();
    process.env.TZ = 'Pacific/Niue';
    const west = new Date('2027-01-15T00:00:00Z').getDate();
    expect(east).not.toBe(west);
  });

  it('never lets the machine clock or zone reach the answer for any window length', () => {
    const consent = '2026-12-31';
    for (const days of [1, 30, 60, 90, 365]) {
      const answers = zones.map((zone) => {
        process.env.TZ = zone;
        const deadline = addDays(consent, days);
        return `${deadline}|${diffDays(consent, deadline)}|${isWithin(deadline, consent, addDays(consent, 400))}`;
      });
      expect(new Set(answers).size).toBe(1);
    }
  });
});
