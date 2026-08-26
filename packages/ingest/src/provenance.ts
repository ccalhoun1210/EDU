/**
 * Data lineage.
 *
 * Spec: Master Technical Buildout section 10.6. CLAUDE.md invariant 3.
 *
 * Section 10.6 is one sentence long and it is the reason this platform can be sold as
 * assurance rather than as a dashboard: *"A finding must be able to show the exact underlying
 * source data."*
 *
 * Everything else in the ingestion pipeline exists to make this record truthful. A canonical
 * fact that cannot name where it came from is not admissible, because the chain
 *
 * ```text
 * Finding → Rule → Rule version → Authority → Input fact → Source record → Transformation → Snapshot
 * ```
 *
 * breaks at "Source record" and a district asked by a monitor "where does this number come
 * from" has no answer.
 *
 * ## Not every fact came from a row
 *
 * This record used to have exactly one shape: a row in an uploaded file. That was right for
 * the overwhelming majority of facts and wrong for the ones that decide the hardest cases. A
 * prior-year maintenance-of-effort status is a determination this platform made in a finalized
 * run — there is no spreadsheet cell behind it, and the fields that describe one were being
 * filled with placeholders. `sourceRow: 1` on a carried-forward determination sends a business
 * officer looking for a cell that does not exist, and `sourceHash` pointing at some unrelated
 * upload is not merely unhelpful, it is false.
 *
 * Worse, nothing bound such a fact to the run it named. A `moe_status_source_run_id` was a
 * string; anything could have written any run id beside any status, and the provenance chain
 * would have looked complete. `DeterminationProvenance` carries the prior result's evaluation
 * hash, which is derived from that run's inputs and output — so the claim "this value came
 * from that determination" is checkable rather than asserted. See
 * `packages/assurance/src/carry-forward.ts`, which is the only sanctioned way to build one.
 */

export interface SourceFileRef {
  readonly sourceFileId: string;
  readonly originalFilename: string;
  /** SHA-256 over the uploaded bytes. The raw artifact is immutable (§10.3). */
  readonly sourceHash: string;
  readonly uploadedAt: string;
  readonly uploadedBy: string;
}

export const PROVENANCE_KINDS = ['FILE_ROW', 'DETERMINATION'] as const;
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

/** A value read out of a row in a file the district uploaded. */
export interface FileRowProvenance {
  readonly kind: 'FILE_ROW';
  readonly importJobId: string;
  readonly sourceFileId: string;
  readonly sourceHash: string;
  /** 1-based data row, as a user counts rows. */
  readonly sourceRow: number;
  /** 1-based physical line in the file, which differs once a quoted field spans lines. */
  readonly sourceLine: number;
  /** The source columns this value was derived from. Plural: fields can be merged. */
  readonly sourceFields: readonly string[];
  /** The raw text as it appeared, before any transformation. */
  readonly sourceValues: readonly (string | null)[];
  readonly mappingTemplateId: string;
  readonly mappingVersion: string;
  /** The transformation chain, e.g. `trim → parseCurrency`. */
  readonly transformation: string;
}

/**
 * A value carried forward from a finalized assessment run of this platform.
 *
 * Every field here identifies the computation, not the act of copying it. That is deliberate:
 * the point is that a reader can go back to the named run, recompute it from the snapshot it
 * names, and get the same evaluation hash — at which point the value in this fact is proven
 * rather than trusted.
 */
export interface DeterminationProvenance {
  readonly kind: 'DETERMINATION';
  readonly assessmentRunId: string;
  readonly ruleId: string;
  readonly rulePackId: string;
  readonly rulePackVersion: string;
  /** The snapshot that run evaluated against. */
  readonly dataSnapshotId: string;
  readonly engineVersion: string;
  /**
   * The prior result's evaluation hash — the binding.
   *
   * It covers the rule, the pack version, the engine, the snapshot, the inputs read and the
   * whole result, and excludes the timestamp and run id. So it is stable under re-running and
   * changes under any alteration of what was concluded.
   */
  readonly evaluationHash: string;
  /**
   * Which part of that result this value is, as a dotted path: `status`, `output.methodsMet`.
   *
   * Structured rather than prose so the claim can be checked. `verifyCarriedForward` re-reads
   * this path out of the prior result and compares.
   */
  readonly derivedFrom: string;
  /** When the determination was made. Supplied, never read from a clock. */
  readonly determinedAt: string;
}

export type FactProvenance = FileRowProvenance | DeterminationProvenance;

export function isFileRowProvenance(provenance: FactProvenance): provenance is FileRowProvenance {
  return provenance.kind === 'FILE_ROW';
}

export function isDeterminationProvenance(
  provenance: FactProvenance,
): provenance is DeterminationProvenance {
  return provenance.kind === 'DETERMINATION';
}

/**
 * A one-line human rendering, for the finding-detail screen.
 *
 * Deliberately terse and deliberately specific. "FY2028 Budget Export.xlsx, row 412, column
 * `LOCAL_ACTUAL`" is something a business officer can go and look at; a provenance id is not.
 * The determination form is the same idea for a different kind of source: the run, the rule
 * and the date are what a monitor would ask to see next.
 */
export function describeProvenance(
  provenance: FactProvenance,
  file: SourceFileRef | undefined,
): string {
  if (provenance.kind === 'DETERMINATION') {
    return (
      `${provenance.ruleId} in finalized run ${provenance.assessmentRunId} ` +
      `(${provenance.determinedAt}), ${provenance.derivedFrom}`
    );
  }
  const name = file?.originalFilename ?? provenance.sourceFileId;
  const columns = provenance.sourceFields.join(', ');
  return `${name}, row ${provenance.sourceRow}, column ${columns} (${provenance.transformation})`;
}
