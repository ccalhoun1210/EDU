import { describe, expect, it } from 'vitest';
import {
  AssertionImmutableError,
  AssertionSchema,
  assertMutable,
  claimIsSupported,
  indicatorStatus,
  isMutable,
  type Assertion,
} from './assertion.js';
import type { Workpaper } from './workpaper.js';

const base = {
  assertionId: 'as_1',
  tenantId: 't_1',
  organizationId: 'org_1',
  instrumentId: 'GA-GADOE-CFM',
  instrumentVersion: 'FY2025',
  indicatorId: '18.2',
  fiscalYear: 'FY2026',
  claimedResult: 'MET',
} as const;

const attestation = {
  name: 'A. Director',
  role: 'Director of Federal Programs',
  at: '2026-08-26T14:00:00Z',
  statement: 'I affirm the annual excess cost calculation was performed for FY2026.',
};

function draft(overrides: Record<string, unknown> = {}): Assertion {
  return AssertionSchema.parse({ ...base, status: 'DRAFT', ...overrides });
}

function attested(overrides: Record<string, unknown> = {}): Assertion {
  return AssertionSchema.parse({ ...base, status: 'ATTESTED', attestation, ...overrides });
}

function wp(status: Workpaper['status']): Workpaper {
  return { status } as Workpaper;
}

describe('assertion lifecycle', () => {
  it('requires an attestation once attested', () => {
    expect(() => AssertionSchema.parse({ ...base, status: 'ATTESTED' })).toThrow(
      /must carry an attestation/,
    );
  });

  it('refuses an attestation while still a draft', () => {
    expect(() => AssertionSchema.parse({ ...base, status: 'DRAFT', attestation })).toThrow(
      /must not carry an attestation/,
    );
  });

  it('requires a superseded assertion to name its replacement', () => {
    expect(() =>
      AssertionSchema.parse({ ...base, status: 'SUPERSEDED', attestation, supersededBy: null }),
    ).toThrow(/must name the assertion that replaced it/);
  });

  it('refuses an assertion that supersedes itself', () => {
    expect(() => attested({ supersedes: 'as_1' })).toThrow(/cannot supersede itself/);
  });

  it('records who is accountable, verbatim', () => {
    expect(attested().attestation?.statement).toMatch(/^I affirm/);
  });
});

describe('immutability (invariant 4)', () => {
  it('treats a draft as editable', () => {
    expect(isMutable(draft())).toBe(true);
    expect(() => assertMutable(draft())).not.toThrow();
  });

  it('refuses to edit an attested assertion and says what to do instead', () => {
    expect(() => assertMutable(attested())).toThrow(AssertionImmutableError);
    expect(() => assertMutable(attested())).toThrow(/Publish a superseding assertion instead/);
  });

  it('refuses to edit a superseded assertion', () => {
    expect(isMutable(attested({ status: 'SUPERSEDED', supersededBy: 'as_2' }))).toBe(false);
  });
});

describe('indicator status roll-up', () => {
  it('is NOT_APPLICABLE when no rule stands behind the indicator', () => {
    expect(indicatorStatus([])).toBe('NOT_APPLICABLE');
  });

  it('lets an unanswerable rule outrank a passing one', () => {
    expect(indicatorStatus([wp('PASS'), wp('INDETERMINATE')])).toBe('INDETERMINATE');
  });

  it('lets a failure outrank everything', () => {
    expect(indicatorStatus([wp('PASS'), wp('INDETERMINATE'), wp('FAIL')])).toBe('FAIL');
  });
});

describe('claims must be supported by the evidence', () => {
  it('accepts MET where every rule passed', () => {
    expect(claimIsSupported('MET', [wp('PASS')])).toBe(true);
  });

  it('rejects MET where a rule failed', () => {
    expect(claimIsSupported('MET', [wp('FAIL')])).toBe(false);
  });

  it('rejects MET while an input is still missing', () => {
    expect(claimIsSupported('MET', [wp('INDETERMINATE')])).toBe(false);
  });

  it('accepts MET where no rule applies, because most indicators are narrative', () => {
    expect(claimIsSupported('MET', [])).toBe(true);
  });

  it('never blocks a district from recording NOT_MET', () => {
    expect(claimIsSupported('NOT_MET', [wp('FAIL')])).toBe(true);
    expect(claimIsSupported('NOT_MET', [wp('PASS')])).toBe(true);
  });
});
