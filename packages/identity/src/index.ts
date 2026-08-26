/**
 * @complianceos/identity — who is acting, and what they may do.
 *
 * Spec: Master Technical Buildout section 18. CLAUDE.md invariant 7.
 *
 * The shape of the whole package in four lines:
 *
 *   a provider authenticates and yields a SubjectClaim   (claim.ts, providers/)
 *   a claim is resolved against the database to a Principal  (resolve.ts)
 *   the identity — never the authority — is sealed into a session  (session.ts)
 *   every later request re-resolves the Principal from that session  (resolve.ts)
 *
 * Nothing here constructs a `Principal` except `resolve.ts`, and nothing reads a tenant id
 * from a browser request. Those two facts together are invariant 7.
 */

export * from './claim.js';
export * from './principal.js';
export * from './providers/demo.js';
export * from './providers/neon-auth.js';
export * from './resolve.js';
export * from './session.js';
