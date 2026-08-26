/**
 * What each environment makes this deployment, and what it must never make it.
 *
 * Spec: Master Technical Buildout sections 18 and 19.
 *
 * This file exists because of a live 500. Neon's Vercel integration injects `DATABASE_URL`
 * into a linked project; nothing injects a `SESSION_SECRET`; and an earlier version of
 * `config.ts` threw on that combination. The throw took down every application route on a
 * preview deployment — including the rule registry and, had they not been in another route
 * group, the marketing pages, none of which need a database at all.
 *
 * The rule these tests pin is the one that replaced it: **a configuration problem downgrades
 * capability and says so; it never takes the site down.** Every downgrade is toward less
 * access, so the failure mode is a deployment that will not let anyone in, rather than one
 * that lets the wrong person in or serves nobody at all.
 */

import { describe, expect, it } from 'vitest';
import { configFrom } from './config.js';

const SECRET = 'x'.repeat(48);
const DB = 'postgres://app:pw@db.example/neondb';
const TENANT = '4f2b1c8e-6a3d-4e51-9b27-0c8d5e1a7f43';

describe('a deployment with neither half', () => {
  it('is unconnected, and says why', () => {
    const config = configFrom({});
    expect(config.kind).toBe('UNCONNECTED');
    if (config.kind !== 'UNCONNECTED') return;
    expect(config.reason).toContain('no DATABASE_URL');
  });
});

describe('a deployment with only half', () => {
  it('does not throw when a database is injected without a session secret', () => {
    // The exact regression. Neon's integration sets DATABASE_URL on a linked Vercel project
    // and nothing sets a secret; this must serve the site, not 500 it.
    expect(() => configFrom({ DATABASE_URL: DB })).not.toThrow();
  });

  it('disables sign-in rather than the deployment, and names the missing secret', () => {
    const config = configFrom({ DATABASE_URL: DB });
    expect(config.kind).toBe('UNCONNECTED');
    if (config.kind !== 'UNCONNECTED') return;
    expect(config.reason).toContain('SESSION_SECRET');
    // Actionable, not just descriptive: the reason is rendered on the sign-in page.
    expect(config.reason).toContain('openssl rand');
  });

  it('is unconnected with a secret but no database, and says which way round', () => {
    const config = configFrom({ SESSION_SECRET: SECRET });
    expect(config.kind).toBe('UNCONNECTED');
    if (config.kind !== 'UNCONNECTED') return;
    expect(config.reason).toContain('SESSION_SECRET is set but DATABASE_URL is not');
  });

  it('treats an empty string as absent, because a platform sets those', () => {
    expect(configFrom({ DATABASE_URL: '', SESSION_SECRET: '' }).kind).toBe('UNCONNECTED');
    expect(configFrom({ DATABASE_URL: DB, SESSION_SECRET: '' }).kind).toBe('UNCONNECTED');
  });
});

describe('a fully configured deployment', () => {
  it('is connected', () => {
    const config = configFrom({ DATABASE_URL: DB, SESSION_SECRET: SECRET });
    expect(config.kind).toBe('CONNECTED');
  });

  it('refuses a session secret shorter than the sealer accepts', () => {
    // This one still throws, and should: it comes from the SessionSealer's own constructor,
    // and a deployment signing sessions with a weak key is not a downgrade, it is a lie.
    expect(() => configFrom({ DATABASE_URL: DB, SESSION_SECRET: 'short' })).toThrow();
  });

  it('caps the session lifetime at the package ceiling', () => {
    const config = configFrom({ DATABASE_URL: DB, SESSION_SECRET: SECRET });
    if (config.kind !== 'CONNECTED') throw new Error('expected CONNECTED');
    expect(config.sessionTtlSeconds).toBeLessThanOrEqual(8 * 60 * 60);
    expect(config.sessionTtlSeconds).toBeGreaterThan(0);
  });
});

describe('the demonstration sign-in', () => {
  const base = { DATABASE_URL: DB, SESSION_SECRET: SECRET };

  it('is offered when a tenant is named outside production', () => {
    const config = configFrom({ ...base, DEMO_TENANT_ID: TENANT, NODE_ENV: 'development' });
    if (config.kind !== 'CONNECTED') throw new Error('expected CONNECTED');
    expect(config.demoTenantId).toBe(TENANT);
  });

  it('is withheld in production without taking the deployment down', () => {
    // Two independent controls stop this reaching production; the provider refuses at
    // construction too. What this one adds is that nobody is offered a form in the first
    // place — and, since the earlier version threw here, that the site still serves.
    const config = configFrom({ ...base, DEMO_TENANT_ID: TENANT, VERCEL_ENV: 'production' });
    expect(config.kind).toBe('CONNECTED');
    if (config.kind !== 'CONNECTED') return;
    expect(config.demoTenantId).toBeUndefined();
  });

  it('is still offered on a Vercel preview, where NODE_ENV is also production', () => {
    // Keying off NODE_ENV alone would refuse on every preview — where a demo roster is the
    // entire point — and whoever hit that would reach for an override.
    const config = configFrom({
      ...base,
      DEMO_TENANT_ID: TENANT,
      VERCEL_ENV: 'preview',
      NODE_ENV: 'production',
    });
    if (config.kind !== 'CONNECTED') throw new Error('expected CONNECTED');
    expect(config.demoTenantId).toBe(TENANT);
  });

  it('is withheld when the id is not a uuid rather than reaching SQL', () => {
    for (const bad of ['northfield', '../../etc', "' OR '1'='1", '']) {
      const config = configFrom({ ...base, DEMO_TENANT_ID: bad, NODE_ENV: 'development' });
      if (config.kind !== 'CONNECTED') throw new Error('expected CONNECTED');
      expect(config.demoTenantId).toBeUndefined();
    }
  });

  it('is absent when no tenant is named', () => {
    const config = configFrom({ ...base, NODE_ENV: 'development' });
    if (config.kind !== 'CONNECTED') throw new Error('expected CONNECTED');
    expect(config.demoTenantId).toBeUndefined();
  });
});
