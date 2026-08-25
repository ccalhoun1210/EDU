/**
 * Canonical facts and immutable data snapshots.
 *
 * Spec: Master Technical Buildout sections 10.6 and 11. CLAUDE.md invariants 3 and 4.
 *
 * §11: *"A compliance assessment should never execute against a moving target."*
 *
 * A snapshot is the frozen set of facts a run saw, identified by a content hash over those
 * facts. Two consequences follow, and both are the point:
 *
 * - An assessment run pins a snapshot id, so re-running it later is a real reproduction
 *   rather than a re-computation against whatever the data has since become.
 * - The hash is over the facts *and their provenance*, so a snapshot cannot be edited to
 *   point at different source rows while keeping its identity. Provenance is part of what
 *   the run saw, not metadata attached to it.
 */

import { hashCanonical, type CanonicalValue, type DataClassification } from '@complianceos/domain';
import type { FactProvenance, SourceFileRef } from './provenance.js';

/**
 * One canonical value about one subject.
 *
 * The subject is an LEA and a fiscal year for the fiscal module; a case and a date for
 * programmatic monitoring later. Facts are named by the canonical field the rule packs
 * declare as inputs, which is what lets the engine project a fact bag without knowing
 * anything about the file it came from.
 */
export interface CanonicalFact {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly field: string;
  readonly value: CanonicalValue;
  readonly classification: DataClassification;
  readonly provenance: FactProvenance;
}

export interface DataSnapshot {
  readonly snapshotId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  /** Supplied by the caller. Nothing in this package reads the clock. */
  readonly createdAt: string;
  readonly sourceFiles: readonly SourceFileRef[];
  readonly facts: readonly CanonicalFact[];
  readonly contentHash: string;
}

/**
 * Order facts deterministically before hashing.
 *
 * Without this the hash would depend on the order rows happened to be processed, and the
 * same data imported twice would produce two snapshot identities — which would make every
 * run comparison report spurious change.
 */
function sortFacts(facts: readonly CanonicalFact[]): readonly CanonicalFact[] {
  return [...facts].sort((a, b) => {
    if (a.subjectType !== b.subjectType) return a.subjectType < b.subjectType ? -1 : 1;
    if (a.subjectId !== b.subjectId) return a.subjectId < b.subjectId ? -1 : 1;
    if (a.field !== b.field) return a.field < b.field ? -1 : 1;
    // A subject can legitimately carry repeated facts for one field (line items rolled up
    // later). Source row breaks the tie, and it is stable across imports of the same file.
    return a.provenance.sourceRow - b.provenance.sourceRow;
  });
}

export function computeSnapshotHash(
  facts: readonly CanonicalFact[],
  sourceFiles: readonly SourceFileRef[],
): string {
  return hashCanonical({
    // The uploaded artifacts' own hashes, so a snapshot is bound to the exact bytes it came
    // from (§10.3 — source artifacts are immutable).
    sourceHashes: [...sourceFiles].map((file) => file.sourceHash).sort(),
    facts: sortFacts(facts).map((fact) => ({
      subjectType: fact.subjectType,
      subjectId: fact.subjectId,
      field: fact.field,
      value: fact.value,
      // Every provenance field, not a selection of them.
      //
      // The raw source text and the physical line are what a monitor is shown on the
      // finding-detail screen, so they are evidence. Leaving them out of the hash let a
      // sealed snapshot be edited to claim a district's cell said something it never said,
      // with `verifySnapshot` still returning true — which is precisely the tampering the
      // hash exists to detect. `sourceHash` is included for the same reason: it could
      // otherwise be desynced from the source file it names.
      // `importJobId` is deliberately absent: it identifies the job, not the district's data.
      // Hashing it would make re-importing identical bytes a different snapshot, and every
      // run comparison would then report change where nothing changed.
      provenance: {
        sourceFileId: fact.provenance.sourceFileId,
        sourceHash: fact.provenance.sourceHash,
        sourceRow: fact.provenance.sourceRow,
        sourceLine: fact.provenance.sourceLine,
        sourceFields: fact.provenance.sourceFields,
        sourceValues: fact.provenance.sourceValues,
        mappingTemplateId: fact.provenance.mappingTemplateId,
        mappingVersion: fact.provenance.mappingVersion,
        transformation: fact.provenance.transformation,
      },
    })),
  });
}

export interface BuildSnapshotRequest {
  readonly snapshotId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly createdAt: string;
  readonly sourceFiles: readonly SourceFileRef[];
  readonly facts: readonly CanonicalFact[];
}

export function buildSnapshot(request: BuildSnapshotRequest): DataSnapshot {
  const facts = sortFacts(request.facts);
  return {
    snapshotId: request.snapshotId,
    tenantId: request.tenantId,
    organizationId: request.organizationId,
    createdAt: request.createdAt,
    sourceFiles: request.sourceFiles,
    facts,
    contentHash: computeSnapshotHash(facts, request.sourceFiles),
  };
}

/** Re-derive the hash and compare. A mismatch means the snapshot was altered after sealing. */
export function verifySnapshot(snapshot: DataSnapshot): boolean {
  return computeSnapshotHash(snapshot.facts, snapshot.sourceFiles) === snapshot.contentHash;
}

export class DuplicateFactError extends Error {
  constructor(
    readonly field: string,
    readonly subjectId: string,
  ) {
    super(
      `subject ${subjectId} has more than one value for "${field}". A rule reading it would ` +
        'get whichever happened to be last, so the conflict has to be resolved during ' +
        'reconciliation rather than at evaluation time.',
    );
    this.name = 'DuplicateFactError';
  }
}

/**
 * Project a subject's facts into the flat bag the rules engine evaluates against.
 *
 * Throws on a duplicate rather than picking one. A silently chosen value is the worst
 * outcome available here: the finding would be internally consistent, fully provenanced, and
 * computed from an arbitrary half of the district's data.
 */
export function projectFactBag(
  snapshot: DataSnapshot,
  subjectType: string,
  subjectId: string,
): Readonly<Record<string, CanonicalValue>> {
  const bag: Record<string, CanonicalValue> = {};

  for (const fact of snapshot.facts) {
    if (fact.subjectType !== subjectType || fact.subjectId !== subjectId) continue;
    if (Object.prototype.hasOwnProperty.call(bag, fact.field)) {
      throw new DuplicateFactError(fact.field, subjectId);
    }
    bag[fact.field] = fact.value;
  }

  return bag;
}

/**
 * The provenance behind one input on the finding-detail screen.
 *
 * This is the function that closes the chain: a number rendered on a page, back to the row of
 * the spreadsheet a district uploaded.
 */
export function provenanceFor(
  snapshot: DataSnapshot,
  subjectType: string,
  subjectId: string,
  field: string,
): FactProvenance | undefined {
  return snapshot.facts.find(
    (fact) =>
      fact.subjectType === subjectType && fact.subjectId === subjectId && fact.field === field,
  )?.provenance;
}

export function sourceFileFor(
  snapshot: DataSnapshot,
  sourceFileId: string,
): SourceFileRef | undefined {
  return snapshot.sourceFiles.find((file) => file.sourceFileId === sourceFileId);
}
