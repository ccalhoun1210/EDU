/**
 * What a forged, tampered, stale or malformed session token gets.
 *
 * Spec: Master Technical Buildout sections 18, 19 and 26.4. CLAUDE.md invariant 7.
 *
 * The session cookie is the only thing standing between an anonymous request and a
 * district's fiscal position, so the interesting tests here are the ones that try to get
 * past it. A round-trip test proves the happy path and almost nothing else; the value is
 * below, in the cases that must fail.
 *
 * The suite signs its own payloads where it needs to, using the same secret the sealer has.
 * That is deliberately a *stronger* attacker than the real one — someone who can compute
 * valid MACs — because it isolates the checks that must hold even then: version, claim
 * shape, issue time, expiry and the lifetime ceiling. An attacker without the secret is
 * covered by the signature cases.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_SESSION_TTL_SECONDS,
  MIN_SECRET_LENGTH,
  SESSION_COOKIE_NAME,
  SESSION_FORMAT_VERSION,
  SessionError,
  SessionSealer,
  sessionCookieOptions,
} from './session.js';

const SECRET = 'a'.repeat(MIN_SECRET_LENGTH);
const OTHER_SECRET = 'b'.repeat(MIN_SECRET_LENGTH);
const TTL = 3600;

/** A fixed instant, so nothing here depends on how long the suite takes to run. */
const T0 = Date.UTC(2026, 7, 26, 12, 0, 0);

function sealerAt(millis: { value: number }, secret = SECRET, ttl = TTL): SessionSealer {
  return new SessionSealer(secret, ttl, () => millis.value);
}

function identity() {
  return { tenantId: randomUUID(), userId: randomUUID(), subjectId: 'sub-0001' };
}

/** Encode and sign an arbitrary payload with a chosen secret — the strong-attacker tool. */
function forge(payload: unknown, secret = SECRET): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(encoded, 'utf8')
    .digest()
    .toString('base64url');
  return `${encoded}.${mac}`;
}

function decode(token: string): Record<string, unknown> {
  const segment = token.split('.')[0] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('SessionSealer construction', () => {
  it('refuses a secret shorter than the floor rather than signing weakly', () => {
    expect(() => new SessionSealer('short', TTL)).toThrow(SessionError);
    expect(() => new SessionSealer('x'.repeat(MIN_SECRET_LENGTH - 1), TTL)).toThrow(SessionError);
    expect(() => new SessionSealer('x'.repeat(MIN_SECRET_LENGTH), TTL)).not.toThrow();
  });

  it('refuses an absent secret instead of falling back to a default', () => {
    // The failure mode this guards is a deployment that starts anyway with a built-in key,
    // which is the same as no key at all because the key is in the repository.
    expect(() => new SessionSealer(undefined as unknown as string, TTL)).toThrow(SessionError);
    expect(() => new SessionSealer('', TTL)).toThrow(SessionError);
  });

  it('refuses a lifetime beyond the ceiling, and any non-positive one', () => {
    expect(() => new SessionSealer(SECRET, MAX_SESSION_TTL_SECONDS + 1)).toThrow(SessionError);
    expect(() => new SessionSealer(SECRET, 0)).toThrow(SessionError);
    expect(() => new SessionSealer(SECRET, -1)).toThrow(SessionError);
    expect(() => new SessionSealer(SECRET, 1.5)).toThrow(SessionError);
    expect(() => new SessionSealer(SECRET, MAX_SESSION_TTL_SECONDS)).not.toThrow();
  });
});

describe('sealing and verifying', () => {
  it('round-trips the identity it was given', () => {
    const clock = { value: T0 };
    const sealer = sealerAt(clock);
    const who = identity();

    const { token, payload } = sealer.seal(who);
    const verified = sealer.verify(token);

    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.payload.tid).toBe(who.tenantId);
    expect(verified.payload.uid).toBe(who.userId);
    expect(verified.payload.sub).toBe(who.subjectId);
    expect(verified.payload.sid).toBe(payload.sid);
    expect(verified.payload.exp - verified.payload.iat).toBe(TTL);
  });

  it('carries no role, capability or scope — authority is not in the token', () => {
    // The design claim of session.ts, asserted rather than left to the prose. If a
    // capability is ever added here, revoking it stops taking effect until expiry.
    const sealer = sealerAt({ value: T0 });
    const claims = Object.keys(decode(sealer.seal(identity()).token)).sort();

    expect(claims).toEqual(['exp', 'iat', 'sid', 'sub', 'tid', 'uid', 'v']);
  });

  it('mints a distinct session id per sign-in', () => {
    const sealer = sealerAt({ value: T0 });
    const who = identity();
    expect(sealer.seal(who).payload.sid).not.toBe(sealer.seal(who).payload.sid);
  });

  it('refuses to seal a tenant or user id that is not a uuid', () => {
    const sealer = sealerAt({ value: T0 });
    expect(() => sealer.seal({ ...identity(), tenantId: 'alpha' })).toThrow(SessionError);
    expect(() => sealer.seal({ ...identity(), userId: '../../etc/passwd' })).toThrow(SessionError);
    expect(() => sealer.seal({ ...identity(), subjectId: '' })).toThrow(SessionError);
  });
});

describe('forgery and tampering', () => {
  it('rejects a token signed with a different secret', () => {
    const clock = { value: T0 };
    const token = sealerAt(clock, OTHER_SECRET).seal(identity()).token;

    expect(sealerAt(clock).verify(token)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects a swapped tenant id — invariant 7 through the front door', () => {
    // The attack the whole design exists to stop: take your own valid session, change the
    // tenant to someone else's, and read their district. The payload is re-encoded, so the
    // MAC no longer matches what was signed.
    const clock = { value: T0 };
    const sealer = sealerAt(clock);
    const { token } = sealer.seal(identity());

    const payload = decode(token);
    payload['tid'] = randomUUID();
    const swapped = `${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.${
      token.split('.')[1] ?? ''
    }`;

    expect(sealer.verify(swapped)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects a flipped byte anywhere in either segment', () => {
    const clock = { value: T0 };
    const sealer = sealerAt(clock);
    const { token } = sealer.seal(identity());

    // Every position, not a sampled few: a check that only covers the payload would miss a
    // signature that was being compared by prefix, and vice versa.
    for (let index = 0; index < token.length; index += 1) {
      if (token[index] === '.') continue;
      const flipped = token[index] === 'A' ? 'B' : 'A';
      const mutated = token.slice(0, index) + flipped + token.slice(index + 1);
      expect(sealer.verify(mutated).ok).toBe(false);
    }
  });

  it('rejects a signature that is a truncation of the real one', () => {
    // A comparison written with `startsWith`, or one that compared only the first n bytes,
    // would pass this. `timingSafeEqual` on equal lengths is what makes it fail.
    const clock = { value: T0 };
    const sealer = sealerAt(clock);
    const [encoded, mac] = sealer.seal(identity()).token.split('.');

    expect(sealer.verify(`${encoded ?? ''}.${(mac ?? '').slice(0, 20)}`)).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects an unsigned or extra-segment token rather than reading the first parts', () => {
    const sealer = sealerAt({ value: T0 });
    const { token } = sealer.seal(identity());
    const [encoded, mac] = token.split('.');

    expect(sealer.verify(encoded ?? '')).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(sealer.verify(`${token}.extra`)).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(sealer.verify(`.${mac ?? ''}`)).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(sealer.verify('')).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(sealer.verify('....')).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('has no algorithm field an attacker could downgrade', () => {
    // The JWT `alg: none` family, checked at the root. The property is not that a token
    // mentioning an algorithm is rejected — an unknown field is simply ignored, and the
    // first assertion pins that, since a signed payload is a signed payload. It is that
    // saying so buys nothing: the MAC is still required, and still computed the one way
    // this file computes it. So the same claim without the secret fails exactly as any
    // other forgery does, and an empty signature is not a way to opt out of checking.
    const sealer = sealerAt({ value: T0 });
    const { payload } = sealer.seal(identity());

    expect(sealer.verify(forge({ ...payload, alg: 'none' })).ok).toBe(true);
    expect(sealer.verify(forge({ ...payload, alg: 'none' }, OTHER_SECRET))).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
    expect(sealer.verify(`${forge(payload).split('.')[0] ?? ''}.`)).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects a MAC computed with a weaker digest over the same payload', () => {
    const sealer = sealerAt({ value: T0 });
    const { payload } = sealer.seal(identity());
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sha1 = createHmac('sha1', Buffer.from(SECRET, 'utf8'))
      .update(encoded, 'utf8')
      .digest()
      .toString('base64url');

    expect(sealer.verify(`${encoded}.${sha1}`)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects a payload that is valid JSON but not an object', () => {
    const sealer = sealerAt({ value: T0 });
    expect(sealer.verify(forge('a string')).ok).toBe(false);
    expect(sealer.verify(forge(null)).ok).toBe(false);
    expect(sealer.verify(forge([1, 2, 3])).ok).toBe(false);
  });

  it('rejects a correctly signed payload that is not JSON at all', () => {
    const encoded = Buffer.from('not json', 'utf8').toString('base64url');
    const mac = createHmac('sha256', Buffer.from(SECRET, 'utf8'))
      .update(encoded, 'utf8')
      .digest()
      .toString('base64url');

    expect(sealerAt({ value: T0 }).verify(`${encoded}.${mac}`)).toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
  });
});

describe('claims a signed payload still cannot make', () => {
  const clock = { value: T0 };
  const nowSeconds = Math.floor(T0 / 1000);
  const valid = {
    v: SESSION_FORMAT_VERSION,
    sid: randomUUID(),
    tid: randomUUID(),
    uid: randomUUID(),
    sub: 'sub-0001',
    iat: nowSeconds - 10,
    exp: nowSeconds + TTL,
  };

  it('accepts the baseline, so the negatives below are about one field each', () => {
    expect(sealerAt(clock).verify(forge(valid)).ok).toBe(true);
  });

  it('rejects a version it does not implement', () => {
    const sealer = sealerAt(clock);
    expect(sealer.verify(forge({ ...valid, v: SESSION_FORMAT_VERSION + 1 }))).toEqual({
      ok: false,
      reason: 'UNSUPPORTED_VERSION',
    });
    expect(sealer.verify(forge({ ...valid, v: '1' })).ok).toBe(false);
    const versionless: Record<string, unknown> = { ...valid };
    delete versionless['v'];
    expect(sealer.verify(forge(versionless)).ok).toBe(false);
  });

  it('rejects a tenant, user or session id that is not a uuid', () => {
    // The second layer behind `Database.withTenant`'s own check. A tid of
    // "00000000-0000-0000-0000-000000000000' OR '1'='1" never reaches SQL, and it never
    // reaches the resolver either.
    const sealer = sealerAt(clock);
    for (const field of ['tid', 'uid', 'sid'] as const) {
      expect(sealer.verify(forge({ ...valid, [field]: 'alpha' }))).toEqual({
        ok: false,
        reason: 'INVALID_CLAIM',
      });
      expect(sealer.verify(forge({ ...valid, [field]: 42 })).ok).toBe(false);
      expect(sealer.verify(forge({ ...valid, [field]: null })).ok).toBe(false);
    }
  });

  it('rejects an empty or non-string subject', () => {
    const sealer = sealerAt(clock);
    expect(sealer.verify(forge({ ...valid, sub: '' })).ok).toBe(false);
    expect(sealer.verify(forge({ ...valid, sub: { nested: true } })).ok).toBe(false);
  });

  it('rejects a lifetime longer than the ceiling even though the MAC is good', () => {
    // The only ways to hold such a token are a leaked secret or a past misconfiguration.
    // Both are reasons to stop, so a valid signature is not enough on its own.
    expect(
      sealerAt(clock).verify(
        forge({ ...valid, iat: nowSeconds - 10, exp: nowSeconds + MAX_SESSION_TTL_SECONDS + 60 }),
      ),
    ).toEqual({ ok: false, reason: 'INVALID_CLAIM' });
  });

  it('rejects non-finite timestamps', () => {
    const sealer = sealerAt(clock);
    // JSON has no Infinity, so it arrives as null — which must not read as zero.
    expect(sealer.verify(forge({ ...valid, exp: Infinity })).ok).toBe(false);
    expect(sealer.verify(forge({ ...valid, iat: NaN })).ok).toBe(false);
  });
});

describe('the clock', () => {
  const nowSeconds = Math.floor(T0 / 1000);

  it('rejects a token once it expires, at the boundary second', () => {
    const clock = { value: T0 };
    const sealer = sealerAt(clock);
    const { token } = sealer.seal(identity());

    clock.value = T0 + (TTL - 1) * 1000;
    expect(sealer.verify(token).ok).toBe(true);

    // `exp <= now` rather than `<`: the second it names is the first second it is dead.
    clock.value = T0 + TTL * 1000;
    expect(sealer.verify(token)).toEqual({ ok: false, reason: 'EXPIRED' });

    clock.value = T0 + (TTL + 86400) * 1000;
    expect(sealer.verify(token)).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('rejects a token issued in the future rather than tolerating skew', () => {
    const clock = { value: T0 };
    expect(
      sealerAt(clock).verify(
        forge({
          ...{
            v: SESSION_FORMAT_VERSION,
            sid: randomUUID(),
            tid: randomUUID(),
            uid: randomUUID(),
            sub: 'sub-0001',
          },
          iat: nowSeconds + 60,
          exp: nowSeconds + 60 + TTL,
        }),
      ),
    ).toEqual({ ok: false, reason: 'NOT_YET_VALID' });
  });

  it('does not extend a session by re-verifying it', () => {
    // Sliding expiry would make a stolen cookie immortal so long as it kept being used.
    const clock = { value: T0 };
    const sealer = sealerAt(clock);
    const { token } = sealer.seal(identity());

    for (let elapsed = 0; elapsed < TTL; elapsed += 600) {
      clock.value = T0 + elapsed * 1000;
      expect(sealer.verify(token).ok).toBe(true);
    }
    clock.value = T0 + TTL * 1000;
    expect(sealer.verify(token)).toEqual({ ok: false, reason: 'EXPIRED' });
  });
});

describe('the cookie it travels in', () => {
  it('uses the __Host- prefix, which the browser enforces', () => {
    // Not decoration: the prefix makes the browser refuse the cookie unless it is Secure,
    // has no Domain and is path '/'. That is what stops a compromised subdomain from
    // writing a session cookie this app would then read.
    expect(SESSION_COOKIE_NAME.startsWith('__Host-')).toBe(true);
  });

  it('is httpOnly, secure, lax and rooted, with the session lifetime', () => {
    expect(sessionCookieOptions(TTL)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: TTL,
    });
  });
});
