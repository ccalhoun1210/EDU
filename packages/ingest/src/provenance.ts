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
 * fact that cannot name the file, the row, the column and the transformation that produced it
 * is not admissible, because the chain
 *
 * ```text
 * Finding → Rule → Rule version → Authority → Input fact → Source record → Transformation → Snapshot
 * ```
 *
 * breaks at "Source record" and a district asked by a monitor "where does this number come
 * from" has no answer.
 */

export interface SourceFileRef {
  readonly sourceFileId: string;
  readonly originalFilename: string;
  /** SHA-256 over the uploaded bytes. The raw artifact is immutable (§10.3). */
  readonly sourceHash: string;
  readonly uploadedAt: string;
  readonly uploadedBy: string;
}

export interface FactProvenance {
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
 * A one-line human rendering, for the finding-detail screen.
 *
 * Deliberately terse and deliberately specific. "FY2028 Budget Export.xlsx, row 412, column
 * `LOCAL_ACTUAL`" is something a business officer can go and look at; a provenance id is not.
 */
export function describeProvenance(
  provenance: FactProvenance,
  file: SourceFileRef | undefined,
): string {
  const name = file?.originalFilename ?? provenance.sourceFileId;
  const columns = provenance.sourceFields.join(', ');
  return `${name}, row ${provenance.sourceRow}, column ${columns} (${provenance.transformation})`;
}
