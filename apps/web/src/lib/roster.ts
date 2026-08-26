import 'server-only';

/**
 * The demonstration sign-in roster, read from the database rather than from configuration.
 *
 * Spec: Master Technical Buildout section 18.
 *
 * `DemoIdentityProvider` takes a roster and signs you in as any entry on it, so where that
 * roster comes from decides how dangerous it is. Reading it from `users` — inside
 * `withTenant`, under RLS, for the one tenant `DEMO_TENANT_ID` names — means the demo can
 * only ever produce a claim for somebody who genuinely exists in that district and
 * genuinely holds an active membership. A roster in an environment variable could name
 * anyone in any tenant, and would be a second, drifting copy of the user list besides.
 *
 * Suspended and deprovisioned users are excluded here as well as being refused by the
 * resolver. Not redundancy for its own sake: offering a suspended person on a sign-in page
 * and then refusing them is a confusing way to say "no", and listing them at all discloses
 * that the account exists.
 */

import { DemoIdentityProvider, type DemoIdentity } from '@complianceos/identity';
import { appConfig, type ConnectedConfig } from './config.js';

interface RosterRow {
  subject_id: string;
  email: string;
  display_name: string;
  mfa_enrolled: boolean;
}

/**
 * The roster for the configured demonstration tenant, or `null` where none is configured.
 *
 * `null` is the ordinary case: an unconnected deployment, or a connected one that has not
 * asked for a demo sign-in. Only a connected deployment with `DEMO_TENANT_ID` gets a list.
 */
export async function demoRoster(): Promise<readonly DemoIdentity[] | null> {
  const config = appConfig();
  if (config.kind !== 'CONNECTED' || config.demoTenantId === undefined) return null;

  const tenantId = config.demoTenantId;
  const rows = await config.database.withTenant(tenantId, async (db) =>
    db.query<RosterRow>(
      `SELECT u.subject_id, u.email, u.display_name, u.mfa_enrolled
         FROM users u
        WHERE u.status = 'ACTIVE'
          AND EXISTS (
                SELECT 1 FROM memberships m
                 WHERE m.user_id = u.id AND m.revoked_at IS NULL
              )
        ORDER BY u.display_name, u.subject_id`,
    ),
  );

  // The handle is the subject id. Using the email would make the sign-in page's form values
  // the very field `resolve.ts` refuses to match on, which is the sort of inconsistency that
  // survives right up until someone reuses it in the real provider.
  return rows.rows.map((row) => ({
    handle: row.subject_id,
    tenantId,
    subjectId: row.subject_id,
    email: row.email,
    displayName: row.display_name,
    mfaSatisfied: row.mfa_enrolled,
  }));
}

/**
 * Build the provider for a roster just read.
 *
 * Constructed per sign-in rather than held, because the roster is database state and a
 * provider cached at boot would keep offering a person after their membership was revoked.
 * The construction is trivial; the staleness would not be.
 */
export function demoProviderFor(roster: readonly DemoIdentity[]): DemoIdentityProvider {
  return new DemoIdentityProvider({ roster, acknowledgeNoAuthentication: true });
}

/** Narrowing helper, so route handlers do not each re-derive what "connected" means. */
export function connected(): ConnectedConfig | null {
  const config = appConfig();
  return config.kind === 'CONNECTED' ? config : null;
}
