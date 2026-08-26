/**
 * Seed one district, so a freshly migrated database has something to sign in to.
 *
 * Spec: Master Technical Buildout section 18.
 *
 * This is provisioning, not fixture data. It writes the rows an administrator would
 * otherwise create by hand — a tenant, an organization, and three people with different
 * grants — and stops there. It writes no fiscal figures, no snapshots and no runs, because
 * those arrive through the ingestion pipeline with provenance attached and inventing them
 * here would put rows in `canonical_facts` that no file ever produced.
 *
 * ## Three users, deliberately different
 *
 * A single all-powerful user would let every authorization bug through. These three differ
 * in exactly the ways the resolver is supposed to notice:
 *
 *   director  — Special Education Director, may export, no student identity. The ordinary case.
 *   fiscal    — Fiscal Officer, may export and configure. A second role on the same tenant.
 *   readonly  — Read Only, no capabilities at all, and scoped to one school rather than the
 *               whole organization. If the site-narrowing logic breaks, this user sees too much.
 *
 * ## Idempotent
 *
 * Re-running must not create a second Northfield or fail on a unique constraint, because the
 * realistic use is running it again after a migration. Every insert is `ON CONFLICT DO
 * NOTHING` against a natural key, and the ids are derived from fixed UUIDs rather than
 * generated, so a second run finds the same rows and changes nothing.
 *
 * ## Usage
 *
 *   DATABASE_URL_UNPOOLED=postgres://owner:...@host/db pnpm db:seed:demo
 *
 * It prints the DEMO_TENANT_ID to set. Run it against a development or preview database;
 * it refuses nothing, but a production tenant should be provisioned through the product.
 */

import { env, exit } from 'node:process';

const connectionString = env['DATABASE_URL_UNPOOLED'] ?? env['DATABASE_URL'];

if (connectionString === undefined) {
  console.error('No database URL. Set DATABASE_URL_UNPOOLED. See .env.example.');
  exit(1);
}

/**
 * Fixed ids, so re-running is a no-op and so the printed DEMO_TENANT_ID never changes.
 *
 * Version 4 UUIDs generated once and written down, not `gen_random_uuid()`: a seed whose
 * tenant id changed on every run would mean re-editing the deployment's environment
 * variables every time somebody re-seeded.
 */
const TENANT_ID = '4f2b1c8e-6a3d-4e51-9b27-0c8d5e1a7f43';
const ORGANIZATION_ID = 'a1d94e77-2b6c-4f38-8e05-3c7a9b1d6e24';
const SITE_ID = 'c8e63f10-9d47-4a25-b1f8-2e5c7a04d9b6';

const USERS = [
  {
    id: '7b3e2d95-1f84-4c60-a72d-8e91b5c3f0a7',
    membershipId: '2c74a8f6-5b19-4d3e-8067-b1e4f92d7c58',
    subjectId: 'demo|director',
    email: 'director@northfield.invalid',
    displayName: 'Dana Whitfield',
    role: 'SPECIAL_EDUCATION_DIRECTOR',
    mayExport: true,
    mayReadStudentIdentity: false,
    mayConfigure: false,
    siteScoped: false,
  },
  {
    id: '9d51c47a-3e28-4b96-8f13-6a7e0b2d5c94',
    membershipId: 'e6b02f38-7c45-4a19-9d82-1f3b8e5a0dc7',
    subjectId: 'demo|fiscal',
    email: 'csfo@northfield.invalid',
    displayName: 'Marcus Oyelaran',
    role: 'FISCAL_OFFICER',
    mayExport: true,
    mayReadStudentIdentity: false,
    mayConfigure: true,
    siteScoped: false,
  },
  {
    id: 'b4f78e26-0a93-4d17-85c6-9e2b7f14a3d8',
    membershipId: '5a19d3c7-8e42-4f60-b93a-2d75c8e1f406',
    subjectId: 'demo|readonly',
    email: 'reviewer@northfield.invalid',
    displayName: 'Priya Raghunathan',
    role: 'READ_ONLY',
    mayExport: false,
    mayReadStudentIdentity: false,
    mayConfigure: false,
    siteScoped: true,
  },
];

const pg = (await import('pg')).default;
const client = new pg.Client({ connectionString });
await client.connect();

/** Every seeded table is FORCE RLS, so even the owner needs tenant context set. */
async function inTenant(work) {
  await client.query('BEGIN');
  await client.query('SELECT set_config($1, $2, true)', ['complianceos.tenant_id', TENANT_ID]);
  try {
    await work();
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

try {
  await client.query(
    `INSERT INTO tenants (id, slug, display_name)
     VALUES ($1, 'northfield', 'Northfield Consolidated School District')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_ID],
  );

  await inTenant(async () => {
    await client.query(
      `INSERT INTO organizations
         (tenant_id, id, organization_type, legal_name, state_code, state_agency_id)
       VALUES ($1, $2, 'LEA_DISTRICT', 'Northfield Consolidated School District', 'AL', 'NF-001')
       ON CONFLICT (tenant_id, id) DO NOTHING`,
      [TENANT_ID, ORGANIZATION_ID],
    );

    await client.query(
      `INSERT INTO schools_sites (tenant_id, id, organization_id, site_name, state_school_id)
       VALUES ($1, $2, $3, 'Northfield High School', 'NF-HS-01')
       ON CONFLICT (tenant_id, id) DO NOTHING`,
      [TENANT_ID, SITE_ID, ORGANIZATION_ID],
    );

    for (const user of USERS) {
      await client.query(
        `INSERT INTO users
           (tenant_id, id, subject_id, email, display_name, status, mfa_enrolled)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', true)
         ON CONFLICT (tenant_id, subject_id) DO NOTHING`,
        [TENANT_ID, user.id, user.subjectId, user.email, user.displayName],
      );

      await client.query(
        `INSERT INTO memberships
           (tenant_id, id, user_id, role, may_export, may_read_student_identity, may_configure)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, user_id, role) DO NOTHING`,
        [
          TENANT_ID,
          user.membershipId,
          user.id,
          user.role,
          user.mayExport,
          user.mayReadStudentIdentity,
          user.mayConfigure,
        ],
      );

      // The read-only reviewer is narrowed to one site; the others hold the whole
      // organization. A NULL school_site_id means every site, per the schema's comment.
      await client.query(
        `INSERT INTO access_scopes
           (tenant_id, id, membership_id, organization_id, school_site_id, module)
         SELECT $1, $2, $3, $4, $5, 'IDEA_FISCAL'
          WHERE NOT EXISTS (
                SELECT 1 FROM access_scopes
                 WHERE tenant_id = $1 AND membership_id = $3 AND revoked_at IS NULL
              )`,
        [
          TENANT_ID,
          // Derived from the membership id so a re-run collides with itself rather than
          // adding a duplicate scope.
          user.membershipId.replace(/^.{8}/, 'aaaaaaaa'),
          user.membershipId,
          ORGANIZATION_ID,
          user.siteScoped ? SITE_ID : null,
        ],
      );
    }
  });

  // Counted inside a tenant transaction: every one of these tables is FORCE RLS, so the
  // same query outside one reports zero and the seed would claim to have written nothing.
  let row = {};
  await inTenant(async () => {
    const counts = await client.query(
      `SELECT
         (SELECT count(*) FROM users) AS users,
         (SELECT count(*) FROM memberships) AS memberships,
         (SELECT count(*) FROM access_scopes) AS scopes`,
    );
    row = counts.rows[0] ?? {};
  });

  console.log(
    `Seeded Northfield Consolidated School District.\n` +
      `  users: ${String(row.users ?? '?')}  memberships: ${String(row.memberships ?? '?')}  ` +
      `scopes: ${String(row.scopes ?? '?')}\n\n` +
      `Set these on the deployment:\n` +
      `  DEMO_TENANT_ID=${TENANT_ID}\n` +
      `  SESSION_SECRET=<openssl rand -base64 48>\n\n` +
      `The demonstration sign-in authenticates nobody and refuses to run in production.`,
  );
} catch (error) {
  console.error(`Seed failed:\n${String(error)}`);
  exit(1);
} finally {
  await client.end();
}
