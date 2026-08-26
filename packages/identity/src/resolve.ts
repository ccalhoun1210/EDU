/**
 * Where a claim becomes a principal — the only place authority is granted.
 *
 * Spec: Master Technical Buildout section 18. CLAUDE.md invariant 7.
 *
 * Two entry points, and the difference between them is the point of the file:
 *
 * - {@link establishPrincipal} runs once, at sign-in, from a provider's claim. It may write:
 *   it refreshes the local user row from the claim and flips an invitation to active.
 * - {@link loadPrincipal} runs on every request, from a verified session payload. It writes
 *   nothing and trusts nothing but the database.
 *
 * Both end at the same place — `buildPrincipal` — so there is one definition of what
 * authority a user has, and no path where a session confers something a sign-in would not
 * have. Everything happens inside `withTenant`, so every statement below is executing under
 * RLS as the non-owner application role: a query that forgot its tenant predicate returns
 * nothing rather than another district's rows.
 *
 * ## The session is not the authority
 *
 * `loadPrincipal` re-reads status, memberships and scopes on every request. That is the
 * reason `session.ts` keeps them out of the token. Suspending a user or revoking a
 * membership takes effect on their next request; nothing has to wait for a token to expire,
 * and there is no revocation list to keep, because the grant table *is* the list.
 */

import type { Database } from '@complianceos/db';
import type { SubjectClaim } from './claim.js';
import type { AccessScope, Capability, Membership, Principal, Role } from './principal.js';
import { isRole } from './principal.js';
import type { SessionPayload } from './session.js';

/**
 * Why a person with a valid claim or a valid session still gets nothing.
 *
 * Each is a distinct decision the platform made, and they are kept apart because the
 * operator's next action differs: `NOT_PROVISIONED` is an invitation to send, `SUSPENDED`
 * is deliberate, `NO_ACTIVE_MEMBERSHIP` is a grant that was revoked or never made, and
 * `MFA_REQUIRED` is a configuration problem at the identity provider.
 */
export type PrincipalRefusal =
  'NOT_PROVISIONED' | 'SUSPENDED' | 'DEPROVISIONED' | 'NO_ACTIVE_MEMBERSHIP' | 'MFA_REQUIRED';

export type PrincipalOutcome =
  | { readonly ok: true; readonly principal: Principal }
  | { readonly ok: false; readonly reason: PrincipalRefusal };

interface UserRow {
  id: string;
  subject_id: string;
  email: string;
  display_name: string;
  status: string;
  is_vendor_staff: boolean;
  mfa_enrolled: boolean;
}

interface MembershipRow {
  id: string;
  role: string;
  may_export: boolean;
  may_read_student_identity: boolean;
  may_configure: boolean;
}

interface ScopeRow {
  membership_id: string;
  organization_id: string;
  school_site_id: string | null;
  module: string | null;
}

/** A connection with tenant context already established. */
type Conn = Parameters<Parameters<Database['withTenant']>[1]>[0];

function capabilitiesOf(row: MembershipRow): readonly Capability[] {
  const capabilities: Capability[] = [];
  if (row.may_export) capabilities.push('EXPORT');
  if (row.may_read_student_identity) capabilities.push('READ_STUDENT_IDENTITY');
  if (row.may_configure) capabilities.push('CONFIGURE');
  return capabilities;
}

/**
 * Turn a user row into a principal, or refuse.
 *
 * `status` is checked here rather than in the SQL so that "suspended" and "not provisioned"
 * stay distinguishable. A `WHERE status = 'ACTIVE'` would collapse both into an empty
 * result, and the operator reading the audit log could not tell a revoked account from one
 * that was never created — which are opposite problems with opposite fixes.
 */
async function buildPrincipal(
  db: Conn,
  user: UserRow,
  sessionId: string,
  mfaSatisfied: boolean,
): Promise<PrincipalOutcome> {
  if (user.status === 'SUSPENDED') return { ok: false, reason: 'SUSPENDED' };
  if (user.status === 'DEPROVISIONED') return { ok: false, reason: 'DEPROVISIONED' };

  // Section 18: "mandatory MFA for vendor/admin staff". Enforced against the live user row
  // rather than against anything the session carried, so marking someone vendor staff locks
  // their existing sessions out of the next request unless their IdP asserts a second
  // factor — which is what marking them vendor staff was for.
  if (user.is_vendor_staff && !mfaSatisfied) return { ok: false, reason: 'MFA_REQUIRED' };

  const memberships = await db.query<MembershipRow>(
    `SELECT id, role, may_export, may_read_student_identity, may_configure
       FROM memberships
      WHERE user_id = $1 AND revoked_at IS NULL
      ORDER BY granted_at, id`,
    [user.id],
  );

  if (memberships.rows.length === 0) return { ok: false, reason: 'NO_ACTIVE_MEMBERSHIP' };

  const resolved: Membership[] = [];
  for (const row of memberships.rows) {
    // A role outside the known set means the database moved ahead of this build. Skipping
    // the membership is the safe reading: it withholds authority this code cannot reason
    // about, rather than granting it under a name it does not understand.
    if (!isRole(row.role)) continue;
    resolved.push({
      membershipId: row.id,
      role: row.role satisfies Role,
      capabilities: capabilitiesOf(row),
    });
  }

  if (resolved.length === 0) return { ok: false, reason: 'NO_ACTIVE_MEMBERSHIP' };

  const scopes = await db.query<ScopeRow>(
    `SELECT membership_id, organization_id, school_site_id, module
       FROM access_scopes
      WHERE membership_id = ANY($1::uuid[]) AND revoked_at IS NULL
      ORDER BY granted_at, id`,
    [resolved.map((m) => m.membershipId)],
  );

  const resolvedScopes: AccessScope[] = scopes.rows.map((row) => ({
    membershipId: row.membership_id,
    organizationId: row.organization_id,
    schoolSiteId: row.school_site_id,
    // The column is CHECKed against the module list, so anything present is one of them.
    // Cast rather than re-validate: a value that got past the CHECK is the database's
    // assertion, and re-deriving it here would be a second, drifting copy of that list.
    module: row.module as AccessScope['module'],
  }));

  return {
    ok: true,
    principal: {
      tenantId: db.tenantId,
      userId: user.id,
      subjectId: user.subject_id,
      email: user.email,
      displayName: user.display_name,
      isVendorStaff: user.is_vendor_staff,
      memberships: resolved,
      scopes: resolvedScopes,
      sessionId,
    },
  };
}

/**
 * Sign-in: turn a provider's claim into a principal.
 *
 * Matches on `subject_id` and nothing else. Not on email — see `claim.ts` for why matching
 * on a reassignable mailbox hands a departing employee's access to their successor.
 *
 * There is no just-in-time provisioning here, deliberately. A person who authenticates
 * successfully against a district's federated identity provider but has no `users` row in
 * that tenant gets `NOT_PROVISIONED`, not an account. Auto-creating one would mean that
 * everybody with a district email address — every teacher, every student on the same
 * Workspace tenant — becomes a user of a fiscal compliance platform the moment they try
 * the URL. Provisioning stays an administrative act with a record of who performed it.
 */
export function establishPrincipal(
  database: Database,
  claim: SubjectClaim,
  sessionId: string,
): Promise<PrincipalOutcome> {
  return database.withTenant(claim.tenantId, async (db) => {
    const found = await db.query<UserRow>(
      `SELECT id, subject_id, email, display_name, status, is_vendor_staff, mfa_enrolled
         FROM users
        WHERE subject_id = $1`,
      [claim.subjectId],
    );

    const existing = found.rows[0];
    if (existing === undefined) return { ok: false, reason: 'NOT_PROVISIONED' };

    // Refuse before writing. A suspended account should not have its display name refreshed
    // or its last_seen_at bumped by an attempt it was never going to be allowed to complete
    // — the log of that attempt belongs in audit_events, not in the user row.
    if (existing.status === 'SUSPENDED') return { ok: false, reason: 'SUSPENDED' };
    if (existing.status === 'DEPROVISIONED') return { ok: false, reason: 'DEPROVISIONED' };

    // The identity provider is the authority on who this person is and what they are
    // called, so the local row follows it. An invitation is redeemed by its first
    // successful sign-in; every other status is left alone rather than being reset to
    // ACTIVE by a login, which would let a sign-in undo an administrative decision.
    const updated = await db.query<UserRow>(
      `UPDATE users
          SET email = $2,
              display_name = $3,
              mfa_enrolled = $4,
              status = CASE WHEN status = 'INVITED' THEN 'ACTIVE' ELSE status END,
              last_seen_at = now()
        WHERE id = $1
        RETURNING id, subject_id, email, display_name, status, is_vendor_staff, mfa_enrolled`,
      [existing.id, claim.email, claim.displayName, claim.mfaSatisfied],
    );

    const user = updated.rows[0];
    // Unreachable in practice — the row was just read inside this transaction and RLS
    // cannot hide it from a statement running under the same tenant. Handled anyway so the
    // type is honest rather than asserted away with a non-null assertion.
    if (user === undefined) return { ok: false, reason: 'NOT_PROVISIONED' };

    return buildPrincipal(db, user, sessionId, claim.mfaSatisfied);
  });
}

/**
 * Every request after the first: turn a verified session payload into a principal.
 *
 * The payload has already been proved to be one this process sealed (`SessionSealer.verify`),
 * so its tenant and user ids are trustworthy as *identifiers*. They are still not authority:
 * everything that decides what the user may do is read fresh below.
 *
 * `subject_id` is compared as well as `user_id`. The pair was minted together, so a
 * disagreement means the row was re-keyed to a different IdP subject since — someone
 * deprovisioned and a new person took the seat. Treating that as `NOT_PROVISIONED` forces a
 * fresh sign-in rather than letting an old cookie address the new occupant's account.
 */
export function loadPrincipal(
  database: Database,
  payload: SessionPayload,
): Promise<PrincipalOutcome> {
  return database.withTenant(payload.tid, async (db) => {
    const found = await db.query<UserRow>(
      `SELECT id, subject_id, email, display_name, status, is_vendor_staff, mfa_enrolled
         FROM users
        WHERE id = $1 AND subject_id = $2`,
      [payload.uid, payload.sub],
    );

    const user = found.rows[0];
    if (user === undefined) return { ok: false, reason: 'NOT_PROVISIONED' };

    // The MFA assertion came from the identity provider at sign-in and is not re-asserted
    // per request, so the enrolment recorded on the row is what a later request has to go
    // on. Read from the row rather than carried in the token: if an administrator marks
    // someone vendor staff, the very next request re-evaluates it against this.
    return buildPrincipal(db, user, payload.sid, user.mfa_enrolled);
  });
}
