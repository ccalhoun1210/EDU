/**
 * Behavioural tests for the rule DSL evaluator.
 *
 * Spec: Master Technical Buildout sections 8.4 and 8.6. CLAUDE.md invariants 2, 5, 6 and 9.
 *
 * These defend three things the rest of the platform leans on. First, that evaluation is
 * genuinely Kleene three-valued — that an unknown propagates where it must and, just as
 * importantly, does not propagate where the answer was never in doubt. Second, that a single
 * run tells a district everything it owes: neither connective short-circuits, so the trace
 * collects every missing input in one pass. Third, that comparison is exact — money orders
 * numerically rather than lexically, dates order as dates, and a shape the evaluator cannot
 * order honestly is refused as UNKNOWN rather than coerced into an answer.
 */

import { describe, expect, it } from 'vitest';
import type {
  Calculator,
  CalculatorInputs,
  CalculatorResult,
  CalculatorValue,
} from '@complianceos/calculators';
import type { CalculatorName, Expression } from '@complianceos/rulepack-sdk';
import {
  EvaluationTrace,
  evaluateBoolean,
  evaluateExpression,
  type EvaluationContext,
} from './evaluate.js';

// --- fixtures ---------------------------------------------------------------------------

function calculatorResult(overrides: Partial<CalculatorResult> = {}): CalculatorResult {
  return { status: 'PASS', missingInputs: [], warnings: [], steps: [], output: {}, ...overrides };
}

/** A calculator that records how often it ran, so double-evaluation is observable. */
interface StubCalculator extends Calculator {
  readonly calls: CalculatorInputs[];
}

function stubCalculator(
  name: CalculatorName,
  run: (inputs: CalculatorInputs) => CalculatorResult = () => calculatorResult(),
): StubCalculator {
  const calls: CalculatorInputs[] = [];
  return {
    name,
    title: `stub ${name}`,
    authority: ['34 CFR 300.203'],
    inputs: [],
    calls,
    run(inputs: CalculatorInputs): CalculatorResult {
      calls.push(inputs);
      return run(inputs);
    },
  };
}

function context(
  facts: Readonly<Record<string, CalculatorValue | undefined>> = {},
  calculators: readonly Calculator[] = [],
): EvaluationContext {
  return {
    facts,
    calculators: new Map(calculators.map((calculator) => [calculator.name, calculator])),
  };
}

const TRUE_NODE: Expression = { op: 'eq', left: { literal: 1 }, right: { literal: 1 } };
const FALSE_NODE: Expression = { op: 'eq', left: { literal: 1 }, right: { literal: 2 } };

/** UNKNOWN because the comparison reads an input the snapshot does not carry. */
function unknownNode(inputName: string): Expression {
  return { op: 'eq', left: { input: inputName }, right: { literal: 1 } };
}

/** Most tests care only about the answer; this keeps the trace out of the way. */
function decide(
  expression: Expression,
  facts: Readonly<Record<string, CalculatorValue | undefined>> = {},
  calculators: readonly Calculator[] = [],
): string {
  return evaluateBoolean(expression, context(facts, calculators), new EvaluationTrace());
}

// --- Kleene logic -----------------------------------------------------------------------

describe('all — Kleene conjunction', () => {
  it('is TRUE only when every conjunct is TRUE', () => {
    expect(decide({ all: [TRUE_NODE, TRUE_NODE] })).toBe('TRUE');
  });

  it('is UNKNOWN when a conjunct is unanswerable and none is FALSE', () => {
    expect(decide({ all: [TRUE_NODE, unknownNode('absent')] })).toBe('UNKNOWN');
    expect(decide({ all: [unknownNode('absent'), TRUE_NODE] })).toBe('UNKNOWN');
  });

  // The asymmetry that keeps the product usable: the conjunction is already decided, so a
  // missing datum cannot rescue it. Reporting INDETERMINATE here would bury a real failure.
  it('is FALSE when a conjunct is FALSE even though a sibling is unanswerable', () => {
    expect(decide({ all: [FALSE_NODE, unknownNode('absent')] })).toBe('FALSE');
    expect(decide({ all: [unknownNode('absent'), FALSE_NODE] })).toBe('FALSE');
  });

  it('is FALSE when any conjunct is FALSE', () => {
    expect(decide({ all: [FALSE_NODE, TRUE_NODE] })).toBe('FALSE');
    expect(decide({ all: [TRUE_NODE, FALSE_NODE] })).toBe('FALSE');
  });
});

describe('any — Kleene disjunction', () => {
  it('is FALSE only when every disjunct is FALSE', () => {
    expect(decide({ any: [FALSE_NODE, FALSE_NODE] })).toBe('FALSE');
  });

  it('is UNKNOWN when a disjunct is unanswerable and none is TRUE', () => {
    expect(decide({ any: [FALSE_NODE, unknownNode('absent')] })).toBe('UNKNOWN');
    expect(decide({ any: [unknownNode('absent'), FALSE_NODE] })).toBe('UNKNOWN');
  });

  it('is TRUE when a disjunct is TRUE even though a sibling is unanswerable', () => {
    expect(decide({ any: [TRUE_NODE, unknownNode('absent')] })).toBe('TRUE');
    expect(decide({ any: [unknownNode('absent'), TRUE_NODE] })).toBe('TRUE');
  });
});

describe('not', () => {
  it('inverts a decided answer', () => {
    expect(decide({ not: TRUE_NODE })).toBe('FALSE');
    expect(decide({ not: FALSE_NODE })).toBe('TRUE');
  });

  // This is the case where two-valued logic manufactures an assurance nobody computed: a
  // rule written as `not(overspend)` against a missing expenditure figure reads FALSE as
  // "did not overspend" and reports a PASS. UNKNOWN is the only honest answer.
  it('leaves an unanswerable operand unanswerable rather than negating it into TRUE', () => {
    expect(decide({ not: unknownNode('priorYearLocalExpenditure') })).toBe('UNKNOWN');
  });

  it('leaves a doubly negated unknown unanswerable', () => {
    expect(decide({ not: { not: unknownNode('absent') } })).toBe('UNKNOWN');
  });
});

// --- no short-circuiting ----------------------------------------------------------------

describe('evaluation completeness', () => {
  it('collects the missing inputs of later conjuncts even once a conjunct has answered FALSE', () => {
    const trace = new EvaluationTrace();
    const expression: Expression = {
      all: [FALSE_NODE, unknownNode('stateAidRevenue'), unknownNode('localTaxRevenue')],
    };

    expect(evaluateBoolean(expression, context(), trace)).toBe('FALSE');
    expect(trace.missingInputs).toEqual(['localTaxRevenue', 'stateAidRevenue']);
  });

  it('collects the missing inputs of later disjuncts even once a disjunct has answered TRUE', () => {
    const trace = new EvaluationTrace();
    const expression: Expression = {
      any: [TRUE_NODE, unknownNode('stateAidRevenue'), unknownNode('localTaxRevenue')],
    };

    expect(evaluateBoolean(expression, context(), trace)).toBe('TRUE');
    expect(trace.missingInputs).toEqual(['localTaxRevenue', 'stateAidRevenue']);
  });

  it('runs a calculator exactly once per appearance in the tree', () => {
    const calculator = stubCalculator('idea_moe_compliance_v1');
    const invocation: Expression = {
      op: 'eq',
      left: { compute: { calculator: { name: 'idea_moe_compliance_v1', inputs: {} } } },
      right: { literal: 'PASS' },
    };
    const trace = new EvaluationTrace();

    expect(evaluateBoolean({ all: [invocation] }, context({}, [calculator]), trace)).toBe('TRUE');
    expect(calculator.calls).toHaveLength(1);
    expect(trace.invocations).toHaveLength(1);
  });

  it('still runs a calculator in a branch that can no longer change the answer', () => {
    const calculator = stubCalculator('idea_moe_compliance_v1');
    const invocation: Expression = {
      op: 'eq',
      left: { compute: { calculator: { name: 'idea_moe_compliance_v1', inputs: {} } } },
      right: { literal: 'PASS' },
    };
    const trace = new EvaluationTrace();

    expect(
      evaluateBoolean({ all: [FALSE_NODE, invocation] }, context({}, [calculator]), trace),
    ).toBe('FALSE');
    expect(calculator.calls).toHaveLength(1);
  });

  it('records one invocation per appearance when the same calculator appears twice', () => {
    const calculator = stubCalculator('idea_moe_compliance_v1');
    const invocation = (select: string): Expression => ({
      op: 'neq',
      left: { compute: { calculator: { name: 'idea_moe_compliance_v1', inputs: {}, select } } },
      right: { literal: 'nothing' },
    });
    const trace = new EvaluationTrace();

    expect(
      evaluateBoolean(
        { all: [invocation('status'), invocation('status')] },
        context({}, [calculator]),
        trace,
      ),
    ).toBe('TRUE');
    expect(calculator.calls).toHaveLength(2);
    expect(trace.invocations).toHaveLength(2);
  });
});

// --- exists -----------------------------------------------------------------------------

describe('exists', () => {
  // Asking whether a value is present is not the same as needing it. A district is not owed
  // a "you are missing X" for a field the rule only asked about.
  it('answers FALSE for an absent input without recording it as missing', () => {
    const trace = new EvaluationTrace();

    expect(evaluateBoolean({ exists: { input: 'waiverRequest' } }, context(), trace)).toBe('FALSE');
    expect(trace.missingInputs).toEqual([]);
  });

  it('answers FALSE for an input the district supplied as null', () => {
    expect(decide({ exists: { input: 'waiverRequest' } }, { waiverRequest: null })).toBe('FALSE');
  });

  it('answers TRUE for a present value, including zero and an empty string', () => {
    expect(decide({ exists: { input: 'localExpenditure' } }, { localExpenditure: '0' })).toBe(
      'TRUE',
    );
    expect(decide({ exists: { input: 'note' } }, { note: '' })).toBe('TRUE');
    expect(decide({ exists: { input: 'waived' } }, { waived: false })).toBe('TRUE');
  });

  it('records a bare input reference in a comparison as missing even when an exists on the same input did not', () => {
    const trace = new EvaluationTrace();
    const expression: Expression = {
      all: [{ exists: { input: 'waiverRequest' } }, unknownNode('waiverRequest')],
    };

    expect(evaluateBoolean(expression, context(), trace)).toBe('FALSE');
    expect(trace.missingInputs).toEqual(['waiverRequest']);
  });
});

// --- comparison semantics ---------------------------------------------------------------

describe('ordering comparisons', () => {
  // A lexical comparison says "9" > "10", which in a fiscal rule is a finding against a
  // district that spent nine dollars. Amounts order numerically.
  it('orders amount strings numerically rather than lexically', () => {
    expect(decide({ op: 'gt', left: { literal: '9' }, right: { literal: '10' } })).toBe('FALSE');
    expect(decide({ op: 'lt', left: { literal: '9' }, right: { literal: '10' } })).toBe('TRUE');
    expect(
      decide({ op: 'gte', left: { literal: '5250000.00' }, right: { literal: '842310' } }),
    ).toBe('TRUE');
  });

  it('orders amount strings that differ only in scale as equal', () => {
    expect(decide({ op: 'gt', left: { literal: '1250.00' }, right: { literal: '1250' } })).toBe(
      'FALSE',
    );
    expect(decide({ op: 'lte', left: { literal: '1250.00' }, right: { literal: '1250' } })).toBe(
      'TRUE',
    );
  });

  it('orders calendar dates as dates', () => {
    expect(
      decide({ op: 'lt', left: { literal: '2026-09-30' }, right: { literal: '2026-10-01' } }),
    ).toBe('TRUE');
    expect(
      decide({ op: 'gte', left: { literal: '2027-01-01' }, right: { literal: '2026-12-31' } }),
    ).toBe('TRUE');
  });

  // Invariant 5: coercing the string side to a double here would undo exact arithmetic at
  // the very last step, so the mismatch is reported rather than resolved.
  it('refuses to order a number against a decimal string, and says why', () => {
    const trace = new EvaluationTrace();
    const expression: Expression = {
      op: 'gt',
      left: { literal: 1250 },
      right: { literal: '1249.99' },
    };

    expect(evaluateBoolean(expression, context(), trace)).toBe('UNKNOWN');
    expect(trace.notes.join(' ')).toMatch(/cannot order/);
  });

  it('is UNKNOWN when either side of an ordering comparison is absent', () => {
    const trace = new EvaluationTrace();
    const expression: Expression = {
      op: 'lte',
      left: { input: 'currentYearLocal' },
      right: { literal: '100' },
    };

    expect(evaluateBoolean(expression, context(), trace)).toBe('UNKNOWN');
    expect(trace.missingInputs).toEqual(['currentYearLocal']);
  });

  it('is UNKNOWN when a side is a null the district supplied as empty', () => {
    expect(
      decide(
        { op: 'lte', left: { input: 'currentYearLocal' }, right: { literal: '100' } },
        {
          currentYearLocal: null,
        },
      ),
    ).toBe('UNKNOWN');
  });

  /**
   * DEFECT: `orderValues` claims in its comment that calendar dates are "routed through the
   * date comparison anyway so that a malformed one is caught rather than quietly ordered",
   * citing `2027-13-45`. It only routes when *both* sides are valid calendar dates; when one
   * is a date-shaped string that names no real day, both fall through to the lexical
   * fallback and are quietly ordered — `2027-13-45` sorts after `2027-01-01`, so a rule
   * comparing a deadline against a malformed date returns a confident TRUE/FALSE built on a
   * date that does not exist.
   *
   * Correct behaviour: when one operand is a valid calendar date and the other is a string
   * that is not, ordering is UNKNOWN with a note naming the malformed value — the same
   * treatment the number-against-decimal-string mismatch already gets.
   */
  it('refuses to order a valid calendar date against a malformed one', () => {
    const trace = new EvaluationTrace();
    const context: EvaluationContext = {
      facts: { deadline: '2027-01-01', received: '2027-13-45' },
      calculators: new Map(),
    };
    const result = evaluateBoolean(
      { op: 'lte', left: { input: 'received' }, right: { input: 'deadline' } },
      context,
      trace,
    );
    expect(result).toBe('UNKNOWN');
    expect(trace.notes.join(' ')).toMatch(/not a calendar date/);
  });
});

describe('equality comparisons', () => {
  it('treats two spellings of the same amount as equal', () => {
    expect(decide({ op: 'eq', left: { literal: '1250' }, right: { literal: '1250.00' } })).toBe(
      'TRUE',
    );
    expect(decide({ op: 'neq', left: { literal: '1250' }, right: { literal: '1250.00' } })).toBe(
      'FALSE',
    );
  });

  it('is UNKNOWN rather than FALSE when a side is absent', () => {
    expect(decide({ op: 'eq', left: { input: 'absent' }, right: { literal: '1250' } })).toBe(
      'UNKNOWN',
    );
    expect(decide({ op: 'neq', left: { input: 'absent' }, right: { literal: '1250' } })).toBe(
      'UNKNOWN',
    );
  });

  it('treats a supplied null as equal only to another null', () => {
    expect(
      decide(
        { op: 'eq', left: { input: 'waiver' }, right: { literal: null } },
        {
          waiver: null,
        },
      ),
    ).toBe('TRUE');
    expect(
      decide(
        { op: 'eq', left: { input: 'waiver' }, right: { literal: 'X' } },
        {
          waiver: null,
        },
      ),
    ).toBe('FALSE');
  });

  it('compares non-amount strings exactly', () => {
    expect(decide({ op: 'eq', left: { literal: 'FY2026' }, right: { literal: 'FY2026' } })).toBe(
      'TRUE',
    );
    expect(decide({ op: 'eq', left: { literal: 'FY2026' }, right: { literal: 'fy2026' } })).toBe(
      'FALSE',
    );
  });
});

describe('in', () => {
  it('is TRUE when the value appears in the list', () => {
    expect(
      decide(
        {
          op: 'in',
          left: { input: 'method' },
          right: { literalList: ['LOCAL_ONLY', 'STATE_AND_LOCAL'] },
        },
        { method: 'STATE_AND_LOCAL' },
      ),
    ).toBe('TRUE');
  });

  it('is FALSE when the value does not appear in the list', () => {
    expect(
      decide(
        {
          op: 'in',
          left: { input: 'method' },
          right: { literalList: ['LOCAL_ONLY'] },
        },
        { method: 'COMBINED' },
      ),
    ).toBe('FALSE');
  });

  it('matches list membership by amount rather than by spelling', () => {
    expect(
      decide({ op: 'in', left: { literal: '1250.00' }, right: { literalList: ['1250'] } }),
    ).toBe('TRUE');
  });

  it('is UNKNOWN when the value is absent', () => {
    const trace = new EvaluationTrace();
    const expression: Expression = {
      op: 'in',
      left: { input: 'method' },
      right: { literalList: ['LOCAL_ONLY'] },
    };

    expect(evaluateBoolean(expression, context(), trace)).toBe('UNKNOWN');
    expect(trace.missingInputs).toEqual(['method']);
  });

  it('is UNKNOWN with a note when the right operand is not a list', () => {
    const trace = new EvaluationTrace();
    const expression: Expression = {
      op: 'in',
      left: { literal: 'LOCAL_ONLY' },
      right: { literal: 'LOCAL_ONLY' },
    };

    expect(evaluateBoolean(expression, context(), trace)).toBe('UNKNOWN');
    expect(trace.notes.join(' ')).toMatch(/must be a list/);
  });
});

// --- within -----------------------------------------------------------------------------

describe('within', () => {
  const between = (value: string, min: string, max: string): Expression => ({
    within: { value: { literal: value }, min: { literal: min }, max: { literal: max } },
  });

  it('includes both ends of the window', () => {
    expect(decide(between('2026-07-01', '2026-07-01', '2027-06-30'))).toBe('TRUE');
    expect(decide(between('2027-06-30', '2026-07-01', '2027-06-30'))).toBe('TRUE');
  });

  it('excludes the day either side of the window', () => {
    expect(decide(between('2026-06-30', '2026-07-01', '2027-06-30'))).toBe('FALSE');
    expect(decide(between('2027-07-01', '2026-07-01', '2027-06-30'))).toBe('FALSE');
  });

  it('applies the same inclusive bounds to amounts, compared numerically', () => {
    expect(decide(between('9', '5', '10'))).toBe('TRUE');
    expect(decide(between('10', '5', '10'))).toBe('TRUE');
    expect(decide(between('10.01', '5', '10'))).toBe('FALSE');
  });

  it('is UNKNOWN when any bound is missing, and records the bound as owed', () => {
    const trace = new EvaluationTrace();
    const expression: Expression = {
      within: {
        value: { literal: '2026-07-01' },
        min: { input: 'windowStart' },
        max: { literal: '2027-06-30' },
      },
    };

    expect(evaluateBoolean(expression, context(), trace)).toBe('UNKNOWN');
    expect(trace.missingInputs).toEqual(['windowStart']);
  });

  it('is UNKNOWN when the value itself is missing', () => {
    expect(
      decide({
        within: {
          value: { input: 'evaluationDate' },
          min: { literal: '2026-07-01' },
          max: { literal: '2027-06-30' },
        },
      }),
    ).toBe('UNKNOWN');
  });
});

// --- date arithmetic inside a comparison ------------------------------------------------

describe('dateDiff and dateAdd inside a comparison', () => {
  const withinSixtyDays: Expression = {
    op: 'lte',
    left: {
      compute: {
        dateDiff: { from: { input: 'consentOn' }, to: { input: 'evaluatedOn' }, unit: 'days' },
      },
    },
    right: { literal: 60 },
  };

  it('answers TRUE on the last day of a 60-day statutory window', () => {
    expect(decide(withinSixtyDays, { consentOn: '2026-09-01', evaluatedOn: '2026-10-31' })).toBe(
      'TRUE',
    );
  });

  it('answers FALSE one day past a 60-day statutory window', () => {
    expect(decide(withinSixtyDays, { consentOn: '2026-09-01', evaluatedOn: '2026-11-01' })).toBe(
      'FALSE',
    );
  });

  it('is UNKNOWN and reports the gap when a date the arithmetic needs is missing', () => {
    const trace = new EvaluationTrace();

    expect(evaluateBoolean(withinSixtyDays, context({ consentOn: '2026-09-01' }), trace)).toBe(
      'UNKNOWN',
    );
    expect(trace.missingInputs).toEqual(['evaluatedOn']);
  });

  it('is UNKNOWN with a note when a value that is not a calendar date reaches dateDiff', () => {
    const trace = new EvaluationTrace();
    const facts = { consentOn: '01/09/2026', evaluatedOn: '2026-10-31' };

    expect(evaluateBoolean(withinSixtyDays, context(facts), trace)).toBe('UNKNOWN');
    expect(trace.notes.join(' ')).toMatch(/dateDiff expects two calendar dates/);
  });

  it('compares a date against a deadline computed by dateAdd', () => {
    const beforeDeadline: Expression = {
      op: 'lte',
      left: { input: 'evaluatedOn' },
      right: {
        compute: { dateAdd: { base: { input: 'consentOn' }, amount: 60, unit: 'days' } },
      },
    };

    expect(decide(beforeDeadline, { consentOn: '2026-09-01', evaluatedOn: '2026-10-31' })).toBe(
      'TRUE',
    );
    expect(decide(beforeDeadline, { consentOn: '2026-09-01', evaluatedOn: '2026-11-01' })).toBe(
      'FALSE',
    );
  });

  it('clamps a month-based deadline to the end of the target month', () => {
    const trace = new EvaluationTrace();
    const value = evaluateExpression(
      { dateAdd: { base: { literal: '2027-01-31' }, amount: 1, unit: 'months' } },
      context(),
      trace,
    );

    expect(value).toBe('2027-02-28');
  });

  it('is UNKNOWN with a note when dateAdd is given something that is not a calendar date', () => {
    const trace = new EvaluationTrace();
    const expression: Expression = {
      op: 'lte',
      left: { literal: '2026-11-01' },
      right: { compute: { dateAdd: { base: { input: 'consentOn' }, amount: 60, unit: 'days' } } },
    };

    expect(evaluateBoolean(expression, context({ consentOn: 20260901 }), trace)).toBe('UNKNOWN');
    expect(trace.notes.join(' ')).toMatch(/dateAdd expects a calendar date/);
  });

  it('reports a value expression used where a boolean was required rather than guessing', () => {
    const trace = new EvaluationTrace();
    const expression: Expression = {
      not: {
        dateDiff: {
          from: { literal: '2026-09-01' },
          to: { literal: '2026-10-31' },
          unit: 'days',
        },
      },
    };

    expect(evaluateBoolean(expression, context(), trace)).toBe('UNKNOWN');
    expect(trace.notes.join(' ')).toMatch(/value expression was used where a boolean/);
  });
});

// --- calculators ------------------------------------------------------------------------

describe('calculator invocation', () => {
  it('reads the calculator status by default and records the invocation', () => {
    const calculator = stubCalculator('idea_moe_compliance_v1', () =>
      calculatorResult({ status: 'FAIL' }),
    );
    const trace = new EvaluationTrace();
    const expression: Expression = {
      op: 'eq',
      left: { compute: { calculator: { name: 'idea_moe_compliance_v1', inputs: {} } } },
      right: { literal: 'FAIL' },
    };

    expect(evaluateBoolean(expression, context({}, [calculator]), trace)).toBe('TRUE');
    expect(trace.invocations[0]?.name).toBe('idea_moe_compliance_v1');
    expect(trace.invocations[0]?.select).toBe('status');
    expect(trace.invocations[0]?.result.status).toBe('FAIL');
  });

  it('resolves a dotted path into the calculator output', () => {
    const calculator = stubCalculator('idea_excess_cost_v1', () =>
      calculatorResult({ output: { qualifyingMethodCount: 3, perPupil: '1250.00' } }),
    );
    const countAtLeastTwo: Expression = {
      op: 'gte',
      left: {
        compute: {
          calculator: {
            name: 'idea_excess_cost_v1',
            inputs: {},
            select: 'output.qualifyingMethodCount',
          },
        },
      },
      right: { literal: 2 },
    };

    expect(decide(countAtLeastTwo, {}, [calculator])).toBe('TRUE');
  });

  it('passes resolved operands through to the calculator', () => {
    const calculator = stubCalculator('idea_moe_compliance_v1');
    const expression: Expression = {
      op: 'eq',
      left: {
        compute: {
          calculator: {
            name: 'idea_moe_compliance_v1',
            inputs: { current: { input: 'currentYearLocal' }, prior: { literal: '900000' } },
          },
        },
      },
      right: { literal: 'PASS' },
    };

    decide(expression, { currentYearLocal: '1000000' }, [calculator]);
    expect(calculator.calls[0]).toEqual({ current: '1000000', prior: '900000' });
  });

  it('is UNKNOWN when the selected path names nothing in the result', () => {
    const calculator = stubCalculator('idea_excess_cost_v1', () =>
      calculatorResult({ output: { perPupil: '1250.00' } }),
    );
    const expression: Expression = {
      op: 'gte',
      left: {
        compute: {
          calculator: { name: 'idea_excess_cost_v1', inputs: {}, select: 'output.notComputed' },
        },
      },
      right: { literal: 2 },
    };

    expect(decide(expression, {}, [calculator])).toBe('UNKNOWN');
  });

  it("propagates a calculator's own missing inputs into the trace", () => {
    const calculator = stubCalculator('idea_moe_compliance_v1', () =>
      calculatorResult({
        status: 'INDETERMINATE',
        missingInputs: ['priorYearLocalExpenditure', 'currentYearLocalExpenditure'],
      }),
    );
    const trace = new EvaluationTrace();
    const expression: Expression = {
      op: 'eq',
      left: { compute: { calculator: { name: 'idea_moe_compliance_v1', inputs: {} } } },
      right: { literal: 'PASS' },
    };

    expect(evaluateBoolean(expression, context({}, [calculator]), trace)).toBe('FALSE');
    expect(trace.missingInputs).toEqual([
      'currentYearLocalExpenditure',
      'priorYearLocalExpenditure',
    ]);
  });

  // An engine build older than the rule pack is a deployment fault. It must surface as
  // "we could not tell", never as an exception that fails the run and never as a quiet FALSE
  // that reads like a district finding.
  it('is UNKNOWN with a note when the calculator is not registered in this engine build', () => {
    const trace = new EvaluationTrace();
    const expression: Expression = {
      op: 'eq',
      left: { compute: { calculator: { name: 'idea_cceis_v1', inputs: {} } } },
      right: { literal: 'PASS' },
    };

    expect(() => evaluateBoolean(expression, context(), trace)).not.toThrow();
    expect(evaluateBoolean(expression, context(), trace)).toBe('UNKNOWN');
    expect(trace.notes.join(' ')).toMatch(/is not registered in this engine build/);
    expect(trace.invocations).toEqual([]);
  });

  it('does not let an unregistered calculator inside a negation become TRUE', () => {
    const expression: Expression = {
      not: {
        op: 'eq',
        left: { compute: { calculator: { name: 'idea_cceis_v1', inputs: {} } } },
        right: { literal: 'PASS' },
      },
    };

    expect(decide(expression)).toBe('UNKNOWN');
  });

  it('accepts a boolean read out of a calculator output as a boolean node', () => {
    const calculator = stubCalculator('idea_moe_eligibility_v1', () =>
      calculatorResult({ output: { exceptionApplies: true } }),
    );
    const expression: Expression = {
      not: {
        calculator: {
          name: 'idea_moe_eligibility_v1',
          inputs: {},
          select: 'output.exceptionApplies',
        },
      },
    };

    expect(decide(expression, {}, [calculator])).toBe('FALSE');
  });
});

// --- the trace --------------------------------------------------------------------------

describe('EvaluationTrace', () => {
  it('reports missing inputs sorted and de-duplicated, so a run hash is walk-order stable', () => {
    const trace = new EvaluationTrace();
    const expression: Expression = {
      all: [unknownNode('zeta'), unknownNode('alpha'), unknownNode('zeta'), unknownNode('mu')],
    };

    evaluateBoolean(expression, context(), trace);
    expect(trace.missingInputs).toEqual(['alpha', 'mu', 'zeta']);
  });

  it('does not repeat an identical note', () => {
    const trace = new EvaluationTrace();
    const mismatch: Expression = {
      op: 'gt',
      left: { literal: 1250 },
      right: { literal: '1249.99' },
    };

    evaluateBoolean({ all: [mismatch, mismatch] }, context(), trace);
    expect(trace.notes).toHaveLength(1);
  });

  it('hands out copies, so a caller cannot mutate what a finding will cite', () => {
    const trace = new EvaluationTrace();
    trace.recordMissing('alpha');

    const first = trace.missingInputs;
    expect(first).toEqual(['alpha']);
    trace.recordMissing('beta');
    expect(first).toEqual(['alpha']);
    expect(trace.missingInputs).toEqual(['alpha', 'beta']);
  });
});
