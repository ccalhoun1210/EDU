/**
 * The demonstration identity provider.
 *
 * Spec: Master Technical Buildout section 18 — "email/password for early pilots if
 * necessary". This is the pilot provider, and it is not that: it stores no credential,
 * because `users.subject_id` is documented as "Never a password hash: this platform does
 * not store credentials", and adding a password column to work around that would be
 * arguing with the schema rather than reading it.
 *
 * What it does instead is let a caller sign in as one of a fixed roster configured at
 * construction. That is honest about what it is — a way to walk through the product before
 * a district's SSO is federated — and it is exactly as dangerous as it sounds, because
 * anyone who can reach it can become anyone on the roster.
 *
 * ## Two independent refusals
 *
 * So it refuses to exist in production, twice over, and both checks must pass:
 *
 * 1. The caller must pass `acknowledgeNoAuthentication: true`. Nobody constructs this by
 *    accident or by copying a line from another provider.
 * 2. The environment must not look like production.
 *
 * Two controls rather than one because they fail differently. The flag protects against a
 * developer wiring the wrong provider; the environment check protects against the right
 * provider reaching the wrong deployment. Neither catches the other's case.
 *
 * `VERCEL_ENV` is the signal that actually distinguishes a Vercel production deployment
 * from a preview, and `NODE_ENV` is not: Vercel builds previews with `NODE_ENV=production`
 * too, so keying off it alone would refuse on every preview — where a demo roster is the
 * entire point — and teach whoever hit that to reach for an override. `NODE_ENV` is still
 * consulted for a self-hosted production build, where `VERCEL_ENV` is absent and it is the
 * only signal there is.
 */

import type { AuthenticationOutcome, IdentityProvider, SubjectClaim } from '../claim.js';

/** One roster entry. The same fields a real provider would assert about a person. */
export interface DemoIdentity {
  /** How the roster entry is selected at sign-in. Not a secret and not a credential. */
  readonly handle: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly email: string;
  readonly displayName: string;
  /**
   * Whether to claim MFA. Present so a demo roster can exercise the resolver's MFA
   * enforcement for vendor staff rather than routing around it — a demo that can only
   * produce the passing case tests nothing.
   */
  readonly mfaSatisfied: boolean;
}

export class DemoProviderRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoProviderRefused';
  }
}

export interface DemoProviderOptions {
  readonly roster: readonly DemoIdentity[];
  /**
   * Must be `true`. Named for what accepting it means rather than for what it enables:
   * this provider performs no authentication whatsoever.
   */
  readonly acknowledgeNoAuthentication: boolean;
  /**
   * The environment to judge. Defaults to `process.env`. Injected so the production-refusal
   * test can present a production environment without setting one on the test runner.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Whether an environment is one where an unauthenticated sign-in must never be offered.
 *
 * Exported because the app needs to make the same judgement when deciding whether to mount
 * the sign-in form at all, and two spellings of "is this production" that could disagree is
 * how the form ends up mounted on the one deployment that mattered.
 */
export function looksLikeProduction(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const vercelEnv = env['VERCEL_ENV'];
  if (vercelEnv !== undefined) return vercelEnv === 'production';
  return env['NODE_ENV'] === 'production';
}

export const DEMO_PROVIDER_ID = 'demo';

export class DemoIdentityProvider implements IdentityProvider {
  readonly id = DEMO_PROVIDER_ID;
  readonly label = 'Demonstration roster';

  readonly #byHandle: ReadonlyMap<string, DemoIdentity>;

  constructor(options: DemoProviderOptions) {
    if (options.acknowledgeNoAuthentication !== true) {
      throw new DemoProviderRefused(
        'The demonstration provider performs no authentication. Construct it only with ' +
          'acknowledgeNoAuthentication: true.',
      );
    }
    if (looksLikeProduction(options.env ?? process.env)) {
      throw new DemoProviderRefused(
        'The demonstration provider signs anyone in as anyone on its roster and must not ' +
          'be reachable in production. Federate the district identity provider instead.',
      );
    }
    if (options.roster.length === 0) {
      throw new DemoProviderRefused('A demonstration roster with no identities signs nobody in.');
    }

    const byHandle = new Map<string, DemoIdentity>();
    for (const identity of options.roster) {
      if (byHandle.has(identity.handle)) {
        // A duplicated handle would make which identity you get depend on roster order,
        // which is precisely the sort of thing that is fine in a demo right up until a
        // screenshot shows the wrong district's figures.
        throw new DemoProviderRefused(`Duplicate roster handle: ${identity.handle}`);
      }
      byHandle.set(identity.handle, identity);
    }
    this.#byHandle = byHandle;
  }

  /** The roster, for rendering the sign-in page. */
  get roster(): readonly DemoIdentity[] {
    return [...this.#byHandle.values()];
  }

  authenticate(input: Readonly<Record<string, string>>): Promise<AuthenticationOutcome> {
    const handle = input['handle'];
    if (typeof handle !== 'string' || handle.length === 0) {
      return Promise.resolve({ ok: false, reason: 'MALFORMED_RESPONSE' });
    }

    const identity = this.#byHandle.get(handle);
    if (identity === undefined) {
      return Promise.resolve({ ok: false, reason: 'NO_SUCH_IDENTITY' });
    }

    const claim: SubjectClaim = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      email: identity.email,
      displayName: identity.displayName,
      mfaSatisfied: identity.mfaSatisfied,
      issuer: this.id,
    };
    return Promise.resolve({ ok: true, claim });
  }
}
