/**
 * The tamper-evident audit log.
 *
 * Spec: Master Technical Buildout section 21, and the section 25 threat-model row
 * "audit-log manipulation — append-only permissions, hash chain, sealed digests". Section 19
 * supplies the just-in-time support-access context that a support actor's events must carry.
 *
 * ## What this module is defending against
 *
 * Ordinary activity logging answers "what happened?". This answers a harder question: "can
 * anyone show that what the log says today is what it said then?" The adversary is assumed
 * to have write access to the audit table — a compromised operator, a rogue support user, a
 * SQL injection that reaches past the application. Against that adversary there are four
 * distinct attacks, and a design that only stops the first is not tamper-evident:
 *
 * 1. **Mutation** — change a field of a stored event.
 * 2. **Deletion** — remove an inconvenient event from the middle.
 * 3. **Insertion** — fabricate an event that makes an action look authorised.
 * 4. **Reordering** — move an event so that it appears to precede its own authorisation.
 *
 * Each event commits to its predecessor's hash, so the chain is a total order that cannot be
 * cut, spliced or shuffled without breaking a link. `verifyChain` reports the *first* break
 * and why, because the index of the first break is the interesting forensic fact — everything
 * after it is downstream damage.
 *
 * A hash chain alone cannot detect a fifth attack: **truncation** of the tail. Lopping the
 * last N events off a chain leaves a chain that verifies perfectly. That is what `sealDigest`
 * is for, and the limits of what a seal proves are documented on that function rather than
 * left implied.
 *
 * ## Canonicalisation
 *
 * The hash is taken over `canonicalize` from ./canonical.js — the same byte-stable
 * serialization used for evaluation hashes and snapshot hashes. It is deliberately shared:
 * two definitions of "the same content" inside one system is precisely the divergence a
 * hash chain exists to rule out. Its refusal to encode a fractional number applies here too,
 * so an amount recorded in before/after metadata must be a decimal string (invariant 5).
 *
 * ## Nothing here reads the clock or the database
 *
 * Every timestamp is supplied by the caller and every function is pure. A hash that depended
 * on the machine it was computed on could not be re-verified years later by a monitor with a
 * database export and this source file, which is the only verification that matters.
 */

import { canonicalize, hashCanonical, sha256Hex } from './canonical.js';
import type { CanonicalValue } from './canonical.js';

/**
 * An ISO-8601 instant in UTC, e.g. `2028-03-01T14:22:05Z`.
 *
 * An audit event happened at a moment, so this is deliberately not the calendar-date
 * treatment invariant 6 requires of statutory deadlines. Kept module-local so a later shared
 * time module can own the exported name.
 */
type Instant = string;

/* ------------------------------------------------------------------- event vocabulary -- */

/** Section 21, "actor type". Who — or what — took the action. */
export const AUDIT_ACTOR_TYPES = [
  'USER',
  /** Vendor staff operating under a section 19 just-in-time grant. Never unattributed. */
  'SUPPORT_USER',
  /** A district-owned integration credential, e.g. a nightly SIS export job. */
  'SERVICE_ACCOUNT',
  /** The platform acting on its own schedule: rule-pack activation, retention sweeps. */
  'SYSTEM',
] as const;

export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export interface AuditActor {
  readonly actorId: string;
  readonly actorType: AuditActorType;
  /**
   * The actor's name *as it stood when the event happened*. Denormalised on purpose: people
   * change names and leave organisations, and a log that renders today's directory instead
   * of the historical fact is a log that has quietly rewritten itself.
   */
  readonly displayName?: string;
}

/**
 * Section 21, "IP/session" and "request ID".
 *
 * `requestId` is required — it is the join key between an audit event and the application
 * trace that produced it, and an event that cannot be tied back to a request is the one an
 * investigator will most want to explain. IP and session are optional because a SYSTEM actor
 * has neither, and inventing `0.0.0.0` to fill a column would be a fabricated fact.
 */
export interface AuditRequestContext {
  readonly requestId: string;
  readonly ipAddress?: string;
  readonly sessionId?: string;
}

/**
 * Section 19's just-in-time elevation, carried on every event the grant produced.
 *
 * The point of recording the grant inline rather than by reference is that the reason and
 * scope are then inside the hash. A support user who later edits the grant record to widen
 * their own authorisation does not thereby change what the audit log says they were allowed
 * to do at the time.
 */
export interface SupportAccessContext {
  readonly grantId: string;
  /** The customer-facing reason: a ticket reference or an incident id, not free apology. */
  readonly reason: string;
  /** What the grant covered — the section 19 "limited scope". */
  readonly scope: string;
  readonly approvedBy: string;
  readonly expiresAt: Instant;
  /** Section 19's PII access flag. Whether this grant was permitted student-level data. */
  readonly piiAccess: boolean;
}

/**
 * Section 21's "before/after metadata where appropriate".
 *
 * "Where appropriate" is doing real work. This is a compliance audit trail, not a shadow
 * copy of the database: a diff recorded here must be reduced to what a reviewer needs to see
 * a change happened. Anything classified STUDENT_PII or above (see ./classification.js)
 * belongs here as a field name and a change indicator, never as a value — otherwise the
 * audit log becomes the most sensitive table in the system and invariant 10 is lost in the
 * one place nobody thought to look.
 */
export type AuditMetadata = Readonly<Record<string, CanonicalValue>>;

/**
 * An entry in the append-only log.
 *
 * `action` is an open string rather than a closed union, which is a deliberate exception to
 * the house preference for enumerated vocabularies. Every module the platform ever grows
 * will need to log, and the failure mode of a closed list is an action that *cannot be
 * logged* — strictly worse than an action whose name is only conventionally checked. The
 * convention is `OBJECT.VERB` in upper snake case, e.g. `RULE_VERSION.ACTIVATED`,
 * `EVIDENCE.DOWNLOADED`, `SUPPORT_GRANT.ISSUED`.
 */
export interface AuditEvent {
  readonly eventId: string;
  readonly tenantId: string;
  readonly actor: AuditActor;
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly before?: AuditMetadata;
  readonly after?: AuditMetadata;
  readonly occurredAt: Instant;
  readonly context: AuditRequestContext;
  readonly supportAccess?: SupportAccessContext;
  /** The `eventHash` of the predecessor, or `genesisHash(tenantId)` for the first event. */
  readonly previousHash: string;
  readonly eventHash: string;
}

/** An event before it has been linked into a chain. The two hashes are the chain's to fill. */
export type AuditEventDraft = Omit<AuditEvent, 'previousHash' | 'eventHash'>;

/* ------------------------------------------------------------------------ the hashing -- */

/**
 * Domain separation. Every preimage in this module is prefixed with this string so that an
 * audit hash can never coincide with an evaluation hash or a snapshot hash computed over the
 * same bytes, and so that a chain from one deployment cannot be spliced into another.
 *
 * The version suffix is part of the commitment: changing how an event is hashed produces a
 * new domain, which makes the break explicit and dated rather than silently invalidating
 * every historical chain. Old chains continue to verify under the version they were written
 * with; that migration belongs to the storage layer, which records the version per event.
 */
export const AUDIT_HASH_DOMAIN = 'complianceos-edu/audit-chain/v1';

/**
 * The head of a per-tenant chain.
 *
 * Chains are per tenant (section 21: "per-tenant or partition hash chain"), so the genesis
 * value binds the tenant id. A fixed constant shared by all tenants would let an attacker
 * with write access lift tenant A's first event into tenant B's chain, where it would verify.
 * The tenant id goes through `canonicalize` so that an id containing the separator cannot be
 * chosen to collide with another tenant's genesis.
 */
export function genesisHash(tenantId: string): string {
  return sha256Hex(`${AUDIT_HASH_DOMAIN}/genesis/${canonicalize(tenantId)}`);
}

/**
 * The exact set of fields the event hash commits to.
 *
 * The mapped type is load-bearing, not decoration. `-?` makes every field of `AuditEvent`
 * (bar the hash itself) *required* in the preimage, so adding a field to `AuditEvent` without
 * adding it to `hashedFields` is a compile error rather than a silent hole — a field outside
 * the preimage is a field an attacker may edit undetected.
 */
type HashedFields = { readonly [K in keyof Omit<AuditEvent, 'eventHash'>]-?: CanonicalValue };

/**
 * Project an event into its preimage.
 *
 * An absent optional field is encoded as an explicit `null` rather than omitted, because
 * `canonicalize` drops undefined properties: without this, `{ before: undefined }` and a
 * record with no `before` at all would produce the same preimage shape, and "there was no
 * prior value" would be indistinguishable from "the prior value was removed from the log".
 */
function hashedFields(draft: AuditEventDraft, previousHash: string): HashedFields {
  return {
    eventId: draft.eventId,
    tenantId: draft.tenantId,
    actor: {
      actorId: draft.actor.actorId,
      actorType: draft.actor.actorType,
      displayName: draft.actor.displayName ?? null,
    },
    action: draft.action,
    objectType: draft.objectType,
    objectId: draft.objectId,
    before: draft.before ?? null,
    after: draft.after ?? null,
    occurredAt: draft.occurredAt,
    context: {
      requestId: draft.context.requestId,
      ipAddress: draft.context.ipAddress ?? null,
      sessionId: draft.context.sessionId ?? null,
    },
    supportAccess: draft.supportAccess
      ? {
          grantId: draft.supportAccess.grantId,
          reason: draft.supportAccess.reason,
          scope: draft.supportAccess.scope,
          approvedBy: draft.supportAccess.approvedBy,
          expiresAt: draft.supportAccess.expiresAt,
          piiAccess: draft.supportAccess.piiAccess,
        }
      : null,
    previousHash,
  };
}

/**
 * SHA-256 over the canonical serialization of the event and the hash it links to.
 *
 * `previousHash` is inside the hash, not merely stored beside it. That is the whole
 * mechanism: it makes each event a commitment to the entire history before it, so any edit
 * to any earlier event invalidates every hash that follows.
 */
export function hashEvent(draft: AuditEventDraft, previousHash: string): string {
  return hashCanonical({
    domain: AUDIT_HASH_DOMAIN,
    event: hashedFields(draft, previousHash),
  });
}

/* --------------------------------------------------------------------------- appending -- */

/** Raised when a caller tries to build a chain that could not be verified afterwards. */
export class AuditChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditChainError';
  }
}

/** Seal a draft against a known predecessor hash. */
export function linkEvent(draft: AuditEventDraft, previousHash: string): AuditEvent {
  return { ...draft, previousHash, eventHash: hashEvent(draft, previousHash) };
}

/**
 * The hash the next event in this tenant's chain must link to.
 *
 * An empty chain yields the tenant's genesis, so the first append needs no special case at
 * the call site.
 */
export function chainTip(chain: readonly AuditEvent[], tenantId: string): string {
  const last = chain[chain.length - 1];
  if (last === undefined) return genesisHash(tenantId);
  if (last.tenantId !== tenantId) {
    throw new AuditChainError(
      `chain tip belongs to tenant ${last.tenantId}, not ${tenantId}; chains are per tenant`,
    );
  }
  return last.eventHash;
}

/**
 * Append a draft to a chain, returning the extended chain.
 *
 * Refuses to mix tenants rather than interleaving them: a chain covering two tenants would
 * verify while telling an investigator nothing, and would make one tenant's audit history
 * depend on rows the other tenant's RLS policy hides (invariant 7).
 *
 * Deliberately does *not* re-verify the existing chain. Appending is on the hot path of every
 * write in the product and must stay O(1); verification is `verifyChain`'s job and belongs to
 * the periodic sealing run, not to the request that is trying to log something.
 */
export function appendEvent(
  chain: readonly AuditEvent[],
  draft: AuditEventDraft,
): readonly AuditEvent[] {
  const first = chain[0];
  if (first !== undefined && first.tenantId !== draft.tenantId) {
    throw new AuditChainError(
      `cannot append a ${draft.tenantId} event to a ${first.tenantId} chain; ` +
        'audit chains are per tenant',
    );
  }
  return [...chain, linkEvent(draft, chainTip(chain, draft.tenantId))];
}

/* ------------------------------------------------------------------------ verification -- */

/**
 * Why a chain failed. Each value names an attack, not an inconvenience.
 *
 * There is no reason for a non-monotonic timestamp. Order is proven by the links, and a
 * clock that steps backwards across two application instances is normal operations — making
 * that a chain break would train reviewers to ignore chain breaks.
 */
export const AUDIT_CHAIN_BREAKS = [
  /** Two tenants' events in one list. Rejected rather than verified as an interleaving. */
  'MIXED_TENANTS',
  /** The first event does not link to this tenant's genesis: the head has been cut off. */
  'GENESIS_MISMATCH',
  /** An event does not link to its predecessor: something was removed, inserted or moved. */
  'LINK_MISMATCH',
  /** An event's stored hash is not the hash of its content: it was edited in place. */
  'HASH_MISMATCH',
  /** The same event id appears twice: a replayed or duplicated row. */
  'DUPLICATE_EVENT_ID',
] as const;

export type AuditChainBreak = (typeof AUDIT_CHAIN_BREAKS)[number];

export type ChainVerification =
  | {
      readonly valid: true;
      readonly length: number;
      /** Null only for an empty chain, which has no tenant to report. */
      readonly tenantId: string | null;
      readonly tipHash: string | null;
    }
  | {
      readonly valid: false;
      /** Index of the *first* break. Everything after it is unverifiable, not merely wrong. */
      readonly index: number;
      readonly reason: AuditChainBreak;
      readonly detail: string;
    };

/**
 * Walk a chain and report the first break.
 *
 * The order of the checks matters. Content is verified before links, so an event edited in
 * place is reported as HASH_MISMATCH at its own index rather than as a link failure one event
 * later — the difference between "this row was tampered with" and "a row is missing here".
 *
 * An empty chain is valid. A tenant that has done nothing has an honest empty history, and
 * treating that as a break would make every new tenant look compromised on day one.
 */
export function verifyChain(events: readonly AuditEvent[]): ChainVerification {
  const first = events[0];
  if (first === undefined) return { valid: true, length: 0, tenantId: null, tipHash: null };

  const tenantId = first.tenantId;
  const seenEventIds = new Set<string>();
  let expectedPrevious = genesisHash(tenantId);

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    // `noUncheckedIndexedAccess`: the loop bound guarantees this, but the type does not.
    if (event === undefined) {
      return {
        valid: false,
        index,
        reason: 'LINK_MISMATCH',
        detail: 'the chain contains a hole where an event should be',
      };
    }

    if (event.tenantId !== tenantId) {
      return {
        valid: false,
        index,
        reason: 'MIXED_TENANTS',
        detail:
          `event ${event.eventId} belongs to tenant ${event.tenantId} but the chain is ` +
          `tenant ${tenantId}; audit chains are verified per tenant`,
      };
    }

    if (seenEventIds.has(event.eventId)) {
      return {
        valid: false,
        index,
        reason: 'DUPLICATE_EVENT_ID',
        detail: `event id ${event.eventId} appears more than once`,
      };
    }
    seenEventIds.add(event.eventId);

    const recomputed = hashEvent(event, event.previousHash);
    if (recomputed !== event.eventHash) {
      return {
        valid: false,
        index,
        reason: 'HASH_MISMATCH',
        detail:
          `event ${event.eventId} stores hash ${event.eventHash} but its content hashes to ` +
          `${recomputed}; the record was altered after it was written`,
      };
    }

    if (event.previousHash !== expectedPrevious) {
      return {
        valid: false,
        index,
        reason: index === 0 ? 'GENESIS_MISMATCH' : 'LINK_MISMATCH',
        detail:
          index === 0
            ? `the chain starts at event ${event.eventId}, which links to ${event.previousHash} ` +
              `rather than the genesis of tenant ${tenantId}; earlier events are missing`
            : `event ${event.eventId} links to ${event.previousHash} but its predecessor ` +
              `hashes to ${expectedPrevious}; an event was removed, inserted or reordered here`,
      };
    }

    expectedPrevious = event.eventHash;
  }

  return { valid: true, length: events.length, tenantId, tipHash: expectedPrevious };
}

/* ---------------------------------------------------------------------------- sealing -- */

/**
 * A digest root over a contiguous range of one tenant's chain (section 21: "periodically
 * seal digest roots into a protected archive location").
 *
 * ## What a seal proves, and what it does not
 *
 * Written to storage the application cannot reach — an object-lock bucket, a countersigning
 * service, a printed page in a monitor's file — a seal closes the one gap a hash chain leaves
 * open. A chain that has had its tail lopped off still verifies; a chain whose tip no longer
 * reaches an archived `tipHash` does not. A seal therefore proves:
 *
 * - that the events in the range are exactly the events that were there at sealing time, in
 *   that order (via `merkleRoot` and `tipHash`);
 * - that the range began where the previous history ended (via `rangeStartsAfter`);
 * - hence that nothing in the range has been edited, removed, inserted, reordered *or
 *   truncated* since the seal was taken.
 *
 * A seal proves none of the following, and claiming otherwise in front of a monitor would be
 * worse than not sealing at all:
 *
 * - **That the events are true.** It commits to what the application wrote. An attacker who
 *   controls the application before the event is written writes a lie, and the seal preserves
 *   the lie faithfully.
 * - **That nothing happened after the seal.** Everything since the last seal is protected
 *   only by the chain, so the sealing interval is the exact width of the truncation window.
 * - **Anything at all, if the seal itself is stored where the audit log is stored.** An
 *   attacker who can rewrite both simply reseals. The protection is the archive's
 *   independence, not this function.
 * - **When it was taken.** There is no clock here. The archive records the sealing time, and
 *   external timestamping (a countersignature, a transparency log) is what makes that time
 *   evidence rather than assertion.
 */
export interface AuditSeal {
  readonly tenantId: string;
  readonly firstEventId: string;
  readonly lastEventId: string;
  readonly eventCount: number;
  /** The `previousHash` of the first event: what this range claims to continue from. */
  readonly rangeStartsAfter: string;
  /** The `eventHash` of the last event — the chain tip this seal freezes. */
  readonly tipHash: string;
  /** Merkle root over the event hashes, so one event's inclusion can be proved alone. */
  readonly merkleRoot: string;
  /** Hash over every other field. This single value is what the archive has to hold. */
  readonly digest: string;
}

/**
 * Merkle root over the event hashes, with distinct leaf and interior prefixes.
 *
 * The prefixes are not ceremony: without them an interior node's preimage could be presented
 * as a leaf, letting a forged inclusion proof pass. An odd node is *promoted* to the next
 * level rather than duplicated — duplicating the last leaf is the classic construction that
 * lets two different event lists share a root — and `eventCount` is sealed alongside the
 * root so the tree's shape is pinned as well as its contents.
 */
function merkleRoot(eventHashes: readonly string[]): string {
  let level = eventHashes.map((hash) => sha256Hex(`${AUDIT_HASH_DOMAIN}/leaf/${hash}`));

  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1];
      if (left === undefined) continue;
      next.push(
        right === undefined ? left : sha256Hex(`${AUDIT_HASH_DOMAIN}/node/${left}/${right}`),
      );
    }
    level = next;
  }

  const root = level[0];
  if (root === undefined) throw new AuditChainError('cannot seal an empty range');
  return root;
}

/**
 * Seal a contiguous range of one tenant's chain.
 *
 * Verifies before sealing, and throws if the range does not hold together. Sealing a broken
 * chain would be the worst outcome available here: it would archive a tampered history under
 * a root that makes it look attested, and every later verification would confirm the forgery.
 */
export function sealDigest(events: readonly AuditEvent[]): AuditSeal {
  const first = events[0];
  const last = events[events.length - 1];
  if (first === undefined || last === undefined) {
    throw new AuditChainError('cannot seal an empty range');
  }

  const verification = verifyChain(events);
  if (!verification.valid) {
    throw new AuditChainError(
      `refusing to seal a broken chain: ${verification.reason} at index ` +
        `${verification.index} — ${verification.detail}`,
    );
  }

  const seal = {
    tenantId: first.tenantId,
    firstEventId: first.eventId,
    lastEventId: last.eventId,
    eventCount: events.length,
    rangeStartsAfter: first.previousHash,
    tipHash: last.eventHash,
    merkleRoot: merkleRoot(events.map((event) => event.eventHash)),
  } as const;

  return { ...seal, digest: hashCanonical({ domain: `${AUDIT_HASH_DOMAIN}/seal`, seal }) };
}

export const AUDIT_SEAL_BREAKS = [
  /** The seal's own fields do not hash to its digest: the archived record was edited. */
  'DIGEST_MISMATCH',
  /** The presented events do not verify as a chain at all. */
  'CHAIN_BROKEN',
  /** The presented events are a different tenant, range or length than the seal covers. */
  'RANGE_MISMATCH',
  /** The range verifies and matches, but its content hashes to a different root. */
  'ROOT_MISMATCH',
] as const;

export type AuditSealBreak = (typeof AUDIT_SEAL_BREAKS)[number];

export type SealVerification =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: AuditSealBreak; readonly detail: string };

/**
 * Check a range of events against a seal retrieved from the archive.
 *
 * The digest is checked first. A seal that has itself been rewritten cannot be used to judge
 * anything, and reporting "the events disagree with the seal" when the seal is the forged
 * half would point an investigation in exactly the wrong direction.
 */
export function verifySeal(seal: AuditSeal, events: readonly AuditEvent[]): SealVerification {
  const { digest, ...fields } = seal;
  const recomputed = hashCanonical({ domain: `${AUDIT_HASH_DOMAIN}/seal`, seal: fields });
  if (recomputed !== digest) {
    return {
      valid: false,
      reason: 'DIGEST_MISMATCH',
      detail: `the seal record hashes to ${recomputed}, not the ${digest} it carries`,
    };
  }

  const verification = verifyChain(events);
  if (!verification.valid) {
    return {
      valid: false,
      reason: 'CHAIN_BROKEN',
      detail: `${verification.reason} at index ${verification.index}: ${verification.detail}`,
    };
  }

  const first = events[0];
  const last = events[events.length - 1];
  if (
    first === undefined ||
    last === undefined ||
    events.length !== seal.eventCount ||
    first.tenantId !== seal.tenantId ||
    first.eventId !== seal.firstEventId ||
    first.previousHash !== seal.rangeStartsAfter ||
    last.eventId !== seal.lastEventId ||
    last.eventHash !== seal.tipHash
  ) {
    return {
      valid: false,
      reason: 'RANGE_MISMATCH',
      detail:
        `the seal covers ${seal.eventCount} events of tenant ${seal.tenantId} ending at ` +
        `${seal.lastEventId}; the presented range does not match`,
    };
  }

  const root = merkleRoot(events.map((event) => event.eventHash));
  if (root !== seal.merkleRoot) {
    return {
      valid: false,
      reason: 'ROOT_MISMATCH',
      detail: `the presented range roots to ${root}, not the sealed ${seal.merkleRoot}`,
    };
  }

  return { valid: true };
}
