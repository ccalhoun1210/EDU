/**
 * Apply the schema to a database.
 *
 * Spec: Master Technical Buildout section 27. CLAUDE.md, "expand/contract migrations".
 *
 * `packages/db` has had a migration runner since it was written and no way to run it, which
 * meant the only things that ever applied the schema were tests against throwaway schemas.
 * A deployment needs this.
 *
 * ## Which URL
 *
 * The DIRECT (unpooled) URL, as the schema owner. Migrations create tables, roles and
 * policies, and a transaction-mode pooler is the wrong place to do that: `CREATE ROLE` and
 * advisory locks do not behave as expected when a connection can be handed to someone else
 * between statements. `DATABASE_URL_UNPOOLED` is preferred and `DATABASE_URL` is the
 * fallback, with a warning, because on Neon the pooled URL is the one people have to hand.
 *
 * The application role is deliberately NOT the role that runs this. It is `NOBYPASSRLS` and
 * owns nothing; if it could create tables it could create one without RLS, and the isolation
 * of the whole platform would rest on nobody ever doing that.
 *
 * ## Usage
 *
 *   DATABASE_URL_UNPOOLED=postgres://owner:...@host/db pnpm db:migrate
 *   ... pnpm db:migrate --schema complianceos     # into a named schema
 *
 * There is no --dry-run, deliberately: `migrate()` does not implement one, and a flag that
 * silently did nothing would be worse than its absence. The runner is idempotent and
 * reports what it applied, so running it is the dry run.
 */

import { argv, env, exit } from 'node:process';

function flag(name) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

const schema = typeof flag('schema') === 'string' ? flag('schema') : undefined;

const direct = env['DATABASE_URL_UNPOOLED'];
const pooled = env['DATABASE_URL'];
const connectionString = direct ?? pooled;

if (connectionString === undefined) {
  console.error(
    'No database URL. Set DATABASE_URL_UNPOOLED to the DIRECT connection string for the\n' +
      'schema owner. See .env.example.',
  );
  exit(1);
}

if (direct === undefined) {
  console.warn(
    'DATABASE_URL_UNPOOLED is not set, so DATABASE_URL is being used. If that is a pooled\n' +
      'endpoint, role and policy creation may behave unexpectedly — a transaction-mode pooler\n' +
      'can hand the connection to another session between statements.',
  );
}

/**
 * The runner is TypeScript, and the workspace packages export source rather than build
 * output so that Next can compile them directly. A plain Node script cannot import that, so
 * this uses the compiled output and says plainly what to run when it is absent — rather than
 * re-implementing the ordering and checksum bookkeeping, which is the part of the runner
 * that stops a migration being applied twice or a file being edited after the fact.
 */
let migrate;
try {
  ({ migrate } = await import('../packages/db/dist/migrate.js'));
} catch (error) {
  console.error(
    `Could not load the migration runner from packages/db/dist.\n` +
      `Run \`pnpm exec tsc --build\` first.\n\n${String(error)}`,
  );
  exit(1);
}

const options = { connectionString };
if (schema !== undefined) options.schema = schema;

try {
  const result = await migrate(options);
  const applied = result.applied ?? [];
  const already = result.alreadyApplied ?? [];

  if (applied.length === 0) {
    console.log(`Schema is up to date — ${String(already.length)} migration(s) already applied.`);
  } else {
    console.log(
      `Applied ${String(applied.length)} migration(s):\n` +
        applied.map((name) => `  ${name}`).join('\n'),
    );
    if (already.length > 0) console.log(`${String(already.length)} were already applied.`);
  }
} catch (error) {
  console.error(`Migration failed:\n${String(error)}`);
  exit(1);
}
