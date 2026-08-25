/**
 * Organization vocabulary.
 *
 * Spec: Master Technical Buildout section 6. A parent/child relationship never
 * implies data access — access is always explicit. The helper below exists so that
 * invariant is expressed in code rather than only in prose.
 */

export const ORGANIZATION_TYPES = [
  'STATE_AGENCY',
  'LEA_DISTRICT',
  'SCHOOL',
  'EARLY_INTERVENTION_PROGRAM',
  'OTHER_MONITORED_ENTITY',
] as const;

export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export interface AccessScope {
  readonly tenantId: string;
  readonly organizationId: string;
}

/**
 * Parent organizations do NOT inherit access to child organization data.
 * A scope grants access to exactly the organization it names.
 */
export function grantsAccessTo(scopes: readonly AccessScope[], target: AccessScope): boolean {
  return scopes.some(
    (scope) => scope.tenantId === target.tenantId && scope.organizationId === target.organizationId,
  );
}
