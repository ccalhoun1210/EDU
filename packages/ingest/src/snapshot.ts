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

import {
  hashCanonical,
  originRefusal,
  type CanonicalValue,
  type DataClassification,
  type FactOrigin,
} from '@complianceos/domain';
import type { FactProvenance, ProvenanceKind, SourceFileRef } from './provenance.js';

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
  /**
   * Whose statement this is.
   *
   * Classification says how sensitive the value is; origin says who was entitled to assert
   * it. A district's expenditure total and the platform's own prior determination about that
   * district are both CONFIDENTIAL, and only one of them may arrive in an uploaded
   * spreadsheet. See `packages/domain/src/fact-origin.ts`.
   */
  readonly origin: FactOrigin;
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
    // later). Provenance breaks the tie with something stable across imports of the same data:
    // the row for a file, the prior computation's hash for a determination.
    const left = tieBreaker(a.provenance);
    const right = tieBreaker(b.provenance);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/**
 * A stable, kind-aware ordering key.
 *
 * The row number is padded so that row 2 sorts before row 10 — a lexical comparison of "2" and
 * "10" would not, and the hash the ordering feeds would then depend on how many rows the file
 * happened to have.
 */
function tieBreaker(provenance: FactProvenance): string {
  return provenance.kind === 'FILE_ROW'
    ? `FILE_ROW:${String(provenance.sourceRow).padStart(12, '0')}`
    : `DETERMINATION:${provenance.evaluationHash}`;
}

/**
 * Every provenance field, not a selection of them.
 *
 * The raw source text and the physical line are what a monitor is shown on the finding-detail
 * screen, so they are evidence. Leaving them out of the hash let a sealed snapshot be edited to
 * claim a district's cell said something it never said, with `verifySnapshot` still returning
 * true — which is precisely the tampering the hash exists to detect. `sourceHash` is included
 * for the same reason: it could otherwise be desynced from the source file it names.
 *
 * `importJobId` is the one deliberate omission: it identifies the job, not the district's data.
 * Hashing it would make re-importing identical bytes a different snapshot, and every run
 * comparison would then report change where nothing changed. A determination has no equivalent
 * — every field on it describes the computation being carried forward — so all of it is hashed,
 * including the evaluation hash that binds the fact to that computation.
 *
 * `kind` is hashed too. Without it, relabelling a district's own figure as a determination
 * would be detectable only if some other field happened to differ.
 */
function hashableProvenance(provenance: FactProvenance): Record<string, CanonicalValue> {
  if (provenance.kind === 'DETERMINATION') {
    return {
      kind: provenance.kind,
      assessmentRunId: provenance.assessmentRunId,
      ruleId: provenance.ruleId,
      rulePackId: provenance.rulePackId,
      rulePackVersion: provenance.rulePackVersion,
      dataSnapshotId: provenance.dataSnapshotId,
      engineVersion: provenance.engineVersion,
      evaluationHash: provenance.evaluationHash,
      derivedFrom: provenance.derivedFrom,
      determinedAt: provenance.determinedAt,
    };
  }
  return {
    kind: provenance.kind,
    sourceFileId: provenance.sourceFileId,
    sourceHash: provenance.sourceHash,
    sourceRow: provenance.sourceRow,
    sourceLine: provenance.sourceLine,
    sourceFields: [...provenance.sourceFields],
    sourceValues: [...provenance.sourceValues],
    mappingTemplateId: provenance.mappingTemplateId,
    mappingVersion: provenance.mappingVersion,
    transformation: provenance.transformation,
  };
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
      // Hashed for the same reason the raw source text is: if origin were outside the hash,
      // a sealed snapshot could be edited to relabel a district's own figure as a platform
      // determination, and `verifySnapshot` would still return true.
      origin: fact.origin,
      provenance: hashableProvenance(fact.provenance),
    })),
  });
}

/**
 * Which provenance shape each origin is entitled to carry.
 *
 * `null` means no shape has been designed for that origin yet, and a fact claiming it is
 * refused rather than squeezed into one of the two that exist. That refusal is the point:
 * a district attestation is a person asserting something in the product, an SEA determination
 * is a state agency's record, and a published allocation table is neither — each needs fields
 * of its own, and the last time a shape was reused for something it did not describe the
 * result was a determination carrying a spreadsheet row number. Nothing in the platform
 * produces those three today, so nothing is blocked by leaving them undesigned; the first
 * producer will get an error naming exactly what has to be built.
 */
const SHAPE_BY_ORIGIN: Readonly<Record<FactOrigin, ProvenanceKind | null>> = {
  DISTRICT_EXPORT: 'FILE_ROW',
  DISTRICT_ATTESTATION: null,
  PLATFORM_DETERMINATION: 'DETERMINATION',
  SEA_DETERMINATION: null,
  PLATFORM_REFERENCE: null,
};

/** A fact whose provenance does not describe the kind of source its origin claims. */
export class ProvenanceShapeError extends Error {
  constructor(
    readonly field: string,
    readonly origin: FactOrigin,
    readonly kind: ProvenanceKind,
  ) {
    const expected = SHAPE_BY_ORIGIN[origin];
    super(
      expected === null
        ? `"${field}" claims origin ${origin}, which has no provenance shape yet. It was given ` +
            `a ${kind} record, which describes something else. Design a variant in ` +
            'packages/ingest/src/provenance.ts before recording facts from this origin — a ' +
            'chain that describes the wrong kind of source is worse than an absent one.'
        : `"${field}" claims origin ${origin}, which is recorded as ${expected}, but its ` +
            `provenance is a ${kind} record. A finding built on it would cite the wrong source.`,
    );
    this.name = 'ProvenanceShapeError';
  }
}

/**
 * Refuse a fact whose provenance does not describe where it says it came from.
 *
 * Checked at sealing rather than at projection, because a snapshot is the record: once a fact
 * with an incoherent chain is inside the content hash, the hash certifies the incoherence.
 */
function assertProvenanceShape(facts: readonly CanonicalFact[]): void {
  for (const fact of facts) {
    if (SHAPE_BY_ORIGIN[fact.origin] !== fact.provenance.kind) {
      throw new ProvenanceShapeError(fact.field, fact.origin, fact.provenance.kind);
    }
  }
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
  assertProvenanceShape(request.facts);
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
/**
 * A fact reached projection from a source with no standing to assert it.
 *
 * Thrown rather than dropped. Dropping would make the field absent, the calculator would
 * return INDETERMINATE, and the district would be told it was missing a figure it had in fact
 * supplied — hiding an attempt to assert a determination behind a data-quality message.
 */
export class FactOriginError extends Error {
  constructor(
    message: string,
    readonly field: string,
    readonly origin: FactOrigin,
  ) {
    super(message);
    this.name = 'FactOriginError';
  }
}

export function projectFactBag(
  snapshot: DataSnapshot,
  subjectType: string,
  subjectId: string,
): Readonly<Record<string, CanonicalValue>> {
  const bag: Record<string, CanonicalValue> = {};

  for (const fact of snapshot.facts) {
    if (fact.subjectType !== subjectType || fact.subjectId !== subjectId) continue;

    // Authority is checked here rather than at evaluation because this is the last point at
    // which a fact still knows where it came from. Past this line the bag is flat and a
    // district's assertion is indistinguishable from a determination.
    const refusal = originRefusal(fact.field, fact.origin);
    if (refusal !== undefined) throw new FactOriginError(refusal, fact.field, fact.origin);

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
