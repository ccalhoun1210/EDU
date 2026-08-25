/**
 * The transformation library.
 *
 * Spec: Master Technical Buildout section 10.4. Every capability that section lists — date
 * parsing, currency parsing, enumeration mapping, boolean normalization, trimming and casing,
 * code crosswalk, split and merge, defaults, conditional mapping — is a named, declarative
 * step here rather than an expression a district administrator writes.
 *
 * ## Why transformations are data
 *
 * A mapping is authored by a district administrator in a UI and stored as a versioned
 * template. If a transformation could be an arbitrary expression, then a mapping would be
 * code, running on the server, authored by a customer — and the same reasoning that keeps
 * arbitrary code out of rules (CLAUDE.md invariant 2) applies with more force here, because
 * the author is outside the organisation entirely.
 *
 * So the set is closed. Every step is pure, deterministic, and reports what it did, which is
 * what §10.6 records as the `transformation` on a fact's provenance.
 *
 * ## Why a failure is a value, not an exception
 *
 * A transformation that cannot do its job returns an issue and leaves the value unmapped.
 * §10.5: "Never silently discard records." A currency string the parser does not recognise
 * becomes a reported problem on a named row and column that a district can go and fix — never
 * a zero, and never a dropped row.
 */

import { isAmountString } from '@complianceos/domain';
import { isCalendarDate, parseCalendarDate } from '@complianceos/domain';

export const TRANSFORM_NAMES = [
  'trim',
  'collapseWhitespace',
  'upperCase',
  'lowerCase',
  'titleCase',
  'nullIfBlank',
  'defaultValue',
  'parseCurrency',
  'parseInteger',
  'parseBoolean',
  'parseDate',
  'mapEnum',
  'crosswalk',
  'stripPrefix',
  'stripSuffix',
  'padStart',
  'requireOneOf',
] as const;

export type TransformName = (typeof TRANSFORM_NAMES)[number];

export type TransformStep =
  | { readonly transform: 'trim' }
  | { readonly transform: 'collapseWhitespace' }
  | { readonly transform: 'upperCase' }
  | { readonly transform: 'lowerCase' }
  | { readonly transform: 'titleCase' }
  | { readonly transform: 'nullIfBlank' }
  | { readonly transform: 'defaultValue'; readonly value: string }
  | {
      readonly transform: 'parseCurrency';
      /** Accept `(1,250.00)` as negative, the accounting convention many ERPs export. */
      readonly allowParentheses?: boolean;
      /** Accept a leading currency symbol. */
      readonly allowSymbol?: boolean;
    }
  | { readonly transform: 'parseInteger' }
  | {
      readonly transform: 'parseBoolean';
      readonly trueValues?: readonly string[];
      readonly falseValues?: readonly string[];
    }
  | {
      readonly transform: 'parseDate';
      /** Ordered list of accepted layouts. The first that matches wins. */
      readonly formats: readonly DateFormat[];
    }
  | { readonly transform: 'mapEnum'; readonly values: Readonly<Record<string, string>> }
  | {
      readonly transform: 'crosswalk';
      readonly codes: Readonly<Record<string, string>>;
      /** When false, an unknown code is an issue rather than a pass-through. */
      readonly passThroughUnknown?: boolean;
    }
  | { readonly transform: 'stripPrefix'; readonly prefix: string }
  | { readonly transform: 'stripSuffix'; readonly suffix: string }
  | { readonly transform: 'padStart'; readonly length: number; readonly fill: string }
  | { readonly transform: 'requireOneOf'; readonly values: readonly string[] };

export const DATE_FORMATS = [
  'YYYY-MM-DD',
  'MM/DD/YYYY',
  'M/D/YYYY',
  'DD/MM/YYYY',
  'YYYYMMDD',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export interface TransformIssue {
  readonly code: string;
  readonly message: string;
  readonly transform: TransformName;
}

/** One applied step, recorded for provenance (§10.6). */
export interface AppliedTransform {
  readonly transform: TransformName;
  readonly from: string | null;
  readonly to: string | null;
}

export interface TransformOutcome {
  /** null means "no value" — distinct from the empty string, which is a value. */
  readonly value: string | null;
  readonly applied: readonly AppliedTransform[];
  readonly issue?: TransformIssue;
}

function issue(transform: TransformName, code: string, message: string): TransformIssue {
  return { transform, code, message };
}

const DIGITS_ONLY = /^\d+$/;

/**
 * Parse a currency string into a canonical decimal string.
 *
 * Deliberately narrow. It accepts what district ERP exports actually contain — grouping
 * commas, a leading `$`, accounting parentheses, a trailing minus — and rejects everything
 * else. A permissive parser here is how `1.234,56` from a European locale becomes `1.234`
 * and a maintenance-of-effort finding goes wrong by three orders of magnitude.
 */
function parseCurrency(
  raw: string,
  options: { allowParentheses: boolean; allowSymbol: boolean },
): { value?: string; issue?: TransformIssue } {
  let text = raw.trim();
  if (text === '') return { issue: issue('parseCurrency', 'BLANK', 'no value to parse') };

  let negative = false;

  if (options.allowParentheses && text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  if (options.allowSymbol) text = text.replace(/^[$]\s*/, '');

  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1).trim();
  } else if (text.endsWith('-')) {
    negative = !negative;
    text = text.slice(0, -1).trim();
  }

  // Grouping separators, but only where they actually group: "1,234,567.89" is fine and
  // "1,23,4" is not. Rejecting the malformed case is the point — it usually means the file
  // is not in the locale the mapping assumes.
  if (text.includes(',')) {
    if (!/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(text)) {
      return {
        issue: issue(
          'parseCurrency',
          'UNRECOGNISED_FORMAT',
          `"${raw}" does not group as thousands. If this file uses a different locale, the ` +
            'mapping needs a different transformation rather than a looser parser.',
        ),
      };
    }
    text = text.replace(/,/g, '');
  }

  if (!/^\d+(\.\d+)?$/.test(text)) {
    return {
      issue: issue('parseCurrency', 'UNRECOGNISED_FORMAT', `"${raw}" is not a currency amount`),
    };
  }

  const signed = negative && Number(text) !== 0 ? `-${text}` : text;
  return { value: signed };
}

function parseDateWith(raw: string, format: DateFormat): string | undefined {
  const text = raw.trim();
  const pad = (value: string): string => value.padStart(2, '0');

  const build = (year: string, month: string, day: string): string | undefined => {
    const candidate = `${year}-${pad(month)}-${pad(day)}`;
    // parseCalendarDate rejects a date that does not exist — 31 February never becomes
    // 3 March here, which is what `Date` would do and what would silently move a deadline.
    try {
      parseCalendarDate(candidate);
      return candidate;
    } catch {
      return undefined;
    }
  };

  switch (format) {
    case 'YYYY-MM-DD': {
      const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
      return match ? build(match[1] ?? '', match[2] ?? '', match[3] ?? '') : undefined;
    }
    case 'MM/DD/YYYY':
    case 'M/D/YYYY': {
      const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
      return match ? build(match[3] ?? '', match[1] ?? '', match[2] ?? '') : undefined;
    }
    case 'DD/MM/YYYY': {
      const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
      return match ? build(match[3] ?? '', match[2] ?? '', match[1] ?? '') : undefined;
    }
    case 'YYYYMMDD': {
      if (!/^\d{8}$/.test(text)) return undefined;
      return build(text.slice(0, 4), text.slice(4, 6), text.slice(6, 8));
    }
  }
}

const DEFAULT_TRUE = ['true', 'yes', 'y', '1', 't'];
const DEFAULT_FALSE = ['false', 'no', 'n', '0', 'f'];

function applyStep(
  value: string | null,
  step: TransformStep,
): {
  value: string | null;
  issue?: TransformIssue;
} {
  // A null flowing through most steps stays null: there is nothing to trim or upper-case.
  // `defaultValue` is the deliberate exception, since supplying a value is its whole job.
  if (value === null && step.transform !== 'defaultValue') return { value: null };

  const text = value ?? '';

  switch (step.transform) {
    case 'trim':
      return { value: text.trim() };
    case 'collapseWhitespace':
      return { value: text.replace(/\s+/g, ' ').trim() };
    case 'upperCase':
      return { value: text.toUpperCase() };
    case 'lowerCase':
      return { value: text.toLowerCase() };
    case 'titleCase':
      return {
        value: text
          .toLowerCase()
          .replace(
            /(^|\s|-)(\p{L})/gu,
            (_match, lead: string, letter: string) => lead + letter.toUpperCase(),
          ),
      };
    case 'nullIfBlank':
      return { value: text.trim() === '' ? null : text };
    case 'defaultValue':
      return { value: value === null || value.trim() === '' ? step.value : value };
    case 'stripPrefix':
      return { value: text.startsWith(step.prefix) ? text.slice(step.prefix.length) : text };
    case 'stripSuffix':
      return { value: text.endsWith(step.suffix) ? text.slice(0, -step.suffix.length) : text };
    case 'padStart':
      return { value: text.padStart(step.length, step.fill) };

    case 'parseCurrency': {
      const outcome = parseCurrency(text, {
        allowParentheses: step.allowParentheses ?? true,
        allowSymbol: step.allowSymbol ?? true,
      });
      return outcome.value === undefined
        ? { value: null, ...(outcome.issue ? { issue: outcome.issue } : {}) }
        : { value: outcome.value };
    }

    case 'parseInteger': {
      const cleaned = text.trim().replace(/,/g, '');
      if (!DIGITS_ONLY.test(cleaned.replace(/^-/, '')) || cleaned === '' || cleaned === '-') {
        return {
          value: null,
          issue: issue('parseInteger', 'NOT_AN_INTEGER', `"${text}" is not a whole number`),
        };
      }
      return { value: String(BigInt(cleaned)) };
    }

    case 'parseBoolean': {
      const lowered = text.trim().toLowerCase();
      const trueValues = (step.trueValues ?? DEFAULT_TRUE).map((v) => v.toLowerCase());
      const falseValues = (step.falseValues ?? DEFAULT_FALSE).map((v) => v.toLowerCase());
      if (trueValues.includes(lowered)) return { value: 'true' };
      if (falseValues.includes(lowered)) return { value: 'false' };
      return {
        value: null,
        issue: issue('parseBoolean', 'NOT_A_BOOLEAN', `"${text}" is neither true nor false`),
      };
    }

    case 'parseDate': {
      for (const format of step.formats) {
        const parsed = parseDateWith(text, format);
        if (parsed !== undefined) return { value: parsed };
      }
      return {
        value: null,
        issue: issue(
          'parseDate',
          'UNRECOGNISED_DATE',
          `"${text}" does not match any of ${step.formats.join(', ')}`,
        ),
      };
    }

    case 'mapEnum': {
      const mapped = step.values[text.trim()];
      if (mapped === undefined) {
        return {
          value: null,
          issue: issue(
            'mapEnum',
            'UNMAPPED_VALUE',
            `"${text}" has no mapping. Add it to the template rather than letting it through — ` +
              'an unrecognised category silently excluded from a count is a wrong denominator.',
          ),
        };
      }
      return { value: mapped };
    }

    case 'crosswalk': {
      const mapped = step.codes[text.trim()];
      if (mapped !== undefined) return { value: mapped };
      if (step.passThroughUnknown === true) return { value: text };
      return {
        value: null,
        issue: issue('crosswalk', 'UNKNOWN_CODE', `"${text}" is not in the crosswalk`),
      };
    }

    case 'requireOneOf': {
      if (step.values.includes(text)) return { value: text };
      return {
        value: null,
        issue: issue(
          'requireOneOf',
          'NOT_PERMITTED',
          `"${text}" is not one of ${step.values.join(', ')}`,
        ),
      };
    }
  }
}

/**
 * Run a value through an ordered chain of steps.
 *
 * Stops at the first failure. Continuing would compound one problem into several and bury the
 * one the district can actually act on.
 */
export function applyTransforms(
  input: string | null,
  steps: readonly TransformStep[],
): TransformOutcome {
  let value = input;
  const applied: AppliedTransform[] = [];

  for (const step of steps) {
    const before = value;
    const result = applyStep(value, step);
    applied.push({ transform: step.transform, from: before, to: result.value });

    if (result.issue !== undefined) {
      return { value: null, applied, issue: result.issue };
    }
    value = result.value;
  }

  return { value, applied };
}

/** A one-line record of the chain, for the provenance `transformation` field (§10.6). */
export function describeTransforms(steps: readonly TransformStep[]): string {
  return steps.length === 0 ? 'identity' : steps.map((step) => step.transform).join(' → ');
}

/** True when a transformed value is already in canonical money form. */
export function isCanonicalMoney(value: string | null): boolean {
  return value !== null && isAmountString(value);
}

/** True when a transformed value is already a calendar date. */
export function isCanonicalDate(value: string | null): boolean {
  return value !== null && isCalendarDate(value);
}
