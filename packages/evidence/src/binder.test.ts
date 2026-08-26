import { describe, expect, it } from 'vitest';
import { BinderIncompleteError, coverageForSection, finalizeBinder } from './binder.js';
import { InstrumentSchema, type Section } from './instrument.js';
import { AssertionSchema, type Assertion } from './assertion.js';

const instrument = InstrumentSchema.parse({
  instrumentId: 'GA-GADOE-CFM',
  version: 'FY2025',
  jurisdiction: 'US-GA',
  issuingAgency: 'Georgia Department of Education',
  effective: { start: '2024-07-01', end: '2025-06-30' },
  description: 'Cross-Functional Monitoring instrument.',
  sections: [
    {
      sectionNumber: '18',
      title: 'IDEA — Fiscal Indicators',
      indicators: [
        { indicatorId: '18.1', title: 'Maintenance of effort', requirement: 'MOE procedures.' },
        { indicatorId: '18.2', title: 'Excess cost', requirement: 'Annual calculation.' },
        {
          indicatorId: '18.3',
          title: 'CCEIS',
          requirement: 'Complete the CCEIS tab if applicable.',
          conditional: true,
        },
      ],
    },
  ],
});

const section = instrument.sections[0] as Section;

const attestation = {
  name: 'A. Director',
  role: 'Director of Federal Programs',
  at: '2026-08-26T14:00:00Z',
  statement: 'Affirmed.',
};

function assertion(
  indicatorId: string,
  status: Assertion['status'],
  overrides: Record<string, unknown> = {},
): Assertion {
  return AssertionSchema.parse({
    assertionId: `as_${indicatorId}_${status}`,
    tenantId: 't_1',
    organizationId: 'org_1',
    instrumentId: 'GA-GADOE-CFM',
    instrumentVersion: 'FY2025',
    indicatorId,
    fiscalYear: 'FY2026',
    status,
    claimedResult: 'MET',
    ...(status === 'DRAFT' ? {} : { attestation }),
    ...(status === 'SUPERSEDED' ? { supersededBy: 'as_later' } : {}),
    ...overrides,
  });
}

const binderMeta = {
  binderId: 'bd_1',
  tenantId: 't_1',
  organizationId: 'org_1',
  organizationName: 'Sample County Schools',
  instrumentId: 'GA-GADOE-CFM',
  instrumentVersion: 'FY2025',
  sectionNumber: '18',
  fiscalYear: 'FY2026' as const,
  generatedAt: '2026-08-26T15:00:00Z',
  generatedBy: 'A. Director',
};

describe('coverage', () => {
  it('reports every indicator as missing when nothing has been asserted', () => {
    const coverage = coverageForSection(section, []);
    expect(coverage).toMatchObject({
      total: 3,
      attested: 0,
      draft: 0,
      missing: 3,
      complete: false,
    });
  });

  it('distinguishes draft from attested', () => {
    const coverage = coverageForSection(section, [
      assertion('18.1', 'ATTESTED'),
      assertion('18.2', 'DRAFT'),
    ]);
    expect(coverage).toMatchObject({ attested: 1, draft: 1, missing: 1, complete: false });
  });

  it('ignores superseded assertions so a correction cannot look finished', () => {
    const coverage = coverageForSection(section, [assertion('18.1', 'SUPERSEDED')]);
    expect(coverage.entries[0]?.status).toBe('MISSING');
  });

  it('prefers the attested assertion when a draft correction also exists', () => {
    const coverage = coverageForSection(section, [
      assertion('18.1', 'DRAFT'),
      assertion('18.1', 'ATTESTED'),
    ]);
    expect(coverage.entries[0]?.status).toBe('ATTESTED');
  });

  it('is complete only when every indicator is attested', () => {
    const coverage = coverageForSection(section, [
      assertion('18.1', 'ATTESTED'),
      assertion('18.2', 'ATTESTED'),
      assertion('18.3', 'ATTESTED'),
    ]);
    expect(coverage.complete).toBe(true);
  });

  it('carries the conditional flag through so N/A indicators are still visible', () => {
    expect(coverageForSection(section, []).entries[2]?.conditional).toBe(true);
  });
});

describe('finalizing a binder — whole or not at all', () => {
  const complete = ['18.1', '18.2', '18.3'].map((id) => assertion(id, 'ATTESTED'));

  it('assembles the binder in the state’s indicator order', () => {
    const binder = finalizeBinder({
      instrument,
      sectionNumber: '18',
      assertions: complete,
      binder: binderMeta,
    });
    expect(binder.assertionIds).toEqual([
      'as_18.1_ATTESTED',
      'as_18.2_ATTESTED',
      'as_18.3_ATTESTED',
    ]);
  });

  it('refuses when an indicator has never been asserted', () => {
    expect(() =>
      finalizeBinder({
        instrument,
        sectionNumber: '18',
        assertions: complete.slice(0, 2),
        binder: binderMeta,
      }),
    ).toThrow(BinderIncompleteError);
  });

  it('refuses when an indicator is still a draft, and names it', () => {
    expect(() =>
      finalizeBinder({
        instrument,
        sectionNumber: '18',
        assertions: [...complete.slice(0, 2), assertion('18.3', 'DRAFT')],
        binder: binderMeta,
      }),
    ).toThrow(/18\.3 \(draft\)/);
  });

  it('tells the reader what to do about it', () => {
    expect(() =>
      finalizeBinder({ instrument, sectionNumber: '18', assertions: [], binder: binderMeta }),
    ).toThrow(/Attest them or record them as not applicable/);
  });

  it('refuses a section the instrument does not contain', () => {
    expect(() =>
      finalizeBinder({
        instrument,
        sectionNumber: '99',
        assertions: complete,
        binder: { ...binderMeta, sectionNumber: '99' },
      }),
    ).toThrow(/has no section 99/);
  });
});
