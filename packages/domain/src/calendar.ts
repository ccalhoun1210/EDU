/**
 * Calendar-date arithmetic on `YYYY-MM-DD` strings.
 *
 * Spec: Master Technical Buildout section 4. CLAUDE.md invariant 6.
 *
 * A regulatory deadline is a calendar date. "Sixty days from receipt of consent" names a
 * square on a wall calendar; it does not name an instant, and it has no time zone. The
 * moment such a date is put through `new Date(...)` it acquires one, and a deadline computed
 * in one zone and read back in another lands on the wrong day. In a Child Find timeline that
 * is the difference between compliant and not.
 *
 * So this module never constructs a `Date`. Everything here is integer arithmetic over
 * (year, month, day) triples, converting through a day number when it needs to count.
 *
 * The conversion is Howard Hinnant's civil-from-days algorithm, which is exact for any year
 * in the proleptic Gregorian calendar. It is dense, and the reason to use it rather than a
 * loop over months is that a loop is where off-by-one errors around leap years live.
 */

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A calendar date in ISO `YYYY-MM-DD` form.
 *
 * The string is the canonical representation everywhere in the platform — wire, storage,
 * rule-pack YAML, golden corpus. `CalendarParts` is only the decomposed form used while
 * doing arithmetic; it is not what anything stores.
 */
export type CalendarDate = string;

export interface CalendarParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export class CalendarDateError extends Error {
  constructor(
    readonly raw: string,
    reason: string,
  ) {
    super(`"${raw}" is not a usable calendar date: ${reason}`);
    this.name = 'CalendarDateError';
  }
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return MONTH_LENGTHS[month - 1] ?? 0;
}

/**
 * Parse, and reject a date that does not exist.
 *
 * `2027-02-30` is syntactically fine and is not a day. Accepting it and silently normalising
 * to 2 March — which is what `Date` does — would turn a typo in a district export into a
 * deadline two days late, with nothing anywhere reporting a problem.
 */
export function parseCalendarDate(raw: string): CalendarParts {
  const match = CALENDAR_DATE.exec(raw);
  if (match === null) throw new CalendarDateError(raw, 'expected YYYY-MM-DD');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // A plausibility bound, not a limit of the arithmetic — `toDayNumber` and `fromDayNumber`
  // are exact for any year. It exists because a four-digit-year regex happily accepts
  // "0026-06-30", which in a district export is a mistyped 2026 rather than a date in the
  // first century, and a due date silently placed two millennia in the past would make every
  // deadline appear met.
  if (year < 1583 || year > 9999) {
    throw new CalendarDateError(
      raw,
      `year ${year} is outside the range this platform accepts (1583-9999)`,
    );
  }
  if (month < 1 || month > 12) throw new CalendarDateError(raw, `month ${month} does not exist`);
  const limit = daysInMonth(year, month);
  if (day < 1 || day > limit) {
    throw new CalendarDateError(
      raw,
      `${year}-${match[2]} has ${limit} days, so day ${day} does not exist`,
    );
  }

  return { year, month, day };
}

export function formatCalendarDate(date: CalendarParts): string {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${String(date.year).padStart(4, '0')}-${month}-${day}`;
}

export function isCalendarDate(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  try {
    parseCalendarDate(raw);
    return true;
  } catch {
    return false;
  }
}

/** Days since 1970-01-01. Pure integer arithmetic; no Date, no zone, no clock. */
export function toDayNumber(date: CalendarParts): number {
  const year = date.year - (date.month <= 2 ? 1 : 0);
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear =
    Math.floor((153 * (date.month + (date.month > 2 ? -3 : 9)) + 2) / 5) + date.day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

export function fromDayNumber(dayNumber: number): CalendarParts {
  const shifted = dayNumber + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  return { year: year + (month <= 2 ? 1 : 0), month, day };
}

/**
 * Guard an offset before it reaches the arithmetic.
 *
 * `addDays(d, 1.5)` would otherwise yield a fractional day number and format to something
 * `parseCalendarDate` itself would reject — a malformed string escaping from a function whose
 * whole contract is to return a valid date. A caller that has computed a fractional offset
 * has a bug upstream, and the earliest possible failure is the kindest one.
 */
function requireWholeOffset(offset: number, unit: string): number {
  if (!Number.isSafeInteger(offset)) {
    throw new CalendarDateError(
      String(offset),
      `an offset of ${unit} must be a whole number within the safe integer range`,
    );
  }
  return offset;
}

export function addDays(raw: string, days: number): string {
  return formatCalendarDate(
    fromDayNumber(toDayNumber(parseCalendarDate(raw)) + requireWholeOffset(days, 'days')),
  );
}

/**
 * Add whole months, clamping to the end of the target month.
 *
 * 31 January plus one month is 28 or 29 February, not 3 March. Clamping is the convention
 * every statutory scheme this platform has met uses, but it is a convention rather than a
 * universal, so a rule that needs different behaviour must say so explicitly.
 */
export function addMonths(raw: string, months: number): string {
  const date = parseCalendarDate(raw);
  const zeroBased = date.year * 12 + (date.month - 1) + requireWholeOffset(months, 'months');
  const year = Math.floor(zeroBased / 12);
  const month = zeroBased - year * 12 + 1;
  return formatCalendarDate({ year, month, day: Math.min(date.day, daysInMonth(year, month)) });
}

/** Add whole years. 29 February plus one year is 28 February in a common year. */
export function addYears(raw: string, years: number): string {
  return addMonths(raw, requireWholeOffset(years, 'years') * 12);
}

export function addWeeks(raw: string, weeks: number): string {
  return addDays(raw, requireWholeOffset(weeks, 'weeks') * 7);
}

/** Calendar days from `from` to `to`. Negative when `to` precedes `from`. */
export function diffDays(from: string, to: string): number {
  return toDayNumber(parseCalendarDate(to)) - toDayNumber(parseCalendarDate(from));
}

/** Whole months between two dates, truncated toward zero. */
export function diffMonths(from: string, to: string): number {
  const a = parseCalendarDate(from);
  const b = parseCalendarDate(to);
  const months = (b.year - a.year) * 12 + (b.month - a.month);
  if (months > 0 && b.day < a.day) return months - 1;
  if (months < 0 && b.day > a.day) return months + 1;
  return months;
}

export function diffYears(from: string, to: string): number {
  const months = diffMonths(from, to);
  // `|| 0` normalises negative zero. `Math.ceil(-11 / 12)` is `-0`, which prints as "-0" and
  // makes a zero-length span read as though it had a direction. `diffMonths` works in
  // integers and returns `+0` for the same span, so without this the three differs disagree
  // about how to say "no whole units between these dates".
  return (months < 0 ? Math.ceil(months / 12) : Math.floor(months / 12)) || 0;
}

export function diffWeeks(from: string, to: string): number {
  const days = diffDays(from, to);
  return (days < 0 ? Math.ceil(days / 7) : Math.floor(days / 7)) || 0;
}

/**
 * Compare two calendar dates.
 *
 * `YYYY-MM-DD` sorts correctly as a string, which is why the format is used throughout. This
 * function exists so that intent is legible at call sites and so both dates are validated —
 * a lexical comparison would happily order `2027-13-45` against a real date.
 */
export function compareCalendarDates(a: string, b: string): number {
  return toDayNumber(parseCalendarDate(a)) - toDayNumber(parseCalendarDate(b));
}

/** Inclusive on both ends, as regulatory windows almost always are. */
export function isWithin(value: string, min: string, max: string): boolean {
  return compareCalendarDates(value, min) >= 0 && compareCalendarDates(value, max) <= 0;
}
