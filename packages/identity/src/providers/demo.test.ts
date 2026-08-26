/**
 * That the demonstration provider cannot reach production.
 *
 * Spec: Master Technical Buildout sections 18 and 19.
 *
 * This provider signs anyone in as anyone on its roster. Everything below is about the two
 * independent conditions that have to hold before it will exist at all, and the fact that
 * neither can be satisfied by accident.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEMO_PROVIDER_ID,
  DemoIdentityProvider,
  DemoProviderRefused,
  looksLikeProduction,
} from './demo.js';
import type { DemoIdentity } from './demo.js';

const TENANT = randomUUID();

const ROSTER: readonly DemoIdentity[] = [
  {
    handle: 'director',
    tenantId: TENANT,
    subjectId: 'sub-director',
    email: 'director@northfield.invalid',
    displayName: 'Special Education Director',
    mfaSatisfied: true,
  },
  {
    handle: 'no-mfa',
    tenantId: TENANT,
    subjectId: 'sub-no-mfa',
    email: 'support@vendor.invalid',
    displayName: 'Vendor Support',
    mfaSatisfied: false,
  },
];

/** A non-production environment, stated explicitly so no test inherits the runner's. */
const DEVELOPMENT = { NODE_ENV: 'development' } as const;

function provider(env: Readonly<Record<string, string | undefined>> = DEVELOPMENT) {
  return new DemoIdentityProvider({ roster: ROSTER, acknowledgeNoAuthentication: true, env });
}

describe('looksLikeProduction', () => {
  it('treats a Vercel production deployment as production', () => {
    expect(looksLikeProduction({ VERCEL_ENV: 'production', NODE_ENV: 'production' })).toBe(true);
  });

  it('does not treat a Vercel preview as production, though NODE_ENV says so', () => {
    // Vercel builds previews with NODE_ENV=production. Keying off it alone would refuse on
    // every preview — where a demo roster is the whole point — and whoever hit that would
    // reach for an override, which is how the refusal stops meaning anything.
    expect(looksLikeProduction({ VERCEL_ENV: 'preview', NODE_ENV: 'production' })).toBe(false);
    expect(looksLikeProduction({ VERCEL_ENV: 'development', NODE_ENV: 'production' })).toBe(false);
  });

  it('falls back to NODE_ENV where there is no Vercel, for a self-hosted build', () => {
    expect(looksLikeProduction({ NODE_ENV: 'production' })).toBe(true);
    expect(looksLikeProduction({ NODE_ENV: 'development' })).toBe(false);
    expect(looksLikeProduction({})).toBe(false);
  });
});

describe('the two refusals', () => {
  it('refuses to be constructed in production', () => {
    expect(
      () =>
        new DemoIdentityProvider({
          roster: ROSTER,
          acknowledgeNoAuthentication: true,
          env: { VERCEL_ENV: 'production' },
        }),
    ).toThrow(DemoProviderRefused);

    expect(
      () =>
        new DemoIdentityProvider({
          roster: ROSTER,
          acknowledgeNoAuthentication: true,
          env: { NODE_ENV: 'production' },
        }),
    ).toThrow(DemoProviderRefused);
  });

  it('refuses without the acknowledgement, even outside production', () => {
    // The second control, which catches the different failure: the right provider on the
    // wrong deployment is the environment check; the wrong provider anywhere is this one.
    expect(
      () =>
        new DemoIdentityProvider({
          roster: ROSTER,
          acknowledgeNoAuthentication: false,
          env: DEVELOPMENT,
        }),
    ).toThrow(DemoProviderRefused);

    expect(
      () =>
        new DemoIdentityProvider({
          roster: ROSTER,
          acknowledgeNoAuthentication: undefined as unknown as boolean,
          env: DEVELOPMENT,
        }),
    ).toThrow(DemoProviderRefused);
  });

  it('refuses an empty roster and a duplicated handle', () => {
    expect(
      () =>
        new DemoIdentityProvider({
          roster: [],
          acknowledgeNoAuthentication: true,
          env: DEVELOPMENT,
        }),
    ).toThrow(DemoProviderRefused);

    const first = ROSTER[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(
      () =>
        new DemoIdentityProvider({
          roster: [first, { ...first, subjectId: 'sub-other' }],
          acknowledgeNoAuthentication: true,
          env: DEVELOPMENT,
        }),
    ).toThrow(DemoProviderRefused);
  });
});

describe('authenticating against the roster', () => {
  it('yields the claim for a known handle, stamped with the issuer', async () => {
    const outcome = await provider().authenticate({ handle: 'director' });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.claim).toEqual({
      tenantId: TENANT,
      subjectId: 'sub-director',
      email: 'director@northfield.invalid',
      displayName: 'Special Education Director',
      mfaSatisfied: true,
      issuer: DEMO_PROVIDER_ID,
    });
  });

  it('can produce an identity without MFA, so the resolver has something to refuse', async () => {
    // A demo roster where every entry asserts MFA cannot exercise the vendor-staff rule at
    // all, which would leave the one control section 18 makes mandatory untested end to end.
    const outcome = await provider().authenticate({ handle: 'no-mfa' });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.claim.mfaSatisfied).toBe(false);
  });

  it('refuses an unknown handle rather than defaulting to the first entry', async () => {
    expect(await provider().authenticate({ handle: 'nobody' })).toEqual({
      ok: false,
      reason: 'NO_SUCH_IDENTITY',
    });
  });

  it('refuses a missing or empty handle', async () => {
    expect(await provider().authenticate({})).toEqual({ ok: false, reason: 'MALFORMED_RESPONSE' });
    expect(await provider().authenticate({ handle: '' })).toEqual({
      ok: false,
      reason: 'MALFORMED_RESPONSE',
    });
  });

  it('does not let a prototype key select an identity', async () => {
    // The roster is a Map, so `__proto__` and `constructor` are ordinary missing keys
    // rather than inherited properties that would resolve to something.
    for (const handle of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(await provider().authenticate({ handle })).toEqual({
        ok: false,
        reason: 'NO_SUCH_IDENTITY',
      });
    }
  });

  it('exposes the roster for the sign-in page without exposing a credential', async () => {
    // There is nothing to leak, which is the point: the schema forbids storing one and this
    // provider stores none. The assertion is that no field here is secret-shaped.
    const listed = provider().roster;
    expect(listed.map((entry) => entry.handle)).toEqual(['director', 'no-mfa']);
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual([
      'displayName',
      'email',
      'handle',
      'mfaSatisfied',
      'subjectId',
      'tenantId',
    ]);
  });
});
