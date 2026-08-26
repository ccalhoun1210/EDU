/**
 * Who is acting, on behalf of which tenant, and what they are permitted to do.
 *
 * Spec: Master Technical Buildout section 18 (Identity, RBAC and ABAC). ADR 0004.
 * CLAUDE.md invariants 7 and 10.
 *
 * A `Principal` is the answer to that question for one request. It is assembled
 * server-side, from the database, on every request — never deserialized from anything the
 * browser sent. The session token says *who*; this says *what they may do*, and the two are
 * deliberately different objects with different lifetimes. See `session.ts` for why.
 *
 * ## Roles and capabilities are not the same axis
 *
 * Section 18 lists roles (District Administrator, Fiscal Officer, …) and, separately,
 * scopes that include "student-identity access", "export permission" and "configuration
 * permission". Those three are modelled here as capabilities carried by the membership
 * rather than as consequences of a role, matching the `memberships` table.
 *
 * The reason is invariant 10 and the export threat in section 26.4. If reading student
 * identifiers were implied by a role, then granting someone a role for an unrelated reason
 * would silently grant it, and the grant would be invisible in any list of who may read
 * identifiers. Making it a separate boolean means "who can read student identity" is a
 * query, and "Read Only" cannot quietly come to mean "may export the whole district".
 */

/**
 * The roles in `memberships.role`.
 *
 * Kept in the same order as the CHECK constraint so the two can be read side by side, and
 * asserted equal to it by test rather than by hope.
 */
export const ROLES = [
  'DISTRICT_ADMINISTRATOR',
  'SPECIAL_EDUCATION_DIRECTOR',
  'FEDERAL_PROGRAMS_DIRECTOR',
  'FISCAL_OFFICER',
  'COMPLIANCE_REVIEWER',
  'SCHOOL_ADMINISTRATOR',
  'EVIDENCE_CONTRIBUTOR',
  'READ_ONLY',
  'STATE_REVIEWER',
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * The capabilities granted per membership, independently of role.
 *
 * These are the three booleans on `memberships`. They are unioned across a user's active
 * memberships: holding any membership that grants export means the user may export.
 */
export const CAPABILITIES = ['EXPORT', 'READ_STUDENT_IDENTITY', 'CONFIGURE'] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** The modules an access scope may be narrowed to. Mirrors `access_scopes.module`. */
export const MODULES = ['IDEA_FISCAL', 'DISPROPORTIONALITY', 'SPED_PROGRAMMATIC'] as const;

export type Module = (typeof MODULES)[number];

/**
 * One grant of access to an organization, optionally narrowed to a site and/or a module.
 *
 * `null` is wider than a value in both fields, exactly as the schema comments say:
 * a null `schoolSiteId` means the whole organization, a null `module` means every module
 * the tenant has enabled. That asymmetry is why `coversModule` below cannot be a plain
 * equality check.
 */
export interface AccessScope {
  readonly membershipId: string;
  readonly organizationId: string;
  /** `null` means the whole organization rather than one site. */
  readonly schoolSiteId: string | null;
  /** `null` means every enabled module rather than one. */
  readonly module: Module | null;
}

/** One active membership: a role, and the capabilities that came with it. */
export interface Membership {
  readonly membershipId: string;
  readonly role: Role;
  readonly capabilities: readonly Capability[];
}

/**
 * The acting user, resolved for one request.
 *
 * `tenantId` is the value that will be handed to `Database.withTenant`, and it reached this
 * object from the sealed session token by way of the database — never from a header, a
 * query parameter or a body. Invariant 7 is enforced by there being no other constructor:
 * `resolvePrincipal` is the only way to make one.
 */
export interface Principal {
  readonly tenantId: string;
  readonly userId: string;
  /** The IdP subject claim this user was matched on. Useful in audit records. */
  readonly subjectId: string;
  readonly email: string;
  readonly displayName: string;
  readonly isVendorStaff: boolean;
  readonly memberships: readonly Membership[];
  readonly scopes: readonly AccessScope[];
  /** The session this principal was resolved for. Recorded on every audit event. */
  readonly sessionId: string;
}

/** Every role the principal holds, across all active memberships. */
export function rolesOf(principal: Principal): readonly Role[] {
  return [...new Set(principal.memberships.map((m) => m.role))];
}

/**
 * Whether the principal holds a capability through *any* active membership.
 *
 * Union rather than intersection: a user who is both a Fiscal Officer with export and a
 * Read Only reviewer without it can export. That is what granting the first membership
 * meant, and an intersection would make adding a narrow role silently remove access.
 */
export function can(principal: Principal, capability: Capability): boolean {
  return principal.memberships.some((m) => m.capabilities.includes(capability));
}

/** Whether the principal holds a given role. */
export function hasRole(principal: Principal, role: Role): boolean {
  return principal.memberships.some((m) => m.role === role);
}

/**
 * Whether the principal may act on an organization, and optionally on one of its sites.
 *
 * A scope with a null `schoolSiteId` covers every site in that organization; a scope naming
 * a site covers only that site. Asking about the organization itself (`siteId` omitted) is
 * satisfied by any scope on it, site-narrowed or not — a site administrator can still see
 * that the organization is the one they belong to.
 */
export function coversOrganization(
  principal: Principal,
  organizationId: string,
  siteId?: string,
): boolean {
  return principal.scopes.some((scope) => {
    if (scope.organizationId !== organizationId) return false;
    if (siteId === undefined) return true;
    return scope.schoolSiteId === null || scope.schoolSiteId === siteId;
  });
}

/**
 * Whether the principal may act within a module.
 *
 * A `null` module on a scope is a wildcard, so this is not equality. Written out rather
 * than folded into `coversOrganization` because a module check with no organization in hand
 * is a real question — "may this user open IDEA Fiscal at all" — asked before any
 * organization has been chosen.
 */
export function coversModule(principal: Principal, module: Module): boolean {
  return principal.scopes.some((scope) => scope.module === null || scope.module === module);
}

/**
 * A principal with no active membership is not a principal.
 *
 * Exported so the resolver and the tests agree on the definition rather than each spelling
 * it out. A user row can exist — invited, suspended, or with every membership revoked —
 * without conferring any authority at all, and treating "row exists" as "may act" is the
 * mistake this guards.
 */
export function hasAnyAuthority(principal: Principal): boolean {
  return principal.memberships.length > 0;
}
