import { describe, expect, it } from 'vitest';
import { WorkpaperSchema, hashWorkpaper, isIntact, type Workpaper } from './workpaper.js';
import { InputSnapshotSchema, InputValueSchema, canonicalizeInputs } from './provenance.js';
import { sha256Hex } from './primitives.js';

const values = [
  InputValueSchema.parse({
    name: 'priorYearLocal',
    unit: 'USD',
    value: '40218773.42',
    source: {
      kind: 'UPLOADED_DOCUMENT',
      description: 'FY2025 AFR line 2300',
      suppliedBy: 'A. Director',
      retrievedAt: '2026-08-26T14:00:00Z',
    },
  }),
];

const inputs = InputSnapshotSchema.parse({
  capturedAt: '2026-08-26T14:00:00Z',
  values,
  hash: sha256Hex(canonicalizeInputs(values)),
});

const core = {
  asOf: '2026-07-01',
  rule: {
    packId: 'US-FED-IDEA-B-2026',
    packVersion: '0.1.0',
    ruleId: 'IDEA-MOE-COMPLIANCE-001',
    authority: { citation: '34 CFR 300.203(b)', sourceId: 'ecfr-34-300-203' },
    calculator: 'idea_moe_compliance_v1',
  },
  inputs,
  method: 'LOCAL_FUNDS_ONLY',
  result: { shortfall: '0.00' },
  status: 'PASS',
} as const;

function workpaper(overrides: Partial<Workpaper> = {}): Workpaper {
  return WorkpaperSchema.parse({
    workpaperId: 'wp_1',
    tenantId: 't_1',
    organizationId: 'org_1',
    runId: 'run_1',
    ...core,
    severity: null,
    explanation: 'Local funds met the prior year level under the local-funds-only method.',
    computedAt: '2026-08-26T14:05:00Z',
    contentHash: hashWorkpaper(core),
    ...overrides,
  });
}

describe('workpaper provenance', () => {
  it('records which statutory method was applied', () => {
    expect(workpaper().method).toBe('LOCAL_FUNDS_ONLY');
  });

  it('freezes the citation at run time rather than referencing it', () => {
    expect(workpaper().rule.authority.citation).toBe('34 CFR 300.203(b)');
  });

  it('allows a null method for rules the regulation gives only one way to compute', () => {
    const single = { ...core, method: null };
    expect(workpaper({ method: null, contentHash: hashWorkpaper(single) }).method).toBeNull();
  });
});

describe('tamper evidence', () => {
  it('verifies an untouched workpaper', () => {
    expect(isIntact(workpaper())).toBe(true);
  });

  it('detects a changed result', () => {
    expect(isIntact(workpaper({ result: { shortfall: '125000.00' } }))).toBe(false);
  });

  it('detects a changed conclusion', () => {
    expect(isIntact(workpaper({ status: 'FAIL' }))).toBe(false);
  });

  it('detects a changed input', () => {
    const tampered = InputSnapshotSchema.parse({
      capturedAt: '2026-08-26T14:00:00Z',
      values: [{ ...values[0]!, value: '1.00' }],
      hash: inputs.hash,
    });
    expect(isIntact(workpaper({ inputs: tampered }))).toBe(false);
  });

  it('ignores fields a reviewer would not care had changed', () => {
    expect(isIntact(workpaper({ workpaperId: 'wp_2', runId: 'run_2' }))).toBe(true);
  });
});
