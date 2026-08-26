/**
 * Turning a finalized determination into a fact the next year's run can read.
 *
 * Spec: Master Technical Buildout sections 10.6, 11 and 12.1. CLAUDE.md invariants 3 and 4.
 *
 * ## The problem this exists to solve
 *
 * A maintenance-of-effort determination is not self-contained. Whether an LEA met the standard
 * this year depends on what it was required to spend, and that in turn depends on whether it
 * met the standard last year — 34 CFR 300.203(c) exists precisely so a failing year cannot
 * lower the following year's bar. So each run has to read determinations the platform made in
 * earlier runs.
 *
 * Carrying a value forward by hand is where that becomes dangerous. The prior status is a
 * string; the run it came from is another string; nothing connects them. Somebody — a bug, a
 * migration, an operator — could write `MET` beside any run id at all and the provenance chain
 * would look complete all the way back to a finalized run that concluded the opposite.
 *
 * ## What binds them
 *
 * `carryForward` reads the value straight out of the prior `EvaluationResult` and stamps that
 * result's own identifiers onto the fact, including its evaluation hash. There is no parameter
 * for the value: it cannot disagree with the determination it claims to come from, because it
 * is taken from it.
 *
 * `verifyCarriedForward` closes the loop from the other side. Given the prior results, it
 * checks that the named run and rule are among them, that the hash matches, and that the value
 * still reads out of the same path. A fact that fails is not a data-quality warning — it is a
 * claim about a determination that was never made.
 *
 * The hash itself is what makes this more than bookkeeping. It covers the rule, the pack
 * version, the engine, the snapshot, the inputs read and the whole result, and excludes the
 * timestamp and run id. So it survives re-running the prior year unchanged and breaks the
 * moment anything about that conclusion is different.
 */

import {
  hashCanonical,
  type CanonicalValue,
  type DataClassification,
  type FactOrigin,
} from '@complianceos/domain';
import type { CanonicalFact, DeterminationProvenance, ValueType } from '@complianceos/ingest';
import { isDeterminationProvenance } from '@complianceos/ingest';
import type { EvaluationResult } from '@complianceos/rules-engine';

/** Origins entitled to carry a determination forward. Neither is the district. */
const DETERMINING_ORIGINS: ReadonlySet<FactOrigin> = new Set<FactOrigin>([
  'PLATFORM_DETERMINATION',
  'SEA_DETERMINATION',
]);

export class CarryForwardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CarryForwardError';
  }
}

export interface CarryForwardRequest {
  /** The finalized result being carried forward. */
  readonly result: EvaluationResult;
  /** The canonical field the next run will read. */
  readonly field: string;
  /**
   * Which part of the result the value is, as a dotted path: `status`, `output.methodStatus`.
   *
   * Three readable roots and no others. `status` and `output.*` are what the rule concluded.
   * `assessmentRunId` is the run's own identity, which is not an intermediate and is exactly
   * what a field like `moe_status_source_run_id` is defined to hold. Everything else is
   * refused: a rule's inputs and steps are how it reached its conclusion, not the conclusion,
   * and carrying one forward would let a later run treat a working figure as a determination.
   */
  readonly derivedFrom: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly classification: DataClassification;
  /**
   * The kind of value being carried forward.
   *
   * Stated by the caller rather than inferred from the prior result, whose outputs are typed
   * for the calculator that produced them and not for storage. A status is `text`; a dollar
   * figure carried forward is `money` and has to stay money all the way into NUMERIC.
   */
  readonly valueType: ValueType;
  /** Defaults to the platform's own determination, which is what a prior run is. */
  readonly origin?: FactOrigin;
}

/**
 * Walk a dotted path, own enumerable properties only.
 *
 * The own-property check matters for the same reason it does in the explanation renderer:
 * plain indexing walks the prototype chain, and `output.constructor` would resolve to an
 * engine internal and be sealed into a snapshot as a regulatory fact.
 */
function readPath(source: unknown, path: readonly string[]): unknown {
  let current = source;
  for (const segment of path) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function valueAt(result: EvaluationResult, derivedFrom: string): CanonicalValue | undefined {
  const [head, ...rest] = derivedFrom.split('.');
  if (rest.length === 0) {
    if (head === 'status') return result.status;
    if (head === 'assessmentRunId') return result.assessmentRunId;
    return undefined;
  }
  if (head !== 'output') return undefined;
  const value = readPath(result.output, rest);
  return value === undefined ? undefined : (value as CanonicalValue);
}

export function carryForward(request: CarryForwardRequest): CanonicalFact {
  const { result, field, derivedFrom } = request;
  const origin = request.origin ?? 'PLATFORM_DETERMINATION';

  if (!DETERMINING_ORIGINS.has(origin)) {
    throw new CarryForwardError(
      `"${field}" cannot be carried forward as ${origin}. A determination is the platform's ` +
        "or the State's; recording one under a district origin would let an upload replace it.",
    );
  }

  const value = valueAt(result, derivedFrom);
  if (value === undefined) {
    throw new CarryForwardError(
      `"${derivedFrom}" reads nothing on ${result.ruleId} in run ${result.assessmentRunId}. ` +
        'Only "status", "assessmentRunId" and paths under "output" may be carried forward, ' +
        'and the path must exist — a fact derived from nothing would be sealed with a ' +
        'provenance chain pointing at nothing.',
    );
  }

  const provenance: DeterminationProvenance = {
    kind: 'DETERMINATION',
    assessmentRunId: result.assessmentRunId,
    ruleId: result.ruleId,
    rulePackId: result.pack.packId,
    rulePackVersion: result.pack.version,
    dataSnapshotId: result.dataSnapshotId,
    engineVersion: result.engineVersion,
    evaluationHash: result.evaluationHash,
    derivedFrom,
    determinedAt: result.evaluatedAt,
  };

  return {
    subjectType: request.subjectType,
    subjectId: request.subjectId,
    field,
    value,
    valueType: request.valueType,
    classification: request.classification,
    origin,
    provenance,
  };
}

export type CarryForwardVerdict =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Check a carried-forward fact against the determinations it claims to come from.
 *
 * Returns a verdict rather than throwing, because a caller holding a set of facts wants to
 * report every broken chain at once — the same reasoning as `InputReader` accumulating missing
 * inputs instead of failing on the first.
 */
export function verifyCarriedForward(
  fact: CanonicalFact,
  priorResults: readonly EvaluationResult[],
): CarryForwardVerdict {
  const { provenance } = fact;
  if (!isDeterminationProvenance(provenance)) {
    return { ok: false, reason: `"${fact.field}" is not a carried-forward determination.` };
  }

  const source = priorResults.find(
    (candidate) =>
      candidate.assessmentRunId === provenance.assessmentRunId &&
      candidate.ruleId === provenance.ruleId,
  );
  if (source === undefined) {
    return {
      ok: false,
      reason:
        `"${fact.field}" names ${provenance.ruleId} in run ${provenance.assessmentRunId}, ` +
        'which is not among the finalized results supplied.',
    };
  }

  if (source.evaluationHash !== provenance.evaluationHash) {
    return {
      ok: false,
      reason:
        `"${fact.field}" carries evaluation hash ${provenance.evaluationHash}, but ` +
        `${provenance.ruleId} in run ${provenance.assessmentRunId} computed ` +
        `${source.evaluationHash}. The determination it cites is not the one that was made.`,
    };
  }

  const expected = valueAt(source, provenance.derivedFrom);
  // Compared through the canonical hash rather than by serialising both sides. `JSON.stringify`
  // preserves insertion order, so two objects that are the same fact would compare unequal if
  // the keys happened to be built in a different order — a verifier that fails on a value it
  // should accept teaches operators to ignore it.
  if (hashCanonical({ value: expected ?? null }) !== hashCanonical({ value: fact.value })) {
    return {
      ok: false,
      reason:
        `"${fact.field}" says ${JSON.stringify(fact.value)}, but ${provenance.derivedFrom} on ` +
        `${provenance.ruleId} reads ${JSON.stringify(expected)}.`,
    };
  }

  return { ok: true };
}
