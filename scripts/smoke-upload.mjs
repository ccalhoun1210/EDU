/**
 * Upload a district export over real HTTP and check what actually landed in the database.
 *
 * Spec: Master Technical Buildout sections 10, 11 and 24. CLAUDE.md invariants 3, 4 and 7.
 *
 * `smoke-auth.mjs` proves the session is wired to the database. This proves the other half:
 * that a file posted by a signed-in officer becomes rows, and that the assessment page then
 * reads those rows rather than recomputing an answer.
 *
 * Every piece below has unit tests. `persistImport` is tested against Postgres, the pipeline
 * is tested in memory, the page's sentences are tested against fixtures. None of that catches
 * the failure this script exists for: a route that never calls the store, a page that renders
 * the worked example over a real district's run, a mapping template whose columns no longer
 * match the CSV a district would actually send. Each of those passes every unit suite.
 *
 * The assertions are deliberately split between what the browser sees and what the database
 * holds, because the interesting failures show up in exactly one of the two. A page that says
 * "stored" while nothing was written is the failure mode worth the whole script.
 *
 * Usage: pnpm smoke:upload   (run after `pnpm build`, with DATABASE_URL set)
 */

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DATABASE_URL = process.env.DATABASE_URL;

if (DATABASE_URL === undefined) {
  if (process.env.REQUIRE_DATABASE_TESTS !== undefined) {
    console.error(
      'REQUIRE_DATABASE_TESTS is set but DATABASE_URL is not. The upload path would go ' +
        'unchecked, which looks exactly like it passing.',
    );
    process.exit(1);
  }
  console.log('smoke:upload SKIPPED — set DATABASE_URL to a Postgres superuser connection string.');
  process.exit(0);
}

const PORT = Number(process.env.SMOKE_UPLOAD_PORT ?? 3212);
const BASE = `http://127.0.0.1:${PORT}`;
const SCHEMA = `smokeupload_${randomUUID().replace(/-/g, '')}`;
const APP_PASSWORD = 'smoke-upload-only';
const SESSION_SECRET = 'smoke-upload-secret-that-is-long-enough';

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const pg = (await import('pg')).default;
const MIGRATIONS = new URL('../packages/db/migrations/', import.meta.url);
const REPO = new URL('../', import.meta.url);

/**
 * A district fiscal export, in the columns the mapping template names.
 *
 * Synthetic, like every fixture in this repository: Northfield Consolidated does not exist
 * and every figure is invented. It is a copy of `NORTHFIELD_EXPORT_CSV` rather than an import
 * of it, because a plain Node script cannot import the workspace packages' TypeScript source
 * — and because a smoke test posting bytes the product was built around is not testing the
 * same thing as one posting bytes a district would type. If the template changes and this
 * file does not, the upload fails here, which is the point.
 */
const EXPORT_CSV =
  [
    'LEA ID,LEA Name,Fiscal Year,Fiscal Year End,Basis,Comparison FY,Comparison Local Actual,' +
      'Comparison State+Local Actual,Comparison Child Count,Local Actual,State+Local Actual,' +
      'Child Count,Part B Subgrant,Federal Funds Excluded,Serves Elementary,Serves Secondary,' +
      'Prior FY,Elem Total Exp,Elem Capital Outlay,Elem Debt Service,Elem Part B Exp,' +
      'Elem Title I A Exp,Elem Title III Exp,Elem SPED State Local,Elem ESEA State Local,' +
      'Elem Enrollment,Elem Children With Disabilities,Elem Non Part B Spend,Sec Total Exp,' +
      'Sec Capital Outlay,Sec Debt Service,Sec Part B Exp,Sec Title I A Exp,Sec Title III Exp,' +
      'Sec SPED State Local,Sec ESEA State Local,Sec Enrollment,Sec Children With Disabilities,' +
      'Sec Non Part B Spend',
    'LEA-0417,"Smoke Consolidated School District, Unit 3",FY2026,2026-06-30,ACTUAL_EXPENDITURE,' +
      'FY2025,"$4,900,000.00","$7,850,000.00",991,"$4,830,000.00","$7,975,000.00",1004,' +
      '"$1,450,000.00",Yes,Yes,Yes,FY2025,"$21,400,000.00","$1,100,000.00","$350,000.00",' +
      '"$1,050,000.00","$820,000.00","$140,000.00","$3,900,000.00","$260,000.00",4120,612,' +
      '"$16,140,000.00","$18,900,000.00","$900,000.00","$300,000.00","$980,000.00",' +
      '"$610,000.00","$95,000.00","$3,300,000.00","$210,000.00",3480,498,"$14,105,000.00"',
  ].join('\n') + '\n';

const EXPORT_SHA = createHash('sha256').update(Buffer.from(EXPORT_CSV, 'utf8')).digest('hex');

async function applyMigrations(client, schema) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  const files = (await readdir(MIGRATIONS)).filter((name) => name.endsWith('.sql')).sort();
  if (files.length === 0) throw new Error(`no migrations found in ${MIGRATIONS.pathname}`);
  for (const file of files) {
    await client.query(await readFile(path.join(MIGRATIONS.pathname, file), 'utf8'));
  }
}

/**
 * Publish the rule packs by running the real script.
 *
 * Not a hand-written INSERT. A run cannot be stored against content the database has never
 * seen, so `db:publish:rulepack` is a load-bearing part of the deployment procedure — and a
 * smoke test that seeded the content itself would keep passing after that script broke.
 */
function publishRulePacks(schema) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--conditions=dist', 'scripts/publish-rulepack.mjs', '--schema', schema],
      {
        cwd: REPO.pathname,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DATABASE_URL_UNPOOLED: DATABASE_URL },
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`publish-rulepack failed:\n${output}`)),
    );
  });
}

const tenantId = randomUUID();
const organizationId = randomUUID();
const fiscalUserId = randomUUID();
const readonlyUserId = randomUUID();
const FISCAL_SUBJECT = 'sub-smoke-fiscal';
const READONLY_SUBJECT = 'sub-smoke-readonly';
const FISCAL_NAME = 'Smoke Fiscal Officer';
const READONLY_NAME = 'Smoke Read Only';

let owner;
let server;
let serverOutput = '';

async function asOwner(tenant, statements) {
  await owner.query('BEGIN');
  await owner.query('SELECT set_config($1, $2, true)', ['complianceos.tenant_id', tenant]);
  try {
    await statements();
    await owner.query('COMMIT');
  } catch (error) {
    await owner.query('ROLLBACK');
    throw error;
  }
}

/** Read a single value under tenant context, for the "did it actually land" assertions. */
async function scalar(sql, params = []) {
  let value;
  await asOwner(tenantId, async () => {
    const result = await owner.query(sql, params);
    value = result.rows[0];
  });
  return value;
}

function sessionCookie(response) {
  for (const line of response.headers.getSetCookie?.() ?? []) {
    if (!line.startsWith('__Host-complianceos_session=')) continue;
    return line.slice('__Host-complianceos_session='.length).split(';')[0] ?? '';
  }
  return undefined;
}

const withCookie = (cookie) =>
  cookie === undefined ? {} : { cookie: `__Host-complianceos_session=${cookie}` };

async function signIn(handle) {
  const response = await fetch(`${BASE}/api/auth/sign-in`, {
    method: 'POST',
    redirect: 'manual',
    headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ handle }),
  });
  return sessionCookie(response);
}

async function postExport(cookie, csv = EXPORT_CSV, fileName = 'smoke-fiscal-fy2026.csv') {
  const form = new FormData();
  form.set('export', new File([csv], fileName, { type: 'text/csv' }));
  return fetch(`${BASE}/api/district-export`, {
    method: 'POST',
    redirect: 'manual',
    headers: { origin: BASE, ...withCookie(cookie) },
    body: form,
  });
}

/** The `upload` code a redirect carries back, which is the route's whole answer. */
function outcomeOf(response) {
  const location = response.headers.get('location') ?? '';
  return new URL(location, BASE).searchParams.get('upload');
}

async function waitForReady() {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`server exited early:\n${serverOutput}`);
    try {
      await fetch(`${BASE}/sign-in`, { signal: AbortSignal.timeout(2000) });
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`server never became ready on ${BASE}:\n${serverOutput}`);
}

function stopServer() {
  if (server?.pid === undefined || server.exitCode !== null) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // Already gone; failing here would mask the real result.
  }
}

try {
  // ---------------------------------------------------------------- schema and seed --
  owner = new pg.Client({ connectionString: DATABASE_URL });
  await owner.connect();
  await applyMigrations(owner, SCHEMA);
  await owner.query(`ALTER ROLE complianceos_app WITH LOGIN PASSWORD '${APP_PASSWORD}'`);
  await publishRulePacks(SCHEMA);

  await owner.query('INSERT INTO tenants (id, slug, display_name) VALUES ($1, $2, $3)', [
    tenantId,
    'smoke-upload',
    'Smoke Upload District',
  ]);

  await asOwner(tenantId, async () => {
    await owner.query(
      `INSERT INTO organizations
         (tenant_id, id, organization_type, legal_name, state_code, state_agency_id)
       VALUES ($1, $2, 'LEA_DISTRICT', 'Smoke Consolidated School District', 'AL', 'smoke-up-1')`,
      [tenantId, organizationId],
    );

    // Two people who differ in exactly the way the upload route is supposed to notice: one
    // may configure, one may not. A single all-powerful user would let the check through.
    for (const [userId, subject, name, mayConfigure, role] of [
      [fiscalUserId, FISCAL_SUBJECT, FISCAL_NAME, true, 'FISCAL_OFFICER'],
      [readonlyUserId, READONLY_SUBJECT, READONLY_NAME, false, 'READ_ONLY'],
    ]) {
      await owner.query(
        `INSERT INTO users (tenant_id, id, subject_id, email, display_name, status, mfa_enrolled)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', true)`,
        [tenantId, userId, subject, `${subject}@smoke.invalid`, name],
      );
      const membershipId = randomUUID();
      await owner.query(
        `INSERT INTO memberships
           (tenant_id, id, user_id, role, may_export, may_read_student_identity, may_configure)
         VALUES ($1, $2, $3, $4, true, false, $5)`,
        [tenantId, membershipId, userId, role, mayConfigure],
      );
      await owner.query(
        `INSERT INTO access_scopes
           (tenant_id, id, membership_id, organization_id, school_site_id, module)
         VALUES ($1, $2, $3, $4, NULL, 'IDEA_FISCAL')`,
        [tenantId, randomUUID(), membershipId, organizationId],
      );
    }
  });

  // ------------------------------------------------------------------- start server --
  const appUrl = new URL(DATABASE_URL);
  appUrl.username = 'complianceos_app';
  appUrl.password = APP_PASSWORD;
  appUrl.searchParams.set('options', `-c search_path=${SCHEMA}`);

  server = spawn('next', ['start', '-p', String(PORT)], {
    cwd: new URL('../apps/web/', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: {
      ...process.env,
      NO_PROXY: '*',
      no_proxy: '*',
      DATABASE_URL: appUrl.toString(),
      SESSION_SECRET,
      DEMO_TENANT_ID: tenantId,
      VERCEL_ENV: 'development',
      // No scanner exists anywhere in this repository, so the alternative to this flag is a
      // smoke test that can only ever assert a refusal. Set here and nowhere else, which is
      // itself the assertion that the default refuses.
      UPLOAD_ACCEPT_UNSCANNED: 'true',
    },
  });
  server.stdout.on('data', (chunk) => (serverOutput += chunk));
  server.stderr.on('data', (chunk) => (serverOutput += chunk));

  await waitForReady();

  // ---------------------------------------------------------------- who may upload --
  const anonymous = await postExport(undefined);
  check(
    outcomeOf(anonymous) === 'signed-out',
    `an anonymous upload got ${outcomeOf(anonymous)}, expected signed-out`,
  );

  const forged = await fetch(`${BASE}/api/district-export`, {
    method: 'POST',
    redirect: 'manual',
    headers: { origin: 'https://evil.example' },
    body: new FormData(),
  });
  check(forged.status === 403, `a cross-origin upload got ${forged.status}, expected 403`);

  const readonlyCookie = await signIn(READONLY_SUBJECT);
  check(readonlyCookie !== undefined, 'the read-only user could not sign in');
  const readonlyUpload = await postExport(readonlyCookie);
  check(
    outcomeOf(readonlyUpload) === 'not-permitted',
    `a read-only user's upload got ${outcomeOf(readonlyUpload)}, expected not-permitted`,
  );

  const nothingYet = await scalar('SELECT count(*)::int AS n FROM import_jobs');
  check(
    nothingYet?.n === 0,
    `${nothingYet?.n} import job(s) exist after only refused uploads — a refusal wrote rows`,
  );

  // ------------------------------------------------------------------- a real upload --
  const cookie = await signIn(FISCAL_SUBJECT);
  check(cookie !== undefined, 'the fiscal officer could not sign in');

  const uploaded = await postExport(cookie);
  check(uploaded.status === 303, `the upload returned ${uploaded.status}, expected a 303`);
  check(
    outcomeOf(uploaded) === 'stored',
    `the upload got ${outcomeOf(uploaded)}, expected stored. Server log:\n${serverOutput.slice(-2000)}`,
  );

  // ------------------------------------------------- what actually landed in the rows --
  const file = await scalar(
    `SELECT f.file_name, f.content_hash, f.scan_status, f.scanner,
            octet_length(f.content) AS bytes, f.row_count
       FROM import_files f`,
  );
  check(file !== undefined, 'no import_files row was written');
  check(file?.content_hash === EXPORT_SHA, 'the stored content hash is not the hash of the bytes');
  check(
    Number(file?.bytes) === Buffer.byteLength(EXPORT_CSV, 'utf8'),
    'the stored bytes are not the bytes that were posted',
  );
  check(
    file?.scan_status === 'NOT_SCANNED' && file?.scanner === 'none-configured',
    `the import records scan status ${file?.scan_status} by ${file?.scanner} — a deployment ` +
      'with no scanner must not record a verdict it never reached',
  );
  check(Number(file?.row_count) === 1, `the import recorded ${file?.row_count} rows, expected 1`);

  const chain = await scalar(
    `SELECT (SELECT count(*)::int FROM raw_records) AS rows_,
            (SELECT count(*)::int FROM canonical_facts) AS facts,
            (SELECT count(*)::int FROM fact_provenance) AS provenance,
            (SELECT count(*)::int FROM fact_provenance WHERE raw_record_id IS NULL) AS orphans,
            (SELECT count(*)::int FROM data_snapshots) AS snapshots,
            (SELECT count(*)::int FROM data_snapshot_facts) AS sealed,
            (SELECT count(*)::int FROM assessment_runs) AS runs,
            (SELECT count(*)::int FROM evaluation_results) AS results,
            (SELECT count(*)::int FROM evaluation_result_inputs) AS inputs`,
  );
  check(chain?.rows_ === 1, `${chain?.rows_} raw records, expected 1`);
  check(chain?.facts > 0, 'no canonical facts were written, so nothing was actually ingested');
  check(
    chain?.provenance === chain?.facts,
    `${chain?.provenance} provenance rows for ${chain?.facts} facts — invariant 3 says every ` +
      'fact names where it came from',
  );
  check(
    chain?.orphans === 0,
    `${chain?.orphans} fact(s) point at no source record, which is a fact from nowhere`,
  );
  check(chain?.sealed === chain?.facts, 'the snapshot does not seal every fact that was written');
  check(chain?.snapshots === 1 && chain?.runs === 1, 'the run and its snapshot were not stored');
  check(chain?.results > 0, 'the run stored no results');
  check(
    chain?.inputs > 0,
    'no result names the facts it read — a finding whose inputs are not linked is the one ' +
      'invariant 3 says must not be creatable',
  );

  // Invariant 5, through the whole stack: the district wrote "$4,830,000.00" and the database
  // holds that exact decimal, compared in SQL rather than through a JavaScript number.
  const money = await scalar(
    `SELECT numeric_value = 4830000.00 AS exact
       FROM canonical_facts
      WHERE numeric_value = 4830000.00
      LIMIT 1`,
  );
  check(
    money?.exact === true,
    'the local expenditure figure did not survive as an exact decimal, so something on the ' +
      'path floated it',
  );

  // ---------------------------------------------------- the page reads what was stored --
  const page = await (await fetch(`${BASE}/assessment`, { headers: withCookie(cookie) })).text();
  const run = await scalar('SELECT id, data_snapshot_id FROM assessment_runs LIMIT 1');
  check(
    page.includes(run?.id ?? 'no-run'),
    'the assessment does not show the stored run id, so it is not rendering the stored run',
  );
  check(
    page.includes(run?.data_snapshot_id ?? 'no-snapshot'),
    'the assessment does not name the snapshot the stored run was evaluated against',
  );
  check(
    !page.includes('Northfield Consolidated'),
    'the assessment still shows the worked example over a district that has a real run',
  );
  check(
    !page.includes('no district export has been uploaded'),
    'the assessment still tells the officer nothing has been uploaded',
  );

  // ------------------------------------------------------------- the same file, again --
  const duplicate = await postExport(cookie);
  check(
    outcomeOf(duplicate) === 'already-imported',
    `re-posting identical bytes got ${outcomeOf(duplicate)}, expected already-imported`,
  );
  const afterDuplicate = await scalar('SELECT count(*)::int AS n FROM import_jobs');
  check(
    afterDuplicate?.n === 1,
    `${afterDuplicate?.n} import jobs after re-posting the same file — the idempotency key is ` +
      'not stopping a retried upload from producing a second assessment',
  );

  // ------------------------------------------------------------------ an unusable file --
  const garbage = await postExport(cookie, 'not,a,fiscal,export\n1,2,3,4\n', 'wrong.csv');
  check(
    outcomeOf(garbage) === 'rejected',
    `a file with none of the expected columns got ${outcomeOf(garbage)}, expected rejected`,
  );
  const afterGarbage = await scalar(
    `SELECT (SELECT count(*)::int FROM assessment_runs) AS runs,
            (SELECT count(*)::int FROM data_snapshots) AS snapshots`,
  );
  check(
    afterGarbage?.runs === 1 && afterGarbage?.snapshots === 1,
    'an unusable file produced a run or a snapshot — nothing may be inferred from a partial read',
  );
} finally {
  stopServer();
  if (owner !== undefined) {
    await owner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`).catch(() => undefined);
    await owner.end().catch(() => undefined);
  }
}

if (failures.length > 0) {
  console.error(`Upload smoke test failed:\n${failures.map((line) => `  - ${line}`).join('\n')}`);
  if (serverOutput.trim().length > 0) console.error(`\nServer log:\n${serverOutput.slice(-4000)}`);
  process.exit(1);
}

console.log(
  'Upload smoke test passed: a signed-in officer posted an export, every fact landed with the ' +
    'row it came from, the run and its result inputs were stored, the page rendered the stored ' +
    'run rather than the worked example, a re-post was refused, and a read-only user was too.',
);
process.exit(0);
