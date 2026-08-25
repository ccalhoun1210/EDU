/**
 * The tenant-scoped database client.
 *
 * Spec: Master Technical Buildout section 7. ADR 0004. CLAUDE.md invariant 7.
 *
 * Every RLS policy in this schema reads one thing: the `complianceos.tenant_id`
 * session variable. This module is the only place that sets it, and the way it does so is
 * the whole reason the file exists.
 *
 * ## Why the tenant GUC is transaction-local, and why that is not a detail
 *
 * A serverless deployment runs behind a connection pool. A physical connection is borrowed
 * for a request and handed to whoever asks next — a different district's request,
 * milliseconds later, quite possibly mid-flight. If tenant context were set at the session
 * level (`SET complianceos.tenant_id = ...`), it would survive the release of the
 * connection and still be in force for the next borrower. The next request would then run
 * under the previous tenant's identity: not a subtle bug, a cross-tenant data leak, and one
 * that appears only under concurrency and therefore never in development.
 *
 * `set_config(name, value, is_local => true)` binds the setting to the enclosing
 * transaction. Postgres discards it at COMMIT or ROLLBACK, so it cannot outlive the unit of
 * work that set it, and there is no cleanup step that could be skipped on an error path.
 * It is also the only form that is correct behind a transaction-mode pooler such as
 * PgBouncer or Neon's pooled endpoint, where a session-level SET may be applied to a
 * completely different backend than the query that follows it.
 *
 * Hence: `withTenant` opens a transaction, sets the GUC inside it, and every query the
 * callback makes runs in that transaction. There is no supported way to reach the database
 * through this module without tenant context, which is the point.
 *
 * ## Why the tenant id is a bound parameter
 *
 * `set_config` is called with `$1`, never with the id interpolated into SQL. A tenant id
 * reaching this function should already have come from the server-side session rather than
 * from a request body (invariant 7), but "should have" is not a security control. The
 * parameter binding means that even a tenant id that came from somewhere it should not have
 * can only ever be a value, never syntax. The UUID check below is the second layer: a
 * malformed id fails here, in application code with a clear error, rather than as a cast
 * error inside a policy predicate.
 */

import pg from 'pg';
import type { Pool as PgPool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg';

const { Pool } = pg;

/** The session variable every RLS policy reads. Namespaced because Postgres requires it. */
export const TENANT_GUC = 'complianceos.tenant_id';

/**
 * SQLSTATEs raised by the schema's own triggers.
 *
 * Exported so a caller can distinguish "you tried to change history" from a generic
 * database error and say something useful, instead of surfacing a 500.
 */
export const DB_ERROR_CODES = {
  /** A FINALIZED assessment run, or a result belonging to one, was modified. Invariant 4. */
  FINALIZED_RUN_IMMUTABLE: 'CO001',
  /** UPDATE, DELETE or TRUNCATE attempted against an append-only audit table. Section 21. */
  AUDIT_APPEND_ONLY: 'CO002',
  /** An ACTIVE rule version was edited rather than superseded. Invariant 4. */
  ACTIVE_RULE_VERSION_IMMUTABLE: 'CO003',
  /** A report was requested from a run that is not FINALIZED. Section 22. */
  REPORT_REQUIRES_FINALIZED_RUN: 'CO004',
} as const;

export type DbErrorCode = (typeof DB_ERROR_CODES)[keyof typeof DB_ERROR_CODES];

/** Shape-only check. Rejects anything that is not a canonical UUID before it reaches SQL. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantContextError';
  }
}

/**
 * A connection with tenant context established, inside an open transaction.
 *
 * Deliberately narrower than `PoolClient`: it exposes `query` and the tenant id and nothing
 * else. No `release`, because releasing the connection is `withTenant`'s job; no `BEGIN`,
 * because a nested transaction here would silently become a no-op and the caller would
 * believe they had a savepoint they do not have.
 */
export interface TenantConnection {
  readonly tenantId: string;
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

export interface DatabaseConfig {
  /**
   * The POOLED connection URL, and the credentials of the non-owner application role.
   * Never the schema owner: an owner bypasses RLS unless every table is FORCEd, and relying
   * on that would make the isolation of the whole platform depend on nobody ever adding a
   * table without FORCE.
   */
  readonly connectionString: string;
  /** Schema to run in. Omit for the connection's default `search_path`. */
  readonly schema?: string;
  readonly maxConnections?: number;
  /**
   * A ceiling on any single statement. A runaway report query holding a pooled connection
   * open is an availability problem for every other district on the deployment.
   */
  readonly statementTimeoutMs?: number;
  readonly applicationName?: string;
}

const SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;

/**
 * A pool that can only be used through a tenant transaction.
 *
 * Construct one per process. `end()` on shutdown.
 */
export class Database {
  readonly #pool: PgPool;
  readonly #schema: string | undefined;

  constructor(config: DatabaseConfig) {
    if (config.schema !== undefined && !SCHEMA_NAME.test(config.schema)) {
      throw new TenantContextError(`Not a valid schema name: ${config.schema}`);
    }

    // Assembled conditionally rather than with `?? undefined` because
    // exactOptionalPropertyTypes distinguishes "absent" from "present and undefined", and
    // `pg` reads an explicitly-undefined `max` differently from an absent one.
    const poolConfig: PoolConfig = { connectionString: config.connectionString };
    if (config.maxConnections !== undefined) poolConfig.max = config.maxConnections;
    if (config.statementTimeoutMs !== undefined) {
      poolConfig.statement_timeout = config.statementTimeoutMs;
    }
    if (config.applicationName !== undefined) {
      poolConfig.application_name = config.applicationName;
    }

    this.#pool = new Pool(poolConfig);
    this.#schema = config.schema;
  }

  /**
   * Run `fn` with tenant context set, inside a single transaction.
   *
   * Commits when the callback resolves, rolls back when it throws. The callback's queries
   * are all inside that transaction, so a partially applied write is not a state this
   * function can leave behind.
   *
   * The returned value is whatever the callback returns. Rows read inside must not be
   * assumed to remain readable outside: nothing outside a `withTenant` block has tenant
   * context, so a lazily-evaluated query issued later would see no rows at all.
   */
  async withTenant<T>(tenantId: string, fn: (db: TenantConnection) => Promise<T>): Promise<T> {
    if (!UUID.test(tenantId)) {
      throw new TenantContextError(`Not a valid tenant id: ${JSON.stringify(tenantId)}`);
    }

    const client = await this.#pool.connect();
    let opened = false;
    let destroyed = false;
    try {
      await client.query('BEGIN');
      opened = true;

      // The tenant id is bound, never interpolated. `true` is is_local: the setting dies
      // with this transaction and cannot follow the connection back into the pool.
      await client.query('SELECT set_config($1, $2, true)', [TENANT_GUC, tenantId]);

      // Same treatment for the schema, for the same reason — a session-level search_path
      // would leak to the next borrower of this connection.
      if (this.#schema !== undefined) {
        await client.query('SELECT set_config($1, $2, true)', ['search_path', this.#schema]);
      }

      const result = await fn(wrap(client, tenantId));
      await client.query('COMMIT');
      opened = false;
      return result;
    } catch (error) {
      if (opened) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // The connection is unusable — a network drop mid-transaction, or a backend that
          // terminated. Swallowing the rollback failure is right: re-throwing it would
          // replace the real error with a less informative one. Passing `true` to release
          // destroys the connection instead of returning a poisoned one to the pool, which
          // matters because a connection left inside an aborted transaction would reject
          // every query the next borrower issued.
          destroyed = true;
          client.release(true);
        }
      }
      throw error;
    } finally {
      // Guarded: pg throws if a client is released twice, and the rollback path above may
      // already have destroyed this one.
      if (!destroyed) client.release();
    }
  }

  async end(): Promise<void> {
    await this.#pool.end();
  }
}

function wrap(client: PoolClient, tenantId: string): TenantConnection {
  return {
    tenantId,
    query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<R>> {
      // Copied into a mutable array because `pg` types the parameter list as mutable, and
      // the caller's array should not be reachable from the driver.
      return values === undefined
        ? client.query<R>(text)
        : client.query<R>(text, [...values]);
    },
  };
}
