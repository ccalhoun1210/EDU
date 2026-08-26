/**
 * Behavioural tests for the evidence vault vocabulary.
 *
 * Spec: Master Technical Buildout section 15. The load-bearing test in this file is the one
 * that says a 0.99-confidence AI suggestion supports nothing until a human accepts it — that
 * is CLAUDE.md invariant 1 at the evidence layer, and it is the test that must fail if
 * someone later decides a confident model is good enough.
 */

import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_LINK_DISPOSITIONS,
  acceptLink,
  isAiSuggested,
  isConfidence,
  isDeletionBlocked,
  isScanCleared,
  isSha256Hex,
  isSupporting,
  isUsableAsEvidence,
  orderForReview,
  proposeLink,
  rejectLink,
  supersedeLink,
} from './evidence.js';
import type {
  AcceptedEvidenceLink,
  EvidenceItem,
  EvidenceLink,
  EvidenceLinkProposal,
  EvidenceLinkRefusalReason,
  EvidenceLinkResult,
  EvidenceReview,
  MalwareScanStatus,
} from './evidence.js';

const DIGEST = 'a'.repeat(64);

function evidenceItem(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: 'evi_01',
    tenantId: 'ten_01',
    organizationId: 'org_district_7',
    programId: 'IDEA_PART_B',
    period: { kind: 'FISCAL_YEAR', label: 'FY2028' },
    source: 'DISTRICT_UPLOAD',
    documentClass: 'BOARD_MINUTES',
    sensitivity: 'CONFIDENTIAL',
    sha256: DIGEST,
    originalFilename: 'board-minutes-2027-11-14.pdf',
    mimeType: 'application/pdf',
    uploadedBy: 'usr_42',
    uploadedAt: '2028-03-01T14:22:05Z',
    retentionClass: 'FEDERAL_AWARD_RECORD',
    legalHold: false,
    malwareScan: 'CLEAN',
    textExtraction: 'SUCCEEDED',
    ...overrides,
  };
}

const review: EvidenceReview = {
  reviewerId: 'usr_99',
  reviewedAt: '2028-03-02T09:00:00Z',
  note: 'Confirmed the November board vote adopting the FY2028 budget.',
};

function expectLink<T extends EvidenceLink>(result: EvidenceLinkResult<T>): T {
  if (result.outcome !== 'LINK') {
    throw new Error(`expected a link, got ${result.reason}: ${result.explanation}`);
  }
  return result.link;
}

function refusal(result: EvidenceLinkResult): EvidenceLinkRefusalReason | undefined {
  return result.outcome === 'REFUSED' ? result.reason : undefined;
}

function proposal(overrides: Partial<EvidenceLinkProposal> = {}): EvidenceLinkProposal {
  return {
    id: 'lnk_01',
    tenantId: 'ten_01',
    evidenceItemId: 'evi_01',
    target: { kind: 'REQUIREMENT', id: 'req_moe_eligibility' },
    origin: { kind: 'HUMAN', proposedBy: 'usr_42' },
    ...overrides,
  };
}

/** A model-proposed link, as confident as a model ever gets. */
function aiProposal(confidence = 0.99, overrides: Partial<EvidenceLinkProposal> = {}) {
  return proposal({
    id: 'lnk_ai_01',
    origin: {
      kind: 'AI_SUGGESTION',
      extractor: 'evidence-matcher',
      extractorVersion: '2.3.0',
      confidence,
    },
    ...overrides,
  });
}

describe('isSupporting', () => {
  it('refuses a high-confidence AI candidate — invariant 1: AI never decides', () => {
    const item = evidenceItem();
    const candidate = expectLink(proposeLink(aiProposal(0.99)));

    expect(isAiSuggested(candidate)).toBe(true);
    expect(candidate.disposition).toBe('CANDIDATE');
    // The whole point: confidence is not acceptance, at any value.
    expect(isSupporting(candidate, item)).toBe(false);
  });

  it('supports the same AI suggestion once a named human accepts it', () => {
    const item = evidenceItem();
    const candidate = expectLink(proposeLink(aiProposal(0.31)));
    const accepted = expectLink(acceptLink(candidate, item, review));

    // A low-confidence suggestion a human accepted outranks a high-confidence one nobody
    // reviewed. The human's act is what makes evidence, not the model's score.
    expect(isSupporting(accepted, item)).toBe(true);
    expect(accepted.acceptedBy.reviewerId).toBe('usr_99');
    expect(isAiSuggested(accepted)).toBe(true);
  });

  it('counts only ACCEPTED links, never CANDIDATE, REJECTED or SUPERSEDED', () => {
    const item = evidenceItem();
    const candidate = expectLink(proposeLink(proposal()));
    const accepted = expectLink(acceptLink(candidate, item, review));
    const rejected = expectLink(rejectLink(candidate, review));
    const replacement = expectLink(proposeLink(proposal({ id: 'lnk_02' })));
    const superseded = expectLink(supersedeLink(candidate, replacement, review));

    const supporting = new Map<string, boolean>(
      [candidate, accepted, rejected, superseded].map((link) => [
        link.disposition,
        isSupporting(link, item),
      ]),
    );

    expect(supporting).toEqual(
      new Map([
        ['CANDIDATE', false],
        ['ACCEPTED', true],
        ['REJECTED', false],
        ['SUPERSEDED', false],
      ]),
    );
    // Every declared disposition was exercised above, so adding one to the vocabulary
    // without deciding whether it supports evidence fails here.
    expect([...supporting.keys()].sort()).toEqual([...EVIDENCE_LINK_DISPOSITIONS].sort());
  });

  it('refuses an accepted link whose evidence item did not clear the scanner', () => {
    const clean = evidenceItem();
    const accepted = expectLink(acceptLink(expectLink(proposeLink(proposal())), clean, review));

    const blocked: readonly MalwareScanStatus[] = ['PENDING', 'INFECTED', 'FAILED'];
    for (const malwareScan of blocked) {
      // The link is unchanged and still says ACCEPTED; the file behind it is the problem.
      expect(isSupporting(accepted, evidenceItem({ malwareScan }))).toBe(false);
    }
    expect(isSupporting(accepted, clean)).toBe(true);
  });

  it('fails closed when the link and the item do not belong together', () => {
    const item = evidenceItem();
    const accepted: AcceptedEvidenceLink = expectLink(
      acceptLink(expectLink(proposeLink(proposal())), item, review),
    );

    expect(isSupporting(accepted, evidenceItem({ id: 'evi_other' }))).toBe(false);
    expect(isSupporting(accepted, evidenceItem({ tenantId: 'ten_other' }))).toBe(false);
  });
});

describe('isUsableAsEvidence', () => {
  it('treats PENDING as not yet safe, not as safe by default', () => {
    expect(isUsableAsEvidence(evidenceItem({ malwareScan: 'PENDING' }))).toBe(false);
    expect(isScanCleared(evidenceItem({ malwareScan: 'PENDING' }))).toBe(false);
  });

  it('rejects every non-CLEAN scan status and accepts CLEAN', () => {
    expect(isUsableAsEvidence(evidenceItem({ malwareScan: 'INFECTED' }))).toBe(false);
    expect(isUsableAsEvidence(evidenceItem({ malwareScan: 'FAILED' }))).toBe(false);
    expect(isUsableAsEvidence(evidenceItem())).toBe(true);
  });

  it('rejects an item whose content hash cannot anchor the provenance chain', () => {
    expect(isSha256Hex(DIGEST)).toBe(true);
    expect(isSha256Hex(DIGEST.toUpperCase())).toBe(false);
    expect(isSha256Hex(`sha256:${DIGEST}`)).toBe(false);
    expect(isUsableAsEvidence(evidenceItem({ sha256: 'not-a-digest' }))).toBe(false);
  });

  it('does not treat a failed OCR pass as a defective document', () => {
    // Search and extraction are degraded; a human can still read the scan and accept it.
    expect(isUsableAsEvidence(evidenceItem({ textExtraction: 'FAILED' }))).toBe(true);
  });
});

describe('legal hold', () => {
  it('blocks automated deletion for as long as the hold is set', () => {
    expect(isDeletionBlocked(evidenceItem())).toBe(false);
    expect(isDeletionBlocked(evidenceItem({ legalHold: true }))).toBe(true);
  });
});

describe('proposeLink', () => {
  it('starts every link as a candidate, human-proposed ones included', () => {
    expect(expectLink(proposeLink(proposal())).disposition).toBe('CANDIDATE');
    expect(expectLink(proposeLink(aiProposal())).disposition).toBe('CANDIDATE');
  });

  it('requires an AI suggestion to name its extractor and version', () => {
    expect(
      refusal(
        proposeLink(
          proposal({
            origin: {
              kind: 'AI_SUGGESTION',
              extractor: 'evidence-matcher',
              extractorVersion: '   ',
              confidence: 0.8,
            },
          }),
        ),
      ),
    ).toBe('INCOMPLETE_SUGGESTION');
  });

  it('rejects a confidence that is not a real number in 0..1', () => {
    for (const confidence of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isConfidence(confidence)).toBe(false);
      expect(refusal(proposeLink(aiProposal(confidence)))).toBe('INVALID_CONFIDENCE');
    }
    for (const confidence of [0, 0.5, 1]) {
      expect(isConfidence(confidence)).toBe(true);
    }
  });

  it('rejects a link that cannot say what it links', () => {
    expect(refusal(proposeLink(proposal({ id: '  ' })))).toBe('MISSING_IDENTIFIER');
    expect(refusal(proposeLink(proposal({ target: { kind: 'FINDING', id: '' } })))).toBe(
      'MISSING_IDENTIFIER',
    );
    expect(refusal(proposeLink(proposal({ origin: { kind: 'HUMAN', proposedBy: '' } })))).toBe(
      'MISSING_IDENTIFIER',
    );
  });
});

describe('reviewing a link', () => {
  it('never mutates the link it was given — invariant 4', () => {
    const item = evidenceItem();
    const candidate = expectLink(proposeLink(proposal()));
    const accepted = expectLink(acceptLink(candidate, item, review));

    expect(candidate.disposition).toBe('CANDIDATE');
    expect(accepted).not.toBe(candidate);
    expect(accepted.id).toBe(candidate.id);
    expect(accepted.origin).toEqual(candidate.origin);
  });

  it('refuses to accept a link to an unusable evidence item', () => {
    const infected = evidenceItem({ malwareScan: 'INFECTED' });
    const candidate = expectLink(proposeLink(proposal()));

    expect(refusal(acceptLink(candidate, infected, review))).toBe('EVIDENCE_NOT_USABLE');
  });

  it('refuses to accept a link against the wrong evidence item or tenant', () => {
    const candidate = expectLink(proposeLink(proposal()));

    expect(refusal(acceptLink(candidate, evidenceItem({ id: 'evi_other' }), review))).toBe(
      'WRONG_EVIDENCE_ITEM',
    );
    expect(refusal(acceptLink(candidate, evidenceItem({ tenantId: 'ten_other' }), review))).toBe(
      'WRONG_EVIDENCE_ITEM',
    );
  });

  it('requires a named human on every review', () => {
    const item = evidenceItem();
    const candidate = expectLink(proposeLink(proposal()));
    const anonymous: EvidenceReview = { reviewerId: '', reviewedAt: '2028-03-02T09:00:00Z' };

    expect(refusal(acceptLink(candidate, item, anonymous))).toBe('MISSING_IDENTIFIER');
    expect(refusal(rejectLink(candidate, anonymous))).toBe('MISSING_IDENTIFIER');
  });

  it('lets a reviewer withdraw an acceptance, but not revive a final disposition', () => {
    const item = evidenceItem();
    const candidate = expectLink(proposeLink(proposal()));
    const accepted = expectLink(acceptLink(candidate, item, review));

    // Withdrawing is allowed: prior findings are untouched because runs are immutable.
    const withdrawn = expectLink(rejectLink(accepted, review));
    expect(withdrawn.disposition).toBe('REJECTED');

    expect(refusal(acceptLink(withdrawn, item, review))).toBe('DISPOSITION_IS_FINAL');
    expect(refusal(rejectLink(withdrawn, review))).toBe('DISPOSITION_IS_FINAL');
  });

  it('refuses to accept a link that is already accepted', () => {
    const item = evidenceItem();
    const accepted = expectLink(acceptLink(expectLink(proposeLink(proposal())), item, review));

    expect(refusal(acceptLink(accepted, item, review))).toBe('NOT_A_CANDIDATE');
  });
});

describe('supersedeLink', () => {
  it('records which link replaced it and who was looking at the time', () => {
    const original = expectLink(proposeLink(proposal()));
    const replacement = expectLink(proposeLink(proposal({ id: 'lnk_02' })));

    const superseded = expectLink(supersedeLink(original, replacement, review));

    expect(superseded.disposition).toBe('SUPERSEDED');
    expect(superseded.replacedByLinkId).toBe('lnk_02');
    expect(superseded.supersededBy).toEqual(review);
    // The audit reads the chain forwards; the original link's own facts are preserved.
    expect(superseded.target).toEqual(original.target);
    expect(original.disposition).toBe('CANDIDATE');
  });

  it('refuses a replacement that points somewhere else', () => {
    const original = expectLink(proposeLink(proposal()));
    const otherTarget = expectLink(
      proposeLink(proposal({ id: 'lnk_03', target: { kind: 'FINDING', id: 'fnd_01' } })),
    );
    const otherTenant = expectLink(proposeLink(proposal({ id: 'lnk_04', tenantId: 'ten_other' })));

    expect(refusal(supersedeLink(original, otherTarget, review))).toBe('REPLACEMENT_MISMATCH');
    expect(refusal(supersedeLink(original, otherTenant, review))).toBe('REPLACEMENT_MISMATCH');
    expect(refusal(supersedeLink(original, original, review))).toBe('SELF_SUPERSESSION');
  });
});

describe('orderForReview', () => {
  it('puts human proposals first, then AI suggestions by descending confidence', () => {
    const human = expectLink(proposeLink(proposal({ id: 'lnk_human' })));
    const low = expectLink(proposeLink(aiProposal(0.2, { id: 'lnk_low' })));
    const high = expectLink(proposeLink(aiProposal(0.9, { id: 'lnk_high' })));
    const input = [low, high, human];

    expect(orderForReview(input).map((link) => link.id)).toEqual([
      'lnk_human',
      'lnk_high',
      'lnk_low',
    ]);
    // Ordering is a read, not an edit: the caller's array is left alone.
    expect(input.map((link) => link.id)).toEqual(['lnk_low', 'lnk_high', 'lnk_human']);
  });

  it('breaks ties on id so the queue is the same queue every time', () => {
    const b = expectLink(proposeLink(aiProposal(0.5, { id: 'lnk_b' })));
    const a = expectLink(proposeLink(aiProposal(0.5, { id: 'lnk_a' })));

    expect(orderForReview([b, a]).map((link) => link.id)).toEqual(['lnk_a', 'lnk_b']);
    expect(orderForReview([a, b]).map((link) => link.id)).toEqual(['lnk_a', 'lnk_b']);
  });
});
