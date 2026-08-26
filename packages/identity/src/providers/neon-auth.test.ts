/**
 * The Neon Auth adapter, against a real Postgres.
 *
 * Spec: Master Technical Buildout section 18. CLAUDE.md invariant 7.
 *
 * A stand-in for Neon Auth's schema is created per run rather than assuming one is installed:
 * this suite has to work on CI's plain Postgres service container. The columns mirror Better
 * Auth's exactly, quoted camelCase and all, because the whole point of an adapter test is
 * that the SQL matches the schema it will meet in production — a hand-simplified stub that
 * used snake_case would pass while the real query failed.
 *
 * The cases that matter are the refusals. A valid session resolving to the right tenant is
 * one test; the other eleven are about what must NOT produce a claim.
 *
 * ## Running it
 *
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
 *     pnpm exec vitest run --project identity src/providers/neon-auth.test.ts
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import type { Database } from '@complianceos/db';
import { NEON_AUTH_PROVIDER_ID, NeonAuthIdentityProvider } from './neon-auth.js';

const DATABASE_URL = process.env.DATABASE_URL;

if (process.env.REQUIRE_DATABASE_TESTS !== undefined && DATABASE_URL === undefined) {
  throw new Error(
    'REQUIRE_DATABASE_TESTS is set but DATABASE_URL is not, so the Neon Auth adapter suite ' +
      'would skip — a green tick next to an unverified authentication path.',
  );
}

const suite = DATABASE_URL === undefined ? describe.skip : describe;
const title =
  DATABASE_URL === undefined
    ? 'Neon Auth adapter [SKIPPED: set DATABASE_URL — see the header of this file]'
    : 'Neon Auth adapter against Postgres';

const APP_PASSWORD = 'neon-auth-suite-only';

suite(title, () => {
  const appSchema = `neonauth_${randomUUID().replace(/-/g, '')}`;
  const authSchema = `authstub_${randomUUID().replace(/-/g, '')}`;

  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const organizationId = randomUUID();
  const unboundOrganizationId = randomUUID();
  const userId = randomUUID();
  const TOKEN = 'session-token-with-plenty-of-entropy-0001';

  let owner!: Client;
  let app!: Database;
  let provider!: NeonAuthIdentityProvider;

  beforeAll(async () => {
    const url = DATABASE_URL as string;
    const pg = (await import('pg')).default;
    const { migrate, Database: Db } = await import('@complianceos/db');

    await migrate({ connectionString: url, schema: appSchema });

    owner = new pg.Client({ connectionString: url });
    await owner.connect();
    await owner.query(`SET search_path TO "${appSchema}"`);
    await owner.query(`ALTER ROLE complianceos_app WITH LOGIN PASSWORD '${APP_PASSWORD}'`);

    // Better Auth's shape, verbatim: uuid ids, quoted camelCase columns, timestamptz.
    await owner.query(`CREATE SCHEMA "${authSchema}"`);
    await owner.query(
      `CREATE TABLE "${authSchema}"."user" (
         id uuid PRIMARY KEY,
         name text NOT NULL,
         email text NOT NULL,
         "emailVerified" boolean NOT NULL DEFAULT false,
         banned boolean,
         "banReason" text,
         "banExpires" timestamptz
       )`,
    );
    await owner.query(
      `CREATE TABLE "${authSchema}".session (
         id uuid PRIMARY KEY,
         token text NOT NULL,
         "userId" uuid NOT NULL,
         "expiresAt" timestamptz NOT NULL,
         "activeOrganizationId" text
       )`,
    );
    await owner.query(
      `CREATE TABLE "${authSchema}".organization (
         id uuid PRIMARY KEY, name text NOT NULL, slug text NOT NULL
       )`,
    );
    await owner.query(
      `CREATE TABLE "${authSchema}".member (
         id uuid PRIMARY KEY, "organizationId" uuid NOT NULL, "userId" uuid NOT NULL, role text
       )`,
    );
    // Deliberately NOT granted, mirroring migration 0008: this is where credentials live.
    await owner.query(`CREATE TABLE "${authSchema}".account (id uuid PRIMARY KEY, password text)`);

    await owner.query(`GRANT USAGE ON SCHEMA "${authSchema}" TO complianceos_app`);
    for (const table of ['"user"', 'session', 'organization', 'member']) {
      await owner.query(`GRANT SELECT ON "${authSchema}".${table} TO complianceos_app`);
    }

    for (const [id, slug] of [
      [tenantId, 'bound'],
      [otherTenantId, 'other'],
    ]) {
      await owner.query('INSERT INTO tenants (id, slug, display_name) VALUES ($1, $2, $3)', [
        id,
        slug,
        `${slug} district`,
      ]);
    }

    await owner.query(
      `INSERT INTO identity_organization_bindings
         (provider, provider_organization_id, bound_tenant_id)
       VALUES ($1, $2, $3)`,
      [NEON_AUTH_PROVIDER_ID, organizationId, tenantId],
    );

    await owner.query(
      `INSERT INTO "${authSchema}"."user" (id, name, email, "emailVerified")
       VALUES ($1, 'Dana Whitfield', 'director@northfield.invalid', true)`,
      [userId],
    );
    for (const org of [organizationId, unboundOrganizationId]) {
      await owner.query(
        `INSERT INTO "${authSchema}".organization (id, name, slug) VALUES ($1, $2, $3)`,
        [org, `org ${org.slice(0, 4)}`, org.slice(0, 8)],
      );
    }

    const asApp = new URL(url);
    asApp.username = 'complianceos_app';
    asApp.password = APP_PASSWORD;
    app = new Db({ connectionString: asApp.toString(), schema: appSchema });
    provider = new NeonAuthIdentityProvider({ database: app, schema: authSchema });
  }, 60_000);

  afterAll(async () => {
    await app?.end();
    await owner?.query(`DROP SCHEMA IF EXISTS "${authSchema}" CASCADE`);
    await owner?.query(`DROP SCHEMA IF EXISTS "${appSchema}" CASCADE`);
    await owner?.end();
  });

  /** A live session on the bound organization, and an unbanned user. Reset per test. */
  beforeEach(async () => {
    await owner.query(`DELETE FROM "${authSchema}".session`);
    await owner.query(`DELETE FROM "${authSchema}".member`);
    await owner.query(
      `UPDATE "${authSchema}"."user" SET banned = NULL, "banExpires" = NULL WHERE id = $1`,
      [userId],
    );
    await owner.query(
      `INSERT INTO "${authSchema}".session (id, token, "userId", "expiresAt", "activeOrganizationId")
       VALUES ($1, $2, $3, now() + interval '1 hour', $4)`,
      [randomUUID(), TOKEN, userId, organizationId],
    );
    await owner.query(
      `UPDATE identity_organization_bindings SET disabled_at = NULL, disabled_reason = NULL
        WHERE provider = $1`,
      [NEON_AUTH_PROVIDER_ID],
    );
  });

  describe('a live session', () => {
    it('yields a claim carrying the bound tenant', async () => {
      const outcome = await provider.authenticate({ token: TOKEN });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.claim.tenantId).toBe(tenantId);
      expect(outcome.claim.subjectId).toBe(userId);
      expect(outcome.claim.email).toBe('director@northfield.invalid');
      expect(outcome.claim.displayName).toBe('Dana Whitfield');
      expect(outcome.claim.issuer).toBe(NEON_AUTH_PROVIDER_ID);
    });

    it('does not claim a second factor from a verified email address', async () => {
      // The seeded user has emailVerified = true. Reporting that as MFA would let a
      // vendor-staff account past the one check section 18 makes mandatory.
      const outcome = await provider.authenticate({ token: TOKEN });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.claim.mfaSatisfied).toBe(false);
    });

    it('uses the provider user id as the subject, never the email', async () => {
      const outcome = await provider.authenticate({ token: TOKEN });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.claim.subjectId).not.toContain('@');
    });
  });

  describe('sessions that must not authenticate', () => {
    it('refuses an unknown token', async () => {
      expect(await provider.authenticate({ token: 'not-a-real-token' })).toEqual({
        ok: false,
        reason: 'NO_SUCH_IDENTITY',
      });
    });

    it('refuses a missing or empty token without touching the database', async () => {
      expect(await provider.authenticate({})).toEqual({ ok: false, reason: 'MALFORMED_RESPONSE' });
      expect(await provider.authenticate({ token: '' })).toEqual({
        ok: false,
        reason: 'MALFORMED_RESPONSE',
      });
    });

    it('refuses an expired session, judged by the database clock', async () => {
      await owner.query(
        `UPDATE "${authSchema}".session SET "expiresAt" = now() - interval '1 second'
          WHERE token = $1`,
        [TOKEN],
      );

      expect(await provider.authenticate({ token: TOKEN })).toEqual({
        ok: false,
        reason: 'NO_SUCH_IDENTITY',
      });
    });

    it('refuses a banned user', async () => {
      await owner.query(`UPDATE "${authSchema}"."user" SET banned = true WHERE id = $1`, [userId]);

      expect(await provider.authenticate({ token: TOKEN })).toEqual({
        ok: false,
        reason: 'PROVIDER_REFUSED',
      });
    });

    it('admits a user whose ban has expired', async () => {
      // A ban with a past expiry is over. Treating it as permanent would lock somebody out
      // with no way for the district to see why.
      await owner.query(
        `UPDATE "${authSchema}"."user" SET banned = true, "banExpires" = now() - interval '1 day'
          WHERE id = $1`,
        [userId],
      );

      expect((await provider.authenticate({ token: TOKEN })).ok).toBe(true);
    });

    it('refuses a ban with no expiry, which is permanent', async () => {
      await owner.query(
        `UPDATE "${authSchema}"."user" SET banned = true, "banExpires" = NULL WHERE id = $1`,
        [userId],
      );

      expect((await provider.authenticate({ token: TOKEN })).ok).toBe(false);
    });
  });

  describe('choosing the organization', () => {
    it('falls back to a sole membership when no organization is active', async () => {
      await owner.query(
        `UPDATE "${authSchema}".session SET "activeOrganizationId" = NULL WHERE token = $1`,
        [TOKEN],
      );
      await owner.query(
        `INSERT INTO "${authSchema}".member (id, "organizationId", "userId", role)
         VALUES ($1, $2, $3, 'member')`,
        [randomUUID(), organizationId, userId],
      );

      const outcome = await provider.authenticate({ token: TOKEN });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.claim.tenantId).toBe(tenantId);
    });

    it('refuses rather than guessing between two memberships', async () => {
      // The worst available failure for a compliance platform would be dropping somebody
      // into a district they did not choose. Two is not a tie to break.
      await owner.query(
        `UPDATE "${authSchema}".session SET "activeOrganizationId" = NULL WHERE token = $1`,
        [TOKEN],
      );
      for (const org of [organizationId, unboundOrganizationId]) {
        await owner.query(
          `INSERT INTO "${authSchema}".member (id, "organizationId", "userId", role)
           VALUES ($1, $2, $3, 'member')`,
          [randomUUID(), org, userId],
        );
      }

      expect(await provider.authenticate({ token: TOKEN })).toEqual({
        ok: false,
        reason: 'PROVIDER_REFUSED',
      });
    });

    it('refuses when there is neither an active organization nor a membership', async () => {
      await owner.query(
        `UPDATE "${authSchema}".session SET "activeOrganizationId" = NULL WHERE token = $1`,
        [TOKEN],
      );

      expect(await provider.authenticate({ token: TOKEN })).toEqual({
        ok: false,
        reason: 'PROVIDER_REFUSED',
      });
    });
  });

  describe('the binding to a district', () => {
    it('refuses an organization bound to no tenant', async () => {
      // Authenticating against Neon Auth is not entitlement to a district's data.
      await owner.query(
        `UPDATE "${authSchema}".session SET "activeOrganizationId" = $2 WHERE token = $1`,
        [TOKEN, unboundOrganizationId],
      );

      expect(await provider.authenticate({ token: TOKEN })).toEqual({
        ok: false,
        reason: 'PROVIDER_MISCONFIGURED',
      });
    });

    it('refuses a binding an operator disabled, without deleting it', async () => {
      await owner.query(
        `UPDATE identity_organization_bindings
            SET disabled_at = now(), disabled_reason = 'federation revoked'
          WHERE provider = $1 AND provider_organization_id = $2`,
        [NEON_AUTH_PROVIDER_ID, organizationId],
      );

      expect(await provider.authenticate({ token: TOKEN })).toEqual({
        ok: false,
        reason: 'PROVIDER_MISCONFIGURED',
      });
    });

    it('does not match a binding belonging to another provider', async () => {
      // The unique index is on (provider, organization), so the same organization id under a
      // different provider is a different binding — and must not be picked up here.
      await owner.query(
        `UPDATE identity_organization_bindings SET provider = 'workos'
          WHERE provider = $1 AND provider_organization_id = $2`,
        [NEON_AUTH_PROVIDER_ID, organizationId],
      );

      try {
        expect(await provider.authenticate({ token: TOKEN })).toEqual({
          ok: false,
          reason: 'PROVIDER_MISCONFIGURED',
        });
      } finally {
        await owner.query(
          `UPDATE identity_organization_bindings SET provider = $1
            WHERE provider = 'workos' AND provider_organization_id = $2`,
          [NEON_AUTH_PROVIDER_ID, organizationId],
        );
      }
    });
  });

  describe('what the adapter is not allowed to reach', () => {
    it('cannot read the table holding credentials', async () => {
      // Migration 0008 grants four neon_auth tables and deliberately not `account`. The stub
      // mirrors that, and this asserts the application role really is refused rather than
      // merely never asking.
      await expect(
        app.readGlobal((db) => db.query(`SELECT password FROM "${authSchema}".account`)),
      ).rejects.toThrow(/permission denied/i);
    });

    it('cannot write through the pre-authentication read path', async () => {
      // readGlobal opens a READ ONLY transaction, so this is the database refusing rather
      // than the caller behaving.
      await expect(
        app.readGlobal((db) =>
          db.query(`UPDATE identity_organization_bindings SET disabled_reason = 'x'`),
        ),
      ).rejects.toThrow(/read-only/i);
    });

    it('sees no tenant data through the pre-authentication read path', async () => {
      // No GUC is set, so current_tenant_id() is NULL and every tenant policy matches
      // nothing. This is what makes a context-free read safe to have at all.
      const rows = await app.readGlobal((db) =>
        db.query<{ n: number }>('SELECT count(*)::int AS n FROM users'),
      );
      expect(rows.rows[0]?.n).toBe(0);
    });
  });

  describe('construction', () => {
    it('refuses a schema name that is not a bare identifier', async () => {
      // The schema is interpolated, because a schema name cannot be a bind parameter.
      for (const schema of ['neon_auth; DROP TABLE users', 'public.evil', '"quoted"', '1bad']) {
        expect(() => new NeonAuthIdentityProvider({ database: app, schema })).toThrow();
      }
      await Promise.resolve();
    });
  });
});
