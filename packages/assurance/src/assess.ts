/**
 * A district export, in; an IDEA Fiscal assessment, out.
 *
 * Spec: the milestone the master technical buildout names first — *a deterministic, tested,
 * source-cited compliance engine capable of ingesting a district export and reproducing an
 * IDEA Fiscal assessment from an immutable snapshot.*
 *
 * Every piece of that existed before this file and nothing joined them up. `packages/ingest`
 * ended at a sealed snapshot, `packages/rules-engine` began at a flat fact bag, and no package
 * depended on both — so the sentence above was unproven end to end. This is the join.
 *
 * ## Two origins, one snapshot
 *
 * A maintenance-of-effort determination needs 26 inputs. Eighteen are the district's own books
 * and arrive in the export. The other eight are **not district data at all**: the prior year's
 * compliance status, the methods it was met under, the level carried forward under
 * 34 CFR 300.203(c), and the SEA's prohibition on the 300.205 adjustment. Those are the
 * platform's own determinations and the State's, and `packages/domain/src/fact-origin.ts`
 * refuses them from an upload — a district that could state its own prior-year status could
 * declare a failing year compliant and lower the bar it is measured against.
 *
 * So a real assessment merges two sets of facts, with different origins, into one sealed
 * snapshot. That is not an artefact of the fixture; it is what the data model requires, and it
 * is why this operation takes prior determinations as a separate argument rather than letting
 * them arrive in the file.
 */

import { hashCanonical, type CanonicalValue } from '@complianceos/domain';
import {
  buildSnapshot,
  projectFactBag,
  runImport,
  verifySnapshot,
  type CanonicalFact,
  type DataSnapshot,
  type ImportOutcome,
  type ImportRequest,
} from '@complianceos/ingest';
import type { LoadedRulePack, RuleLifecycleStatus } from '@complianceos/rulepack-sdk';
import {
  runAssessment,
  type AssessmentRunOutcome,
  type CalculatorRegistry,
  type RunContext,
  type SubjectRef,
} from '@complianceos/rules-engine';

export interface AssessDistrictExportRequest {
  /** Everything the import needs: the bytes, the scan, the mapping template, the subject. */
  readonly import: ImportRequest;
  /**
   * Facts the district may not assert about itself — prior determinations and SEA records.
   *
   * Supplied by the caller because producing them means reading finalized prior runs, which is
   * a database concern and not this function's. Each must already carry an origin the field
   * permits; `projectFactBag` refuses the rest.
   */
  readonly priorDeterminations: readonly CanonicalFact[];
  readonly subject: SubjectRef;
  readonly context: Omit<RunContext, 'dataSnapshotId'>;
  readonly packs: readonly LoadedRulePack[];
  /** The run's as-of date, deciding which rule versions were in force. */
  readonly asOf: string;
  readonly calculators: CalculatorRegistry;
  readonly includeLifecycles: readonly RuleLifecycleStatus[];
}

export interface AssessDistrictExportOutcome {
  readonly import: ImportOutcome;
  /** Absent when the import did not complete. */
  readonly snapshot?: DataSnapshot;
  /** Absent when there was no snapshot to assess. */
  readonly assessment?: AssessmentRunOutcome;
}

/**
 * A sealed snapshot whose hash does not re-derive.
 *
 * Refused rather than assessed. A snapshot exists so that a finalized run can be reproduced
 * years later from the exact data it saw; assessing one that fails its own integrity check
 * produces a result with a provenance chain that means nothing.
 */
export class SnapshotIntegrityError extends Error {
  constructor(readonly snapshotId: string) {
    super(
      `Snapshot ${snapshotId} does not match its content hash and was not assessed. ` +
        'It was altered after sealing, or was built by something that did not seal it.',
    );
    this.name = 'SnapshotIntegrityError';
  }
}

export function assessDistrictExport(
  request: AssessDistrictExportRequest,
): AssessDistrictExportOutcome {
  const imported = runImport(request.import);

  if (imported.kind !== 'COMPLETED' || imported.snapshot === undefined) {
    // A rejected scan or an unparseable file is a complete answer: the district is told what
    // is wrong with the file, and no assessment is invented from a partial read.
    return { import: imported };
  }

  // Re-seal over both fact sets. The import sealed the district's facts alone; the snapshot an
  // assessment is reproducible from has to be the one holding everything the assessment used.
  const snapshot = buildSnapshot({
    snapshotId: imported.snapshot.snapshotId,
    tenantId: imported.snapshot.tenantId,
    organizationId: imported.snapshot.organizationId,
    createdAt: imported.snapshot.createdAt,
    sourceFiles: imported.snapshot.sourceFiles,
    facts: [...imported.snapshot.facts, ...request.priorDeterminations],
  });

  if (!verifySnapshot(snapshot)) throw new SnapshotIntegrityError(snapshot.snapshotId);

  const facts = projectFactBag(snapshot, request.subject.subjectType, request.subject.subjectId);

  const assessment = runAssessment({
    // The snapshot actually assessed, never a caller-supplied string. A result whose
    // provenance names a snapshot it was not computed from is worse than one with none.
    context: { ...request.context, dataSnapshotId: snapshot.snapshotId },
    subject: request.subject,
    asOf: request.asOf,
    packs: request.packs,
    facts,
    calculators: request.calculators,
    includeLifecycles: request.includeLifecycles,
  });

  return { import: imported, snapshot, assessment };
}

/**
 * A stable identifier for the exact data an assessment saw.
 *
 * The snapshot id is assigned by the caller and says nothing about content; this is derived
 * from the content itself, so two imports of identical bytes with identical determinations
 * produce the same value and a run comparison can tell "nothing changed" from "re-imported".
 */
export function assessedDataFingerprint(snapshot: DataSnapshot): string {
  return hashCanonical({
    contentHash: snapshot.contentHash,
    factCount: snapshot.facts.length,
  } satisfies Record<string, CanonicalValue>);
}
