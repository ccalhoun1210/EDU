/**
 * The tenant-isolation attack suite.
 *
 * Spec: Master Technical Buildout section 26.4 ("automated security tests must try to
 * access another tenant by ID, attach evidence across tenants, query foreign records
 * through filters, exploit bulk export endpoints"). ADR 0004. CLAUDE.md invariants 4 and 7.
 *
 * Every other test in this package reads the SQL and reasons about it. This one runs it.
 * It migrates into a throwaway schema, seeds two districts, connects AS THE APPLICATION
 * ROLE — not as the owner, which is the entire point — and then tries to commit the
 * breaches that would end this product.
 *
 * ## Running it
 *
 * It needs a real Postgres and is skipped without one. Locally:
 *
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
 *     pnpm exec vitest run --project db src/isolation.test.ts
 *
 * The connecting role must be able to CREATE SCHEMA and to ALTER ROLE, because the suite
 * gives the application role a password so it can log in the way it does in production.
 * A superuser (the default in the Postgres image and in the CI service container) has both.
 *
 * The suite is SKIPPED, never silently passed, when DATABASE_URL is absent. A tenant
 * isolation test that quietly reports success on a machine with no database is worse than
 * no test: it is a green tick next to an unverified claim.
 *
 * ## What is not covered here
 *
 * Section 26.4 also lists "reuse another tenant's signed upload URL". That attack lives
 * entirely in the object-storage layer — the database never sees the URL — so it belongs
 * with the evidence-storage module and is deliberately absent rather than faked here.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client, Pool } from 'pg';
import type { Database } from './client.js';

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * Skipping is right on a developer machine and wrong in CI.
 *
 * Tenant isolation is the severest threat this platform has, and these are the only tests
 * that exercise the controls preventing it. A misconfigured service container would turn the
 * entire suite into a green tick reporting nothing — the worst possible outcome, because it
 * looks exactly like the good one. So in CI the absence of a database is a hard failure.
 */
if (process.env.CI !== undefined && DATABASE_URL === undefined) {
  throw new Error(
    'The tenant isolation suite requires DATABASE_URL in CI. It skips locally by design, but ' +
      'a silent skip here would report that isolation holds without having checked it.',
  );
}

const SKIP_TITLE =
  'tenant isolation against a real Postgres [SKIPPED: set DATABASE_URL to a Postgres ' +
  'superuser connection string to run — see the header of src/isolation.test.ts]';

const suite = DATABASE_URL === undefined ? describe.skip : describe;
const title = DATABASE_URL === undefined ? SKIP_TITLE : 'tenant isolation against Postgres';

/** The password the suite gives the application role so it can log in like production. */
const APP_PASSWORD = 'isolation-suite-only';

const hash = (seed: string): string =>
  seed
    .padEnd(64, '0')
    .slice(0, 64)
    .replace(/[^0-9a-f]/g, '0');

/** SQLSTATE of a driver error, or undefined for anything that is not one. */
function sqlState(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

async function rejection(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to be refused, but it succeeded');
}

interface TenantFixture {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly snapshotId: string;
  readonly runId: string;
  readonly evaluationResultId: string;
  readonly findingId: string;
  readonly evidenceItemId: string;
}

suite(title, () => {
  const schema = `isolation_${randomUUID().replace(/-/g, '')}`;
  const packVersionId = randomUUID();
  const ruleVersionId = randomUUID();

  let owner!: Client;
  let app!: Database;
  let probePool!: Pool;
  let tenantA!: TenantFixture;
  let tenantB!: TenantFixture;

  /** Run statements as the schema owner, with tenant context set so FORCE RLS is satisfied. */
  async function asOwner(tenantId: string | undefined, statements: () => Promise<void>) {
    await owner.query('BEGIN');
    if (tenantId !== undefined) {
      await owner.query('SELECT set_config($1, $2, true)', ['complianceos.tenant_id', tenantId]);
    }
    try {
      await statements();
      await owner.query('COMMIT');
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }
  }

  async function seedTenant(slug: string, seed: string): Promise<TenantFixture> {
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const userId = randomUUID();
    const snapshotId = randomUUID();
    const fiscalYearId = randomUUID();
    const runId = randomUUID();
    const evaluationResultId = randomUUID();
    const findingId = randomUUID();
    const evidenceItemId = randomUUID();

    // The tenant registry is not FORCEd, so the owner may provision without context.
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
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, userId, `sub-${slug}`, `director@${slug}.invalid`, 'Sped Director'],
      );
      await owner.query(
        `INSERT INTO fiscal_years (tenant_id, id, organization_id, label, starts_on, ends_on)
         VALUES ($1, $2, $3, 'FY2028', DATE '2027-07-01', DATE '2028-06-30')`,
        [tenantId, fiscalYearId, organizationId],
      );
      await owner.query(
        `INSERT INTO data_snapshots
           (tenant_id, id, organization_id, label, fiscal_year_id, content_hash, fact_count)
         VALUES ($1, $2, $3, 'FY2028 close', $4, $5, 0)`,
        [tenantId, snapshotId, organizationId, fiscalYearId, hash(`5${seed}`)],
      );
      await owner.query(
        `INSERT INTO assessment_runs
           (tenant_id, id, organization_id, module, scope_type, program_year_kind,
            program_year_label, fiscal_year_id, rule_pack_version_id, engine_version,
            data_snapshot_id, status)
         VALUES ($1, $2, $3, 'IDEA_FISCAL', 'ORGANIZATION', 'FISCAL', 'FY2028', $4, $5,
                 '1.0.0', $6, 'COMPLETED')`,
        [tenantId, runId, organizationId, fiscalYearId, packVersionId, snapshotId],
      );
      await owner.query(
        `INSERT INTO evaluation_results
           (tenant_id, id, assessment_run_id, rule_version_id, subject_type, subject_id,
            status, severity, explanation, evaluation_hash)
         VALUES ($1, $2, $3, $4, 'FISCAL_YEAR', $5, 'FAIL', 'HIGH',
                 'Local expenditure fell below the prior year.', $6)`,
        [tenantId, evaluationResultId, runId, ruleVersionId, fiscalYearId, hash(`e${seed}`)],
      );
      await owner.query(
        `INSERT INTO findings
           (tenant_id, id, organization_id, assessment_run_id, evaluation_result_id, rule_id,
            rule_version_id, data_snapshot_id, engine_version, evaluation_hash, requirement_id,
            system_status, severity, subject_type, subject_id, title, summary, detected_on)
         VALUES ($1, $2, $3, $4, $5, 'RULE-MOE-1', $6, $7, '1.0.0', $8, 'REQ-MOE',
                 'FAIL', 'HIGH', 'FISCAL_YEAR', $9, 'MOE shortfall',
                 'Maintenance of effort was not met on any permitted basis.',
                 DATE '2028-07-15')`,
        [
          tenantId,
          findingId,
          organizationId,
          runId,
          evaluationResultId,
          ruleVersionId,
          snapshotId,
          hash(`e${seed}`),
          fiscalYearId,
        ],
      );
      await owner.query(
        `INSERT INTO evidence_items
           (tenant_id, id, organization_id, title, source, document_class, classification,
            retention_class, media_type, byte_size, content_hash, storage_ref)
         VALUES ($1, $2, $3, 'Board minutes', 'DISTRICT_UPLOAD', 'BOARD_MINUTES',
                 'CONFIDENTIAL', 'FEDERAL_AWARD_RECORD', 'application/pdf', 1024, $4, $5)`,
        [tenantId, evidenceItemId, organizationId, hash(`d${seed}`), `blob://${slug}/minutes.pdf`],
      );

      // Finalize last, so the seed exercises the legal transition rather than side-stepping
      // it — and so everything above is now frozen.
      await owner.query(
        `UPDATE assessment_runs SET status = 'FINALIZED', finalized_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, runId],
      );
    });

    return {
      tenantId,
      organizationId,
      userId,
      snapshotId,
      runId,
      evaluationResultId,
      findingId,
      evidenceItemId,
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

    // In production the application role is a separate login with credentials issued by
    // the deployment. Here the suite issues them, because connecting as the owner would
    // test nothing: the whole claim under test is that the role the application uses
    // cannot see across the boundary.
    await owner.query(`ALTER ROLE complianceos_app WITH LOGIN PASSWORD '${APP_PASSWORD}'`);

    // Published regulatory content is global and installed by the owner (see 0004).
    await owner.query(
      `INSERT INTO regulatory_sources
         (id, jurisdiction, publisher, title, citation, official_url, effective_start_on, programs)
       VALUES ('REG-MOE', 'US-FED', 'U.S. Department of Education',
               'Maintenance of effort', '34 CFR 300.203',
               'https://www.ecfr.gov/current/title-34/part-300/section-300.203',
               DATE '2006-10-13', ARRAY['IDEA_PART_B'])`,
    );
    await owner.query(
      `INSERT INTO requirements
         (id, source_id, program, title, summary, citation, effective_start_on)
       VALUES ('REQ-MOE', 'REG-MOE', 'IDEA_PART_B', 'Maintenance of effort',
               'An LEA must not reduce its state and local expenditures.',
               '34 CFR 300.203', DATE '2006-10-13')`,
    );
    await owner.query(
      `INSERT INTO rule_packs (id, jurisdiction, program, title, description)
       VALUES ('PACK-FED-IDEA', 'US-FED', 'IDEA_PART_B', 'Federal baseline', 'IDEA Part B')`,
    );
    await owner.query(
      `INSERT INTO rule_pack_versions
         (id, pack_id, version, status, content_hash, engine_min_version, effective_start_on)
       VALUES ($1, 'PACK-FED-IDEA', '1.0.0', 'ACTIVE', $2, '1.0.0', DATE '2006-10-13')`,
      [packVersionId, hash('a')],
    );
    await owner.query(
      `INSERT INTO rules (id, pack_id, requirement_id, title, subject_type)
       VALUES ('RULE-MOE-1', 'PACK-FED-IDEA', 'REQ-MOE', 'MOE eligibility', 'FISCAL_YEAR')`,
    );
    await owner.query(
      `INSERT INTO rule_versions
         (id, rule_id, rule_pack_version_id, version, lifecycle, severity, authority_citation,
          source_id, logic, explanation_template, content_hash, effective_start_on)
       VALUES ($1, 'RULE-MOE-1', $2, 1, 'ACTIVE', 'HIGH', '34 CFR 300.203', 'REG-MOE',
               '{}'::jsonb, 'moe', $3, DATE '2006-10-13')`,
      [ruleVersionId, packVersionId, hash('b')],
    );

    tenantA = await seedTenant('alpha', '1');
    tenantB = await seedTenant('beta', '2');

    const appUrl = new URL(url);
    appUrl.username = 'complianceos_app';
    appUrl.password = APP_PASSWORD;

    // One connection, so consecutive tenants are guaranteed to reuse the same physical
    // backend. That is the condition under which a session-level GUC would leak.
    app = new Db({ connectionString: appUrl.toString(), schema, maxConnections: 1 });
    probePool = new pg.Pool({ connectionString: appUrl.toString(), max: 1 });
  }, 60_000);

  afterAll(async () => {
    await app?.end();
    await probePool?.end();
    if (owner !== undefined) {
      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await owner.end();
    }
  });

  describe('the seed itself proves the schema accepts a legitimate district', () => {
    it('lets a tenant read its own finding with its whole provenance chain', async () => {
      const rows = await app.withTenant(tenantA.tenantId, async (db) => {
        const result = await db.query<{
          id: string;
          citation: string;
          engine_version: string;
          snapshot_hash: string;
        }>(
          `SELECT f.id, rv.authority_citation AS citation, f.engine_version,
                  s.content_hash AS snapshot_hash
             FROM findings f
             JOIN rule_versions rv ON rv.id = f.rule_version_id
             JOIN data_snapshots s ON s.tenant_id = f.tenant_id AND s.id = f.data_snapshot_id
            WHERE f.id = $1`,
          [tenantA.findingId],
        );
        return result.rows;
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.citation).toBe('34 CFR 300.203');
    });
  });

  describe('accessing another tenant by id', () => {
    it('returns nothing for a foreign organization', async () => {
      const count = await app.withTenant(tenantA.tenantId, async (db) => {
        const result = await db.query('SELECT id FROM organizations WHERE id = $1', [
          tenantB.organizationId,
        ]);
        return result.rowCount;
      });
      expect(count).toBe(0);
    });

    it('returns nothing for a foreign finding, run, evidence item or user', async () => {
      const counts = await app.withTenant(tenantA.tenantId, async (db) => ({
        findings: (await db.query('SELECT 1 FROM findings WHERE id = $1', [tenantB.findingId]))
          .rowCount,
        runs: (await db.query('SELECT 1 FROM assessment_runs WHERE id = $1', [tenantB.runId]))
          .rowCount,
        evidence: (
          await db.query('SELECT 1 FROM evidence_items WHERE id = $1', [tenantB.evidenceItemId])
        ).rowCount,
        users: (await db.query('SELECT 1 FROM users WHERE id = $1', [tenantB.userId])).rowCount,
      }));
      expect(counts).toEqual({ findings: 0, runs: 0, evidence: 0, users: 0 });
    });
  });

  describe('querying foreign records through a filter', () => {
    it('ignores a tenant_id supplied as a query parameter', async () => {
      // The shape of the real bug: a handler that takes tenant_id from a request body and
      // faithfully puts it in the WHERE clause. RLS ANDs its own predicate on top, so the
      // forged filter selects nothing rather than another district's ledger.
      const rows = await app.withTenant(tenantA.tenantId, async (db) => {
        const result = await db.query('SELECT id FROM findings WHERE tenant_id = $1', [
          tenantB.tenantId,
        ]);
        return result.rowCount;
      });
      expect(rows).toBe(0);
    });

    it('cannot pull a foreign row in through a join', async () => {
      const rows = await app.withTenant(tenantA.tenantId, async (db) => {
        const result = await db.query(
          `SELECT f.id
             FROM findings f
             JOIN organizations o ON o.tenant_id = f.tenant_id AND o.id = f.organization_id
            WHERE o.legal_name LIKE 'beta%'`,
        );
        return result.rowCount;
      });
      expect(rows).toBe(0);
    });

    it('cannot count foreign rows through an aggregate', async () => {
      // An aggregate is the classic leak that survives row filtering in an application
      // layer, because nobody remembers to scope the COUNT.
      const total = await app.withTenant(tenantA.tenantId, async (db) => {
        const result = await db.query<{ n: string }>('SELECT count(*) AS n FROM findings');
        return Number(result.rows[0]?.n ?? -1);
      });
      expect(total).toBe(1);
    });
  });

  describe('bulk export across the boundary', () => {
    it('sees only its own rows in every tenant-owned table it can read', async () => {
      const tables = [
        'organizations',
        'users',
        'fiscal_years',
        'data_snapshots',
        'assessment_runs',
        'evaluation_results',
        'findings',
        'evidence_items',
      ];
      const counts = await app.withTenant(tenantA.tenantId, async (db) => {
        const out: Record<string, number> = {};
        for (const table of tables) {
          const result = await db.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
          out[table] = Number(result.rows[0]?.n ?? -1);
        }
        return out;
      });
      // Two districts were seeded identically; a leak of any size shows up as a 2.
      expect(Object.values(counts)).toEqual(tables.map(() => 1));
    });
  });

  describe('attaching evidence across tenants', () => {
    it('refuses a link from its own evidence to a foreign finding', async () => {
      // The composite foreign key is what refuses this: (tenantA, findingOfB) is not a row
      // that exists, so there is no code path — buggy or hostile — that can create it.
      const error = await rejection(() =>
        app.withTenant(tenantA.tenantId, async (db) =>
          db.query(
            `INSERT INTO evidence_links (tenant_id, evidence_item_id, target_kind, finding_id)
             VALUES ($1, $2, 'FINDING', $3)`,
            [tenantA.tenantId, tenantA.evidenceItemId, tenantB.findingId],
          ),
        ),
      );
      expect(sqlState(error)).toBe('23503');
    });

    it('refuses a link written under a foreign tenant id', async () => {
      const error = await rejection(() =>
        app.withTenant(tenantA.tenantId, async (db) =>
          db.query(
            `INSERT INTO evidence_links (tenant_id, evidence_item_id, target_kind, finding_id)
             VALUES ($1, $2, 'FINDING', $3)`,
            [tenantB.tenantId, tenantB.evidenceItemId, tenantB.findingId],
          ),
        ),
      );
      // The RLS WITH CHECK clause, not a foreign key: the row is refused because it does
      // not belong to the session's tenant.
      expect(sqlState(error)).toBe('42501');
    });

    it('refuses a finding whose provenance points at another tenant', async () => {
      // Invariant 3 says a finding must carry its provenance. The composite foreign keys
      // add the half that matters here: the provenance it carries must be its OWN tenant's.
      // A forged finding attributing another district's run to this one is refused by the
      // database, not by a service method somebody could forget to call.
      const error = await rejection(() =>
        app.withTenant(tenantA.tenantId, async (db) =>
          db.query(
            `INSERT INTO findings
               (tenant_id, organization_id, assessment_run_id, evaluation_result_id, rule_id,
                rule_version_id, data_snapshot_id, engine_version, evaluation_hash,
                system_status, severity, subject_type, subject_id, title, summary, detected_on)
             VALUES ($1, $2, $3, $4, 'RULE-MOE-1', $5, $6, '1.0.0', $7, 'FAIL', 'HIGH',
                     'FISCAL_YEAR', 'forged', 'forged', 'forged', DATE '2028-07-15')`,
            [
              tenantA.tenantId,
              tenantA.organizationId,
              tenantB.runId,
              tenantB.evaluationResultId,
              ruleVersionId,
              tenantB.snapshotId,
              hash('f'),
            ],
          ),
        ),
      );
      expect(sqlState(error)).toBe('23503');
    });
  });

  describe('writing outside the boundary', () => {
    it('refuses an organization inserted under a foreign tenant id', async () => {
      const error = await rejection(() =>
        app.withTenant(tenantA.tenantId, async (db) =>
          db.query(
            `INSERT INTO organizations (tenant_id, organization_type, legal_name)
             VALUES ($1, 'LEA_DISTRICT', 'smuggled')`,
            [tenantB.tenantId],
          ),
        ),
      );
      expect(sqlState(error)).toBe('42501');
    });

    it('cannot update a foreign row even by naming its id', async () => {
      const affected = await app.withTenant(tenantA.tenantId, async (db) => {
        const result = await db.query(
          `UPDATE organizations SET legal_name = 'renamed' WHERE id = $1`,
          [tenantB.organizationId],
        );
        return result.rowCount;
      });
      expect(affected).toBe(0);

      const stillNamed = await app.withTenant(tenantB.tenantId, async (db) => {
        const result = await db.query<{ legal_name: string }>(
          'SELECT legal_name FROM organizations WHERE id = $1',
          [tenantB.organizationId],
        );
        return result.rows[0]?.legal_name;
      });
      expect(stillNamed).toBe('beta School District');
    });

    it('cannot delete a foreign row', async () => {
      const affected = await app.withTenant(tenantA.tenantId, async (db) => {
        const result = await db.query('DELETE FROM evidence_items WHERE id = $1', [
          tenantB.evidenceItemId,
        ]);
        return result.rowCount;
      });
      expect(affected).toBe(0);
    });
  });

  describe('tenant context does not survive a pooled connection', () => {
    it('discards the GUC at COMMIT', async () => {
      // The reason src/client.ts sets the tenant transaction-locally. If this ever fails,
      // the next request to borrow this connection inherits the previous district.
      const client = await probePool.connect();
      try {
        await client.query(`SET search_path TO "${schema}"`);
        await client.query('BEGIN');
        await client.query('SELECT set_config($1, $2, true)', [
          'complianceos.tenant_id',
          tenantA.tenantId,
        ]);
        const inside = await client.query<{ t: string | null }>(
          `SELECT current_setting('complianceos.tenant_id', true) AS t`,
        );
        await client.query('COMMIT');
        const after = await client.query<{ t: string | null }>(
          `SELECT current_setting('complianceos.tenant_id', true) AS t`,
        );
        const visible = await client.query('SELECT id FROM findings');

        expect(inside.rows[0]?.t).toBe(tenantA.tenantId);
        expect(after.rows[0]?.t ?? '').toBe('');
        // And with no tenant context, the app role reads nothing. Isolation fails closed.
        expect(visible.rowCount).toBe(0);
      } finally {
        client.release();
      }
    });

    it('shows the next tenant only its own rows on the same connection', async () => {
      const first = await app.withTenant(tenantA.tenantId, async (db) => {
        const result = await db.query<{ legal_name: string }>(
          'SELECT legal_name FROM organizations',
        );
        return result.rows.map((row) => row.legal_name);
      });
      const second = await app.withTenant(tenantB.tenantId, async (db) => {
        const result = await db.query<{ legal_name: string }>(
          'SELECT legal_name FROM organizations',
        );
        return result.rows.map((row) => row.legal_name);
      });
      expect(first).toEqual(['alpha School District']);
      expect(second).toEqual(['beta School District']);
    });

    it('refuses a tenant id that is not a uuid before it reaches SQL', async () => {
      await expect(
        app.withTenant("' OR true --", async (db) => db.query('SELECT 1')),
      ).rejects.toThrow(/Not a valid tenant id/);
    });
  });

  describe('finalized runs are immutable (invariant 4)', () => {
    it('refuses to update a finalized run', async () => {
      const error = await rejection(() =>
        app.withTenant(tenantA.tenantId, async (db) =>
          db.query(`UPDATE assessment_runs SET engine_version = '9.9.9' WHERE id = $1`, [
            tenantA.runId,
          ]),
        ),
      );
      expect(sqlState(error)).toBe('CO001');
    });

    it('refuses to delete a finalized run', async () => {
      const error = await rejection(() =>
        app.withTenant(tenantA.tenantId, async (db) =>
          db.query('DELETE FROM assessment_runs WHERE id = $1', [tenantA.runId]),
        ),
      );
      expect(sqlState(error)).toBe('CO001');
    });

    it('refuses to alter or remove a result belonging to a finalized run', async () => {
      const updateError = await rejection(() =>
        app.withTenant(tenantA.tenantId, async (db) =>
          db.query(`UPDATE evaluation_results SET status = 'PASS' WHERE id = $1`, [
            tenantA.evaluationResultId,
          ]),
        ),
      );
      expect(sqlState(updateError)).toBe('CO001');

      const deleteError = await rejection(() =>
        app.withTenant(tenantA.tenantId, async (db) =>
          db.query('DELETE FROM findings WHERE id = $1', [tenantA.findingId]),
        ),
      );
      expect(sqlState(deleteError)).toBe('CO001');
    });

    it('refuses to append a new finding to a finalized run', async () => {
      const error = await rejection(() =>
        app.withTenant(tenantA.tenantId, async (db) =>
          db.query(
            `INSERT INTO evaluation_results
               (tenant_id, assessment_run_id, rule_version_id, subject_type, subject_id,
                status, severity, explanation, evaluation_hash)
             VALUES ($1, $2, $3, 'FISCAL_YEAR', 'late', 'FAIL', 'HIGH', 'late arrival', $4)`,
            [tenantA.tenantId, tenantA.runId, ruleVersionId, hash('9')],
          ),
        ),
      );
      expect(sqlState(error)).toBe('CO001');
    });

    it('will not generate a report from a run that is not finalized (section 22)', async () => {
      const openRunId = randomUUID();
      await asOwner(tenantB.tenantId, async () => {
        await owner.query(
          `INSERT INTO assessment_runs
             (tenant_id, id, organization_id, module, scope_type, program_year_kind,
              program_year_label, rule_pack_version_id, engine_version, data_snapshot_id, status)
           SELECT $1, $2, $3, 'IDEA_FISCAL', 'ORGANIZATION', 'FISCAL', 'FY2029', $4, '1.0.0',
                  ds.id, 'COMPLETED'
             FROM data_snapshots ds
            WHERE ds.tenant_id = $1
            LIMIT 1`,
          [tenantB.tenantId, openRunId, tenantB.organizationId, packVersionId],
        );
      });

      const error = await rejection(() =>
        app.withTenant(tenantB.tenantId, async (db) =>
          db.query(
            `INSERT INTO report_runs (tenant_id, assessment_run_id, report_type, format)
             VALUES ($1, $2, 'IDEA_FISCAL_PACK', 'PDF')`,
            [tenantB.tenantId, openRunId],
          ),
        ),
      );
      expect(sqlState(error)).toBe('CO004');
    });
  });

  describe('the audit log is append-only (section 21)', () => {
    const eventId = randomUUID();

    it('accepts an appended event', async () => {
      await app.withTenant(tenantA.tenantId, async (db) =>
        db.query(
          `INSERT INTO audit_events
             (tenant_id, id, sequence_no, actor_type, action, object_type, object_id,
              request_id, previous_event_hash, event_hash)
           VALUES ($1, $2, 1, 'SYSTEM', 'ASSESSMENT_RUN.FINALIZED', 'assessment_run', $3,
                   'req-1', $4, $5)`,
          [tenantA.tenantId, eventId, tenantA.runId, hash('c'), hash('d')],
        ),
      );
      const count = await app.withTenant(tenantA.tenantId, async (db) => {
        const result = await db.query('SELECT 1 FROM audit_events WHERE id = $1', [eventId]);
        return result.rowCount;
      });
      expect(count).toBe(1);
    });

    it('refuses a second event at the same chain position', async () => {
      const error = await rejection(() =>
        app.withTenant(tenantA.tenantId, async (db) =>
          db.query(
            `INSERT INTO audit_events
               (tenant_id, sequence_no, actor_type, action, object_type, object_id,
                request_id, previous_event_hash, event_hash)
             VALUES ($1, 1, 'SYSTEM', 'FORK', 'assessment_run', 'x', 'req-2', $2, $3)`,
            [tenantA.tenantId, hash('c'), hash('e')],
          ),
        ),
      );
      // A fork of the chain would verify perfectly in isolation, which is exactly why the
      // unique constraint has to refuse it rather than the application noticing later.
      expect(sqlState(error)).toBe('23505');
    });

    it('denies the application role UPDATE and DELETE outright', async () => {
      for (const statement of [
        `UPDATE audit_events SET action = 'REDACTED' WHERE id = $1`,
        'DELETE FROM audit_events WHERE id = $1',
      ]) {
        const error = await rejection(() =>
          app.withTenant(tenantA.tenantId, async (db) => db.query(statement, [eventId])),
        );
        expect(sqlState(error), statement).toBe('42501');
      }
    });

    it('raises from the trigger even for a role holding the privilege', async () => {
      // Privileges are the first layer; the trigger is the second, and it catches the owner
      // too. TRUNCATE is the sharpest demonstration: it is not row-filtered by RLS, so
      // nothing but the trigger stands between an owner-level mistake and an empty log.
      await owner.query('BEGIN');
      let code: string | undefined;
      try {
        await owner.query('TRUNCATE audit_events');
      } catch (error) {
        code = sqlState(error);
      }
      await owner.query('ROLLBACK');
      expect(code).toBe('CO002');
    });

    it('refuses an event written under a foreign tenant id', async () => {
      const error = await rejection(() =>
        app.withTenant(tenantA.tenantId, async (db) =>
          db.query(
            `INSERT INTO audit_events
               (tenant_id, sequence_no, actor_type, action, object_type, object_id,
                request_id, previous_event_hash, event_hash)
             VALUES ($1, 99, 'SYSTEM', 'PLANTED', 'organization', 'x', 'req-3', $2, $3)`,
            [tenantB.tenantId, hash('c'), hash('f')],
          ),
        ),
      );
      expect(sqlState(error)).toBe('42501');
    });
  });

  describe('an ACTIVE rule version cannot be edited (invariant 4)', () => {
    it('refuses to change the logic of an active version', async () => {
      await owner.query('BEGIN');
      let code: string | undefined;
      try {
        await owner.query(
          `UPDATE rule_versions SET logic = '{"changed":true}'::jsonb WHERE id = $1`,
          [ruleVersionId],
        );
      } catch (error) {
        code = sqlState(error);
      }
      await owner.query('ROLLBACK');
      expect(code).toBe('CO003');
    });

    it('permits the supersession bookkeeping and nothing else', async () => {
      const successorId = randomUUID();
      await owner.query('BEGIN');
      try {
        await owner.query(
          `INSERT INTO rule_versions
             (id, rule_id, rule_pack_version_id, version, lifecycle, severity,
              authority_citation, source_id, logic, explanation_template, content_hash,
              effective_start_on)
           VALUES ($1, 'RULE-MOE-1', $2, 2, 'STAGED', 'HIGH', '34 CFR 300.203', 'REG-MOE',
                   '{}'::jsonb, 'moe', $3, DATE '2026-07-01')`,
          [successorId, packVersionId, hash('7')],
        );
        const updated = await owner.query(
          `UPDATE rule_versions
              SET lifecycle = 'SUPERSEDED', superseded_by_version_id = $2
            WHERE id = $1`,
          [ruleVersionId, successorId],
        );
        expect(updated.rowCount).toBe(1);
      } finally {
        await owner.query('ROLLBACK');
      }
    });
  });
});

/* ------------------------------------------------------- the migration runner -- */

const runnerTitle =
  DATABASE_URL === undefined
    ? 'the migration runner [SKIPPED: set DATABASE_URL to run]'
    : 'the migration runner';

const runnerSuite = DATABASE_URL === undefined ? describe.skip : describe;

runnerSuite(runnerTitle, () => {
  it('refuses a migration that has changed since it was applied', async () => {
    const url = DATABASE_URL as string;
    const { migrate, MigrationError } = await import('./migrate.js');
    const directory = await mkdtemp(path.join(tmpdir(), 'complianceos-migrations-'));
    const file = path.join(directory, '0001_probe.sql');
    const schema = `probe_${randomUUID().replace(/-/g, '')}`;

    const pg = (await import('pg')).default;
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();

    try {
      await writeFile(file, 'CREATE TABLE probe_one (id integer PRIMARY KEY);\n', 'utf8');
      const first = await migrate({ connectionString: url, schema, directory });
      expect(first.applied).toEqual(['0001_probe.sql']);

      const second = await migrate({ connectionString: url, schema, directory });
      expect(second.applied).toEqual([]);
      expect(second.alreadyApplied).toEqual(['0001_probe.sql']);

      // Somebody "fixes" an applied migration in place. Every environment provisioned
      // before the edit now differs from every one provisioned after, and nothing else in
      // the system would notice.
      await writeFile(file, 'CREATE TABLE probe_one (id bigint PRIMARY KEY);\n', 'utf8');
      await expect(migrate({ connectionString: url, schema, directory })).rejects.toThrow(
        MigrationError,
      );
      await expect(migrate({ connectionString: url, schema, directory })).rejects.toThrow(
        /has changed since it was applied/,
      );
    } finally {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  }, 60_000);
});
