/**
 * Sign in to a real database over real HTTP, and check what the session does and does not buy.
 *
 * Spec: Master Technical Buildout sections 18 and 19. CLAUDE.md invariant 7.
 *
 * `smoke-web.mjs` covers the unconnected deployment — no database, worked example, no
 * sign-in. This covers the other one, and it is the more important of the two, because the
 * claims being made are about authentication and tenant isolation rather than about
 * rendering. Unit tests already prove each piece in isolation; only this proves the pieces
 * are wired to each other. A sealer that verifies correctly and a page that never calls it
 * both pass their own suites.
 *
 * The case worth the whole script is the last one: suspend the user in the database and
 * watch the *same unexpired cookie* stop working on the next request. That is the design
 * claim of `session.ts` — authority is not in the token — asserted end to end through the
 * running server rather than against a function.
 *
 * Usage: pnpm smoke:auth   (run after `pnpm build`, with DATABASE_URL set)
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DATABASE_URL = process.env.DATABASE_URL;

if (DATABASE_URL === undefined) {
  if (process.env.REQUIRE_DATABASE_TESTS !== undefined) {
    console.error(
      'REQUIRE_DATABASE_TESTS is set but DATABASE_URL is not. The connected sign-in path ' +
        'would go unchecked, which looks exactly like it passing.',
    );
    process.exit(1);
  }
  console.log('smoke:auth SKIPPED — set DATABASE_URL to a Postgres superuser connection string.');
  process.exit(0);
}

const PORT = Number(process.env.SMOKE_AUTH_PORT ?? 3211);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = BASE;
const SCHEMA = `smokeauth_${randomUUID().replace(/-/g, '')}`;
const APP_PASSWORD = 'smoke-auth-only';
const SESSION_SECRET = 'smoke-auth-secret-that-is-long-enough-32';

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const pg = (await import('pg')).default;

/**
 * Apply the migrations directly rather than through `@complianceos/db`.
 *
 * The workspace packages export TypeScript source — that is what lets Next compile them from
 * source with no separate build step — so a plain Node script cannot import them. The
 * migrations are ordered `.sql` files and applying them in filename order is exactly what the
 * runner does; the bookkeeping it adds on top is for a database that persists, and this
 * schema is dropped in the `finally` below.
 */
const MIGRATIONS = new URL('../packages/db/migrations/', import.meta.url);

async function applyMigrations(client, schema) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  const files = (await readdir(MIGRATIONS)).filter((name) => name.endsWith('.sql')).sort();
  if (files.length === 0) throw new Error(`no migrations found in ${MIGRATIONS.pathname}`);
  for (const file of files) {
    await client.query(await readFile(path.join(MIGRATIONS.pathname, file), 'utf8'));
  }
}

/** Ids are minted here so the assertions can name the exact rows they expect. */
const tenantId = randomUUID();
const otherTenantId = randomUUID();
const organizationId = randomUUID();
const userId = randomUUID();
const membershipId = randomUUID();
const SUBJECT_ID = 'sub-smoke-director';
const DISPLAY_NAME = 'Smoke Test Director';

let owner;
let server;
let serverOutput = '';

/** Run statements as the schema owner with tenant context set, because tables are FORCEd. */
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

/**
 * The session cookie from a response, or undefined.
 *
 * Parsed by hand rather than with a cookie jar: the value is opaque and the only thing this
 * script needs from it is the ability to send it back, plus the ability to notice when the
 * server cleared it.
 */
function sessionCookie(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    if (!line.startsWith('__Host-complianceos_session=')) continue;
    const value = line.slice('__Host-complianceos_session='.length).split(';')[0] ?? '';
    return { value, line };
  }
  return undefined;
}

const withCookie = (cookie) =>
  cookie === undefined ? {} : { cookie: `__Host-complianceos_session=${cookie}` };

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

  for (const [id, slug] of [
    [tenantId, 'smoke-district'],
    [otherTenantId, 'other-district'],
  ]) {
    await owner.query('INSERT INTO tenants (id, slug, display_name) VALUES ($1, $2, $3)', [
      id,
      slug,
      `${slug} district`,
    ]);
  }

  await asOwner(tenantId, async () => {
    await owner.query(
      `INSERT INTO organizations
         (tenant_id, id, organization_type, legal_name, state_code, state_agency_id)
       VALUES ($1, $2, 'LEA_DISTRICT', 'Smoke School District', 'AL', 'smoke-1')`,
      [tenantId, organizationId],
    );
    await owner.query(
      `INSERT INTO users (tenant_id, id, subject_id, email, display_name, status, mfa_enrolled)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', true)`,
      [tenantId, userId, SUBJECT_ID, 'director@smoke.invalid', DISPLAY_NAME],
    );
    await owner.query(
      `INSERT INTO memberships
         (tenant_id, id, user_id, role, may_export, may_read_student_identity, may_configure)
       VALUES ($1, $2, $3, 'SPECIAL_EDUCATION_DIRECTOR', true, false, false)`,
      [tenantId, membershipId, userId],
    );
    await owner.query(
      `INSERT INTO access_scopes
         (tenant_id, id, membership_id, organization_id, school_site_id, module)
       VALUES ($1, $2, $3, $4, NULL, 'IDEA_FISCAL')`,
      [tenantId, randomUUID(), membershipId, organizationId],
    );
  });

  // A user in the other tenant, to prove the demo roster cannot reach across.
  await asOwner(otherTenantId, async () => {
    await owner.query(
      `INSERT INTO users (tenant_id, id, subject_id, email, display_name, status)
       VALUES ($1, $2, 'sub-other-director', 'director@other.invalid', 'Other Director', 'ACTIVE')`,
      [otherTenantId, randomUUID()],
    );
  });

  // ------------------------------------------------------------------- start server --
  // The app connects as the application role, with search_path carried on the connection
  // string so the deployment needs no schema setting of its own.
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
      // Explicitly not production, so the demonstration provider is allowed to exist.
      VERCEL_ENV: 'development',
    },
  });
  server.stdout.on('data', (chunk) => (serverOutput += chunk));
  server.stderr.on('data', (chunk) => (serverOutput += chunk));

  await waitForReady();

  // ------------------------------------------------------------- the roster is real --
  const signInPage = await (await fetch(`${BASE}/sign-in`)).text();
  check(
    signInPage.includes(DISPLAY_NAME),
    'the sign-in page does not offer the seeded user, so the roster is not being read',
  );
  check(
    !signInPage.includes('Sign-in is not available'),
    'the sign-in page reports no database, so the connected branch of config.ts is not taken',
  );
  check(
    !signInPage.includes('Other Director'),
    'the roster lists a user from another tenant — the demo roster is not tenant-scoped',
  );

  // ------------------------------------------------------------------- forged posts --
  const forged = await fetch(`${BASE}/api/auth/sign-in`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      origin: 'https://evil.example',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ handle: SUBJECT_ID }),
  });
  check(forged.status === 403, `a cross-origin sign-in post got ${forged.status}, expected 403`);
  check(
    sessionCookie(forged) === undefined,
    'a cross-origin sign-in post was issued a session cookie',
  );

  const originless = await fetch(`${BASE}/api/auth/sign-in`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ handle: SUBJECT_ID }),
  });
  check(originless.status === 403, `an origin-less sign-in post got ${originless.status}, not 403`);

  // -------------------------------------------------------------- an unknown handle --
  const unknown = await fetch(`${BASE}/api/auth/sign-in`, {
    method: 'POST',
    redirect: 'manual',
    headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ handle: 'sub-nobody' }),
  });
  check(
    unknown.status === 303 && (unknown.headers.get('location') ?? '').includes('error=refused'),
    'an unknown handle did not bounce back to the form with a refusal',
  );
  check(sessionCookie(unknown) === undefined, 'an unknown handle was issued a session cookie');

  // A user of another tenant is not on this roster, so their subject is just as unknown.
  const crossTenant = await fetch(`${BASE}/api/auth/sign-in`, {
    method: 'POST',
    redirect: 'manual',
    headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ handle: 'sub-other-director' }),
  });
  check(
    sessionCookie(crossTenant) === undefined,
    "another tenant's subject was signed in through this tenant's roster",
  );

  // ---------------------------------------------------------------- a real sign-in --
  const signedIn = await fetch(`${BASE}/api/auth/sign-in`, {
    method: 'POST',
    redirect: 'manual',
    headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ handle: SUBJECT_ID }),
  });
  const cookie = sessionCookie(signedIn);
  check(signedIn.status === 303, `sign-in returned ${signedIn.status}, expected a 303`);
  check(
    (signedIn.headers.get('location') ?? '').endsWith('/assessment'),
    'sign-in did not send the browser to the assessment',
  );
  check(cookie !== undefined, 'sign-in set no session cookie');

  if (cookie !== undefined) {
    check(cookie.line.includes('HttpOnly'), 'the session cookie is not HttpOnly');
    check(cookie.line.includes('Secure'), 'the session cookie is not Secure');
    check(/SameSite=Lax/i.test(cookie.line), 'the session cookie is not SameSite=Lax');
    check(
      !cookie.value.includes('EXPORT') && !cookie.value.includes('SPECIAL_EDUCATION'),
      'the session cookie appears to carry a capability or role — authority belongs in the ' +
        'database, not in the token',
    );
  }

  const value = cookie?.value;

  // -------------------------------------------------- the session changes what renders --
  const asSignedIn = await (
    await fetch(`${BASE}/assessment`, { headers: withCookie(value) })
  ).text();
  check(
    asSignedIn.includes(DISPLAY_NAME),
    'the assessment does not name the signed-in user in the masthead',
  );
  check(
    asSignedIn.includes('no district export has been uploaded'),
    'the assessment does not tell a signed-in officer why they are seeing a worked example',
  );

  const asAnonymous = await (await fetch(`${BASE}/assessment`)).text();
  check(
    asAnonymous.includes('because nobody is signed in'),
    'the assessment does not render the signed-out branch for an anonymous visitor',
  );
  check(
    !asAnonymous.includes(DISPLAY_NAME),
    'an anonymous request saw the signed-in user — a session leaked across requests',
  );

  // ------------------------------------------------------------------ a tampered cookie --
  if (value !== undefined) {
    // Flip a character in the signature half. The MAC no longer matches, so this must be
    // exactly as good as no cookie at all.
    const tampered = value.slice(0, -1) + (value.endsWith('A') ? 'B' : 'A');
    const withTampered = await (
      await fetch(`${BASE}/assessment`, { headers: withCookie(tampered) })
    ).text();
    check(
      !withTampered.includes(DISPLAY_NAME),
      'a tampered session cookie still rendered as signed in',
    );
  }

  // ------------------------------------------ revocation takes effect on the next request --
  // The claim session.ts is built around, through the running server: nothing is reissued,
  // nothing expires, and the same cookie stops working because the database changed.
  await asOwner(tenantId, async () => {
    await owner.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [userId]);
  });

  const afterSuspension = await (
    await fetch(`${BASE}/assessment`, { headers: withCookie(value) })
  ).text();
  check(
    !afterSuspension.includes(DISPLAY_NAME),
    'a suspended user kept their session — authority is being read from the token, not the ' +
      'database',
  );

  await asOwner(tenantId, async () => {
    await owner.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [userId]);
    await owner.query(`UPDATE memberships SET revoked_at = now() WHERE id = $1`, [membershipId]);
  });

  const afterRevocation = await (
    await fetch(`${BASE}/assessment`, { headers: withCookie(value) })
  ).text();
  check(
    !afterRevocation.includes(DISPLAY_NAME),
    'a user whose membership was revoked kept their session',
  );

  await asOwner(tenantId, async () => {
    await owner.query(`UPDATE memberships SET revoked_at = NULL WHERE id = $1`, [membershipId]);
  });

  // ---------------------------------------------------------------------- signing out --
  const signedOut = await fetch(`${BASE}/api/auth/sign-out`, {
    method: 'POST',
    redirect: 'manual',
    headers: { origin: ORIGIN, ...withCookie(value) },
  });
  check(signedOut.status === 303, `sign-out returned ${signedOut.status}, expected a 303`);
  const cleared = sessionCookie(signedOut);
  check(cleared !== undefined && cleared.value === '', 'sign-out did not clear the session cookie');

  const forgedSignOut = await fetch(`${BASE}/api/auth/sign-out`, {
    method: 'POST',
    redirect: 'manual',
    headers: { origin: 'https://evil.example', ...withCookie(value) },
  });
  check(
    forgedSignOut.status === 403,
    `a cross-origin sign-out got ${forgedSignOut.status}, expected 403`,
  );
} finally {
  stopServer();
  if (owner !== undefined) {
    await owner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`).catch(() => undefined);
    await owner.end().catch(() => undefined);
  }
}

if (failures.length > 0) {
  console.error(`Auth smoke test failed:\n${failures.map((line) => `  - ${line}`).join('\n')}`);
  if (serverOutput.trim().length > 0) console.error(`\nServer log:\n${serverOutput.slice(-4000)}`);
  process.exit(1);
}

console.log(
  'Auth smoke test passed: roster read from the database, cross-origin posts refused, ' +
    'session cookie hardened, and both suspension and revocation took effect on the next ' +
    'request without anything being reissued.',
);
process.exit(0);
