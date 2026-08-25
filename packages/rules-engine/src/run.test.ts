/**
 * Behavioural tests for rule and assessment-run evaluation.
 *
 * Spec: Master Technical Buildout sections 8.6, 8.7 and 11. CLAUDE.md invariants 1, 3, 4, 9
 * and 10.
 *
 * Four properties are defended here. That an undecidable applicability guard produces
 * INDETERMINATE rather than the quiet excuse of NOT_APPLICABLE. That the status of a
 * calculator-backed rule is the calculator's and nobody else's. That the evaluation hash
 * identifies the computation — stable across re-runs, sensitive to everything that could
 * change the answer, and deliberately blind to when the run happened. And that a run reports
 * itself official only when every rule it evaluated had actually been approved.
 */

import { describe, expect, it } from 'vitest';
import type {
  Calculator,
  CalculatorInputs,
  CalculatorResult,
  CalculatorValue,
} from '@complianceos/calculators';
import type {
  CalculatorName,
  Expression,
  LoadedRulePack,
  Rule,
  RulePackManifest,
} from '@complianceos/rulepack-sdk';
import type { CalculatorRegistry } from './evaluate.js';
import type { PackRef, ResolvedRule } from './resolve.js';
import { computeEvaluationHash, ENGINE_VERSION, type EvaluationResult } from './result.js';
import {
  evaluateRule,
  runAssessment,
  type AssessmentRunRequest,
  type EvaluateRuleRequest,
  type FactBag,
  type RunContext,
  type SubjectRef,
} from './run.js';

// --- fixtures ---------------------------------------------------------------------------

const CONTEXT: RunContext = {
  tenantId: 'tenant-alpha',
  organizationId: 'lea-0042',
  assessmentRunId: 'run-2026-001',
  dataSnapshotId: 'snapshot-aaa',
  // Deliberately not "now". A test that passed only because the engine happened to agree with
  // the wall clock would prove nothing.
  evaluatedAt: '1999-12-31T23:59:59.000Z',
};

const SUBJECT: SubjectRef = { subjectType: 'LEA_FISCAL_YEAR', subjectId: 'lea-0042:FY2026' };

const FEDERAL_PACK: PackRef = { packId: 'idea-part-b-federal', version: '1.0.0', layer: 'FEDERAL' };

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    ruleId: 'IDEA-MOE-COMPLIANCE-001',
    pack: 'idea-part-b-federal',
    jurisdiction: 'US',
    program: 'IDEA-PART-B',
    subjectType: 'LEA_FISCAL_YEAR',
    lifecycle: 'ACTIVE',
    authority: { citation: '34 CFR 300.203', sourceId: 'cfr-34-300-203' },
    effective: { start: '2020-07-01', end: null },
    inputs: ['current_local'],
    outputSchema: { shortfall: 'money' },
    severityOnFailure: 'HIGH',
    explanationTemplate: 'moe-compliance',
    condition: { op: 'eq', left: { literal: 1 }, right: { literal: 1 } },
    ...overrides,
  };
}

function resolvedRule(value: Rule, pack: PackRef = FEDERAL_PACK): ResolvedRule {
  return { rule: value, pack };
}

function calculatorResult(overrides: Partial<CalculatorResult> = {}): CalculatorResult {
  return { status: 'PASS', missingInputs: [], warnings: [], steps: [], output: {}, ...overrides };
}

/** Records the inputs it was handed, so what the engine passes a calculator is observable. */
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

function registry(...calculators: readonly Calculator[]): CalculatorRegistry {
  return new Map(calculators.map((calculator) => [calculator.name, calculator]));
}

function evaluate(overrides: Partial<EvaluateRuleRequest> = {}): EvaluationResult {
  return evaluateRule({
    resolved: resolvedRule(rule()),
    subject: SUBJECT,
    facts: {},
    calculators: new Map(),
    explanations: new Map(),
    context: CONTEXT,
    ...overrides,
  });
}

/** UNKNOWN: the comparison reads a fact the snapshot does not carry. */
const UNKNOWN_GUARD: Expression = {
  op: 'eq',
  left: { input: 'receives_part_b_subgrant' },
  right: { literal: true },
};

function manifest(overrides: Partial<RulePackManifest> = {}): RulePackManifest {
  return {
    packId: 'idea-part-b-federal',
    version: '1.0.0',
    jurisdiction: 'US',
    program: 'IDEA-PART-B',
    layer: 'FEDERAL',
    extendsPack: null,
    effective: { start: '2020-07-01', end: null },
    description: 'federal baseline',
    ...overrides,
  };
}

function loadedPack(overrides: Partial<LoadedRulePack> = {}): LoadedRulePack {
  return { manifest: manifest(), rules: [], explanations: new Map(), ...overrides };
}

function runRequest(overrides: Partial<AssessmentRunRequest> = {}): AssessmentRunRequest {
  return {
    context: CONTEXT,
    subject: SUBJECT,
    asOf: '2026-07-01',
    packs: [loadedPack()],
    facts: {},
    calculators: new Map(),
    includeLifecycles: ['ACTIVE'],
    ...overrides,
  };
}

/**
 * The exact subset the hash is computed over, rebuilt from a result so a single field can be
 * varied. Written out rather than destructured so that a field added to `EvaluationResult`
 * surfaces here as a type error rather than silently dropping out of the test.
 */
type HashInput = Omit<EvaluationResult, 'evaluationHash' | 'evaluatedAt' | 'assessmentRunId'>;

function hashInput(result: EvaluationResult, overrides: Partial<HashInput> = {}): HashInput {
  return {
    tenantId: result.tenantId,
    organizationId: result.organizationId,
    subjectType: result.subjectType,
    subjectId: result.subjectId,
    dataSnapshotId: result.dataSnapshotId,
    engineVersion: result.engineVersion,
    ruleId: result.ruleId,
    ruleLifecycle: result.ruleLifecycle,
    pack: result.pack,
    ...(result.supersedes === undefined ? {} : { supersedes: result.supersedes }),
    authority: result.authority,
    computedInputs: result.computedInputs,
    status: result.status,
    severityOnFailure: result.severityOnFailure,
    output: result.output,
    steps: result.steps,
    warnings: result.warnings,
    missingInputs: result.missingInputs,
    notes: result.notes,
    explanation: result.explanation,
    ...overrides,
  };
}

// --- applicability ------------------------------------------------------------------------

describe('evaluateRule — the applicability guard', () => {
  it('reports NOT_APPLICABLE when the guard decisively says the rule does not bind', () => {
    const result = evaluate({
      resolved: resolvedRule(
        rule({ inputs: ['receives_part_b_subgrant'], applicability: UNKNOWN_GUARD }),
      ),
      facts: { receives_part_b_subgrant: false },
    });

    expect(result.status).toBe('NOT_APPLICABLE');
  });

  /**
   * Invariant 9, and the distinction the module comment is built around. Not knowing whether a
   * requirement binds is not the same as knowing it does not: NOT_APPLICABLE here would excuse
   * a district from a requirement that may well apply to it, and nobody would ever look again.
   */
  it('reports INDETERMINATE, never NOT_APPLICABLE, when the guard cannot be decided', () => {
    const result = evaluate({
      resolved: resolvedRule(
        rule({ inputs: ['receives_part_b_subgrant'], applicability: UNKNOWN_GUARD }),
      ),
      facts: {},
    });

    expect(result.status).toBe('INDETERMINATE');
    expect(result.status).not.toBe('NOT_APPLICABLE');
  });

  it('names the input that left applicability unanswerable', () => {
    const result = evaluate({
      resolved: resolvedRule(
        rule({ inputs: ['receives_part_b_subgrant'], applicability: UNKNOWN_GUARD }),
      ),
    });

    expect(result.missingInputs).toEqual(['receives_part_b_subgrant']);
  });

  it('does not run the calculator for a rule that does not bind', () => {
    const calculator = stubCalculator('idea_moe_compliance_v1');

    const result = evaluate({
      resolved: resolvedRule(
        rule({
          inputs: ['receives_part_b_subgrant'],
          applicability: UNKNOWN_GUARD,
          calculator: 'idea_moe_compliance_v1',
        }),
      ),
      facts: { receives_part_b_subgrant: false },
      calculators: registry(calculator),
    });

    expect(result.status).toBe('NOT_APPLICABLE');
    expect(calculator.calls).toHaveLength(0);
    expect(result.steps).toEqual([]);
  });
});

// --- where the status comes from -----------------------------------------------------------

describe('evaluateRule — where a status comes from', () => {
  it('takes the status from the calculator, including statuses no condition can produce', () => {
    for (const status of ['RISK', 'MANUAL_REVIEW'] as const) {
      const result = evaluate({
        resolved: resolvedRule(rule({ calculator: 'idea_moe_compliance_v1' })),
        calculators: registry(
          stubCalculator('idea_moe_compliance_v1', () => calculatorResult({ status })),
        ),
      });

      expect(result.status).toBe(status);
    }
  });

  it('carries the calculator output, steps and warnings onto the result', () => {
    const result = evaluate({
      resolved: resolvedRule(rule({ calculator: 'idea_excess_cost_v1' })),
      calculators: registry(
        stubCalculator('idea_excess_cost_v1', () =>
          calculatorResult({
            status: 'FAIL',
            output: { shortfall: '12000.00' },
            steps: [{ key: 'shortfall', label: 'Shortfall', value: '12000.00', unit: 'USD' }],
            warnings: [{ code: 'CHECK', message: 'verify the ledger', severity: 'WARNING' }],
            missingInputs: ['prior_year_local'],
          }),
        ),
      ),
    });

    expect(result.status).toBe('FAIL');
    expect(result.output).toEqual({ shortfall: '12000.00' });
    expect(result.steps[0]?.key).toBe('shortfall');
    expect(result.warnings[0]?.code).toBe('CHECK');
    expect(result.missingInputs).toEqual(['prior_year_local']);
  });

  it('maps a condition onto PASS, FAIL and INDETERMINATE and nothing else', () => {
    const satisfied = evaluate({
      resolved: resolvedRule(
        rule({ condition: { op: 'eq', left: { literal: 1 }, right: { literal: 1 } } }),
      ),
    });
    const violated = evaluate({
      resolved: resolvedRule(
        rule({ condition: { op: 'eq', left: { literal: 1 }, right: { literal: 2 } } }),
      ),
    });
    const unanswerable = evaluate({
      resolved: resolvedRule(rule({ inputs: ['current_local'], condition: UNKNOWN_GUARD })),
    });

    expect(satisfied.status).toBe('PASS');
    expect(violated.status).toBe('FAIL');
    expect(unanswerable.status).toBe('INDETERMINATE');
  });

  it('reports INDETERMINATE with a note when the engine has no such calculator', () => {
    const result = evaluate({
      resolved: resolvedRule(rule({ calculator: 'idea_cceis_v1' })),
      calculators: new Map(),
    });

    expect(result.status).toBe('INDETERMINATE');
    expect(result.notes.join(' ')).toContain('idea_cceis_v1');
    expect(result.notes.join(' ')).toContain(ENGINE_VERSION);
  });

  it('refuses to guess when a pack bypassed validation and declared neither calculator nor condition', () => {
    const bare = rule();
    delete bare.condition;

    const result = evaluate({ resolved: resolvedRule(bare) });

    expect(result.status).toBe('INDETERMINATE');
    expect(result.notes.join(' ')).toContain('neither a calculator nor a condition');
  });
});

// --- computed inputs -----------------------------------------------------------------------

describe('evaluateRule — computedInputs', () => {
  it('records every declared input in sorted order, absent ones as null rather than omitted', () => {
    const result = evaluate({
      resolved: resolvedRule(rule({ inputs: ['prior_local', 'current_local', 'child_count'] })),
      facts: { current_local: '5250000.00' },
    });

    expect(Object.keys(result.computedInputs)).toEqual([
      'child_count',
      'current_local',
      'prior_local',
    ]);
    // `null` says the engine looked and found nothing. An omitted key would leave a reader
    // unable to tell absence from a rule that never asked.
    expect(result.computedInputs).toEqual({
      child_count: null,
      current_local: '5250000.00',
      prior_local: null,
    });
    expect('prior_local' in result.computedInputs).toBe(true);
  });

  it('records no fact the rule did not declare, however many the bag holds', () => {
    const result = evaluate({
      resolved: resolvedRule(rule({ inputs: ['current_local'] })),
      facts: {
        current_local: '5250000.00',
        student_last_name: 'Rivera',
        student_iep_date: '2026-01-15',
      },
    });

    // Invariant 10. The result is a durable record; an undeclared fact reaching it is student
    // data retained by a module that never declared a need for it.
    expect(Object.keys(result.computedInputs)).toEqual(['current_local']);
  });

  it('keeps a false or zero input as itself rather than collapsing it to null', () => {
    const result = evaluate({
      resolved: resolvedRule(rule({ inputs: ['exception_claimed', 'child_count'] })),
      facts: { exception_claimed: false, child_count: 0 },
    });

    expect(result.computedInputs).toEqual({ exception_claimed: false, child_count: 0 });
  });

  it('hands the calculator only the inputs the rule declared', () => {
    // `runAssessment` builds one fact bag for every rule in the stack. Passing it wholesale
    // would let a calculator decide on a fact its rule never declared: `computedInputs` would
    // then no longer record everything the decision rested on (invariant 3), and a module
    // would be handed data outside its declared contract (invariant 10).
    const calculator = stubCalculator('idea_moe_compliance_v1');

    evaluate({
      resolved: resolvedRule(
        rule({ inputs: ['current_local'], calculator: 'idea_moe_compliance_v1' }),
      ),
      facts: {
        current_local: '5250000.00',
        student_last_name: 'Rivera',
        student_iep_date: '2026-01-15',
      },
      calculators: registry(calculator),
    });

    expect(calculator.calls).toHaveLength(1);
    expect(Object.keys(calculator.calls[0] ?? {})).toEqual(['current_local']);
  });

  it('projects the declared inputs the same way whatever order the fact bag was built in', () => {
    const one = evaluate({
      resolved: resolvedRule(rule({ inputs: ['a', 'b'] })),
      facts: { b: '2.00', a: '1.00' },
    });
    const two = evaluate({
      resolved: resolvedRule(rule({ inputs: ['a', 'b'] })),
      facts: { a: '1.00', b: '2.00' },
    });

    expect(Object.keys(one.computedInputs)).toEqual(Object.keys(two.computedInputs));
  });
});

// --- the clock ------------------------------------------------------------------------------

describe('evaluateRule — the engine never reads the clock', () => {
  it('stamps the caller-supplied evaluatedAt verbatim', () => {
    const result = evaluate();

    expect(result.evaluatedAt).toBe(CONTEXT.evaluatedAt);
  });

  it('carries the caller-supplied run and snapshot identity onto the result', () => {
    const result = evaluate();

    expect(result.assessmentRunId).toBe('run-2026-001');
    expect(result.dataSnapshotId).toBe('snapshot-aaa');
    expect(result.tenantId).toBe('tenant-alpha');
    expect(result.organizationId).toBe('lea-0042');
    expect(result.engineVersion).toBe(ENGINE_VERSION);
  });
});

// --- provenance -------------------------------------------------------------------------------

describe('evaluateRule — provenance', () => {
  it('carries the rule authority, lifecycle and pack version onto every result', () => {
    const result = evaluate({
      resolved: resolvedRule(rule({ lifecycle: 'SHADOW' })),
    });

    // Invariant 3: finding → rule → rule version → regulatory authority, without a second query.
    expect(result.ruleId).toBe('IDEA-MOE-COMPLIANCE-001');
    expect(result.ruleLifecycle).toBe('SHADOW');
    expect(result.pack).toEqual(FEDERAL_PACK);
    expect(result.authority).toEqual({
      citation: '34 CFR 300.203',
      sourceId: 'cfr-34-300-203',
    });
  });

  it('records the superseded pack when a higher layer replaced the rule', () => {
    const state: PackRef = { packId: 'idea-part-b-al', version: '2.0.0', layer: 'STATE' };
    const result = evaluate({
      resolved: { rule: rule(), pack: state, supersedes: FEDERAL_PACK },
    });

    expect(result.supersedes).toEqual(FEDERAL_PACK);
  });

  it('omits supersedes entirely when nothing was superseded', () => {
    expect('supersedes' in evaluate()).toBe(false);
  });
});

// --- the evaluation hash ------------------------------------------------------------------------

describe('the evaluation hash — the reproducibility guarantee', () => {
  const calculated = (facts: FactBag, snapshot = 'snapshot-aaa'): EvaluationResult =>
    evaluate({
      resolved: resolvedRule(rule({ inputs: ['current_local', 'prior_local'] })),
      facts,
      context: { ...CONTEXT, dataSnapshotId: snapshot },
    });

  it('is identical for the same rule evaluated twice against the same facts', () => {
    const first = calculated({ current_local: '5250000.00', prior_local: '5000000.00' });
    const second = calculated({ current_local: '5250000.00', prior_local: '5000000.00' });

    expect(second.evaluationHash).toBe(first.evaluationHash);
  });

  it('is identical when the fact bag is rebuilt with its keys in a different order', () => {
    const first = calculated({ current_local: '5250000.00', prior_local: '5000000.00' });
    const second = calculated({ prior_local: '5000000.00', current_local: '5250000.00' });

    expect(second.evaluationHash).toBe(first.evaluationHash);
  });

  it('is identical when calculator output is rebuilt with its keys in a different order', () => {
    const withOutput = (output: Record<string, CalculatorValue>): EvaluationResult =>
      evaluate({
        resolved: resolvedRule(rule({ calculator: 'idea_moe_compliance_v1' })),
        calculators: registry(
          stubCalculator('idea_moe_compliance_v1', () => calculatorResult({ output })),
        ),
      });

    expect(withOutput({ shortfall: '1.00', met: false }).evaluationHash).toBe(
      withOutput({ met: false, shortfall: '1.00' }).evaluationHash,
    );
  });

  it('is reproducible from the stored result alone', () => {
    // The audit procedure: take the stored row, recompute, compare. If the stored hash could
    // not be rebuilt from the stored fields, nothing downstream could verify anything.
    const result = calculated({ current_local: '5250000.00', prior_local: '5000000.00' });

    expect(computeEvaluationHash(hashInput(result))).toBe(result.evaluationHash);
  });

  it('changes when an input value changes', () => {
    const first = calculated({ current_local: '5250000.00', prior_local: '5000000.00' });
    const second = calculated({ current_local: '5250000.01', prior_local: '5000000.00' });

    expect(second.evaluationHash).not.toBe(first.evaluationHash);
  });

  it('changes when an input goes from absent to present', () => {
    const first = calculated({ current_local: '5250000.00' });
    const second = calculated({ current_local: '5250000.00', prior_local: '5000000.00' });

    expect(second.evaluationHash).not.toBe(first.evaluationHash);
  });

  it('changes when the pack version changes', () => {
    const base = calculated({ current_local: '5250000.00' });
    const republished = computeEvaluationHash(
      hashInput(base, { pack: { ...FEDERAL_PACK, version: '1.1.0' } }),
    );

    expect(republished).not.toBe(base.evaluationHash);
  });

  it('changes when the engine version changes', () => {
    const base = calculated({ current_local: '5250000.00' });
    const nextEngine = computeEvaluationHash(hashInput(base, { engineVersion: '0.2.0' }));

    expect(nextEngine).not.toBe(base.evaluationHash);
  });

  it('changes when the data snapshot changes', () => {
    const first = calculated({ current_local: '5250000.00' }, 'snapshot-aaa');
    const second = calculated({ current_local: '5250000.00' }, 'snapshot-bbb');

    expect(second.evaluationHash).not.toBe(first.evaluationHash);
  });

  it('changes when the resulting status changes', () => {
    const outcome = (status: 'PASS' | 'FAIL'): string =>
      evaluate({
        resolved: resolvedRule(rule({ calculator: 'idea_moe_compliance_v1' })),
        calculators: registry(
          stubCalculator('idea_moe_compliance_v1', () => calculatorResult({ status })),
        ),
      }).evaluationHash;

    expect(outcome('FAIL')).not.toBe(outcome('PASS'));
  });

  it('changes when the subject changes', () => {
    const first = evaluate();
    const second = evaluate({
      subject: { subjectType: 'LEA_FISCAL_YEAR', subjectId: 'lea-9:FY26' },
    });

    expect(second.evaluationHash).not.toBe(first.evaluationHash);
  });

  /**
   * The property that makes "re-run it and compare" a valid audit procedure. The hash
   * identifies the computation, not the event of running it — if the clock or the run id
   * entered it, every re-run would differ from the stored row and a mismatch would mean
   * nothing at all.
   */
  it('does not change when evaluatedAt or the assessment run id change', () => {
    const first = evaluate();
    const second = evaluate({
      context: {
        ...CONTEXT,
        assessmentRunId: 'run-2027-999',
        evaluatedAt: '2027-10-15T09:30:00.000Z',
      },
    });

    expect(second.evaluationHash).toBe(first.evaluationHash);
    expect(second.evaluatedAt).not.toBe(first.evaluatedAt);
  });
});

// --- runAssessment -------------------------------------------------------------------------------

describe('runAssessment — official versus advisory', () => {
  it('is official when every rule it evaluated was ACTIVE', () => {
    const outcome = runAssessment(
      runRequest({ packs: [loadedPack({ rules: [rule({ lifecycle: 'ACTIVE' })] })] }),
    );

    expect(outcome.official).toBe(true);
  });

  it('is not official when a single evaluated rule was not yet approved', () => {
    const outcome = runAssessment(
      runRequest({
        packs: [
          loadedPack({
            rules: [
              rule({ ruleId: 'R-ACTIVE', lifecycle: 'ACTIVE' }),
              rule({ ruleId: 'R-DRAFT', lifecycle: 'DRAFT' }),
            ],
          }),
        ],
        includeLifecycles: ['ACTIVE', 'DRAFT'],
      }),
    );

    expect(outcome.results).toHaveLength(2);
    expect(outcome.official).toBe(false);
  });

  it('is not official when it evaluated no rules at all', () => {
    // An empty run is vacuously "all ACTIVE". Reporting it official would let a stack that
    // resolved to nothing present itself as a clean compliance determination.
    const outcome = runAssessment(runRequest({ packs: [loadedPack({ rules: [] })] }));

    expect(outcome.results).toEqual([]);
    expect(outcome.official).toBe(false);
  });

  it('is not official when every rule was filtered out by lifecycle', () => {
    const outcome = runAssessment(
      runRequest({
        packs: [loadedPack({ rules: [rule({ lifecycle: 'DRAFT' })] })],
        includeLifecycles: ['ACTIVE'],
      }),
    );

    expect(outcome.official).toBe(false);
  });
});

describe('runAssessment — lifecycle filtering', () => {
  it('evaluates only the permitted lifecycles and names what it skipped', () => {
    const outcome = runAssessment(
      runRequest({
        packs: [
          loadedPack({
            rules: [
              rule({ ruleId: 'R-ACTIVE', lifecycle: 'ACTIVE' }),
              rule({ ruleId: 'R-SHADOW', lifecycle: 'SHADOW' }),
              rule({ ruleId: 'R-DRAFT', lifecycle: 'DRAFT' }),
            ],
          }),
        ],
        includeLifecycles: ['ACTIVE'],
      }),
    );

    expect(outcome.results.map((result) => result.ruleId)).toEqual(['R-ACTIVE']);
    expect([...outcome.skippedByLifecycle].sort()).toEqual(['R-DRAFT', 'R-SHADOW']);
  });

  it('skips every rule when no lifecycle is permitted', () => {
    const outcome = runAssessment(
      runRequest({
        packs: [loadedPack({ rules: [rule({ ruleId: 'R-ACTIVE' })] })],
        includeLifecycles: [],
      }),
    );

    expect(outcome.results).toEqual([]);
    expect(outcome.skippedByLifecycle).toEqual(['R-ACTIVE']);
  });
});

describe('runAssessment — the cross-rule roll-up', () => {
  const conditionRule = (ruleId: string, condition: Expression): Rule =>
    rule({ ruleId, condition, inputs: ['current_local'] });

  const TRUE_CONDITION: Expression = { op: 'eq', left: { literal: 1 }, right: { literal: 1 } };
  const FALSE_CONDITION: Expression = { op: 'eq', left: { literal: 1 }, right: { literal: 2 } };

  it('never reports PASS when one of its rules could not be evaluated', () => {
    const outcome = runAssessment(
      runRequest({
        packs: [
          loadedPack({
            rules: [conditionRule('R-1', TRUE_CONDITION), conditionRule('R-2', UNKNOWN_GUARD)],
          }),
        ],
      }),
    );

    expect(outcome.results.map((result) => result.status).sort()).toEqual([
      'INDETERMINATE',
      'PASS',
    ]);
    expect(outcome.status).toBe('INDETERMINATE');
  });

  it('lets a single failure dominate the run', () => {
    const outcome = runAssessment(
      runRequest({
        packs: [
          loadedPack({
            rules: [
              conditionRule('R-1', TRUE_CONDITION),
              conditionRule('R-2', UNKNOWN_GUARD),
              conditionRule('R-3', FALSE_CONDITION),
            ],
          }),
        ],
      }),
    );

    expect(outcome.status).toBe('FAIL');
  });

  it('reports NOT_APPLICABLE for a run that evaluated nothing', () => {
    expect(runAssessment(runRequest()).status).toBe('NOT_APPLICABLE');
  });
});

describe('runAssessment — explanation templates across layers', () => {
  const federal = loadedPack({
    rules: [rule({ explanationTemplate: 'moe-compliance' })],
    explanations: new Map([['moe-compliance', 'Federal wording.']]),
  });
  const state = loadedPack({
    manifest: manifest({
      packId: 'idea-part-b-al',
      version: '1.0.0',
      layer: 'STATE',
      extendsPack: 'idea-part-b-federal',
      jurisdiction: 'US-AL',
    }),
    explanations: new Map([['moe-compliance', 'Alabama wording.']]),
  });

  it("lets a later layer's template of the same name override an earlier layer's", () => {
    const outcome = runAssessment(runRequest({ packs: [federal, state] }));

    expect(outcome.results[0]?.explanation).toBe('Alabama wording.');
  });

  it('uses the only available template when no overlay redefines it', () => {
    const outcome = runAssessment(runRequest({ packs: [federal] }));

    expect(outcome.results[0]?.explanation).toBe('Federal wording.');
  });

  it('resolves templates in layer order however the caller ordered the packs', () => {
    // Rule resolution sorts by layer, so template merging must too. Otherwise a rule decided
    // under state text is explained in federal words whenever a call site happened to build
    // the array the other way round.
    const supplied = runAssessment(runRequest({ packs: [state, federal] }));

    expect(supplied.results[0]?.explanation).toBe('Alabama wording.');
  });
});
