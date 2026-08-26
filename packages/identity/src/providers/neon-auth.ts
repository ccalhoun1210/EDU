/**
 * Neon Auth as an identity provider.
 *
 * Spec: Master Technical Buildout section 18. CLAUDE.md invariant 7.
 *
 * Neon Auth is Better Auth with a Postgres backend, installed by Neon into a `neon_auth`
 * schema in the same database as the application's own tables. That co-location is the only
 * reason this adapter can be as simple as it is: validating a session is a join, not an HTTP
 * round trip to an identity service.
 *
 * ## What this adapter does and does not own
 *
 * Neon Auth owns **authentication**. Sign-up, sign-in, passwords, OAuth, email verification,
 * and the session cookie are all its business, and none of that is reimplemented here. This
 * adapter reads the result.
 *
 * ComplianceOS owns **authorization**, and that has not moved: the claim this yields confers
 * nothing. It is handed to `resolvePrincipal`, which looks the subject up in this platform's
 * own `users` table and reads membership and scope from `memberships` and `access_scopes`.
 * A person with a perfectly good Neon Auth session who has not been provisioned into a
 * district gets `NOT_PROVISIONED`, exactly as they would through any other provider.
 *
 * That split is what keeps the schema's promise that `users.subject_id` is "never a password
 * hash: this platform does not store credentials". The credentials live in
 * `neon_auth.account`, which migration 0008 deliberately does **not** grant this application
 * read access to.
 *
 * ## Why the session token is looked up rather than verified
 *
 * Better Auth signs its cookie and then looks the token up in `neon_auth.session`. This
 * adapter does only the second half. That is not a shortcut past a security control: the
 * token is a high-entropy random value, the row is the authority on whether a session
 * exists, and an attacker who cannot guess a token gains nothing from the missing signature
 * check. What it costs is that a cookie Better Auth would reject for a bad signature — but
 * which nonetheless carries a live token — would be accepted here, and holding a live token
 * is already the whole game.
 *
 * Expiry is checked in SQL rather than in JavaScript, against the database's clock, so a
 * skewed application server cannot extend a session.
 *
 * ## Which tenant
 *
 * `session.activeOrganizationId` when Better Auth's organization plugin has set one;
 * otherwise the user's single membership. Two or more memberships with no active
 * organization is refused rather than guessed — picking one would silently drop somebody
 * into a district they did not choose, and for a compliance platform that is the worst
 * available failure.
 *
 * The organization is then mapped to a tenant through `identity_organization_bindings`,
 * which is platform configuration an operator sets up. An unbound organization is refused:
 * authenticating against Neon Auth is not by itself entitlement to any district's data.
 */

import type { Database } from '@complianceos/db';
import type { AuthenticationOutcome, IdentityProvider, SubjectClaim } from '../claim.js';

export const NEON_AUTH_PROVIDER_ID = 'neon-auth';

interface SessionRow {
  user_id: string;
  email: string;
  display_name: string;
  email_verified: boolean;
  banned: boolean | null;
  ban_expires: Date | null;
  active_organization_id: string | null;
}

interface OrganizationRow {
  organization_id: string;
}

interface BindingRow {
  bound_tenant_id: string;
}

export interface NeonAuthProviderOptions {
  readonly database: Database;
  /**
   * The schema Neon Auth installed into. `neon_auth` unless Neon changes it.
   *
   * Validated against a strict pattern before it reaches SQL, because it is interpolated
   * rather than bound — a schema name cannot be a bind parameter. It comes from deployment
   * configuration and not from a request, but "comes from configuration" has never been a
   * reason to skip the check.
   */
  readonly schema?: string;
}

const SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;

export class NeonAuthIdentityProvider implements IdentityProvider {
  readonly id = NEON_AUTH_PROVIDER_ID;
  readonly label = 'Your organization account';

  readonly #database: Database;
  readonly #schema: string;

  constructor(options: NeonAuthProviderOptions) {
    const schema = options.schema ?? 'neon_auth';
    if (!SCHEMA_NAME.test(schema)) {
      throw new Error(`Not a valid schema name: ${JSON.stringify(schema)}`);
    }
    this.#database = options.database;
    this.#schema = schema;
  }

  /**
   * `input.token` is the Better Auth session token, taken from its cookie by the caller.
   *
   * Everything below runs through `readGlobal`: no tenant context exists yet, and the
   * READ ONLY transaction means this path cannot write even by mistake.
   */
  async authenticate(input: Readonly<Record<string, string>>): Promise<AuthenticationOutcome> {
    const token = input['token'];
    if (typeof token !== 'string' || token.length === 0) {
      return { ok: false, reason: 'MALFORMED_RESPONSE' };
    }

    const schema = this.#schema;

    return this.#database.readGlobal(async (db) => {
      // Expiry compared against now() — the database's clock — so a skewed application
      // server cannot hold a session open past its end.
      const found = await db.query<SessionRow>(
        `SELECT s."userId"        AS user_id,
                u.email           AS email,
                u.name            AS display_name,
                u."emailVerified" AS email_verified,
                u.banned          AS banned,
                u."banExpires"    AS ban_expires,
                s."activeOrganizationId" AS active_organization_id
           FROM ${schema}.session s
           JOIN ${schema}."user" u ON u.id = s."userId"
          WHERE s.token = $1 AND s."expiresAt" > now()`,
        [token],
      );

      const session = found.rows[0];
      if (session === undefined) return { ok: false, reason: 'NO_SUCH_IDENTITY' };

      // Better Auth's admin plugin can ban a user with an optional expiry. A ban with no
      // expiry is permanent; one in the future is in force. Honoured here as well as by the
      // platform's own `users.status`, because a district that bans someone in the identity
      // provider expects that to be the end of it.
      const banned =
        session.banned === true &&
        (session.ban_expires === null || session.ban_expires.getTime() > Date.now());
      if (banned) return { ok: false, reason: 'PROVIDER_REFUSED' };

      let organizationId = session.active_organization_id;

      if (organizationId === null) {
        // No active organization: fall back to a sole membership. Two is not a tie to break.
        const memberships = await db.query<OrganizationRow>(
          `SELECT m."organizationId" AS organization_id
             FROM ${schema}.member m
            WHERE m."userId" = $1
            LIMIT 2`,
          [session.user_id],
        );
        if (memberships.rows.length !== 1) return { ok: false, reason: 'PROVIDER_REFUSED' };
        organizationId = memberships.rows[0]?.organization_id ?? null;
        if (organizationId === null) return { ok: false, reason: 'PROVIDER_REFUSED' };
      }

      const binding = await db.query<BindingRow>(
        `SELECT bound_tenant_id
           FROM identity_organization_bindings
          WHERE provider = $1 AND provider_organization_id = $2 AND disabled_at IS NULL`,
        [NEON_AUTH_PROVIDER_ID, organizationId],
      );

      const boundTenantId = binding.rows[0]?.bound_tenant_id;
      if (boundTenantId === undefined) {
        // Authenticated, but this organization is not federated to any district — or its
        // binding was disabled. Not a misconfiguration to paper over: without it there is no
        // tenant whose data this person is entitled to, and guessing is not available.
        return { ok: false, reason: 'PROVIDER_MISCONFIGURED' };
      }

      const claim: SubjectClaim = {
        tenantId: boundTenantId,
        // Better Auth's user id is the stable subject. Not the email, which is reassignable
        // — see `claim.ts` for why matching on a mailbox hands a successor the predecessor's
        // access.
        subjectId: session.user_id,
        email: session.email,
        displayName: session.display_name,
        // Neon Auth's base schema records email verification, not a second factor, and the
        // two are not the same thing. Claiming MFA from `emailVerified` would let a
        // vendor-staff account past the check section 18 makes mandatory, so this reports
        // what it can actually see: no second factor asserted.
        mfaSatisfied: false,
        issuer: NEON_AUTH_PROVIDER_ID,
      };
      return { ok: true, claim };
    });
  }
}
