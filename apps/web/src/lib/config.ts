import 'server-only';

/**
 * What this deployment is configured to be, decided once and read everywhere.
 *
 * Spec: Master Technical Buildout sections 18 and 19. CLAUDE.md invariant 7.
 *
 * ## Two honest shapes, and no third
 *
 * A deployment either has a database or it does not, and both are legitimate:
 *
 * - **Connected.** `DATABASE_URL` and `SESSION_SECRET` are set. Districts sign in, tenant
 *   context comes from the session, and the assessment shows their stored runs.
 * - **Unconnected.** Neither is set. The marketing site and the rule registry work exactly
 *   as they do now, and the assessment shows the worked example — a synthetic district,
 *   labelled as such on every page that renders it. That is not a shell: see the header of
 *   `worked-example.ts` and ADR 0010. It is the product demonstrating its own pipeline over
 *   an export whose figures are invented.
 *
 * What must never happen is the third shape: a deployment that half-configured itself and
 * then decided to carry on. A `DATABASE_URL` with no `SESSION_SECRET` would mean real
 * district data behind a session this process cannot seal — so it throws, at startup, in
 * one place, rather than serving the first request and discovering it at sign-in.
 *
 * ## Read once
 *
 * `process.env` is read exactly here. A page or route handler that reached for it directly
 * would be a second opinion about what this deployment is, and the two would eventually
 * disagree — which is how a demo sign-in ends up mounted on a connected deployment.
 */

import { Database } from '@complianceos/db';
import {
  MAX_SESSION_TTL_SECONDS,
  SessionSealer,
  looksLikeProduction,
} from '@complianceos/identity';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Session lifetime. Under the package ceiling, and a working day for a district officer. */
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * A deployment with a database and a way to seal sessions.
 *
 * `demoTenantId` names the tenant whose users the demonstration sign-in may impersonate.
 * It is refused in production by `looksLikeProduction`, and it is an id rather than a
 * roster: the roster is read from `users` at sign-in, so the demo can only ever sign you in
 * as somebody who genuinely exists and genuinely holds a membership. A roster in an
 * environment variable could name anyone.
 *
 * An id and not a slug, because resolving a slug would require reading `tenants` — which is
 * behind an RLS policy keyed on the tenant context the lookup is trying to establish. That
 * circularity is not an obstacle to work around; it is the isolation model working. A real
 * identity provider has the same shape: its connection maps to a tenant id held as platform
 * configuration.
 */
export interface ConnectedConfig {
  readonly kind: 'CONNECTED';
  readonly database: Database;
  readonly sealer: SessionSealer;
  readonly sessionTtlSeconds: number;
  readonly demoTenantId: string | undefined;
}

export interface UnconnectedConfig {
  readonly kind: 'UNCONNECTED';
  /** Why, in words a deploying engineer can act on. Rendered on the assessment page. */
  readonly reason: string;
}

export type AppConfig = ConnectedConfig | UnconnectedConfig;

function build(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const databaseUrl = env['DATABASE_URL'];
  const secret = env['SESSION_SECRET'];

  if (databaseUrl === undefined || databaseUrl.length === 0) {
    if (secret !== undefined && secret.length > 0) {
      // Not merely unhelpful — it means somebody intended this deployment to be connected
      // and it silently is not. Saying so beats rendering a demonstration they will mistake
      // for their district.
      throw new ConfigurationError(
        'SESSION_SECRET is set but DATABASE_URL is not. A session with nothing to resolve ' +
          'against cannot sign anyone in. Set both, or neither.',
      );
    }
    return {
      kind: 'UNCONNECTED',
      reason:
        'This deployment has no DATABASE_URL, so there is no district data to read and ' +
        'nowhere to put an upload.',
    };
  }

  if (secret === undefined || secret.length === 0) {
    throw new ConfigurationError(
      'DATABASE_URL is set but SESSION_SECRET is not. Refusing to start: district data ' +
        'behind a session this process cannot seal is worse than no deployment at all.',
    );
  }

  const demoTenantId = env['DEMO_TENANT_ID'];
  const demoConfigured = demoTenantId !== undefined && demoTenantId.length > 0;

  if (demoConfigured && looksLikeProduction(env)) {
    // The provider refuses this too, at construction. Refusing here as well means a
    // production deployment carrying the variable fails to boot rather than failing at the
    // first sign-in attempt, when whoever set it has stopped watching.
    throw new ConfigurationError(
      'DEMO_TENANT_ID is set on a production deployment. The demonstration sign-in ' +
        'authenticates nobody and must not be reachable there.',
    );
  }
  if (demoConfigured && !UUID.test(demoTenantId)) {
    throw new ConfigurationError(
      `DEMO_TENANT_ID is not a uuid: ${JSON.stringify(demoTenantId)}. It names a tenant row, ` +
        'not a slug — see the note on ConnectedConfig.',
    );
  }

  return {
    kind: 'CONNECTED',
    database: new Database({
      connectionString: databaseUrl,
      // A ceiling on any one statement: a runaway query holding a pooled connection is an
      // availability problem for every other district on the deployment.
      statementTimeoutMs: 15_000,
      applicationName: 'complianceos-web',
    }),
    sealer: new SessionSealer(secret, Math.min(SESSION_TTL_SECONDS, MAX_SESSION_TTL_SECONDS)),
    sessionTtlSeconds: Math.min(SESSION_TTL_SECONDS, MAX_SESSION_TTL_SECONDS),
    demoTenantId: demoConfigured ? demoTenantId : undefined,
  };
}

/**
 * Memoized per process, because `Database` owns a connection pool.
 *
 * Building a second pool per request is how a serverless deployment exhausts its database's
 * connection limit under load — and it would do it only under load, which is to say only in
 * production.
 */
let cached: AppConfig | undefined;

export function appConfig(): AppConfig {
  cached ??= build(process.env);
  return cached;
}

/** For tests: build a configuration from an explicit environment, bypassing the cache. */
export function configFrom(env: Readonly<Record<string, string | undefined>>): AppConfig {
  return build(env);
}
