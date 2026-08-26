/**
 * Laying an import and a run down, and reading them back.
 *
 * Spec: Master Technical Buildout sections 10, 11 and 22. CLAUDE.md invariants 3, 4, 5 and 7.
 *
 * The happy path is one test. The rest are the refusals, because this is the module that
 * decides whether a stored finding can be trusted:
 *
 *   - a finding whose inputs cannot be traced to stored facts is refused (invariant 3)
 *   - a finding citing rule content this database has never seen is refused (invariant 3)
 *   - a finalized run cannot be edited afterwards (invariant 4)
 *   - money survives the round trip exactly (invariant 5)
 *   - one tenant cannot read another's run (invariant 7)
 *   - a failure part-way through leaves nothing behind
 *
 * Everything reads and writes as `complianceos_app` — the non-owner, NOBYPASSRLS role — for
 * the same reason the isolation suite does: the claims are about what that role can do.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import type { Database } from './client.js';
import { UnstorableProvenanceError, factKey, persistImport } from './import-store.js';
import {
  MissingInputFactError,
  UnpublishedRuleError,
  latestRun,
  persistRun,
  resultsForRun,
} from './run-store.js';
import type { PersistImportRequest, StorableResult } from './index.js';

const DATABASE_URL = process.env.DATABASE_URL;

if (process.env.REQUIRE_DATABASE_TESTS !== undefined && DATABASE_URL === undefined) {
  throw new Error(
    'REQUIRE_DATABASE_TESTS is set but DATABASE_URL is not, so the persistence suite would ' +
      'skip — and it is the suite that decides whether a stored finding can be trusted.',
  );
}

const suite = DATABASE_URL === undefined ? describe.skip : describe;
const title =
  DATABASE_URL === undefined
    ? 'persistence [SKIPPED: set DATABASE_URL — see the header of src/store.test.ts]'
    : 'persistence against Postgres';

const APP_PASSWORD = 'store-suite-only';
const PACK_ID = 'PACK-FED-IDEA';
const PACK_VERSION = '1.0.0';
const RULE_ID = 'RULE-MOE-1';

const hash = (seed: string): string =>
  seed
    .padEnd(64, '0')
    .slice(0, 64)
    .replace(/[^0-9a-f]/g, '0');

suite(title, () => {
  const schema = `store_${randomUUID().replace(/-/g, '')}`;

  let owner!: Client;
  let app!: Database;
  /** The fiscal fact the fixture's row carries, named once so lookups cannot drift. */
  const STATE_LOCAL_TOTAL = {
    subjectType: 'FISCAL_YEAR',
    subjectId: 'FY2026',
    field: 'state_local_total',
  } as const;

  /** The high-precision fact that proves nothing on the write path floats a decimal. */
  const STATE_SHARE = {
    subjectType: 'FISCAL_YEAR',
    subjectId: 'FY2026',
    field: 'state_share_of_total',
  } as const;

  interface Fixture {
    tenantId: string;
    organizationId: string;
    userId: string;
    sourceSystemId: string;
  }
  let alpha!: Fixture;
  let beta!: Fixture;

  async function asOwner(tenantId: string, work: () => Promise<void>) {
    await owner.query('BEGIN');
    await owner.query('SELECT set_config($1, $2, true)', ['complianceos.tenant_id', tenantId]);
    try {
      await work();
      await owner.query('COMMIT');
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }
  }

  async function seed(slug: string): Promise<Fixture> {
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const userId = randomUUID();
    const sourceSystemId = randomUUID();

    await owner.query('INSERT INTO tenants (id, slug, display_name) VALUES ($1, $2, $3)', [
      tenantId,
      slug,
      `${slug} district`,
    ]);

    await asOwner(tenantId, async () => {
      await owner.query(
        `INSERT INTO organizations
           (tenant_id, id, organization_type, legal_name, state_code, state_agency_id)
         VALUES ($1, $2, 'LEA_DISTRICT', $3, 'AL', $4)`,
        [tenantId, organizationId, `${slug} School District`, slug],
      );
      await owner.query(
        `INSERT INTO users (tenant_id, id, subject_id, email, display_name)
         VALUES ($1, $2, $3, $4, 'Officer')`,
        [tenantId, userId, `sub-${slug}`, `officer@${slug}.invalid`],
      );
      await owner.query(
        `INSERT INTO source_systems
           (tenant_id, id, organization_id, system_type, connector_kind, display_name)
         VALUES ($1, $2, $3, 'ERP_FINANCE', 'CSV_UPLOAD', 'Manual export')`,
        [tenantId, sourceSystemId, organizationId],
      );
    });

    return { tenantId, organizationId, userId, sourceSystemId };
  }

  /** The one row a district uploads, and the facts sealed from it. */
  function importRequest(who: Fixture, overrides: Partial<PersistImportRequest> = {}) {
    const row = { lea_id: 'LEA-0417', state_local_total: '4830000.00', children: '1004' };
    return {
      tenantId: who.tenantId,
      organizationId: who.organizationId,
      sourceSystemId: who.sourceSystemId,
      requestedByUserId: who.userId,
      idempotencyKey: `upload-${randomUUID()}`,
      file: {
        fileName: 'northfield-fiscal-fy2026.csv',
        mediaType: 'text/csv',
        bytes: Buffer.from('lea_id,state_local_total,children\nLEA-0417,4830000.00,1004\n', 'utf8'),
        rows: [row],
      },
      snapshot: {
        organizationId: who.organizationId,
        label: 'FY2026 close',
        contentHash: hash('abc'),
        facts: [
          {
            subjectType: 'FISCAL_YEAR',
            subjectId: 'FY2026',
            field: 'state_local_total',
            // A decimal string, never a Number — invariant 5 starts here.
            value: { kind: 'MONEY', value: '4830000.00', unit: 'USD' },
            classification: 'CONFIDENTIAL',
            origin: 'DISTRICT_EXPORT',
            provenance: { kind: 'FILE_ROW', sourceRow: 1, sourceFields: ['state_local_total'] },
          },
          {
            subjectType: 'FISCAL_YEAR',
            subjectId: 'FY2026',
            field: 'state_share_of_total',
            // Seventeen significant digits — more than a double can hold. See the money test.
            value: { kind: 'RATIO', value: '1234567.1234567891' },
            classification: 'CONFIDENTIAL',
            origin: 'DISTRICT_EXPORT',
            provenance: { kind: 'FILE_ROW', sourceRow: 1, sourceFields: ['state_share'] },
          },
          {
            subjectType: 'FISCAL_YEAR',
            subjectId: 'FY2026',
            field: 'children_with_disabilities',
            value: { kind: 'COUNT', value: '1004' },
            classification: 'CONFIDENTIAL',
            origin: 'DISTRICT_EXPORT',
            provenance: { kind: 'FILE_ROW', sourceRow: 1, sourceFields: ['children'] },
          },
        ],
      },
      ...overrides,
    } satisfies PersistImportRequest;
  }

  function result(overrides: Partial<StorableResult> = {}): StorableResult {
    return {
      ruleId: RULE_ID,
      subjectType: 'FISCAL_YEAR',
      subjectId: 'FY2026',
      status: 'PASS',
      severityOnFailure: 'CRITICAL',
      explanation: 'State and local expenditures did not fall.',
      evaluationHash: hash('ef'),
      output: { comparisonYearTotal: '4830000.00' },
      missingInputs: [],
      inputFacts: {
        state_local_total: {
          subjectType: 'FISCAL_YEAR',
          subjectId: 'FY2026',
          field: 'state_local_total',
        },
      },
      ...overrides,
    };
  }

  beforeAll(async () => {
    const url = DATABASE_URL as string;
    const pg = (await import('pg')).default;
    const { migrate } = await import('./migrate.js');
    const { Database: Db } = await import('./client.js');

    await migrate({ connectionString: url, schema });

    owner = new pg.Client({ connectionString: url });
    await owner.connect();
    await owner.query(`SET search_path TO "${schema}"`);
    await owner.query(`ALTER ROLE complianceos_app WITH LOGIN PASSWORD '${APP_PASSWORD}'`);

    // Regulatory content is global and installed by the owner (migration 0004). A run cannot
    // cite what is not published, which is the point of the UnpublishedRuleError case below.
    await owner.query(
      `INSERT INTO regulatory_sources
         (id, jurisdiction, publisher, title, citation, official_url, effective_start_on, programs)
       VALUES ('REG-MOE', 'US-FED', 'U.S. Department of Education', 'Maintenance of effort',
               '34 CFR 300.203', 'https://www.ecfr.gov/current/title-34/part-300/section-300.203',
               DATE '2006-10-13', ARRAY['IDEA_PART_B'])`,
    );
    await owner.query(
      `INSERT INTO requirements (id, source_id, program, title, summary, citation, effective_start_on)
       VALUES ('REQ-MOE', 'REG-MOE', 'IDEA_PART_B', 'Maintenance of effort',
               'An LEA must not reduce its state and local expenditures.', '34 CFR 300.203',
               DATE '2006-10-13')`,
    );
    await owner.query(
      `INSERT INTO rule_packs (id, jurisdiction, program, title, description)
       VALUES ($1, 'US-FED', 'IDEA_PART_B', 'Federal baseline', 'IDEA Part B')`,
      [PACK_ID],
    );
    await owner.query(
      `INSERT INTO rule_pack_versions
         (id, pack_id, version, status, content_hash, engine_min_version, effective_start_on)
       VALUES ($1, $2, $3, 'ACTIVE', $4, '1.0.0', DATE '2006-10-13')`,
      [randomUUID(), PACK_ID, PACK_VERSION, hash('a')],
    );
    await owner.query(
      `INSERT INTO rules (id, pack_id, requirement_id, title, subject_type)
       VALUES ($1, $2, 'REQ-MOE', 'IDEA Part B — maintenance of effort', 'FISCAL_YEAR')`,
      [RULE_ID, PACK_ID],
    );
    await owner.query(
      `INSERT INTO rule_versions
         (id, rule_id, rule_pack_version_id, version, lifecycle, severity, authority_citation,
          source_id, logic, explanation_template, content_hash, effective_start_on)
       SELECT $1, $2, pv.id, 1, 'DRAFT', 'CRITICAL', '34 CFR 300.203(b)', 'REG-MOE',
              '{}'::jsonb, 'moe', $3, DATE '2006-10-13'
         FROM rule_pack_versions pv WHERE pv.pack_id = $4 AND pv.version = $5`,
      [randomUUID(), RULE_ID, hash('b'), PACK_ID, PACK_VERSION],
    );

    const asApp = new URL(url);
    asApp.username = 'complianceos_app';
    asApp.password = APP_PASSWORD;
    app = new Db({ connectionString: asApp.toString(), schema });
  }, 60_000);

  // A fresh district per test. Facts are versioned per organization (0005), so reusing one
  // would have each test's import supersede the last — and a test whose fixture depends on
  // what ran before it is a test that stops meaning anything when the order changes.
  async function storeRun(who: Fixture, finalize = false) {
    const imported = await persistImport(app, importRequest(who));
    const { assessmentRunId } = await persistRun(app, {
      tenantId: who.tenantId,
      organizationId: who.organizationId,
      dataSnapshotId: imported.dataSnapshotId,
      factIds: imported.factIds,
      requestedByUserId: who.userId,
      engineVersion: '1.0.0',
      rulePackId: PACK_ID,
      rulePackVersion: PACK_VERSION,
      programYearKind: 'FISCAL',
      programYearLabel: 'FY2026',
      results: [result()],
      finalize,
    });
    return { imported, assessmentRunId };
  }

  beforeEach(async () => {
    alpha = await seed(`alpha-${randomUUID()}`);
    beta = await seed(`beta-${randomUUID()}`);
  });

  afterAll(async () => {
    await app?.end();
    await owner?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await owner?.end();
  });

  describe('an import', () => {
    it('writes the whole chain and returns the ids a run needs', async () => {
      const stored = await persistImport(app, importRequest(alpha));

      expect(stored.importJobId).toBeDefined();
      expect(stored.dataSnapshotId).toBeDefined();
      expect(stored.factIds.size).toBe(3);

      const counts = await app.withTenant(alpha.tenantId, (db) =>
        db.query<{ rows_: number; facts: number; prov: number; linked: number }>(
          `SELECT (SELECT count(*)::int FROM raw_records WHERE import_file_id = $1) AS rows_,
                  (SELECT count(*)::int FROM canonical_facts) AS facts,
                  (SELECT count(*)::int FROM fact_provenance) AS prov,
                  (SELECT count(*)::int FROM data_snapshot_facts WHERE data_snapshot_id = $2)
                    AS linked`,
          [stored.importFileId, stored.dataSnapshotId],
        ),
      );
      const row = counts.rows[0];
      expect(row?.rows_).toBe(1);
      expect(row?.facts).toBe(3);
      // Every fact carries provenance. A fact without it is invariant 3 broken at the root.
      expect(row?.prov).toBe(3);
      expect(row?.linked).toBe(3);
    });

    it('keeps the uploaded bytes, and the ref agrees with them', async () => {
      const request = importRequest(alpha);
      const stored = await persistImport(app, request);

      const file = await app.withTenant(alpha.tenantId, (db) =>
        db.query<{ content: Buffer; storage_ref: string; content_hash: string }>(
          `SELECT content, storage_ref, content_hash FROM import_files WHERE id = $1`,
          [stored.importFileId],
        ),
      );
      const row = file.rows[0];
      expect(row?.content?.toString('utf8')).toBe(request.file.bytes.toString('utf8'));
      expect(row?.storage_ref).toBe(`inline:sha256:${row?.content_hash ?? ''}`);
    });

    it('refuses a row claiming inline storage with no bytes', async () => {
      // Migration 0009's CHECK. Without it the column would drift: code that set the ref and
      // forgot the bytes would leave a file nobody can produce again.
      const stored = await persistImport(app, importRequest(alpha));

      await expect(
        app.withTenant(alpha.tenantId, (db) =>
          db.query(
            `INSERT INTO import_files
               (tenant_id, import_job_id, file_name, media_type, byte_size, content_hash,
                storage_ref, row_count)
             VALUES ($1, $2, 'x.csv', 'text/csv', 1, $3, 'inline:sha256:x', 1)`,
            [alpha.tenantId, stored.importJobId, hash('cc')],
          ),
        ),
      ).rejects.toThrow(/import_files_content_matches_ref/);

      // And the mirror image: bytes with a ref that claims they live somewhere else.
      await expect(
        app.withTenant(alpha.tenantId, (db) =>
          db.query(
            `INSERT INTO import_files
               (tenant_id, import_job_id, file_name, media_type, byte_size, content_hash,
                storage_ref, content, row_count)
             VALUES ($1, $2, 'x.csv', 'text/csv', 1, $3, 'blob://elsewhere', $4, 1)`,
            [alpha.tenantId, stored.importJobId, hash('cc'), Buffer.from('x')],
          ),
        ),
      ).rejects.toThrow(/import_files_content_matches_ref/);
    });

    it('carries an exact decimal through NUMERIC without a float in the way', async () => {
      // Invariant 5. `state_share_of_total` has 17 significant digits, which is more than a
      // double holds: `Number('1234567.1234567891')` is 1234567.1234567892, and that is the
      // artifact this test exists to catch. It is stored as a decimal string and compared in
      // SQL, so a `parseFloat` anywhere on the path changes the last digit and fails here.
      const stored = await persistImport(app, importRequest(alpha));

      const fact = await app.withTenant(alpha.tenantId, (db) =>
        db.query<{
          numeric_value: string;
          unit: string | null;
          text_value: string | null;
          exact: boolean;
        }>(
          `SELECT numeric_value, unit, text_value,
                  numeric_value = $2::numeric AS exact
             FROM canonical_facts WHERE id = $1`,
          [stored.factIds.get(factKey(STATE_SHARE)), '1234567.1234567891'],
        ),
      );
      expect(fact.rows[0]?.exact).toBe(true);
      // A string, not a number: node-postgres hands NUMERIC back as text precisely so that
      // reading a fiscal value cannot quietly put it through a double.
      expect(typeof fact.rows[0]?.numeric_value).toBe('string');
      expect(fact.rows[0]?.text_value).toBeNull();

      const money = await app.withTenant(alpha.tenantId, (db) =>
        db.query<{ unit: string | null; exact: boolean }>(
          `SELECT unit, numeric_value = $2::numeric AS exact FROM canonical_facts WHERE id = $1`,
          [stored.factIds.get(factKey(STATE_LOCAL_TOTAL)), '4830000.00'],
        ),
      );
      expect(money.rows[0]?.exact).toBe(true);
      expect(money.rows[0]?.unit).toBe('USD');
    });

    it('refuses a fact with no row behind it, rather than storing one', async () => {
      // ADR 0008: whose statement is this. A determination is one this platform made in a
      // prior finalized run, and an import has no source row for it — `fact_provenance`
      // requires one. Storing it with a null source would be a fact from nowhere, which is
      // the kind of number that becomes a finding nobody can explain.
      const carried = importRequest(alpha);
      await expect(
        persistImport(app, {
          ...carried,
          snapshot: {
            ...carried.snapshot,
            facts: [
              ...carried.snapshot.facts,
              {
                subjectType: 'FISCAL_YEAR',
                subjectId: 'FY2025',
                field: 'prior_year_moe_status',
                value: { kind: 'ENUM', value: 'MET' },
                classification: 'CONFIDENTIAL',
                origin: 'PLATFORM_DETERMINATION',
                provenance: { kind: 'DETERMINATION', assessmentRunId: 'RUN-PRIOR-0001' },
              },
            ],
          },
        }),
      ).rejects.toThrow(UnstorableProvenanceError);

      // And a mapping bug that names a row the file does not have is refused the same way,
      // rather than quietly landing as a fact with no source.
      const beyond = importRequest(alpha);
      await expect(
        persistImport(app, {
          ...beyond,
          snapshot: {
            ...beyond.snapshot,
            facts: [
              { ...beyond.snapshot.facts[0]!, provenance: { kind: 'FILE_ROW', sourceRow: 7 } },
            ],
          },
        }),
      ).rejects.toThrow(/names row 7, and this file has 1/);

      // Neither attempt left a job behind.
      const jobs = await app.withTenant(alpha.tenantId, (db) =>
        db.query<{ count: string }>('SELECT count(*)::text AS count FROM import_jobs'),
      );
      expect(jobs.rows[0]?.count).toBe('0');
    });

    it('records every mapped fact as a column map against the row it came from', async () => {
      const stored = await persistImport(app, importRequest(alpha));
      const mapped = stored.factIds.get(factKey(STATE_LOCAL_TOTAL));

      const provenance = await app.withTenant(alpha.tenantId, (db) =>
        db.query<{ transformation: string; raw_record_id: string | null; row_number: string }>(
          `SELECT p.transformation, p.raw_record_id, r.row_number
             FROM fact_provenance p
             JOIN raw_records r ON r.tenant_id = p.tenant_id AND r.id = p.raw_record_id
            WHERE p.canonical_fact_id = $1`,
          [mapped],
        ),
      );
      expect(provenance.rows[0]?.transformation).toBe('CSV_COLUMN_MAP');
      // The fact points at the row it was read out of, not merely at some row in the file.
      expect(Number(provenance.rows[0]?.row_number)).toBe(1);
    });

    it('supersedes rather than overwrites when the same field is uploaded again', async () => {
      // A district re-exports with a corrected general ledger. The old fact keeps its values
      // and its place in the snapshot the earlier run cited, or that run stops being
      // reproducible — which is invariant 4 reaching back through the evidence.
      const first = await persistImport(app, importRequest(alpha));
      const corrected = importRequest(alpha);
      const second = await persistImport(app, {
        ...corrected,
        snapshot: {
          ...corrected.snapshot,
          facts: corrected.snapshot.facts.map((fact) =>
            fact.field === 'state_local_total'
              ? { ...fact, value: { kind: 'MONEY', value: '4915000.00', unit: 'USD' } }
              : fact,
          ),
        },
      });

      const oldId = first.factIds.get(factKey(STATE_LOCAL_TOTAL));
      const newId = second.factIds.get(factKey(STATE_LOCAL_TOTAL));
      expect(newId).not.toBe(oldId);

      const versions = await app.withTenant(alpha.tenantId, (db) =>
        db.query<{
          id: string;
          version: number;
          supersedes_fact_id: string | null;
          superseded_at: Date | null;
          exact: boolean;
        }>(
          `SELECT id, version, supersedes_fact_id, superseded_at,
                  numeric_value = CASE WHEN version = 1 THEN 4830000.00 ELSE 4915000.00 END
                    AS exact
             FROM canonical_facts
            WHERE fact_type = 'state_local_total'
            ORDER BY version`,
        ),
      );

      expect(versions.rows.map((row) => row.version)).toEqual([1, 2]);
      // The old row still holds the old number, unchanged.
      expect(versions.rows.every((row) => row.exact)).toBe(true);
      expect(versions.rows[0]?.superseded_at).not.toBeNull();
      expect(versions.rows[1]?.supersedes_fact_id).toBe(oldId);
      expect(versions.rows[1]?.superseded_at).toBeNull();

      // And the earlier snapshot still points at the earlier fact, not the correction.
      const earlier = await app.withTenant(alpha.tenantId, (db) =>
        db.query<{ canonical_fact_id: string }>(
          `SELECT canonical_fact_id FROM data_snapshot_facts
            WHERE data_snapshot_id = $1 AND canonical_fact_id = $2`,
          [first.dataSnapshotId, oldId],
        ),
      );
      expect(earlier.rows).toHaveLength(1);
    });

    it('refuses a second import under the same idempotency key', async () => {
      // A browser retrying a slow upload must not produce two assessments with no way to
      // tell which is current.
      const request = importRequest(alpha, { idempotencyKey: 'fixed-key-0001' });
      await persistImport(app, request);
      await expect(persistImport(app, request)).rejects.toThrow();
    });

    it('leaves nothing behind when a write part-way through fails', async () => {
      const before = await app.withTenant(alpha.tenantId, (db) =>
        db.query<{ n: number }>('SELECT count(*)::int AS n FROM import_jobs'),
      );

      // A fact whose classification is not in the schema's CHECK fails after the job, the
      // file and the rows are already inserted — so this proves the transaction, not the
      // ordering.
      const broken = importRequest(alpha);
      await expect(
        persistImport(app, {
          ...broken,
          snapshot: {
            ...broken.snapshot,
            facts: [{ ...broken.snapshot.facts[0]!, classification: 'NOT_A_CLASSIFICATION' }],
          },
        }),
      ).rejects.toThrow();

      const after = await app.withTenant(alpha.tenantId, (db) =>
        db.query<{ n: number }>('SELECT count(*)::int AS n FROM import_jobs'),
      );
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    });
  });

  describe('a run', () => {
    it('writes results and links each one to the facts it read', async () => {
      const imported = await persistImport(app, importRequest(alpha));
      const { assessmentRunId } = await persistRun(app, {
        tenantId: alpha.tenantId,
        organizationId: alpha.organizationId,
        dataSnapshotId: imported.dataSnapshotId,
        factIds: imported.factIds,
        requestedByUserId: alpha.userId,
        engineVersion: '1.0.0',
        rulePackId: PACK_ID,
        rulePackVersion: PACK_VERSION,
        programYearKind: 'FISCAL',
        programYearLabel: 'FY2026',
        results: [result()],
        finalize: false,
      });

      const inputs = await app.withTenant(alpha.tenantId, (db) =>
        db.query<{ input_name: string; canonical_fact_id: string }>(
          `SELECT eri.input_name, eri.canonical_fact_id
             FROM evaluation_result_inputs eri
             JOIN evaluation_results er ON er.id = eri.evaluation_result_id
            WHERE er.assessment_run_id = $1`,
          [assessmentRunId],
        ),
      );
      expect(inputs.rows).toHaveLength(1);
      expect(inputs.rows[0]?.input_name).toBe('state_local_total');
      expect(inputs.rows[0]?.canonical_fact_id).toBe(
        imported.factIds.get(factKey(STATE_LOCAL_TOTAL)),
      );
    });

    it('refuses a finding whose input is not a stored fact', async () => {
      // Invariant 3, at the only point where it can be broken silently.
      const imported = await persistImport(app, importRequest(alpha));

      await expect(
        persistRun(app, {
          tenantId: alpha.tenantId,
          organizationId: alpha.organizationId,
          dataSnapshotId: imported.dataSnapshotId,
          factIds: imported.factIds,
          requestedByUserId: alpha.userId,
          engineVersion: '1.0.0',
          rulePackId: PACK_ID,
          rulePackVersion: PACK_VERSION,
          programYearKind: 'FISCAL',
          programYearLabel: 'FY2026',
          results: [
            result({
              inputFacts: {
                invented: { subjectType: 'FISCAL_YEAR', subjectId: 'FY2026', field: 'nonesuch' },
              },
            }),
          ],
          finalize: false,
        }),
      ).rejects.toThrow(MissingInputFactError);
    });

    it('does not link an absent input, which is why a rule is indeterminate', async () => {
      const imported = await persistImport(app, importRequest(alpha));
      const { assessmentRunId } = await persistRun(app, {
        tenantId: alpha.tenantId,
        organizationId: alpha.organizationId,
        dataSnapshotId: imported.dataSnapshotId,
        factIds: imported.factIds,
        requestedByUserId: alpha.userId,
        engineVersion: '1.0.0',
        rulePackId: PACK_ID,
        rulePackVersion: PACK_VERSION,
        programYearKind: 'FISCAL',
        programYearLabel: 'FY2026',
        results: [
          result({
            status: 'INDETERMINATE',
            missingInputs: ['prior_year_total'],
            inputFacts: { prior_year_total: null },
          }),
        ],
        finalize: false,
      });

      const stored = await resultsForRun(app, alpha.tenantId, assessmentRunId);
      expect(stored[0]?.status).toBe('INDETERMINATE');
      // The schema CHECKs that an indeterminate result names a reason. Invariant 9 on disk.
      expect(stored[0]?.indeterminateReason).toContain('prior_year_total');
    });

    it('refuses a run citing a rule pack this database has never seen', async () => {
      const imported = await persistImport(app, importRequest(alpha));

      await expect(
        persistRun(app, {
          tenantId: alpha.tenantId,
          organizationId: alpha.organizationId,
          dataSnapshotId: imported.dataSnapshotId,
          factIds: imported.factIds,
          requestedByUserId: alpha.userId,
          engineVersion: '1.0.0',
          rulePackId: PACK_ID,
          rulePackVersion: '99.0.0',
          programYearKind: 'FISCAL',
          programYearLabel: 'FY2026',
          results: [result()],
          finalize: false,
        }),
      ).rejects.toThrow(UnpublishedRuleError);
    });

    it('cannot be edited once finalized', async () => {
      // Invariant 4, enforced by the schema's own trigger rather than by this module.
      const imported = await persistImport(app, importRequest(alpha));
      const { assessmentRunId } = await persistRun(app, {
        tenantId: alpha.tenantId,
        organizationId: alpha.organizationId,
        dataSnapshotId: imported.dataSnapshotId,
        factIds: imported.factIds,
        requestedByUserId: alpha.userId,
        engineVersion: '1.0.0',
        rulePackId: PACK_ID,
        rulePackVersion: PACK_VERSION,
        programYearKind: 'FISCAL',
        programYearLabel: 'FY2026',
        results: [result()],
        finalize: true,
      });

      await expect(
        app.withTenant(alpha.tenantId, (db) =>
          db.query(`UPDATE assessment_runs SET program_year_label = 'FY2027' WHERE id = $1`, [
            assessmentRunId,
          ]),
        ),
      ).rejects.toThrow();

      await expect(
        app.withTenant(alpha.tenantId, (db) =>
          db.query(`UPDATE evaluation_results SET status = 'PASS' WHERE assessment_run_id = $1`, [
            assessmentRunId,
          ]),
        ),
      ).rejects.toThrow();
    });
  });

  describe('reading it back', () => {
    it('returns the latest run with its snapshot and pack', async () => {
      await storeRun(beta);

      const run = await latestRun(app, beta.tenantId, beta.organizationId);
      expect(run).not.toBeNull();
      expect(run?.programYearLabel).toBe('FY2026');
      expect(run?.rulePackId).toBe(PACK_ID);
      expect(run?.factCount).toBe(3);
      expect(run?.snapshotContentHash).toBe(hash('abc'));

      const results = await resultsForRun(app, beta.tenantId, run?.assessmentRunId ?? '');
      expect(results).toHaveLength(1);
      expect(results[0]?.ruleId).toBe(RULE_ID);
      // The authority travels with the result, so a reader never sees a status without one.
      expect(results[0]?.authorityCitation).toBe('34 CFR 300.203(b)');
      expect(results[0]?.authorityUrl).toContain('ecfr.gov');
    });

    it('returns null for an organization with no run', async () => {
      expect(await latestRun(app, alpha.tenantId, randomUUID())).toBeNull();
    });

    it('does not let one tenant read another tenant’s run', async () => {
      // RLS, not application code: the query runs under alpha's context, so beta's rows are
      // not there to be found even though the id is correct.
      await storeRun(beta);

      const betaRun = await latestRun(app, beta.tenantId, beta.organizationId);
      expect(betaRun).not.toBeNull();

      expect(await latestRun(app, alpha.tenantId, beta.organizationId)).toBeNull();
      expect(await resultsForRun(app, alpha.tenantId, betaRun?.assessmentRunId ?? '')).toEqual([]);
    });
  });
});
