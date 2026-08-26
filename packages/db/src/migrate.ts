/**
 * The forward-only migration runner.
 *
 * Spec: Master Technical Buildout section 27 ("database changes"). CLAUDE.md's
 * expand/contract working agreement.
 *
 * Deliberately small, and deliberately not a framework. It applies numbered `.sql` files in
 * order, one transaction each, and records what it applied.
 *
 * ## Why every applied migration keeps its SHA-256
 *
 * A migration that has run is history. Editing one after the fact produces a repository
 * that no longer describes the database anyone is running — every environment provisioned
 * before the edit has the old schema, every one after has the new, and nothing detects the
 * divergence until something breaks in a way that makes no sense. So the checksum of each
 * file is stored when it is applied and re-checked on every subsequent run, and a mismatch
 * is a hard failure with the two hashes named. The fix for a mistake in an applied
 * migration is another migration, which is also what expand/contract requires.
 *
 * ## Why forward-only, with no `down`
 *
 * A rollback script for a schema carrying regulated data is a fiction: it can restore the
 * shape of a table, not the rows a destructive step removed. Section 27's sequence —
 * additive schema, compatible application, asynchronous backfill, switch, remove later — is
 * what makes a bad deployment survivable, and the removal step is itself a migration
 * shipped in a later release. There is nothing here to reverse because nothing here is
 * supposed to destroy anything.
 *
 * ## Concurrency
 *
 * Two deployments can start at the same moment. The runner takes a session-level advisory
 * lock before reading the ledger, so the second waits and then finds the first's work
 * already recorded rather than applying it twice.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import type { Client as PgClient } from 'pg';

const { Client } = pg;

/** The migrations directory, resolved relative to this module in both src and dist. */
export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../migrations');

/** `0003_audit_log.sql` — a four-digit version, an underscore, a lower_snake name. */
const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/**
 * An arbitrary but fixed key for `pg_advisory_lock`. Any constant works; it only has to be
 * the same in every process that migrates this database.
 */
const MIGRATION_LOCK_KEY = 8_531_207_461_003;

const SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;

export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly filename: string;
  readonly sql: string;
  /** Lowercase hex SHA-256 of the file's bytes. */
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly version: string;
  readonly filename: string;
  readonly checksum: string;
  readonly appliedAt: Date;
}

export interface MigrateOptions {
  /**
   * The DIRECT (unpooled) connection URL, as the schema owner. Migrations create tables,
   * roles and policies; the application role must never be able to do any of that.
   */
  readonly connectionString: string;
  /** Target schema. Created if absent. Defaults to the connection's `search_path`. */
  readonly schema?: string;
  readonly directory?: string;
}

export interface MigrateResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

export class MigrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MigrationError';
  }
}

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/**
 * Read and order the migration files.
 *
 * Rejects a duplicate version number and a gap in the sequence. Both are symptoms of the
 * same thing — two branches that each added "the next" migration — and the failure mode if
 * they are tolerated is that the two databases end up with different histories that both
 * look complete.
 */
export async function readMigrations(directory: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const entries = await readdir(directory);
  const migrations: Migration[] = [];

  for (const filename of entries.sort()) {
    if (!filename.endsWith('.sql')) continue;
    const match = MIGRATION_FILE.exec(filename);
    if (match === null) {
      throw new MigrationError(`${filename}: migration files are named NNNN_lower_snake_name.sql`);
    }
    const version = match[1];
    const name = match[2];
    // noUncheckedIndexedAccess: a successful match guarantees both groups, but the compiler
    // cannot know that, and asserting is cheaper to read than a non-null assertion.
    if (version === undefined || name === undefined) {
      throw new MigrationError(`${filename}: could not read the version and name`);
    }
    const sql = await readFile(path.join(directory, filename), 'utf8');
    migrations.push({ version, name, filename, sql, checksum: checksumOf(sql) });
  }

  migrations.sort((a, b) => a.version.localeCompare(b.version));

  migrations.forEach((migration, index) => {
    const expected = String(index + 1).padStart(4, '0');
    if (migration.version !== expected) {
      throw new MigrationError(
        `Migration versions must be consecutive from 0001: expected ${expected}, ` +
          `found ${migration.version} (${migration.filename})`,
      );
    }
  });

  return migrations;
}

/**
 * Apply every migration that has not been applied yet.
 *
 * Each file runs in its own transaction, so a failure leaves the database at the last
 * migration that fully succeeded rather than half way through one.
 */
export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const { schema } = options;
  if (schema !== undefined && !SCHEMA_NAME.test(schema)) {
    throw new MigrationError(`Not a valid schema name: ${schema}`);
  }

  const migrations = await readMigrations(options.directory ?? MIGRATIONS_DIR);
  const client: PgClient = new Client({ connectionString: options.connectionString });
  await client.connect();

  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    if (schema !== undefined) {
      // A schema name is an identifier, and an identifier cannot be a bound parameter.
      // It has already been matched against SCHEMA_NAME — lowercase, digits and
      // underscores only — so there is no quote to escape here; the double quotes are
      // belt and braces.
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await client.query('SELECT set_config($1, $2, false)', ['search_path', schema]);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        filename text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now(),
        applied_by text NOT NULL DEFAULT current_user
      )
    `);

    const ledger = await client.query<{
      version: string;
      filename: string;
      checksum: string;
      applied_at: Date;
    }>('SELECT version, filename, checksum, applied_at FROM schema_migrations');

    const byVersion = new Map(ledger.rows.map((row) => [row.version, row]));

    for (const migration of migrations) {
      const record = byVersion.get(migration.version);

      if (record !== undefined) {
        if (record.checksum !== migration.checksum) {
          throw new MigrationError(
            `${migration.filename} has changed since it was applied on ` +
              `${record.applied_at.toISOString()}.\n` +
              `  applied: ${record.checksum}\n` +
              `  on disk: ${migration.checksum}\n` +
              'An applied migration is history. Add a new migration instead of editing this one.',
          );
        }
        alreadyApplied.push(migration.filename);
        continue;
      }

      await client.query('BEGIN');
      try {
        // Sent without bound parameters so `pg` uses the simple query protocol, which is
        // what lets one file contain many statements and dollar-quoted function bodies.
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.filename, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new MigrationError(
          `${migration.filename} failed and was rolled back: ${describe(error)}`,
          { cause: error },
        );
      }
      applied.push(migration.filename);
    }

    return { applied, alreadyApplied };
  } finally {
    await client.end();
  }
}

/** Read the ledger without applying anything. For a deployment preflight check. */
export async function appliedMigrations(
  options: Pick<MigrateOptions, 'connectionString' | 'schema'>,
): Promise<AppliedMigration[]> {
  const { schema } = options;
  if (schema !== undefined && !SCHEMA_NAME.test(schema)) {
    throw new MigrationError(`Not a valid schema name: ${schema}`);
  }

  const client: PgClient = new Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    if (schema !== undefined) {
      await client.query('SELECT set_config($1, $2, false)', ['search_path', schema]);
    }
    const result = await client.query<{
      version: string;
      filename: string;
      checksum: string;
      applied_at: Date;
    }>('SELECT version, filename, checksum, applied_at FROM schema_migrations ORDER BY version');
    return result.rows.map((row) => ({
      version: row.version,
      filename: row.filename,
      checksum: row.checksum,
      appliedAt: row.applied_at,
    }));
  } finally {
    await client.end();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
