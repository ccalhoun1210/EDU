/**
 * Behavioural tests for the tamper-evident audit log.
 *
 * Spec: Master Technical Buildout section 21, threat-model row "audit-log manipulation".
 *
 * The tests are organised around the attacks rather than around the functions, because the
 * claim this module makes is not "hashing works" — it is "these five things cannot be done to
 * the log without leaving a mark". Mutation, deletion, insertion, reordering and truncation
 * each get their own case, and the truncation case is written to show the limit honestly:
 * `verifyChain` accepts a truncated chain and only the seal catches it.
 */

import { describe, expect, it } from 'vitest';
import {
  AuditChainError,
  appendEvent,
  chainTip,
  genesisHash,
  hashEvent,
  linkEvent,
  sealDigest,
  verifyChain,
  verifySeal,
} from './audit.js';
import type { AuditEvent, AuditEventDraft } from './audit.js';

const TENANT = 'tenant-lincoln-usd';

function draft(overrides: Partial<AuditEventDraft> = {}): AuditEventDraft {
  return {
    eventId: 'evt-1',
    tenantId: TENANT,
    actor: { actorId: 'user-7', actorType: 'USER', displayName: 'A. Reviewer' },
    action: 'FINDING.DISPOSITION_RECORDED',
    objectType: 'finding',
    objectId: 'finding-42',
    occurredAt: '2028-03-01T14:22:05Z',
    context: { requestId: 'req-abc', ipAddress: '203.0.113.7', sessionId: 'sess-9' },
    ...overrides,
  };
}

/** A three-event chain, the smallest that has a middle to attack. */
function chainOfThree(): readonly AuditEvent[] {
  let chain: readonly AuditEvent[] = [];
  for (const eventId of ['evt-1', 'evt-2', 'evt-3']) {
    chain = appendEvent(chain, draft({ eventId }));
  }
  return chain;
}

/** Narrows a verification to its failing arm so the assertions below stay readable. */
function broken(result: ReturnType<typeof verifyChain>) {
  if (result.valid) throw new Error('expected the chain to be reported as broken, but it verified');
  return result;
}

function intact(result: ReturnType<typeof verifyChain>) {
  if (!result.valid) {
    throw new Error(`expected a valid chain, but got ${result.reason} at index ${result.index}`);
  }
  return result;
}

describe('canonical hashing', () => {
  it('ignores property insertion order, at every level of nesting', () => {
    // Same content, built in two different orders — including inside the nested metadata,
    // which is where an ordinary JSON.stringify hash would diverge.
    const a = hashEvent(
      draft({
        before: { status: 'RISK', reviewer: null, amountUsd: '1250.00' },
        after: { status: 'FAIL', reviewer: 'user-7', amountUsd: '1250.00' },
      }),
      'prev',
    );
    const b = hashEvent(
      {
        context: { sessionId: 'sess-9', ipAddress: '203.0.113.7', requestId: 'req-abc' },
        after: { amountUsd: '1250.00', reviewer: 'user-7', status: 'FAIL' },
        before: { amountUsd: '1250.00', reviewer: null, status: 'RISK' },
        occurredAt: '2028-03-01T14:22:05Z',
        objectId: 'finding-42',
        objectType: 'finding',
        action: 'FINDING.DISPOSITION_RECORDED',
        actor: { displayName: 'A. Reviewer', actorType: 'USER', actorId: 'user-7' },
        tenantId: TENANT,
        eventId: 'evt-1',
      },
      'prev',
    );

    expect(a).toBe(b);
  });

  it('changes when a value nested inside metadata changes', () => {
    const base = hashEvent(draft({ after: { scope: { schools: ['north', 'south'] } } }), 'prev');
    const reordered = hashEvent(
      draft({ after: { scope: { schools: ['south', 'north'] } } }),
      'prev',
    );
    const altered = hashEvent(draft({ after: { scope: { schools: ['north', 'east'] } } }), 'prev');

    // Array order is content, not presentation: a reordered list is a different list.
    expect(reordered).not.toBe(base);
    expect(altered).not.toBe(base);
  });

  it('distinguishes an absent metadata block from an empty one', () => {
    // Encoding an absent optional as null rather than omitting it is what makes these two
    // different. Otherwise "no prior value" and "the prior value was deleted from the log"
    // would hash identically.
    expect(hashEvent(draft(), 'prev')).not.toBe(hashEvent(draft({ before: {} }), 'prev'));
  });

  it('commits to the predecessor, so the same content in two positions hashes differently', () => {
    expect(hashEvent(draft(), 'prev-a')).not.toBe(hashEvent(draft(), 'prev-b'));
  });

  it('commits to the support-access context, including the PII flag', () => {
    const support = {
      grantId: 'grant-1',
      reason: 'ticket SUP-882',
      scope: 'evidence:read',
      approvedBy: 'user-approver',
      expiresAt: '2028-03-01T18:00:00Z',
      piiAccess: true,
    } as const;

    const granted = hashEvent(draft({ supportAccess: support }), 'prev');
    const downplayed = hashEvent(
      draft({ supportAccess: { ...support, piiAccess: false } }),
      'prev',
    );

    expect(granted).not.toBe(hashEvent(draft(), 'prev'));
    // Clearing the flag after the fact is exactly the edit a support user would want.
    expect(downplayed).not.toBe(granted);
  });

  it('is stable across calls, so a chain written today verifies tomorrow', () => {
    expect(hashEvent(draft(), 'prev')).toBe(hashEvent(draft(), 'prev'));
  });
});

describe('genesis', () => {
  it('binds the tenant, so one tenant chain cannot be spliced into another', () => {
    expect(genesisHash('tenant-a')).not.toBe(genesisHash('tenant-b'));
  });

  it('starts an empty chain and is what the first event links to', () => {
    expect(chainTip([], TENANT)).toBe(genesisHash(TENANT));
    const [first] = appendEvent([], draft());
    expect(first?.previousHash).toBe(genesisHash(TENANT));
  });
});

describe('appending', () => {
  it('links each event to its predecessor and verifies', () => {
    const chain = chainOfThree();
    expect(chain[1]?.previousHash).toBe(chain[0]?.eventHash);
    expect(chain[2]?.previousHash).toBe(chain[1]?.eventHash);
    expect(intact(verifyChain(chain))).toMatchObject({
      length: 3,
      tenantId: TENANT,
      tipHash: chain[2]?.eventHash,
    });
  });

  it('refuses to mix tenants into one chain', () => {
    const chain = appendEvent([], draft());
    expect(() => appendEvent(chain, draft({ eventId: 'evt-2', tenantId: 'tenant-other' }))).toThrow(
      AuditChainError,
    );
  });

  it('refuses to read a tip belonging to another tenant', () => {
    expect(() => chainTip(chainOfThree(), 'tenant-other')).toThrow(AuditChainError);
  });
});

describe('verifyChain detects every way a chain can be attacked', () => {
  it('accepts an empty chain — a tenant that has done nothing is not compromised', () => {
    expect(verifyChain([])).toEqual({ valid: true, length: 0, tenantId: null, tipHash: null });
  });

  it('detects an event mutated in place', () => {
    const chain = chainOfThree();
    const tampered = [...chain];
    // The classic edit: make a support user's action look like a district user's.
    tampered[1] = { ...chain[1]!, actor: { actorId: 'user-7', actorType: 'USER' } };

    const failure = broken(verifyChain(tampered));
    expect(failure.reason).toBe('HASH_MISMATCH');
    expect(failure.index).toBe(1);
  });

  it('detects a mutation whose hash was recomputed — the break just moves one event later', () => {
    const chain = chainOfThree();
    const tampered = [...chain];
    const forged = { ...chain[1]!, action: 'FINDING.VIEWED' };
    tampered[1] = { ...forged, eventHash: hashEvent(forged, forged.previousHash) };

    // Event 1 now hashes correctly, so the chain only gives way where event 2 still points
    // at the hash the original event 1 had.
    const failure = broken(verifyChain(tampered));
    expect(failure.reason).toBe('LINK_MISMATCH');
    expect(failure.index).toBe(2);
  });

  it('detects an event removed from the middle', () => {
    const chain = chainOfThree();
    const failure = broken(verifyChain([chain[0]!, chain[2]!]));
    expect(failure.reason).toBe('LINK_MISMATCH');
    expect(failure.index).toBe(1);
  });

  it('detects the head of the chain being cut off', () => {
    const chain = chainOfThree();
    const failure = broken(verifyChain([chain[1]!, chain[2]!]));
    expect(failure.reason).toBe('GENESIS_MISMATCH');
    expect(failure.index).toBe(0);
  });

  it('detects a fabricated event inserted into the middle', () => {
    const chain = chainOfThree();
    // The forger does the careful thing: links the insert to the real predecessor and hashes
    // it properly. The event after it still commits to the hash it originally followed.
    const inserted = linkEvent(
      draft({ eventId: 'evt-forged', action: 'SUPPORT_GRANT.APPROVED' }),
      chain[0]!.eventHash,
    );

    const failure = broken(verifyChain([chain[0]!, inserted, chain[1]!, chain[2]!]));
    expect(failure.reason).toBe('LINK_MISMATCH');
    expect(failure.index).toBe(2);
  });

  it('detects two events swapped', () => {
    const chain = chainOfThree();
    const failure = broken(verifyChain([chain[0]!, chain[2]!, chain[1]!]));
    expect(failure.reason).toBe('LINK_MISMATCH');
    expect(failure.index).toBe(1);
  });

  it('detects a duplicated event', () => {
    const chain = chainOfThree();
    const failure = broken(verifyChain([chain[0]!, chain[1]!, chain[1]!, chain[2]!]));
    expect(failure.reason).toBe('DUPLICATE_EVENT_ID');
    expect(failure.index).toBe(2);
  });

  it('rejects a mixed-tenant list rather than silently interleaving it', () => {
    const ours = chainOfThree();
    const theirs = appendEvent([], draft({ eventId: 'evt-x', tenantId: 'tenant-other' }));

    const failure = broken(verifyChain([ours[0]!, theirs[0]!, ours[1]!]));
    expect(failure.reason).toBe('MIXED_TENANTS');
    expect(failure.index).toBe(1);
    expect(failure.detail).toContain('tenant-other');
  });

  it('accepts a truncated tail — the gap that sealing exists to close', () => {
    const chain = chainOfThree();
    // Lopping off the end leaves a chain that is internally perfect. Documented on
    // sealDigest; asserted here so nobody later claims the chain alone covers this.
    expect(intact(verifyChain([chain[0]!, chain[1]!])).length).toBe(2);
  });
});

describe('sealing', () => {
  it('is deterministic for the same range', () => {
    const chain = chainOfThree();
    expect(sealDigest(chain)).toEqual(sealDigest([...chain]));
  });

  it('describes the range it covers', () => {
    const chain = chainOfThree();
    expect(sealDigest(chain)).toMatchObject({
      tenantId: TENANT,
      firstEventId: 'evt-1',
      lastEventId: 'evt-3',
      eventCount: 3,
      rangeStartsAfter: genesisHash(TENANT),
      tipHash: chain[2]?.eventHash,
    });
  });

  it('roots differently for an odd and an even number of events', () => {
    const chain = chainOfThree();
    // Exercises the odd-node promotion path against a two-event tree.
    expect(sealDigest(chain).merkleRoot).not.toBe(sealDigest([chain[0]!, chain[1]!]).merkleRoot);
  });

  it('verifies against the range it was taken over', () => {
    const chain = chainOfThree();
    expect(verifySeal(sealDigest(chain), chain)).toEqual({ valid: true });
  });

  it('catches the truncation the chain walk cannot', () => {
    const chain = chainOfThree();
    const seal = sealDigest(chain);
    const result = verifySeal(seal, [chain[0]!, chain[1]!]);
    expect(result).toMatchObject({ valid: false, reason: 'RANGE_MISMATCH' });
  });

  it('catches an edited event inside a sealed range', () => {
    const chain = chainOfThree();
    const seal = sealDigest(chain);
    const tampered = [...chain];
    tampered[1] = { ...chain[1]!, objectId: 'finding-99' };
    expect(verifySeal(seal, tampered)).toMatchObject({ valid: false, reason: 'CHAIN_BROKEN' });
  });

  it('catches a rewritten seal before blaming the events', () => {
    const chain = chainOfThree();
    const seal = { ...sealDigest(chain), eventCount: 2 };
    // The seal is the forged half here; reporting RANGE_MISMATCH would send an investigation
    // after the wrong record.
    expect(verifySeal(seal, chain)).toMatchObject({ valid: false, reason: 'DIGEST_MISMATCH' });
  });

  it('refuses to seal a broken chain rather than attesting a forgery', () => {
    const chain = chainOfThree();
    expect(() => sealDigest([chain[0]!, chain[2]!])).toThrow(AuditChainError);
  });

  it('refuses to seal an empty range', () => {
    expect(() => sealDigest([])).toThrow(AuditChainError);
  });
});
