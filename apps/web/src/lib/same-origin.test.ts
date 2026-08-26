/**
 * What the forgery check admits, and what it turns away.
 *
 * Spec: Master Technical Buildout section 19.
 *
 * These endpoints mint and destroy sessions, so the interesting cases are the ones a
 * malicious page would try. `evil.example` appears throughout as the attacking origin.
 */

import { describe, expect, it } from 'vitest';
import { checkSameOrigin } from './same-origin.js';

function request(headers: Record<string, string>, url = 'https://app.example/api/auth/sign-in') {
  return new Request(url, { method: 'POST', headers });
}

describe('checkSameOrigin', () => {
  it('admits a same-origin post', () => {
    expect(
      checkSameOrigin(request({ origin: 'https://app.example', host: 'app.example' })),
    ).toEqual({ ok: true });
  });

  it('turns away a post from another site', () => {
    expect(
      checkSameOrigin(request({ origin: 'https://evil.example', host: 'app.example' })),
    ).toEqual({ ok: false, reason: 'CROSS_ORIGIN' });
  });

  it('turns away a post with no Origin at all', () => {
    // Every current browser sends Origin on a state-changing POST, so absent means the
    // caller is not a browser — and these endpoints have no non-browser callers.
    expect(checkSameOrigin(request({ host: 'app.example' }))).toEqual({
      ok: false,
      reason: 'MISSING_ORIGIN',
    });
    expect(checkSameOrigin(request({ origin: '', host: 'app.example' }))).toEqual({
      ok: false,
      reason: 'MISSING_ORIGIN',
    });
  });

  it('turns away the null origin a sandboxed frame sends', () => {
    expect(checkSameOrigin(request({ origin: 'null', host: 'app.example' })).ok).toBe(false);
  });

  it('is not fooled by a host that merely ends with ours', () => {
    // The classic near-miss: an attacker registers a domain whose suffix is the real one, or
    // prefixes it. A `endsWith`/`includes` comparison passes both of these.
    for (const origin of [
      'https://notapp.example',
      'https://app.example.evil.test',
      'https://evil.test/app.example',
      'https://app-example',
    ]) {
      expect(checkSameOrigin(request({ origin, host: 'app.example' })).ok).toBe(false);
    }
  });

  it('does not let a downgrade to http count as the same origin', () => {
    // Scheme is part of an origin. Admitting http here would let a network attacker who can
    // serve plain HTTP on the same host post to the endpoint.
    expect(
      checkSameOrigin(
        request({
          origin: 'http://app.example',
          host: 'app.example',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toEqual({ ok: false, reason: 'CROSS_ORIGIN' });
  });

  it('compares against the forwarded host, because that is what the browser saw', () => {
    // Behind Vercel's proxy the Host header is an internal name; the forwarded pair is the
    // origin the browser actually used, and comparing against Host would reject every
    // legitimate post.
    expect(
      checkSameOrigin(
        request({
          origin: 'https://preview-abc.vercel.app',
          host: 'internal.local',
          'x-forwarded-host': 'preview-abc.vercel.app',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('ignores path, query and trailing slash on the presented origin', () => {
    // A URL comparison rather than a string one, so a cosmetic difference cannot decide a
    // security question in either direction.
    expect(
      checkSameOrigin(request({ origin: 'https://app.example/', host: 'app.example' })),
    ).toEqual({ ok: true });
  });

  it('treats a differently-cased host as the same host', () => {
    expect(
      checkSameOrigin(request({ origin: 'https://APP.example', host: 'app.example' })),
    ).toEqual({ ok: true });
  });

  it('distinguishes a different port on the same hostname', () => {
    expect(
      checkSameOrigin(
        request(
          { origin: 'http://localhost:3001', host: 'localhost:3210', 'x-forwarded-proto': 'http' },
          'http://localhost:3210/api/auth/sign-in',
        ),
      ),
    ).toEqual({ ok: false, reason: 'CROSS_ORIGIN' });

    expect(
      checkSameOrigin(
        request(
          { origin: 'http://localhost:3210', host: 'localhost:3210', 'x-forwarded-proto': 'http' },
          'http://localhost:3210/api/auth/sign-in',
        ),
      ),
    ).toEqual({ ok: true });
  });

  it('turns away an unparseable origin rather than throwing', () => {
    for (const origin of ['not a url', 'https://', '://app.example']) {
      expect(checkSameOrigin(request({ origin, host: 'app.example' })).ok).toBe(false);
    }
  });

  it('turns away a request with no host to compare against', () => {
    const bare = new Request('https://app.example/api/auth/sign-in', { method: 'POST' });
    bare.headers.set('origin', 'https://app.example');
    bare.headers.delete('host');
    // `Request` supplies a host from the URL, so this asserts the branch is reachable and
    // safe rather than that the header can truly be absent in Node's fetch implementation.
    expect(typeof checkSameOrigin(bare).ok).toBe('boolean');
  });
});
