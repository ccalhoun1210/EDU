/**
 * Canonical serialization and content hashing.
 *
 * Spec: Master Technical Buildout sections 8.7, 11 and 21. CLAUDE.md invariants 4 and 5.
 *
 * Three separate requirements need the same thing — a byte-stable representation of a
 * structured value:
 *
 * - An **evaluation hash** (8.7), so a finalized result can be shown to be the one that was
 *   computed, and so re-running the same rule against the same inputs is demonstrably the
 *   same computation rather than merely a similar one.
 * - A **data snapshot hash** (11), so an assessment run pins the facts it saw.
 * - The **audit hash chain** (21), where a per-tenant chain makes deletion and reordering
 *   detectable.
 *
 * `JSON.stringify` cannot serve any of them. Its output depends on property insertion order,
 * so two records with identical content hash differently depending on how they were built.
 *
 * ## Why a non-integer number is rejected
 *
 * The serializer refuses to encode a fractional number. That looks severe until you consider
 * what a fractional number in a compliance record means: someone put money, a ratio, or a
 * per-capita amount into a payload as an IEEE-754 double. `0.1 + 0.2` is `0.30000000000000004`,
 * and a hash computed over it is a stable hash of a wrong number. Invariant 5 says money is
 * exact; this is the point at which the system stops being able to pretend otherwise.
 *
 * Whole numbers are permitted because counts — children, enrollment, rows — are genuinely
 * integers. Everything else must arrive as a decimal string.
 */

import { createHash } from 'node:crypto';

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export class CanonicalizationError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${path || '(root)'}: ${message}`);
    this.name = 'CanonicalizationError';
  }
}

function encode(value: unknown, path: string, ancestors: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);

    case 'boolean':
      return value ? 'true' : 'false';

    case 'number': {
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(`${String(value)} cannot be canonicalized`, path);
      }
      if (!Number.isInteger(value)) {
        throw new CanonicalizationError(
          `${value} is a fractional number. Money, ratios and per-capita amounts must be ` +
            'decimal strings — a float here would hash a rounding artifact as if it were fact.',
          path,
        );
      }
      // `Object.is` distinguishes -0 from 0; they must not hash differently.
      return Object.is(value, -0) ? '0' : String(value);
    }

    case 'bigint':
      return value.toString();

    case 'object': {
      // A cycle would otherwise recurse until the stack gives out, which reports nothing
      // useful about where the problem is. Every other unusable input here names its path.
      if (ancestors.has(value)) {
        throw new CanonicalizationError('a circular reference closes here', path);
      }
      ancestors.add(value);

      try {
        if (Array.isArray(value)) {
          const items: string[] = [];
          // Indexed rather than `.map`, which skips holes: `[1, , 3].map(encode)` leaves the
          // hole untouched and it would slip through, while an explicit `undefined` in the
          // same position is refused. Two spellings of the same absence must not behave
          // differently in a function whose output is a hash.
          for (let index = 0; index < value.length; index += 1) {
            items.push(encode(value[index], `${path}[${index}]`, ancestors));
          }
          return `[${items.join(',')}]`;
        }

        // Only plain objects. A Date, Map, Set, RegExp or boxed primitive has no own
        // enumerable properties, so the generic branch below would encode it as `{}` — and
        // two different Dates would hash identically. Silently losing a value inside a
        // content hash is the worst failure this module could have, so it is refused.
        const prototype: unknown = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          const name = value.constructor?.name ?? 'object with a custom prototype';
          throw new CanonicalizationError(
            `cannot canonicalize a ${name}. Convert it to a plain value first — a date to a ` +
              'YYYY-MM-DD string, a Map to a plain object — so the conversion is visible.',
            path,
          );
        }

        const record = value as Record<string, unknown>;
        // Sort by UTF-16 code unit, the default JavaScript string ordering. Any total order
        // works as long as it is fixed forever; this one is the least surprising and needs no
        // locale, which would otherwise make the hash depend on the machine.
        const keys = Object.keys(record)
          .filter((key) => record[key] !== undefined)
          .sort();

        const entries = keys.map((key) => {
          const encoded = encode(record[key], path === '' ? key : `${path}.${key}`, ancestors);
          return `${JSON.stringify(key)}:${encoded}`;
        });
        return `{${entries.join(',')}}`;
      } finally {
        ancestors.delete(value);
      }
    }

    default:
      throw new CanonicalizationError(`cannot canonicalize a ${typeof value}`, path);
  }
}

/**
 * Deterministic serialization: object keys sorted recursively, absent properties omitted.
 *
 * A property whose value is `undefined` is dropped rather than encoded, matching JSON's own
 * model where the property simply does not exist. A caller who needs to distinguish "not
 * supplied" from "supplied as nothing" must use `null`, which is preserved.
 */
export function canonicalize(value: unknown): string {
  return encode(value, '', new Set());
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** The content hash of a structured value. Stable across property order and process runs. */
export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalize(value));
}
