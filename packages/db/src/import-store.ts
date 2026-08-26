/**
 * Writing an import to the database: the file, its rows, the facts, the snapshot.
 *
 * Spec: Master Technical Buildout sections 10 and 11. CLAUDE.md invariants 3, 4 and 7.
 *
 * `packages/ingest` turns bytes into a sealed `DataSnapshot` in memory and reads no clock
 * and no database — that is what makes it testable and what makes the content hash mean
 * something. This module is the other half: it takes that snapshot and lays it down, keeping
 * the provenance chain intact on the way.
 *
 * ## One transaction, or none of it
 *
 * Everything below runs inside a single `withTenant` call, which is a single transaction.
 * That is not tidiness. A half-written import — an `import_jobs` row whose facts are missing,
 * or a snapshot whose `data_snapshot_facts` did not all land — would be a provenance chain
 * with a hole in it that still *looks* complete, and a finding resting on it would cite
 * evidence that was never stored. Invariant 3 is a claim about every finding, so the write
 * that could break it has to be all-or-nothing.
 *
 * ## Identity
 *
 * The in-memory pipeline identifies a fact by `(subjectType, subjectId, field)` and a
 * snapshot by whatever id the caller supplied. The database uses UUIDs. Rather than pushing
 * UUIDs up into the pure layer — which would make it depend on a database it deliberately
 * does not know about — this module mints them and keeps the map, so that
 * `data_snapshot_facts` and, later, `evaluation_result_inputs` can point at the right rows.
 *
 * The map is returned, not hidden, because the caller needs it to write the run.
 */

import { createHash } from 'node:crypto';
import type { Database } from './client.js';

/** A connection with tenant context, as `withTenant` supplies it. */
type Conn = Parameters<Parameters<Database['withTenant']>[1]>[0];

/**
 * The subset of a sealed fact this module writes.
 *
 * Declared structurally rather than imported from `@complianceos/ingest`, so that
 * `packages/db` does not take a dependency on the ingestion package. The database is the
 * lower layer; it should not need to know what produced the rows.
 */
export interface StorableFact {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly field: string;
  readonly value: { readonly kind: string; readonly value?: unknown } | unknown;
  readonly classification: string;
  readonly origin: string;
  readonly provenance: Readonly<Record<string, unknown>>;
}

export interface StorableSnapshot {
  readonly organizationId: string;
  readonly label: string;
  readonly contentHash: string;
  readonly facts: readonly StorableFact[];
}

export interface StorableFile {
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: Buffer;
  /** Each parsed row, in file order. Written to `raw_records` one row at a time. */
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

export interface PersistImportRequest {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly sourceSystemId: string;
  readonly requestedByUserId: string;
  /**
   * The caller's key for this import.
   *
   * `import_jobs` is UNIQUE on it per tenant, so re-posting the same upload cannot create a
   * second job. That matters because the browser's retry on a slow response is exactly how
   * a district ends up with two identical assessments and no way to tell which is current.
   */
  readonly idempotencyKey: string;
  readonly file: StorableFile;
  readonly snapshot: StorableSnapshot;
  /** Fiscal year to attach the snapshot to, when one is known. */
  readonly fiscalYearId?: string;
}

export interface PersistedImport {
  readonly importJobId: string;
  readonly importFileId: string;
  readonly dataSnapshotId: string;
  /** `factKey(fact)` to the `canonical_facts` row id. */
  readonly factIds: ReadonlyMap<string, string>;
}

/**
 * The key a fact is found by, matching how the pure layer identifies one.
 *
 * Joined on NUL because a subject type, a subject key and a field name can each contain any
 * printable character a district's export happens to use, NUL among them being the one thing
 * they cannot. A separator that *could* occur in a part — a space, a colon, a slash — makes
 * two different facts collide on one key, and the fact a finding cites would then be
 * whichever of them was written last.
 */
export function factKey(fact: { subjectType: string; subjectId: string; field: string }): string {
  return [fact.subjectType, fact.subjectId, fact.field].join('\u0000');
}

/**
 * Split a canonical value into the typed columns `canonical_facts` provides.
 *
 * The schema has `numeric_value`, `text_value` and `boolean_value` rather than one jsonb
 * blob, so that a fiscal figure is a NUMERIC the database can compare and sum — invariant 5
 * is enforced by the column type, not by everyone remembering. Money arrives here as a
 * decimal *string* and is handed to the driver as one, so it reaches NUMERIC without passing
 * through a float on the way.
 */
function columnsFor(value: unknown): {
  numeric: string | null;
  text: string | null;
  boolean: boolean | null;
  unit: string | null;
} {
  const empty = { numeric: null, text: null, boolean: null, unit: null };
  if (typeof value !== 'object' || value === null) {
    if (typeof value === 'boolean') return { ...empty, boolean: value };
    if (typeof value === 'string') return { ...empty, text: value };
    if (typeof value === 'number') return { ...empty, numeric: String(value) };
    return empty;
  }

  const tagged = value as { kind?: unknown; value?: unknown; unit?: unknown };
  const unit = typeof tagged.unit === 'string' ? tagged.unit : null;
  const inner = tagged.value;

  switch (tagged.kind) {
    case 'MONEY':
    case 'DECIMAL':
    case 'RATIO':
    case 'COUNT':
    case 'INTEGER':
      // String, never Number: a decimal string handed to the driver lands in NUMERIC
      // exactly. Parsing it here would be the float round-trip invariant 5 forbids.
      return {
        ...empty,
        unit,
        numeric: inner === null || inner === undefined ? null : String(inner),
      };
    case 'BOOLEAN':
      return { ...empty, unit, boolean: typeof inner === 'boolean' ? inner : null };
    case 'DATE':
    case 'TEXT':
    case 'ENUM':
    default:
      return { ...empty, unit, text: inner === null || inner === undefined ? null : String(inner) };
  }
}

/**
 * Raised rather than storing a fact this module cannot give honest provenance to.
 *
 * `fact_provenance` requires every fact to name where it came from — a raw record, or the
 * fact it was derived from — and that CHECK is invariant 3 written down. Two kinds of fact
 * arrive here without either:
 *
 *   - a **carried-forward determination**, whose source is a prior finalized run rather than
 *     a cell in this file (see `packages/ingest/src/provenance.ts`). Its home is the run that
 *     concluded it, not an upload; a district export is not permitted to assert one at all,
 *     which is why nothing in the upload path should produce one.
 *   - a **file-row fact naming a row this file does not have**, which is a mapping bug.
 *
 * Both used to fail as a Postgres constraint violation several statements later, which is a
 * 500 and a rolled-back transaction with nothing to tell the user. Naming them here makes the
 * boundary a statement rather than an accident.
 */
export class UnstorableProvenanceError extends Error {
  constructor(
    readonly field: string,
    readonly why: string,
  ) {
    super(
      `Refusing to store the fact "${field}": ${why}. Every stored fact must name the source ` +
        'record it came from (CLAUDE.md invariant 3).',
    );
    this.name = 'UnstorableProvenanceError';
  }
}

/**
 * The raw record a fact was read out of, or a refusal.
 *
 * `sourceRow` is 1-based as a person counts rows, matching `FileRowProvenance`.
 */
function rawRecordFor(fact: StorableFact, rawRecordIds: readonly string[]): string {
  const provenance = fact.provenance;

  if (provenance['kind'] === 'DETERMINATION') {
    throw new UnstorableProvenanceError(
      fact.field,
      'it is a determination carried forward from a prior run, which an import has no source ' +
        'row for',
    );
  }

  const sourceRow = provenance['sourceRow'];
  if (typeof sourceRow !== 'number' || !Number.isInteger(sourceRow)) {
    throw new UnstorableProvenanceError(fact.field, 'its provenance names no source row');
  }

  const id = sourceRow >= 1 ? rawRecordIds[sourceRow - 1] : undefined;
  if (id === undefined) {
    throw new UnstorableProvenanceError(
      fact.field,
      `its provenance names row ${sourceRow}, and this file has ${rawRecordIds.length}`,
    );
  }
  return id;
}

async function writeFacts(
  db: Conn,
  request: PersistImportRequest,
  importFileId: string,
  rawRecordIds: readonly string[],
): Promise<Map<string, string>> {
  const factIds = new Map<string, string>();

  for (const fact of request.snapshot.facts) {
    const columns = columnsFor(fact.value);

    // Facts are versioned, never updated (0005). A corrected general ledger produces a new
    // row that supersedes the old one, and the old one keeps its place in every snapshot
    // that already cited it — which is what makes an eighteen-month-old assessment still
    // reproducible. Overwriting instead would rewrite the evidence under a finalized run.
    const prior = await db.query<{ id: string; version: number }>(
      `SELECT id, version FROM canonical_facts
        WHERE organization_id = $1 AND fact_type = $2 AND subject_type = $3
          AND subject_key = $4
        ORDER BY version DESC
        LIMIT 1`,
      [request.organizationId, fact.field, fact.subjectType, fact.subjectId],
    );
    const supersedes = prior.rows[0] ?? null;

    const inserted = await db.query<{ id: string }>(
      `INSERT INTO canonical_facts
         (tenant_id, organization_id, fact_type, subject_type, subject_key,
          numeric_value, text_value, boolean_value, unit, classification,
          version, supersedes_fact_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        request.tenantId,
        request.organizationId,
        fact.field,
        fact.subjectType,
        fact.subjectId,
        columns.numeric,
        columns.text,
        columns.boolean,
        columns.unit,
        fact.classification,
        (supersedes?.version ?? 0) + 1,
        supersedes?.id ?? null,
      ],
    );

    const id = inserted.rows[0]?.id;
    if (id === undefined)
      throw new Error(`canonical_facts insert returned no id for ${fact.field}`);
    factIds.set(factKey(fact), id);

    if (supersedes !== null) {
      // Only the timestamp. The superseded row's values stay exactly as they were, because a
      // finalized run cites them.
      await db.query(`UPDATE canonical_facts SET superseded_at = now() WHERE id = $1`, [
        supersedes.id,
      ]);
    }

    // Resolved before the insert, so a fact with no row behind it is refused by name rather
    // than by a constraint violation with the transaction already half-written.
    const rawRecordId = rawRecordFor(fact, rawRecordIds);

    await db.query(
      `INSERT INTO fact_provenance
         (tenant_id, canonical_fact_id, raw_record_id, import_file_id, transformation,
          transformation_detail)
       VALUES ($1, $2, $3, $4, 'CSV_COLUMN_MAP', $5)`,
      [request.tenantId, id, rawRecordId, importFileId, JSON.stringify(fact.provenance)],
    );
  }

  return factIds;
}

/**
 * Write an import and its snapshot, all of it or none of it.
 *
 * Returns the ids the caller needs to write an assessment run against this snapshot.
 */
export function persistImport(
  database: Database,
  request: PersistImportRequest,
): Promise<PersistedImport> {
  return database.withTenant(request.tenantId, async (db) => {
    const job = await db.query<{ id: string }>(
      `INSERT INTO import_jobs
         (tenant_id, source_system_id, organization_id, status, idempotency_key,
          requested_by_user_id, started_at, finished_at, raw_record_count)
       VALUES ($1, $2, $3, 'SUCCEEDED', $4, $5, now(), now(), $6)
       RETURNING id`,
      [
        request.tenantId,
        request.sourceSystemId,
        request.organizationId,
        request.idempotencyKey,
        request.requestedByUserId,
        request.file.rows.length,
      ],
    );
    const importJobId = job.rows[0]?.id;
    if (importJobId === undefined) throw new Error('import_jobs insert returned no id');

    // Content-addressed, so the ref and the bytes cannot disagree about which file this is.
    // Migration 0009's CHECK ties the `inline:` scheme to the bytes actually being here.
    const contentHash = createHash('sha256').update(request.file.bytes).digest('hex');

    const file = await db.query<{ id: string }>(
      `INSERT INTO import_files
         (tenant_id, import_job_id, file_name, media_type, byte_size, content_hash,
          storage_ref, content, row_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        request.tenantId,
        importJobId,
        request.file.fileName,
        request.file.mediaType,
        request.file.bytes.byteLength,
        contentHash,
        `inline:sha256:${contentHash}`,
        request.file.bytes,
        request.file.rows.length,
      ],
    );
    const importFileId = file.rows[0]?.id;
    if (importFileId === undefined) throw new Error('import_files insert returned no id');

    const rawRecordIds: string[] = [];
    for (const [index, row] of request.file.rows.entries()) {
      const payload = JSON.stringify(row);
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO raw_records (tenant_id, import_file_id, row_number, payload, payload_hash)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         RETURNING id`,
        [
          request.tenantId,
          importFileId,
          index + 1,
          payload,
          createHash('sha256').update(payload).digest('hex'),
        ],
      );
      const id = inserted.rows[0]?.id;
      if (id === undefined)
        throw new Error(`raw_records insert returned no id for row ${index + 1}`);
      rawRecordIds.push(id);
    }

    const factIds = await writeFacts(db, request, importFileId, rawRecordIds);

    const snapshot = await db.query<{ id: string }>(
      `INSERT INTO data_snapshots
         (tenant_id, organization_id, label, fiscal_year_id, content_hash, fact_count,
          created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        request.tenantId,
        request.organizationId,
        request.snapshot.label,
        request.fiscalYearId ?? null,
        // The hash computed by the pure sealer, carried across unchanged. Recomputing it
        // here from the rows would be a second implementation that could disagree with the
        // one the snapshot was sealed with, and then a re-import would look like a change.
        request.snapshot.contentHash,
        request.snapshot.facts.length,
        request.requestedByUserId,
      ],
    );
    const dataSnapshotId = snapshot.rows[0]?.id;
    if (dataSnapshotId === undefined) throw new Error('data_snapshots insert returned no id');

    for (const id of factIds.values()) {
      await db.query(
        `INSERT INTO data_snapshot_facts (tenant_id, data_snapshot_id, canonical_fact_id)
         VALUES ($1, $2, $3)`,
        [request.tenantId, dataSnapshotId, id],
      );
    }

    return { importJobId, importFileId, dataSnapshotId, factIds };
  });
}
