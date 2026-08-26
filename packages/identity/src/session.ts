/**
 * The sealed session token.
 *
 * Spec: Master Technical Buildout sections 18 and 19. CLAUDE.md invariant 7.
 *
 * ## What is in the token, and what is deliberately not
 *
 * The token carries *identity*: which tenant, which user, which subject claim, which
 * session, and when it expires. It carries no role, no capability and no scope.
 *
 * That split is the whole design. Authority is re-read from `memberships` and
 * `access_scopes` on every request (see `resolve.ts`), so revoking a membership takes
 * effect on the next request rather than whenever the token happens to expire. A token
 * carrying `may_read_student_identity` would keep conferring it for the rest of its
 * lifetime after the grant was withdrawn — for the two capabilities this platform cares
 * most about, export and student identity, that is not an acceptable window.
 *
 * The cost is a database read per request. That is the right trade for a compliance
 * product: it is one indexed lookup, and the alternative is a revocation that does not
 * revoke.
 *
 * ## Why this is not a JWT
 *
 * A JWT names its own algorithm in a header the verifier is then invited to trust. The
 * resulting family of attacks — `alg: none`, HMAC-vs-RSA confusion — exists because the
 * attacker gets a say in how their forgery will be checked. Here the algorithm is fixed in
 * this file, appears nowhere in the token, and cannot be influenced by the token's contents.
 * There is exactly one way a token is verified.
 *
 * The MAC is computed over the *encoded* payload string, not over a re-serialization of the
 * decoded object. So there is no canonicalization question: any byte that differs from what
 * was signed produces a different MAC, whatever it decodes to.
 *
 * ## Format
 *
 *   base64url(JSON payload) "." base64url(HMAC-SHA256 over the first segment)
 *
 * Opaque to the browser by intent. It is not a place to put anything the user should read;
 * it is signed, not encrypted, and its contents are visible to anyone holding the cookie.
 * Nothing in the payload is a secret — ids and timestamps — which is why signing suffices.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Bumped when the payload's meaning changes.
 *
 * Verified before any field is used, so an old token cannot be reinterpreted under new
 * rules — the failure is a clean rejection and a re-authentication, not a field silently
 * read as something it never meant.
 */
export const SESSION_FORMAT_VERSION = 1;

/**
 * A ceiling on how long a sealed session may be asked to last.
 *
 * Enforced at seal time rather than only at configuration time so that no caller can mint a
 * decade-long token by passing a large ttl. Eight hours is a working day: long enough that
 * a district officer is not re-authenticating over lunch, short enough that a stolen cookie
 * is not a standing key.
 */
export const MAX_SESSION_TTL_SECONDS = 8 * 60 * 60;

/**
 * The shortest secret this will accept.
 *
 * 32 bytes of base64 or hex is the smallest thing that is credibly a key rather than a
 * passphrase somebody typed. Refusing short secrets at construction is the only moment when
 * anyone is looking; a weak key discovered later is discovered by someone else.
 */
export const MIN_SECRET_LENGTH = 32;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

/** Why a token was rejected. Never shown to the user; recorded, and useful in tests. */
export type SessionRejection =
  | 'MALFORMED'
  | 'BAD_SIGNATURE'
  | 'UNSUPPORTED_VERSION'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'INVALID_CLAIM';

export interface SessionPayload {
  /** Format version. Checked before anything else is read. */
  readonly v: number;
  /** Session id. Recorded on audit events, and the handle a future revocation list needs. */
  readonly sid: string;
  /** Tenant id. The only source `withTenant` is ever given for a browser request. */
  readonly tid: string;
  /** User id, within the tenant. */
  readonly uid: string;
  /** The IdP subject claim this session was minted from. */
  readonly sub: string;
  /** Issued at, seconds since the epoch. */
  readonly iat: number;
  /** Expires at, seconds since the epoch. */
  readonly exp: number;
}

export type SessionVerification =
  | { readonly ok: true; readonly payload: SessionPayload }
  | { readonly ok: false; readonly reason: SessionRejection };

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

/**
 * The sealer.
 *
 * One per process, constructed from configuration. Holding the secret in an instance rather
 * than reading `process.env` at each call means a missing secret is a startup failure in one
 * place, not a runtime failure at the first sign-in.
 */
export class SessionSealer {
  readonly #secret: Buffer;
  readonly #ttlSeconds: number;
  readonly #now: () => number;

  /**
   * @param secret       The signing key. Refused if shorter than {@link MIN_SECRET_LENGTH}.
   * @param ttlSeconds   Session lifetime. Capped at {@link MAX_SESSION_TTL_SECONDS}.
   * @param now          Injectable clock, in milliseconds. Tests drive expiry with it; in
   *                     production it is `Date.now`. Injected rather than mocked globally
   *                     so that an expiry test cannot accidentally pass by not advancing a
   *                     clock nobody was reading.
   */
  constructor(secret: string, ttlSeconds: number, now: () => number = Date.now) {
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
      throw new SessionError(
        `Session secret must be at least ${MIN_SECRET_LENGTH} characters; got ` +
          `${typeof secret === 'string' ? String(secret.length) : typeof secret}. ` +
          'Refusing to start rather than signing with a weak or absent key.',
      );
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new SessionError(`Session ttl must be a positive whole number of seconds.`);
    }
    if (ttlSeconds > MAX_SESSION_TTL_SECONDS) {
      throw new SessionError(
        `Session ttl of ${String(ttlSeconds)}s exceeds the ${String(MAX_SESSION_TTL_SECONDS)}s ` +
          'ceiling.',
      );
    }

    this.#secret = Buffer.from(secret, 'utf8');
    this.#ttlSeconds = ttlSeconds;
    this.#now = now;
  }

  #sign(encodedPayload: string): string {
    return base64url(createHmac('sha256', this.#secret).update(encodedPayload, 'utf8').digest());
  }

  /**
   * Mint a token for an authenticated identity.
   *
   * `sessionId` defaults to a fresh UUID. It is accepted as a parameter only so a caller
   * that has already written an audit record can seal the same id it recorded, rather than
   * having to reconcile two.
   */
  seal(identity: { tenantId: string; userId: string; subjectId: string; sessionId?: string }): {
    token: string;
    payload: SessionPayload;
  } {
    if (!UUID.test(identity.tenantId)) {
      throw new SessionError(`Not a valid tenant id: ${JSON.stringify(identity.tenantId)}`);
    }
    if (!UUID.test(identity.userId)) {
      throw new SessionError(`Not a valid user id: ${JSON.stringify(identity.userId)}`);
    }
    if (identity.subjectId.length === 0) {
      throw new SessionError('A session cannot be sealed without a subject claim.');
    }

    const issuedAt = Math.floor(this.#now() / 1000);
    const payload: SessionPayload = {
      v: SESSION_FORMAT_VERSION,
      sid: identity.sessionId ?? randomUUID(),
      tid: identity.tenantId,
      uid: identity.userId,
      sub: identity.subjectId,
      iat: issuedAt,
      exp: issuedAt + this.#ttlSeconds,
    };

    const encoded = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
    return { token: `${encoded}.${this.#sign(encoded)}`, payload };
  }

  /**
   * Verify a token and return its payload, or say why not.
   *
   * Returns a result rather than throwing: a bad cookie is an ordinary condition on a public
   * endpoint, not an exception, and an exception here would tempt a caller into a catch that
   * swallows the reason.
   *
   * Order matters. The signature is checked before any field is read, so a forged payload
   * never reaches the parsing or validation logic below it.
   */
  verify(token: string): SessionVerification {
    if (typeof token !== 'string') return { ok: false, reason: 'MALFORMED' };

    // Exactly one separator. Splitting and checking the count rejects both a token with no
    // signature and one with extra segments, rather than quietly using the first two.
    const parts = token.split('.');
    if (parts.length !== 2) return { ok: false, reason: 'MALFORMED' };

    const [encoded, signature] = parts;
    if (encoded === undefined || signature === undefined || encoded.length === 0) {
      return { ok: false, reason: 'MALFORMED' };
    }

    const expected = Buffer.from(this.#sign(encoded), 'utf8');
    const presented = Buffer.from(signature, 'utf8');

    // `timingSafeEqual` throws on a length mismatch, which would itself be a length oracle
    // if it escaped. Checked first, and a mismatch is the same answer a wrong MAC gets.
    if (expected.length !== presented.length) return { ok: false, reason: 'BAD_SIGNATURE' };
    if (!timingSafeEqual(expected, presented)) return { ok: false, reason: 'BAD_SIGNATURE' };

    // Only now is the payload worth parsing. Everything below this line is data this
    // process signed itself, which is what makes it safe to act on.
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'MALFORMED' };
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return { ok: false, reason: 'MALFORMED' };
    }
    const candidate = parsed as Record<string, unknown>;

    if (candidate['v'] !== SESSION_FORMAT_VERSION) {
      return { ok: false, reason: 'UNSUPPORTED_VERSION' };
    }

    const { sid, tid, uid, sub, iat, exp } = candidate;
    if (
      typeof sid !== 'string' ||
      typeof tid !== 'string' ||
      typeof uid !== 'string' ||
      typeof sub !== 'string' ||
      typeof iat !== 'number' ||
      typeof exp !== 'number' ||
      !UUID.test(sid) ||
      !UUID.test(tid) ||
      !UUID.test(uid) ||
      sub.length === 0 ||
      !Number.isFinite(iat) ||
      !Number.isFinite(exp)
    ) {
      return { ok: false, reason: 'INVALID_CLAIM' };
    }

    const nowSeconds = Math.floor(this.#now() / 1000);

    // No skew allowance in the permissive direction. A token that claims to have been
    // issued in the future is not a clock problem to be tolerated, it is a token this
    // process would not have minted.
    if (iat > nowSeconds) return { ok: false, reason: 'NOT_YET_VALID' };
    if (exp <= nowSeconds) return { ok: false, reason: 'EXPIRED' };

    // A token whose own lifetime exceeds the ceiling is rejected even though it verifies,
    // because the only ways to hold one are a secret leak or a past misconfiguration, and
    // both are reasons to stop rather than to honour it.
    if (exp - iat > MAX_SESSION_TTL_SECONDS) return { ok: false, reason: 'INVALID_CLAIM' };

    return { ok: true, payload: { v: SESSION_FORMAT_VERSION, sid, tid, uid, sub, iat, exp } };
  }
}

/**
 * The cookie the sealed token lives in, and the attributes it must carry.
 *
 * Gathered here so the app cannot set the cookie one way in one route and another way in
 * the next. `__Host-` is not decoration: the prefix is enforced by the browser and means
 * the cookie must be Secure, must have no Domain, and must be path `/` — which together
 * stop a subdomain, including one an attacker got hold of, from writing a session cookie
 * this app would then read.
 */
export const SESSION_COOKIE_NAME = '__Host-complianceos_session';

export interface SessionCookieOptions {
  readonly httpOnly: true;
  readonly secure: true;
  readonly sameSite: 'lax';
  readonly path: '/';
  readonly maxAge: number;
}

/**
 * `sameSite: 'lax'` rather than `'strict'`: a district officer following a link from an
 * email into a finding should arrive signed in, and lax already blocks the cross-site POST
 * that CSRF needs. `httpOnly` because no script has any reason to read this value, and the
 * value is the session.
 */
export function sessionCookieOptions(ttlSeconds: number): SessionCookieOptions {
  return { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: ttlSeconds };
}
