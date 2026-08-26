/**
 * The evaluation result record.
 *
 * Spec: Master Technical Buildout section 8.7. CLAUDE.md invariants 3 and 4.
 *
 * Section 8.7 lists what a result stores; this is that list, plus the provenance handles the
 * finding-detail screen needs to answer section 24's eight questions without a second query.
 *
 * ## What the evaluation hash covers, and why the omissions matter
 *
 * The hash identifies the *computation*, not the event of running it. It covers the rule and
 * pack version, the engine version, the data snapshot, the inputs actually read, and the
 * whole result — status, output, steps, warnings and missing inputs.
 *
 * It deliberately excludes the timestamp and the run id. Including either would make every
 * re-run produce a different hash, which destroys the property the hash exists for: running
 * the same rule against the same snapshot on the same engine must be *demonstrably* the same
 * computation, so that section 2.5's "what did the platform conclude on that date" can be
 * answered by recomputation rather than by trusting a stored row.
 *
 * Tenant identity is covered transitively — a data snapshot belongs to exactly one tenant —
 * so two districts cannot collide unless their snapshots are the same snapshot.
 */

import { hashCanonical, type EvaluationStatus, type Severity } from '@complianceos/domain';
import type {
  CalculationStep,
  CalculatorValue,
  CalculatorWarning,
} from '@complianceos/calculators';
import type { PackRef } from './resolve.js';

/**
 * The engine's own version.
 *
 * Bumped whenever a change could alter a result for unchanged inputs — a fix to the
 * evaluator, a change in comparison semantics, a rounding correction. It is part of the
 * evaluation hash, so a bump makes previously computed results visibly the product of a
 * different engine rather than silently comparable to new ones.
 */
export const ENGINE_VERSION = '0.1.0';

export interface AuthorityRef {
  readonly citation: string;
  readonly sourceId: string;
  /** `| undefined` to match what Zod infers for the rule schema's optional url. */
  readonly url?: string | undefined;
}

export interface EvaluationResult {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly subjectType: string;
  readonly subjectId: string;

  readonly assessmentRunId: string;
  readonly dataSnapshotId: string;
  readonly engineVersion: string;

  readonly ruleId: string;
  /**
   * The requirement's name, copied from the rule that produced this result.
   *
   * Copied rather than looked up, so a finding rendered years later reads under the name the
   * requirement carried when it was evaluated, without needing the pack on disk. Deliberately
   * outside the evaluation hash: rewording a title does not change what was computed, and a
   * copy-edit that invalidated every prior hash would make reproducibility unusable.
   */
  readonly ruleTitle: string;
  readonly ruleLifecycle: string;
  readonly pack: PackRef;
  /** Present when a state overlay superseded a lower layer's rule of the same id. */
  readonly supersedes?: PackRef;
  readonly authority: AuthorityRef;

  /** Only the rule's declared inputs, as they were read from the snapshot. */
  readonly computedInputs: Readonly<Record<string, CalculatorValue | null>>;

  readonly status: EvaluationStatus;
  readonly severityOnFailure: Severity;
  readonly output: Readonly<Record<string, CalculatorValue>>;
  readonly steps: readonly CalculationStep[];
  readonly warnings: readonly CalculatorWarning[];
  readonly missingInputs: readonly string[];
  /** Engine-level observations — a type mismatch, an unregistered calculator. */
  readonly notes: readonly string[];

  readonly explanation: string;

  /** Supplied by the caller. The engine never reads the clock. */
  readonly evaluatedAt: string;
  readonly evaluationHash: string;
}

/** The subset of a result that the hash is computed over. See the note above. */
export function evaluationHashInput(
  result: Omit<EvaluationResult, 'evaluationHash' | 'evaluatedAt' | 'assessmentRunId'>,
): Record<string, unknown> {
  return {
    dataSnapshotId: result.dataSnapshotId,
    engineVersion: result.engineVersion,
    ruleId: result.ruleId,
    packId: result.pack.packId,
    packVersion: result.pack.version,
    subjectType: result.subjectType,
    subjectId: result.subjectId,
    computedInputs: result.computedInputs,
    status: result.status,
    output: result.output,
    steps: result.steps,
    warnings: result.warnings,
    missingInputs: result.missingInputs,
  };
}

export function computeEvaluationHash(
  result: Omit<EvaluationResult, 'evaluationHash' | 'evaluatedAt' | 'assessmentRunId'>,
): string {
  return hashCanonical(evaluationHashInput(result));
}
