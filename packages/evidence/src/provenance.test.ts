import { describe, expect, it } from 'vitest';
import {
  InputSnapshotSchema,
  InputValueSchema,
  canonicalizeInputs,
  extraneousInputs,
  missingInputs,
  type InputValue,
} from './provenance.js';
import { sha256Hex } from './primitives.js';

function input(name: string, unit: InputValue['unit'], value: string): InputValue {
  return InputValueSchema.parse({
    name,
    unit,
    value,
    source: {
      kind: 'UPLOADED_DOCUMENT',
      description: 'FY2025 Annual Financial Report, line 2300',
      suppliedBy: 'A. Director',
      retrievedAt: '2026-08-26T14:00:00Z',
    },
  });
}

describe('input values', () => {
  it('accepts money as a decimal string', () => {
    expect(input('priorYearLocal', 'USD', '40218773.42').value).toBe('40218773.42');
  });

  it('rejects a USD value that is not a decimal string', () => {
    expect(() => input('priorYearLocal', 'USD', '40,218,773.42')).toThrow(/decimal strings/);
  });

  it('rejects a DATE value carrying a time', () => {
    expect(() => input('boardApproval', 'DATE', '2026-06-30T00:00:00Z')).toThrow(/YYYY-MM-DD/);
  });

  it('rejects a BOOLEAN value that is not true or false', () => {
    expect(() => input('servesPrivateSchools', 'BOOLEAN', 'yes')).toThrow(
      /must be the string true or false/,
    );
  });

  it('defaults evidenceId to null so an unsourced value is visibly unsourced', () => {
    expect(input('childCount', 'COUNT', '1284').source.evidenceId).toBeNull();
  });
});

describe('snapshots', () => {
  const values = [input('b', 'COUNT', '2'), input('a', 'USD', '1.00')];

  it('hashes independently of insertion order', () => {
    const forward = sha256Hex(canonicalizeInputs(values));
    const reversed = sha256Hex(canonicalizeInputs([...values].reverse()));
    expect(forward).toBe(reversed);
  });

  it('changes hash when a value changes', () => {
    const before = sha256Hex(canonicalizeInputs(values));
    const after = sha256Hex(canonicalizeInputs([input('b', 'COUNT', '3'), values[1]!]));
    expect(after).not.toBe(before);
  });

  it('rejects a snapshot that supplies the same input twice', () => {
    const duplicated = {
      capturedAt: '2026-08-26T14:00:00Z',
      values: [input('a', 'USD', '1.00'), input('a', 'USD', '2.00')],
      hash: sha256Hex('x'),
    };
    expect(() => InputSnapshotSchema.parse(duplicated)).toThrow(/only once/);
  });
});

describe('missing inputs drive INDETERMINATE (invariant 9)', () => {
  const snapshot = InputSnapshotSchema.parse({
    capturedAt: '2026-08-26T14:00:00Z',
    values: [input('priorYearLocal', 'USD', '1.00')],
    hash: sha256Hex(canonicalizeInputs([input('priorYearLocal', 'USD', '1.00')])),
  });

  it('names every declared input the snapshot does not supply', () => {
    expect(missingInputs(['priorYearLocal', 'currentYearLocal', 'childCount'], snapshot)).toEqual([
      'currentYearLocal',
      'childCount',
    ]);
  });

  it('is empty when every declared input is supplied', () => {
    expect(missingInputs(['priorYearLocal'], snapshot)).toEqual([]);
  });

  it('surfaces values nobody asked for without treating them as an error', () => {
    expect(extraneousInputs([], snapshot)).toEqual(['priorYearLocal']);
  });
});
