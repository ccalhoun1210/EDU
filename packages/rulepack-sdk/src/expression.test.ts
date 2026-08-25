import { describe, expect, it } from 'vitest';
import { ExpressionSchema, collectCalculators, collectInputs } from './expression.js';

const nested = {
  all: [
    { op: 'gte' as const, left: { input: 'current_child_count' }, right: { literal: 1 } },
    {
      any: [
        { exists: { input: 'comparison_actual_local' } },
        {
          calculator: {
            name: 'idea_moe_eligibility_v1',
            inputs: { childCount: { input: 'comparison_child_count' } },
          },
        },
      ],
    },
  ],
};

describe('ExpressionSchema', () => {
  it('accepts a nested declarative expression', () => {
    expect(ExpressionSchema.safeParse(nested).success).toBe(true);
  });

  it('rejects an unknown operator', () => {
    const result = ExpressionSchema.safeParse({
      op: 'regex',
      left: { input: 'a' },
      right: { literal: 'b' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an escape hatch into raw JavaScript', () => {
    const result = ExpressionSchema.safeParse({ js: 'return true' });
    expect(result.success).toBe(false);
  });
});

describe('collectInputs', () => {
  it('finds inputs at every depth, including inside calculator arguments', () => {
    expect([...collectInputs(nested)].sort()).toEqual([
      'comparison_actual_local',
      'comparison_child_count',
      'current_child_count',
    ]);
  });
});

describe('collectCalculators', () => {
  it('finds calculators nested inside boolean groups', () => {
    expect([...collectCalculators(nested)]).toEqual(['idea_moe_eligibility_v1']);
  });
});
