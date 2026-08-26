import { describe, expect, it } from 'vitest';
import {
  InstrumentSchema,
  allIndicators,
  findSection,
  isEffectiveOn,
  unresolvedRuleReferences,
  validateInstrument,
  type Instrument,
} from './instrument.js';

const raw = {
  instrumentId: 'GA-GADOE-CFM',
  version: 'FY2025',
  jurisdiction: 'US-GA',
  issuingAgency: 'Georgia Department of Education',
  effective: { start: '2024-07-01', end: '2025-06-30' },
  monitoringCycleYears: 4,
  description: 'Cross-Functional Monitoring instrument.',
  sections: [
    {
      sectionNumber: '18',
      title: 'IDEA — Fiscal Indicators',
      indicators: [
        {
          indicatorId: '18.1',
          title: 'Maintenance of effort',
          requirement: 'The LEA complies with maintenance of effort procedures.',
          satisfiedByRules: ['IDEA-MOE-COMPLIANCE-001'],
        },
        {
          indicatorId: '18.2',
          title: 'Excess cost',
          requirement: 'The LEA conducts an annual excess cost calculation.',
          satisfiedByRules: ['IDEA-EXCESS-COST-001'],
        },
      ],
    },
  ],
};

const instrument: Instrument = InstrumentSchema.parse(raw);

describe('instrument schema', () => {
  it('parses a well-formed instrument and defaults optional fields', () => {
    expect(instrument.sections[0]?.indicators[0]?.requiresNarrative).toBe(false);
    expect(instrument.sections[0]?.indicators[0]?.authority).toBeNull();
  });

  it('rejects an indicator whose id does not match its section number', () => {
    const bad = structuredClone(raw);
    bad.sections[0]!.indicators[0]!.indicatorId = '17.1';
    expect(() => validateInstrument(bad, 'test.yaml')).toThrow(/prefixed with its section number/);
  });

  it('rejects duplicate indicator ids', () => {
    const bad = structuredClone(raw);
    bad.sections[0]!.indicators[1]!.indicatorId = '18.1';
    expect(() => validateInstrument(bad, 'test.yaml')).toThrow(/unique/);
  });

  it('rejects an effective window that ends before it starts', () => {
    const bad = structuredClone(raw);
    bad.effective.end = '2023-06-30';
    expect(() => validateInstrument(bad, 'test.yaml')).toThrow(/must not precede/);
  });

  it('names the file in the error so a failing pack is findable in CI', () => {
    const bad = structuredClone(raw);
    bad.sections[0]!.indicators[0]!.indicatorId = '17.1';
    expect(() => validateInstrument(bad, 'ga/fy2025/instrument.yaml')).toThrow(
      /^ga\/fy2025\/instrument\.yaml:/,
    );
  });
});

describe('effective windows', () => {
  it('applies only inside the window', () => {
    expect(isEffectiveOn(instrument, '2024-07-01')).toBe(true);
    expect(isEffectiveOn(instrument, '2025-06-30')).toBe(true);
    expect(isEffectiveOn(instrument, '2024-06-30')).toBe(false);
    expect(isEffectiveOn(instrument, '2025-07-01')).toBe(false);
  });

  it('treats a null end as open-ended', () => {
    const open = InstrumentSchema.parse({ ...raw, effective: { start: '2024-07-01', end: null } });
    expect(isEffectiveOn(open, '2099-01-01')).toBe(true);
  });
});

describe('navigation and integrity', () => {
  it('finds a section by the state’s own number', () => {
    expect(findSection(instrument, '18')?.title).toBe('IDEA — Fiscal Indicators');
    expect(findSection(instrument, '99')).toBeUndefined();
  });

  it('flattens indicators across sections', () => {
    expect(allIndicators(instrument).map((i) => i.indicatorId)).toEqual(['18.1', '18.2']);
  });

  it('reports rules an indicator claims that no pack provides', () => {
    expect(unresolvedRuleReferences(instrument, new Set(['IDEA-MOE-COMPLIANCE-001']))).toEqual([
      'IDEA-EXCESS-COST-001',
    ]);
  });

  it('reports nothing when every referenced rule resolves', () => {
    const available = new Set(['IDEA-MOE-COMPLIANCE-001', 'IDEA-EXCESS-COST-001']);
    expect(unresolvedRuleReferences(instrument, available)).toEqual([]);
  });
});
