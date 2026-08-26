/**
 * Behavioural tests for canonical serialization and content hashing.
 *
 * Spec: Master Technical Buildout sections 8.7 (evaluation hash), 11 (data snapshot hash)
 * and 21 (audit hash chain). CLAUDE.md invariants 4 and 5.
 *
 * All three of those guarantees reduce to one property: structurally equal values must
 * produce byte-identical output, and structurally different values must not. Everything
 * below is an attempt to break that property — with property order, with array order, with
 * floats, with absent values, with strings that impersonate numbers, and with types the
 * serializer has no honest encoding for. A test that only proves `{a:1}` round-trips would
 * make the hash chain look trustworthy without establishing that it is.
 */

import { describe, expect, it } from 'vitest';
import { CanonicalizationError, canonicalize, hashCanonical, sha256Hex } from './canonical.js';

/**
 * Assert that canonicalization was refused, and hand the error back so the caller can make
 * claims about the path. A plain `toThrow` cannot check `path`, and `path` is the whole
 * reason the error type exists: a rejected snapshot is useless if nobody can find the field.
 */
function refusal(fn: () => unknown): CanonicalizationError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CanonicalizationError);
    return error as CanonicalizationError;
  }
  return expect.fail('expected canonicalization to be refused, but it succeeded');
}

describe('canonicalize — property order', () => {
  it('hashes a deeply nested record identically however its properties were inserted', () => {
    // Both literals describe the same snapshot. Every object in the tree — including the
    // ones inside the array — is written with its keys in a different order in each.
    const builtOneWay = {
      run: {
        fiscalYear: 2026,
        district: { lea: 'LEA-004', state: 'TX' },
        facts: {
          expenditures: [
            { amount: '1250.00', fund: 'IDEA-611', object: '6100' },
            { amount: '90000.00', fund: 'LOCAL', object: '6200' },
          ],
          childCount: 412,
        },
      },
      snapshotId: 'snap-1',
    };

    const builtAnother = {
      snapshotId: 'snap-1',
      run: {
        facts: {
          childCount: 412,
          expenditures: [
            { object: '6100', amount: '1250.00', fund: 'IDEA-611' },
            { fund: 'LOCAL', object: '6200', amount: '90000.00' },
          ],
        },
        district: { state: 'TX', lea: 'LEA-004' },
        fiscalYear: 2026,
      },
    };

    expect(canonicalize(builtOneWay)).toBe(canonicalize(builtAnother));
    expect(hashCanonical(builtOneWay)).toBe(hashCanonical(builtAnother));
  });

  it('orders keys by UTF-16 code unit, which puts digits before uppercase before lowercase', () => {
    // Pinned as a literal because the ordering rule must be fixed forever: a switch to a
    // locale-aware collation would silently re-hash every finalized run on a machine whose
    // locale differs from the one that wrote it.
    expect(canonicalize({ b: 1, A: 2, a: 3, '10': 4, '2': 5, Z: 6 })).toBe(
      '{"10":4,"2":5,"A":2,"Z":6,"a":3,"b":1}',
    );
  });

  it('sorts keys inside array elements, not only at the top level', () => {
    expect(hashCanonical([{ b: 1, a: 2 }])).toBe(hashCanonical([{ a: 2, b: 1 }]));
  });
});

describe('canonicalize — array order', () => {
  it('treats a list as ordered data, so reordering its elements changes the digest', () => {
    expect(hashCanonical([1, 2, 3])).not.toBe(hashCanonical([3, 2, 1]));
  });

  it('distinguishes reordered objects in a list even when the set of objects is unchanged', () => {
    // An expenditure ledger is a sequence. If reordering rows were free, a snapshot hash
    // could not detect a row being moved, only added or removed.
    const forwards = [{ id: 'a' }, { id: 'b' }];
    const backwards = [{ id: 'b' }, { id: 'a' }];
    expect(hashCanonical(forwards)).not.toBe(hashCanonical(backwards));
  });

  it('does not confuse an empty array with an empty object', () => {
    expect(canonicalize([])).toBe('[]');
    expect(canonicalize({})).toBe('{}');
    expect(hashCanonical([])).not.toBe(hashCanonical({}));
  });

  it('does not confuse a one-element list with the element itself', () => {
    expect(hashCanonical([1])).not.toBe(hashCanonical(1));
    expect(hashCanonical(['x'])).not.toBe(hashCanonical('x'));
  });
});

describe('canonicalize — numbers', () => {
  it('refuses a fractional number and names the path that carried it', () => {
    const error = refusal(() => canonicalize({ amount: 0.1 }));
    expect(error.path).toBe('amount');
    expect(error.message).toContain('amount');
    expect(error.message).toContain('fractional');
  });

  it('refuses 0.1 + 0.2 rather than hashing 0.30000000000000004 as if it were three tenths', () => {
    // The classic case, and the reason invariant 5 exists. The sum is not 0.3, so a hash
    // over it is a perfectly stable hash of a wrong number — the worst possible outcome,
    // because it looks like evidence.
    expect(0.1 + 0.2).not.toBe(0.3);
    const error = refusal(() => canonicalize({ total: 0.1 + 0.2 }));
    expect(error.path).toBe('total');
    expect(error.message).toContain('0.30000000000000004');
  });

  it('accepts whole numbers, because counts really are integers', () => {
    expect(canonicalize({ childCount: 412 })).toBe('{"childCount":412}');
    expect(canonicalize({ delta: -7 })).toBe('{"delta":-7}');
    expect(canonicalize(0)).toBe('0');
  });

  it('refuses NaN and reports the path', () => {
    const error = refusal(() => canonicalize({ ratio: { value: Number.NaN } }));
    expect(error.path).toBe('ratio.value');
    expect(error.message).toContain('NaN');
  });

  it('refuses Infinity and -Infinity and reports the path', () => {
    const positive = refusal(() => canonicalize([Number.POSITIVE_INFINITY]));
    expect(positive.path).toBe('[0]');
    expect(positive.message).toContain('Infinity');

    const negative = refusal(() => canonicalize({ floor: Number.NEGATIVE_INFINITY }));
    expect(negative.path).toBe('floor');
    expect(negative.message).toContain('-Infinity');
  });

  it('hashes negative zero and zero identically, as the module claims', () => {
    // -0 arises from arithmetic (`0 * -1`) and is `===` to 0, so two records that compare
    // equal everywhere in application code must not disagree at the hash.
    expect(Object.is(-0, 0)).toBe(false);
    expect(canonicalize({ z: -0 })).toBe('{"z":0}');
    expect(hashCanonical({ z: -0 })).toBe(hashCanonical({ z: 0 }));
    expect(hashCanonical([-0])).toBe(hashCanonical([0]));
  });
});

describe('canonicalize — undefined and null', () => {
  it('drops a property whose value is undefined, matching JSON’s own model', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('preserves null, which is how a caller says "supplied, and it was nothing"', () => {
    expect(canonicalize({ a: 1, b: null })).toBe('{"a":1,"b":null}');
  });

  it('distinguishes an absent property from a null one, but not from an undefined one', () => {
    // The three-way relationship is the contract: "not supplied" and "supplied as
    // undefined" are the same fact; "supplied as null" is a different fact.
    expect(hashCanonical({ a: 1, b: undefined })).toBe(hashCanonical({ a: 1 }));
    expect(hashCanonical({ a: 1, b: null })).not.toBe(hashCanonical({ a: 1 }));
  });

  it('refuses undefined as a whole value rather than serializing it as nothing', () => {
    const error = refusal(() => canonicalize(undefined));
    expect(error.path).toBe('');
    expect(error.message).toContain('(root)');
  });

  it('refuses an undefined array element rather than shortening or nulling the list', () => {
    // Dropping it would change the length of an ordered list; encoding it as null would
    // invent a fact. Refusal is the only answer that does not corrupt a snapshot.
    const error = refusal(() => canonicalize({ rows: [1, undefined, 3] }));
    expect(error.path).toBe('rows[1]');
  });
});

describe('canonicalize — strings are never reinterpreted', () => {
  /**
   * This is a real seam between two modules and it is easy to get backwards.
   *
   * `money.formatAmount` is what normalises a decimal numeral: it is what turns `"1250"`
   * and `"1250.00"` into one agreed form before a value is stored or hashed. Canonicalize
   * deliberately does NOT do that — it has no idea whether a given string is money, a fund
   * code, a district id or free text, and a serializer that guessed would quietly rewrite
   * `"0100"` (an object code) into `"100"`.
   *
   * So the ordering is: normalise with money first, canonicalize second. If these two
   * strings ever start hashing the same here, the seam has been broken and un-normalised
   * data will silently pass a snapshot comparison.
   */
  it('hashes "1250.00" and "1250" differently, because normalising decimals is money’s job', () => {
    expect(canonicalize('1250.00')).toBe('"1250.00"');
    expect(canonicalize('1250')).toBe('"1250"');
    expect(hashCanonical({ amount: '1250.00' })).not.toBe(hashCanonical({ amount: '1250' }));
  });

  it('never lets a string impersonate the scalar it spells', () => {
    expect(hashCanonical({ a: '1' })).not.toBe(hashCanonical({ a: 1 }));
    expect(hashCanonical({ a: 'null' })).not.toBe(hashCanonical({ a: null }));
    expect(hashCanonical({ a: 'true' })).not.toBe(hashCanonical({ a: true }));
  });

  it('escapes quotes, backslashes and control characters so a string cannot forge structure', () => {
    expect(canonicalize({ a: 'a"b\\c\nd' })).toBe('{"a":"a\\"b\\\\c\\nd"}');
    // A value containing serializer punctuation must not be able to fake a second property.
    expect(hashCanonical({ a: '1","b":2' })).not.toBe(hashCanonical({ a: '1', b: 2 }));
  });

  it('escapes a key the same way it escapes a value', () => {
    expect(canonicalize({ 'a"b': 1 })).toBe('{"a\\"b":1}');
  });
});

describe('CanonicalizationError paths', () => {
  it('points at the offending value through nested objects and array indices', () => {
    const snapshot = {
      facts: {
        expenditures: [{ amount: '1.00' }, { amount: '2.00' }, { amount: 3.5 }],
      },
    };
    const error = refusal(() => canonicalize(snapshot));
    expect(error.path).toBe('facts.expenditures[2].amount');
    expect(error.message.startsWith('facts.expenditures[2].amount: ')).toBe(true);
  });

  it('reports an index chain for an array nested inside an array', () => {
    const error = refusal(() =>
      canonicalize({
        grid: [
          [1, 2],
          [3, Number.NaN],
        ],
      }),
    );
    expect(error.path).toBe('grid[1][1]');
  });

  it('is an Error subclass named CanonicalizationError, so a catch site can tell it apart', () => {
    const error = refusal(() => canonicalize({ x: 1.5 }));
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CanonicalizationError');
  });
});

describe('canonicalize — unsupported types', () => {
  it('refuses a function rather than silently dropping it', () => {
    const error = refusal(() => canonicalize({ compute: () => 1 }));
    expect(error.path).toBe('compute');
    expect(error.message).toContain('function');
  });

  it('refuses a symbol value rather than silently dropping it', () => {
    const error = refusal(() => canonicalize({ tag: Symbol('rule') }));
    expect(error.path).toBe('tag');
    expect(error.message).toContain('symbol');
  });

  /**
   * DEFECT: a non-plain object is silently serialized as `{}` instead of being refused.
   *
   * `encode` reaches the `case 'object'` branch for any object that is not an array and
   * calls `Object.keys` on it. A Date, Map, Set or boxed Number has no own enumerable
   * properties, so it encodes as the empty object. Consequences:
   *
   *   canonicalize({ d: new Date('2026-08-25') })  === '{"d":{}}'
   *   canonicalize({ d: new Date('1999-01-01') })  === '{"d":{}}'
   *
   * Two snapshots that differ only in a date hash identically, which defeats every use
   * this module exists for — and it does so silently, which is worse than throwing. It
   * also contradicts invariant 6: a regulatory date must travel as a `YYYY-MM-DD` string,
   * and this is precisely the boundary that should say so.
   *
   * Correct behaviour: refuse any object whose prototype is not `Object.prototype` or
   * `null` (Date, Map, Set, RegExp, boxed primitives) with a `CanonicalizationError`
   * naming the path and the offending constructor, in the same way a function is refused.
   */
  it('refuses a Date, Map or Set rather than encoding it as the empty object', () => {
    expect(() => canonicalize({ at: new Date(0) })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ m: new Map([['a', 1]]) })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ s: new Set([1]) })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ r: /x/ })).toThrow(CanonicalizationError);
    // The path names where the offending value sits, as every other rejection does.
    expect(() => canonicalize({ event: { at: new Date(0) } })).toThrow(/event\.at/);
    // An object with a null prototype carries no behaviour and is safe.
    expect(canonicalize(Object.assign(Object.create(null), { a: 1 }))).toBe('{"a":1}');
  });

  /**
   * DEFECT: an array hole is silently emitted, and collides.
   *
   * `value.map(...)` skips holes, leaving the result array sparse; `Array.prototype.join`
   * renders a hole as the empty string. So:
   *
   *   canonicalize([1, , 3]) === '[1,,3]'   // not valid JSON, and no error raised
   *   canonicalize([, ])     === '[]'       // length 1
   *   canonicalize([])       === '[]'       // length 0
   *
   * The last pair is a genuine hash collision between two arrays of different length, and
   * the inconsistency is stark: an explicit `undefined` element is correctly refused with
   * path `[1]`, while a hole in the same position is waved through.
   *
   * Correct behaviour: iterate by index rather than with `map`, so a hole reaches `encode`
   * as `undefined` and is refused with a `CanonicalizationError` naming its index — the
   * same treatment an explicit `undefined` element already gets.
   */
  it('refuses an array hole with the same error an explicit undefined element gets', () => {
    // eslint-disable-next-line no-sparse-arrays
    const withHole = [1, , 3];
    expect(() => canonicalize(withHole)).toThrow(CanonicalizationError);
    expect(() => canonicalize(withHole)).toThrow(/\[1\]/);
    expect(() => canonicalize([1, undefined, 3])).toThrow(/\[1\]/);
  });

  /**
   * DEFECT (minor): a circular structure overflows the stack instead of being refused.
   *
   * `encode` recurses without a visited set, so a self-referential object throws
   * `RangeError: Maximum call stack size exceeded` — no `CanonicalizationError`, no path,
   * and a stack overflow rather than a diagnosable rejection. Every other unusable input
   * in this module reports where the problem is.
   *
   * Correct behaviour: track the ancestor objects on the current path and throw a
   * `CanonicalizationError` naming the path at which the cycle closes.
   */
  it('refuses a circular structure with a CanonicalizationError naming the cycle', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic['self'] = cyclic;
    expect(() => canonicalize(cyclic)).toThrow(CanonicalizationError);
    expect(() => canonicalize(cyclic)).toThrow(/self/);

    // Repeating a value that is not an ancestor is not a cycle and must still encode.
    const shared = { n: 1 };
    expect(canonicalize({ a: shared, b: shared })).toBe('{"a":{"n":1},"b":{"n":1}}');
  });
});

describe('hashCanonical stability', () => {
  it('gives the same digest for the same value hashed twice in one process', () => {
    const value = { a: 1, b: ['x', 'y'], c: { d: null } };
    expect(hashCanonical(value)).toBe(hashCanonical(value));
  });

  it('gives the same digest for a structurally equal value rebuilt from scratch', () => {
    const build = (): unknown => ({
      snapshotId: 'snap-7',
      facts: { childCount: 412, funds: ['IDEA-611', 'IDEA-619'] },
      note: null,
    });
    expect(hashCanonical(build())).toBe(hashCanonical(build()));
  });

  /**
   * Pinned digest. Its only job is to fail loudly if the serialization format is ever
   * changed — separator, quoting, key ordering, number rendering. A format change is not
   * a refactor: it invalidates every stored evaluation hash, every snapshot hash and every
   * link in an existing audit chain, so it must be a deliberate, versioned decision rather
   * than something that slips through green tests.
   */
  it('pins the serialization format, so any change to it fails loudly', () => {
    const record = {
      fiscalYear: 2026,
      facts: { expenditures: [{ amount: '1250.00', fund: 'IDEA-611' }] },
      note: null,
    };
    expect(canonicalize(record)).toBe(
      '{"facts":{"expenditures":[{"amount":"1250.00","fund":"IDEA-611"}]},"fiscalYear":2026,"note":null}',
    );
    expect(hashCanonical(record)).toBe(
      'bae8be4a5dc94ee269b43853dcb286e475d1679ba2f51f4cdcd551ea579f5a44',
    );
  });

  it('produces a 64-character lowercase hex digest', () => {
    expect(hashCanonical({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('sha256Hex', () => {
  it('agrees with the standard SHA-256 digest for known inputs', () => {
    // If this drifts, the audit chain is no longer verifiable by an outside auditor with
    // an ordinary sha256 tool, which is the entire point of using a standard digest.
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('{}')).toBe(hashCanonical({}));
  });

  it('hashes UTF-8 bytes, so a non-ASCII character is not silently transcoded', () => {
    // Explicit because the encoding argument to `update` is what makes the digest
    // reproducible outside Node; a default-encoding change would break verification.
    const expected = sha256Hex('"é"');
    expect(canonicalize('é')).toBe('"é"');
    expect(hashCanonical('é')).toBe(expected);
    expect(hashCanonical('é')).not.toBe(sha256Hex('"e"'));
  });
});
