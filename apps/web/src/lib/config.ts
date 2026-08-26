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
 * ## A misconfiguration downgrades capability; it never takes the site down
 *
 * An earlier version of this file threw when `DATABASE_URL` was set without
 * `SESSION_SECRET`, reasoning that district data behind an unsealed session was worse than
 * no deployment. That was wrong twice over, and it took a 500 on a live preview to see it.
 *
 * It was wrong about the danger: with no secret, no session can be sealed at all, so nobody
 * can sign in and no district data is reachable. The unconnected branch is already the safe
 * one. And it was wrong about the blast radius: the marketing site and the rule registry
 * need no database, and refusing to boot took them down too, on a deployment where a
 * platform integration had injected `DATABASE_URL` without anyone asking for it.
 *
 * So every configuration problem here resolves to UNCONNECTED, carrying a reason that the
 * sign-in page renders. The downgrade is always toward less access, and it is always
 * visible on the page that would have used what is missing — which beats both a silent
 * carry-on and a site-wide 500.
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
    return {
      kind: 'UNCONNECTED',
      reason:
        secret !== undefined && secret.length > 0
          ? 'SESSION_SECRET is set but DATABASE_URL is not, so a session would have nothing ' +
            'to resolve against. Set both, or neither.'
          : 'This deployment has no DATABASE_URL, so there is no district data to read and ' +
            'nowhere to put an upload.',
    };
  }

  if (secret === undefined || secret.length === 0) {
    // The common case on a platform that injects a database for you: Neon's Vercel
    // integration sets DATABASE_URL on the project, and nothing sets a session secret.
    // Sign-in stays off — no secret, no sealed session, no way in — and the rest of the
    // site serves normally.
    return {
      kind: 'UNCONNECTED',
      reason:
        'This deployment has a DATABASE_URL but no SESSION_SECRET, so sessions cannot be ' +
        'sealed and sign-in is disabled. Generate one with `openssl rand -base64 48`.',
    };
  }

  const demoTenantId = env['DEMO_TENANT_ID'];
  const demoConfigured = demoTenantId !== undefined && demoTenantId.length > 0;

  // Both of these disable the demonstration sign-in rather than failing the deployment.
  // The provider refuses production at construction as well, so this is the second of two
  // independent controls and not the only one; what it adds is that the refusal happens
  // before anyone is offered a form, instead of at the first attempt to use it.
  const demoUsable =
    demoConfigured && !looksLikeProduction(env) && UUID.test(demoTenantId as string);

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
    demoTenantId: demoUsable ? demoTenantId : undefined,
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
