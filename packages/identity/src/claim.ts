/**
 * What an identity provider yields, and the port every provider implements.
 *
 * Spec: Master Technical Buildout section 18 — "Use a B2B identity provider such as
 * WorkOS/Auth0 **or an abstraction that permits replacement**". This is that abstraction.
 *
 * ## Why the claim names a tenant
 *
 * `users` is keyed `(tenant_id, subject_id)` and sits behind RLS, so looking a user up
 * requires tenant context, which is exactly what a sign-in does not yet have. Something has
 * to break that circle, and the only honest place is the provider.
 *
 * In the B2B model this platform is built for, that is not a compromise but the actual
 * shape of the thing: a district authenticates through its own connection — its SAML
 * federation, its Google Workspace or Entra tenant — and the connection *is* the district.
 * WorkOS calls it an organization, Auth0 calls it a connection; either way the mapping from
 * connection to tenant is configuration held by the platform, not a value the person
 * signing in gets to choose. A claim that arrived without a tenant would leave us matching
 * on email domain, and two districts sharing a domain (a county office and its schools, a
 * charter network) would then be one tenant, which is a data breach spelled as a feature.
 *
 * So: the provider is trusted to say which tenant, because the provider's configuration is
 * ours. It is trusted for nothing else — the claim confers no authority whatever. See
 * `resolve.ts`, which is where a claim becomes a principal, and where every one of these
 * fields is checked against the database before it means anything.
 */

/**
 * An authenticated identity, as asserted by a provider.
 *
 * Every field here is a *claim*, not a fact about this platform. `email` and `displayName`
 * are the provider's view of the person and are used to keep the local `users` row current;
 * they are never used to find the row. Only `subjectId` does that, because it is the one
 * field an IdP guarantees is stable — an email address gets reassigned when someone leaves
 * a district and their successor inherits the mailbox, and matching on it would hand the
 * successor the predecessor's access.
 */
export interface SubjectClaim {
  /** Which tenant this provider connection belongs to. Platform configuration, not input. */
  readonly tenantId: string;
  /** The IdP subject: SAML NameID, OIDC `sub`. Stable across renames. */
  readonly subjectId: string;
  readonly email: string;
  readonly displayName: string;
  /**
   * Whether the provider asserts a second factor was satisfied.
   *
   * Recorded on the user row and on the audit event. Section 18 requires MFA for vendor and
   * admin staff; enforcing that is the resolver's job, and it needs this to do it.
   */
  readonly mfaSatisfied: boolean;
  /** Identifies the provider for the audit record. Matches `IdentityProvider.id`. */
  readonly issuer: string;
}

/** Why an authentication attempt failed. Never echoed to the browser in detail. */
export type AuthenticationRefusal =
  'NO_SUCH_IDENTITY' | 'PROVIDER_REFUSED' | 'PROVIDER_MISCONFIGURED' | 'MALFORMED_RESPONSE';

export type AuthenticationOutcome =
  | { readonly ok: true; readonly claim: SubjectClaim }
  | { readonly ok: false; readonly reason: AuthenticationRefusal };

/**
 * The port.
 *
 * Narrow on purpose. It does not model a redirect dance, because this platform has one
 * provider today and inventing a protocol for the second one before it exists would fix the
 * shape around guesses. What it does fix is the part that matters and that a replacement
 * must not be allowed to change: authentication produces a claim and nothing else, and a
 * claim is not authority.
 *
 * `input` is whatever the sign-in exchange produced — posted form fields for a local
 * provider, callback query parameters for an OIDC one. Deliberately untyped beyond
 * `string`: it is attacker-controlled, and giving it a shape here would invite a provider
 * to trust that shape.
 */
export interface IdentityProvider {
  /** Stable identifier, recorded as the issuer on audit events. */
  readonly id: string;
  /** Shown on the sign-in page. */
  readonly label: string;
  authenticate(input: Readonly<Record<string, string>>): Promise<AuthenticationOutcome>;
}
