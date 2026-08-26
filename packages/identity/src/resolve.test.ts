/**
 * Resolving a claim or a session to a principal, against a real Postgres.
 *
 * Spec: Master Technical Buildout section 18. CLAUDE.md invariant 7.
 *
 * Every assertion here runs as `complianceos_app` — the non-owner, `NOBYPASSRLS` role the
 * deployment uses — because the claims under test are about what that role can and cannot
 * see. Connecting as the owner would make the cross-tenant cases pass for the wrong reason.
 *
 * ## Running it
 *
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
 *     pnpm exec vitest run --project identity src/resolve.test.ts
 *
 * Skipped, never silently passed, without a database — and turned into a hard failure when
 * `REQUIRE_DATABASE_TESTS` is set, which is what the `database` CI job does. An
 * authorization suite that reports success on a machine with no database is a green tick
 * next to an unverified claim, which is worse than no suite.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import type { Database } from '@complianceos/db';
import { can, coversModule, coversOrganization, hasRole, rolesOf } from './principal.js';
import { establishPrincipal, loadPrincipal } from './resolve.js';
import type { SubjectClaim } from './claim.js';
import type { SessionPayload } from './session.js';
import { SESSION_FORMAT_VERSION } from './session.js';

const DATABASE_URL = process.env.DATABASE_URL;

if (process.env.REQUIRE_DATABASE_TESTS !== undefined && DATABASE_URL === undefined) {
  throw new Error(
    'REQUIRE_DATABASE_TESTS is set but DATABASE_URL is not, so the principal-resolution ' +
      'suite would skip. A silent skip here would report that authorization holds without ' +
      'having checked it.',
  );
}

const suite = DATABASE_URL === undefined ? describe.skip : describe;
const title =
  DATABASE_URL === undefined
    ? 'principal resolution [SKIPPED: set DATABASE_URL — see the header of src/resolve.test.ts]'
    : 'principal resolution against Postgres';

const APP_PASSWORD = 'identity-suite-only';

interface Seeded {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly siteId: string;
  readonly userId: string;
  readonly subjectId: string;
  readonly membershipId: string;
}

suite(title, () => {
  const schema = `identity_${randomUUID().replace(/-/g, '')}`;

  let owner!: Client;
  let app!: Database;
  let alpha!: Seeded;
  let beta!: Seeded;

  /** Seed as the owner with tenant context set, because every table here is FORCEd. */
  async function asOwner(tenantId: string, statements: () => Promise<void>): Promise<void> {
    await owner.query('BEGIN');
    await owner.query('SELECT set_config($1, $2, true)', ['complianceos.tenant_id', tenantId]);
    try {
      await statements();
      await owner.query('COMMIT');
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }
  }

  async function seed(slug: string): Promise<Seeded> {
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const siteId = randomUUID();
    const userId = randomUUID();
    const membershipId = randomUUID();
    const subjectId = `sub-${slug}`;

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
        `INSERT INTO schools_sites (tenant_id, id, organization_id, site_name, state_school_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, siteId, organizationId, `${slug} High School`, `${slug}-hs`],
      );
      await owner.query(
        `INSERT INTO users (tenant_id, id, subject_id, email, display_name, status)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
        [tenantId, userId, subjectId, `director@${slug}.invalid`, 'Sped Director'],
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

    return { tenantId, organizationId, siteId, userId, subjectId, membershipId };
  }

  function claimFor(who: Seeded, overrides: Partial<SubjectClaim> = {}): SubjectClaim {
    return {
      tenantId: who.tenantId,
      subjectId: who.subjectId,
      email: 'director@example.invalid',
      displayName: 'Sped Director',
      mfaSatisfied: true,
      issuer: 'test',
      ...overrides,
    };
  }

  function sessionFor(who: Seeded, overrides: Partial<SessionPayload> = {}): SessionPayload {
    const iat = Math.floor(Date.now() / 1000) - 5;
    return {
      v: SESSION_FORMAT_VERSION,
      sid: randomUUID(),
      tid: who.tenantId,
      uid: who.userId,
      sub: who.subjectId,
      iat,
      exp: iat + 3600,
      ...overrides,
    };
  }

  beforeAll(async () => {
    const url = DATABASE_URL as string;
    const pg = (await import('pg')).default;
    const { migrate, Database: Db } = await import('@complianceos/db');

    await migrate({ connectionString: url, schema });

    owner = new pg.Client({ connectionString: url });
    await owner.connect();
    await owner.query(`SET search_path TO "${schema}"`);
    await owner.query(`ALTER ROLE complianceos_app WITH LOGIN PASSWORD '${APP_PASSWORD}'`);

    const asApp = new URL(url);
    asApp.username = 'complianceos_app';
    asApp.password = APP_PASSWORD;
    app = new Db({ connectionString: asApp.toString(), schema });

    alpha = await seed('alpha');
    beta = await seed('beta');
  }, 60_000);

  afterAll(async () => {
    await app?.end();
    await owner?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await owner?.end();
  });

  /** Undo whatever a test did to alpha's grants, so order cannot decide an outcome. */
  beforeEach(async () => {
    await asOwner(alpha.tenantId, async () => {
      await owner.query(
        `UPDATE users SET status = 'ACTIVE', is_vendor_staff = false WHERE id = $1`,
        [alpha.userId],
      );
      await owner.query(`UPDATE memberships SET revoked_at = NULL WHERE user_id = $1`, [
        alpha.userId,
      ]);
      await owner.query(
        `UPDATE access_scopes SET revoked_at = NULL, revocation_reason = NULL
          WHERE membership_id = $1`,
        [alpha.membershipId],
      );
    });
  });

  describe('sign-in', () => {
    it('resolves a provisioned, active, granted user', async () => {
      const outcome = await establishPrincipal(app, claimFor(alpha), randomUUID());

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.principal.tenantId).toBe(alpha.tenantId);
      expect(outcome.principal.userId).toBe(alpha.userId);
      expect(rolesOf(outcome.principal)).toEqual(['SPECIAL_EDUCATION_DIRECTOR']);
    });

    it('does not provision a stranger who authenticated successfully', async () => {
      // The teacher on the same Workspace tenant who tried the URL. A valid claim against
      // the district's identity provider is not an account on a fiscal compliance platform.
      const outcome = await establishPrincipal(
        app,
        claimFor(alpha, { subjectId: 'sub-nobody' }),
        randomUUID(),
      );

      expect(outcome).toEqual({ ok: false, reason: 'NOT_PROVISIONED' });
    });

    it('matches on the subject claim, never on the email address', async () => {
      // A successor who inherits a departed director's mailbox must not inherit their
      // access. Same email, different subject: no principal.
      const outcome = await establishPrincipal(
        app,
        claimFor(alpha, { subjectId: 'sub-successor', email: `director@alpha.invalid` }),
        randomUUID(),
      );

      expect(outcome).toEqual({ ok: false, reason: 'NOT_PROVISIONED' });
    });

    it('refreshes the local row from the provider, and redeems an invitation', async () => {
      await asOwner(alpha.tenantId, async () => {
        await owner.query(`UPDATE users SET status = 'INVITED' WHERE id = $1`, [alpha.userId]);
      });

      const outcome = await establishPrincipal(
        app,
        claimFor(alpha, { displayName: 'Renamed Director', email: 'renamed@alpha.invalid' }),
        randomUUID(),
      );

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.principal.displayName).toBe('Renamed Director');
      expect(outcome.principal.email).toBe('renamed@alpha.invalid');

      const row = await owner.query<{ status: string; last_seen_at: Date | null }>(
        `SELECT status, last_seen_at FROM users WHERE id = $1`,
        [alpha.userId],
      );
      expect(row.rows[0]?.status).toBe('ACTIVE');
      expect(row.rows[0]?.last_seen_at).not.toBeNull();
    });

    it('does not let a sign-in reinstate a suspended account', async () => {
      await asOwner(alpha.tenantId, async () => {
        await owner.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [alpha.userId]);
      });

      expect(await establishPrincipal(app, claimFor(alpha), randomUUID())).toEqual({
        ok: false,
        reason: 'SUSPENDED',
      });

      // And the refusal happened before any write: a login it was never going to allow
      // should not leave its fingerprints on the user row.
      const row = await owner.query<{ status: string }>(`SELECT status FROM users WHERE id = $1`, [
        alpha.userId,
      ]);
      expect(row.rows[0]?.status).toBe('SUSPENDED');
    });

    it('distinguishes deprovisioned from suspended', async () => {
      await asOwner(alpha.tenantId, async () => {
        await owner.query(`UPDATE users SET status = 'DEPROVISIONED' WHERE id = $1`, [
          alpha.userId,
        ]);
      });

      expect(await establishPrincipal(app, claimFor(alpha), randomUUID())).toEqual({
        ok: false,
        reason: 'DEPROVISIONED',
      });
    });
  });

  describe('authority is the database, not the token', () => {
    it('gives nothing to a user whose every membership is revoked', async () => {
      await asOwner(alpha.tenantId, async () => {
        await owner.query(`UPDATE memberships SET revoked_at = now() WHERE user_id = $1`, [
          alpha.userId,
        ]);
      });

      expect(await loadPrincipal(app, sessionFor(alpha))).toEqual({
        ok: false,
        reason: 'NO_ACTIVE_MEMBERSHIP',
      });
    });

    it('drops a revoked membership on the very next request, mid-session', async () => {
      // The reason session.ts keeps capabilities out of the token, demonstrated: the same
      // unexpired session goes from authorized to not, with nothing reissued.
      const session = sessionFor(alpha);
      expect((await loadPrincipal(app, session)).ok).toBe(true);

      await asOwner(alpha.tenantId, async () => {
        await owner.query(`UPDATE memberships SET revoked_at = now() WHERE user_id = $1`, [
          alpha.userId,
        ]);
      });

      expect((await loadPrincipal(app, session)).ok).toBe(false);
    });

    it('drops a revoked scope while leaving the membership standing', async () => {
      const before = await loadPrincipal(app, sessionFor(alpha));
      expect(before.ok).toBe(true);
      if (!before.ok) return;
      expect(coversOrganization(before.principal, alpha.organizationId)).toBe(true);

      await asOwner(alpha.tenantId, async () => {
        await owner.query(
          `UPDATE access_scopes SET revoked_at = now(), revocation_reason = 'test'
            WHERE membership_id = $1`,
          [alpha.membershipId],
        );
      });

      const after = await loadPrincipal(app, sessionFor(alpha));
      expect(after.ok).toBe(true);
      if (!after.ok) return;
      expect(after.principal.scopes).toEqual([]);
      expect(coversOrganization(after.principal, alpha.organizationId)).toBe(false);
      // Still a principal — they can sign in, they just cannot reach that organization.
      expect(after.principal.memberships).toHaveLength(1);
    });

    it('suspends an active session by suspending the user', async () => {
      const session = sessionFor(alpha);
      expect((await loadPrincipal(app, session)).ok).toBe(true);

      await asOwner(alpha.tenantId, async () => {
        await owner.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [alpha.userId]);
      });

      expect(await loadPrincipal(app, session)).toEqual({ ok: false, reason: 'SUSPENDED' });
    });
  });

  describe('mandatory MFA for vendor staff', () => {
    it('refuses vendor staff whose provider did not assert a second factor', async () => {
      await asOwner(alpha.tenantId, async () => {
        await owner.query(`UPDATE users SET is_vendor_staff = true WHERE id = $1`, [alpha.userId]);
      });

      expect(
        await establishPrincipal(app, claimFor(alpha, { mfaSatisfied: false }), randomUUID()),
      ).toEqual({ ok: false, reason: 'MFA_REQUIRED' });
    });

    it('admits vendor staff who did', async () => {
      await asOwner(alpha.tenantId, async () => {
        await owner.query(`UPDATE users SET is_vendor_staff = true WHERE id = $1`, [alpha.userId]);
      });

      const outcome = await establishPrincipal(
        app,
        claimFor(alpha, { mfaSatisfied: true }),
        randomUUID(),
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.principal.isVendorStaff).toBe(true);
    });

    it('locks an existing session out the moment someone is marked vendor staff', async () => {
      // The enrolment on the row is what a later request has to go on, so a session that
      // began without MFA stops working rather than riding out its hour.
      await establishPrincipal(app, claimFor(alpha, { mfaSatisfied: false }), randomUUID());
      const session = sessionFor(alpha);
      expect((await loadPrincipal(app, session)).ok).toBe(true);

      await asOwner(alpha.tenantId, async () => {
        await owner.query(`UPDATE users SET is_vendor_staff = true WHERE id = $1`, [alpha.userId]);
      });

      expect(await loadPrincipal(app, session)).toEqual({ ok: false, reason: 'MFA_REQUIRED' });
    });
  });

  describe('across the tenant boundary', () => {
    it('cannot resolve beta’s user by pointing an alpha session at their id', async () => {
      // RLS is what fails this, not application code: the query runs with alpha's tenant
      // context, so beta's row is not there to be found.
      const forged = sessionFor(alpha, { uid: beta.userId, sub: beta.subjectId });

      expect(await loadPrincipal(app, forged)).toEqual({ ok: false, reason: 'NOT_PROVISIONED' });
    });

    it('cannot resolve an alpha user under beta’s tenant context', async () => {
      const forged = sessionFor(alpha, { tid: beta.tenantId });

      expect(await loadPrincipal(app, forged)).toEqual({ ok: false, reason: 'NOT_PROVISIONED' });
    });

    it('rejects a session whose user id and subject no longer agree', async () => {
      // The seat was re-keyed to a different IdP subject since the token was minted. An old
      // cookie must not address the new occupant's account.
      expect(await loadPrincipal(app, sessionFor(alpha, { sub: 'sub-someone-else' }))).toEqual({
        ok: false,
        reason: 'NOT_PROVISIONED',
      });
    });

    it('keeps two tenants’ principals entirely separate', async () => {
      const a = await loadPrincipal(app, sessionFor(alpha));
      const b = await loadPrincipal(app, sessionFor(beta));

      expect(a.ok && b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      expect(a.principal.tenantId).not.toBe(b.principal.tenantId);
      expect(coversOrganization(a.principal, beta.organizationId)).toBe(false);
      expect(coversOrganization(b.principal, alpha.organizationId)).toBe(false);
    });
  });

  describe('the principal it builds', () => {
    it('carries the capabilities the membership granted, and no others', async () => {
      const outcome = await loadPrincipal(app, sessionFor(alpha));
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      expect(can(outcome.principal, 'EXPORT')).toBe(true);
      expect(can(outcome.principal, 'READ_STUDENT_IDENTITY')).toBe(false);
      expect(can(outcome.principal, 'CONFIGURE')).toBe(false);
      expect(hasRole(outcome.principal, 'SPECIAL_EDUCATION_DIRECTOR')).toBe(true);
      expect(hasRole(outcome.principal, 'DISTRICT_ADMINISTRATOR')).toBe(false);
    });

    it('unions capabilities across memberships rather than intersecting them', async () => {
      const second = randomUUID();
      await asOwner(alpha.tenantId, async () => {
        await owner.query(
          `INSERT INTO memberships
             (tenant_id, id, user_id, role, may_export, may_read_student_identity, may_configure)
           VALUES ($1, $2, $3, 'READ_ONLY', false, false, false)`,
          [alpha.tenantId, second, alpha.userId],
        );
      });

      try {
        const outcome = await loadPrincipal(app, sessionFor(alpha));
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        // Adding a narrow role must not remove authority the wider one granted.
        expect(can(outcome.principal, 'EXPORT')).toBe(true);
        expect([...rolesOf(outcome.principal)].sort()).toEqual([
          'READ_ONLY',
          'SPECIAL_EDUCATION_DIRECTOR',
        ]);
      } finally {
        await asOwner(alpha.tenantId, async () => {
          await owner.query(`DELETE FROM memberships WHERE id = $1`, [second]);
        });
      }
    });

    it('treats an organization-wide scope as covering every site in it', async () => {
      const outcome = await loadPrincipal(app, sessionFor(alpha));
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      // schoolSiteId is NULL on the seeded scope, which the schema documents as the whole
      // organization — so a specific site is covered without being named.
      expect(coversOrganization(outcome.principal, alpha.organizationId, alpha.siteId)).toBe(true);
      expect(coversOrganization(outcome.principal, alpha.organizationId, randomUUID())).toBe(true);
    });

    it('narrows to one site when the scope names one', async () => {
      await asOwner(alpha.tenantId, async () => {
        await owner.query(`UPDATE access_scopes SET school_site_id = $2 WHERE membership_id = $1`, [
          alpha.membershipId,
          alpha.siteId,
        ]);
      });

      try {
        const outcome = await loadPrincipal(app, sessionFor(alpha));
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(coversOrganization(outcome.principal, alpha.organizationId, alpha.siteId)).toBe(
          true,
        );
        expect(coversOrganization(outcome.principal, alpha.organizationId, randomUUID())).toBe(
          false,
        );
      } finally {
        await asOwner(alpha.tenantId, async () => {
          await owner.query(
            `UPDATE access_scopes SET school_site_id = NULL WHERE membership_id = $1`,
            [alpha.membershipId],
          );
        });
      }
    });

    it('reads a null module as every module, not as none', async () => {
      const scoped = await loadPrincipal(app, sessionFor(alpha));
      expect(scoped.ok).toBe(true);
      if (!scoped.ok) return;
      expect(coversModule(scoped.principal, 'IDEA_FISCAL')).toBe(true);
      expect(coversModule(scoped.principal, 'DISPROPORTIONALITY')).toBe(false);

      await asOwner(alpha.tenantId, async () => {
        await owner.query(`UPDATE access_scopes SET module = NULL WHERE membership_id = $1`, [
          alpha.membershipId,
        ]);
      });

      try {
        const wildcard = await loadPrincipal(app, sessionFor(alpha));
        expect(wildcard.ok).toBe(true);
        if (!wildcard.ok) return;
        expect(coversModule(wildcard.principal, 'IDEA_FISCAL')).toBe(true);
        expect(coversModule(wildcard.principal, 'DISPROPORTIONALITY')).toBe(true);
      } finally {
        await asOwner(alpha.tenantId, async () => {
          await owner.query(
            `UPDATE access_scopes SET module = 'IDEA_FISCAL' WHERE membership_id = $1`,
            [alpha.membershipId],
          );
        });
      }
    });

    it('carries the session id it was resolved for, for the audit record', async () => {
      const session = sessionFor(alpha);
      const outcome = await loadPrincipal(app, session);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.principal.sessionId).toBe(session.sid);
    });
  });
});
