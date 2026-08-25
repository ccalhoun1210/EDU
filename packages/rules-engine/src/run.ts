/**
 * Rule and assessment-run evaluation.
 *
 * Spec: Master Technical Buildout sections 8.6, 8.7 and 11. CLAUDE.md invariants 1, 4 and 9.
 *
 * ## The engine never reads the clock
 *
 * `evaluatedAt` and `asOf` are both supplied by the caller. A pure evaluation is what makes
 * section 2.5 answerable — reproducing a conclusion from October 2027 means evaluating the
 * rules in force then, against the snapshot as it was then, and getting the same hash. An
 * engine that reached for `Date.now()` anywhere in that path could not do it.
 *
 * ## Official versus advisory
 *
 * A run reports `official: true` only when every rule it evaluated was at ACTIVE. Evaluating
 * DRAFT or SHADOW rules is legitimate and necessary — it is how a rule gets reviewed and how
 * shadow impact is measured — but the output of a rule nobody has approved must never reach a
 * district looking like a compliance determination. The flag is what lets the UI say so.
 */

import { rollUpStatus, type EvaluationStatus } from '@complianceos/domain';
import type {
  CalculationStep,
  CalculatorValue,
  CalculatorWarning,
} from '@complianceos/calculators';
import type { LoadedRulePack, RuleLifecycleStatus } from '@complianceos/rulepack-sdk';
import {
  EvaluationTrace,
  evaluateBoolean,
  type CalculatorRegistry,
  type EvaluationContext,
} from './evaluate.js';
import { explain, type ExplanationContext } from './explain.js';
import {
  resolveRulePacks,
  sortPacksByLayer,
  type ResolvedRule,
  type ResolvedRuleSet,
} from './resolve.js';
import { computeEvaluationHash, ENGINE_VERSION, type EvaluationResult } from './result.js';

export interface SubjectRef {
  readonly subjectType: string;
  readonly subjectId: string;
}

export interface RunContext {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly assessmentRunId: string;
  readonly dataSnapshotId: string;
  /** Supplied, never read from the clock. */
  readonly evaluatedAt: string;
}

export interface FactBag {
  readonly [name: string]: CalculatorValue | undefined;
}

export interface EvaluateRuleRequest {
  readonly resolved: ResolvedRule;
  readonly subject: SubjectRef;
  readonly facts: FactBag;
  readonly calculators: CalculatorRegistry;
  readonly explanations: ReadonlyMap<string, string>;
  readonly context: RunContext;
}

/**
 * Project the rule's declared inputs out of the fact bag.
 *
 * Only declared inputs are recorded, and an absent one is recorded as `null` rather than
 * omitted. The distinction is what makes the result self-describing: `null` says the engine
 * looked and found nothing, where an omitted key would leave a reader unable to tell whether
 * the input was absent or the rule never asked for it.
 */
function projectInputs(
  declared: readonly string[],
  facts: FactBag,
): Record<string, CalculatorValue | null> {
  const projected: Record<string, CalculatorValue | null> = {};
  for (const name of [...declared].sort()) {
    projected[name] = facts[name] ?? null;
  }
  return projected;
}

export function evaluateRule(request: EvaluateRuleRequest): EvaluationResult {
  const { resolved, subject, facts, calculators, explanations, context } = request;
  const rule = resolved.rule;

  const evaluationContext: EvaluationContext = { facts, calculators };
  const trace = new EvaluationTrace();

  // Projected before anything reads it, because this — not the whole fact bag — is what the
  // calculator is allowed to see. See the note on the calculator branch below.
  const computedInputs = projectInputs(rule.inputs, facts);

  let status: EvaluationStatus;
  let output: Record<string, CalculatorValue> = {};
  let steps: readonly CalculationStep[] = [];
  let warnings: readonly CalculatorWarning[] = [];

  // 1. Does this rule apply to this subject at all?
  const applicable =
    rule.applicability === undefined
      ? 'TRUE'
      : evaluateBoolean(rule.applicability, evaluationContext, trace);

  if (applicable === 'FALSE') {
    status = 'NOT_APPLICABLE';
  } else if (applicable === 'UNKNOWN') {
    // Invariant 9. Not knowing whether a requirement applies is not the same as it not
    // applying, and reporting NOT_APPLICABLE here would quietly excuse a district from a
    // requirement that may well bind it.
    status = 'INDETERMINATE';
  } else if (rule.calculator !== undefined) {
    // 2. Statutory arithmetic. The calculator owns the status; the engine does not
    // second-guess it (invariant 1 — the deterministic calculation is the decision).
    const calculator = calculators.get(rule.calculator);
    if (calculator === undefined) {
      trace.note(
        `calculator "${rule.calculator}" is not registered in engine ${ENGINE_VERSION}. ` +
          'The deployed engine is older than this rule pack.',
      );
      status = 'INDETERMINATE';
    } else {
      // The declared inputs only, never the whole bag. `runAssessment` builds one fact bag for
      // every rule in the stack, so passing it wholesale would let a calculator read — and
      // decide on — a fact its rule never declared. The finding's `computedInputs` would then
      // no longer record everything the decision rested on, which breaks the provenance chain
      // (invariant 3), and a module would be handed data outside its declared contract
      // (invariant 10). Declaring an input is how a rule asks for it.
      const result = calculator.run(computedInputs);
      status = result.status;
      output = { ...result.output } as Record<string, CalculatorValue>;
      steps = result.steps;
      warnings = result.warnings;
      for (const missing of result.missingInputs) trace.recordMissing(missing);
    }
  } else if (rule.condition !== undefined) {
    // 3. A declarative condition.
    const tri = evaluateBoolean(rule.condition, evaluationContext, trace);
    status = tri === 'TRUE' ? 'PASS' : tri === 'FALSE' ? 'FAIL' : 'INDETERMINATE';
  } else {
    // The schema refuses a rule with neither, so reaching here means a pack bypassed
    // validation. Refuse to guess.
    trace.note('rule declares neither a calculator nor a condition');
    status = 'INDETERMINATE';
  }

  const missingInputs = trace.missingInputs;

  const explanationContext: ExplanationContext = {
    status,
    inputs: computedInputs,
    output,
    steps,
    missingInputs,
  };

  const withoutHash = {
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    dataSnapshotId: context.dataSnapshotId,
    engineVersion: ENGINE_VERSION,
    ruleId: rule.ruleId,
    ruleLifecycle: rule.lifecycle,
    pack: resolved.pack,
    ...(resolved.supersedes === undefined ? {} : { supersedes: resolved.supersedes }),
    authority: rule.authority,
    computedInputs,
    status,
    severityOnFailure: rule.severityOnFailure,
    output,
    steps,
    warnings,
    missingInputs,
    notes: trace.notes,
    explanation: explain(rule.explanationTemplate, explanations, explanationContext),
  } satisfies Omit<EvaluationResult, 'evaluationHash' | 'evaluatedAt' | 'assessmentRunId'>;

  return {
    ...withoutHash,
    assessmentRunId: context.assessmentRunId,
    evaluatedAt: context.evaluatedAt,
    evaluationHash: computeEvaluationHash(withoutHash),
  };
}

export interface AssessmentRunRequest {
  readonly context: RunContext;
  readonly subject: SubjectRef;
  /** The run's as-of date, deciding which rule versions were in force (spec 2.5). */
  readonly asOf: string;
  readonly packs: readonly LoadedRulePack[];
  readonly facts: FactBag;
  readonly calculators: CalculatorRegistry;
  /**
   * Which review stages to evaluate. Required rather than defaulted: running DRAFT content is
   * a deliberate act during authoring, and a caller that has not thought about it should be
   * made to.
   */
  readonly includeLifecycles: readonly RuleLifecycleStatus[];
}

export interface AssessmentRunOutcome {
  readonly context: RunContext;
  readonly subject: SubjectRef;
  readonly resolved: ResolvedRuleSet;
  readonly results: readonly EvaluationResult[];
  /** Cross-rule roll-up. FAIL-dominant, and INDETERMINATE outranks PASS (spec 8.6). */
  readonly status: EvaluationStatus;
  /** True only when every rule evaluated was ACTIVE. See the note at the top of this file. */
  readonly official: boolean;
  /** Rules resolved but not evaluated because their lifecycle was excluded. */
  readonly skippedByLifecycle: readonly string[];
}

export function runAssessment(request: AssessmentRunRequest): AssessmentRunOutcome {
  const resolved = resolveRulePacks(request.packs, request.asOf);

  // One merged template map, merged in layer order rather than in the order the caller
  // supplied the packs. Later layers win, matching rule resolution: a state overlay that
  // supersedes a federal rule brings its own wording for it. Iterating `request.packs`
  // directly would let the federal template overwrite the state one when the array happened
  // to be built [state, federal], so a rule decided under state text could be explained in
  // federal words depending on how a call site was written.
  const explanations = new Map<string, string>();
  for (const pack of sortPacksByLayer(request.packs)) {
    for (const [name, template] of pack.explanations) explanations.set(name, template);
  }

  const permitted = new Set(request.includeLifecycles);
  const evaluated: ResolvedRule[] = [];
  const skipped: string[] = [];

  for (const candidate of resolved.rules) {
    if (permitted.has(candidate.rule.lifecycle)) evaluated.push(candidate);
    else skipped.push(candidate.rule.ruleId);
  }

  const results = evaluated.map((candidate) =>
    evaluateRule({
      resolved: candidate,
      subject: request.subject,
      facts: request.facts,
      calculators: request.calculators,
      explanations,
      context: request.context,
    }),
  );

  return {
    context: request.context,
    subject: request.subject,
    resolved,
    results,
    status: rollUpStatus(results.map((result) => result.status)),
    official: evaluated.length > 0 && evaluated.every((c) => c.rule.lifecycle === 'ACTIVE'),
    skippedByLifecycle: skipped,
  };
}
