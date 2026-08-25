/**
 * Evidence vault vocabulary.
 *
 * Spec: Master Technical Buildout section 15. "Evidence is a core product, not a file
 * attachment afterthought" — so an evidence object here is not a blob with a filename, it is
 * a record with a custody story: where it came from, how sensitive it is, whether it has been
 * scanned, what it is claimed to support, and who decided that claim was good.
 *
 * Four of the platform invariants land directly in this file.
 *
 * Invariant 1 — AI is advisory. A model may propose that a document supports a requirement;
 * the proposal is a CANDIDATE link carrying the extractor's name, its version and a
 * confidence. It becomes supporting evidence only when a named human accepts it.
 * `isSupporting` is where that is enforced, and a 0.99-confidence candidate is exactly as
 * unsupporting as a 0.01-confidence one.
 *
 * Invariant 3 — provenance. A link is its own entity rather than a foreign key hung off a
 * finding, because the facts worth keeping are facts about the *link*: who proposed it, who
 * reviewed it, when, and what replaced it.
 *
 * Invariant 4 — nothing here mutates. Every transition returns a new link, and superseding
 * one records the link that replaced it, so an audit years later can reconstruct what the
 * reviewer was looking at at the time instead of only what the vault says today.
 *
 * Invariant 10 — sensitivity is `DataClassification` from ./classification.js, the same
 * ladder the module data contracts are written against, so "may this module read this
 * document" stays one question rather than two.
 */

import type { DataClassification } from './classification.js';

/**
 * An ISO-8601 instant in UTC, e.g. `2028-03-01T14:22:05Z`.
 *
 * Deliberately *not* the calendar-date treatment invariant 6 requires of regulatory dates.
 * An upload and a review are events that happened at a moment; a statutory deadline is a day
 * on a calendar. Conflating the two is what makes deadlines move by a day, so the two kinds
 * of time are given different names and never share a helper. Kept module-local so a later
 * shared time module can own the exported name.
 */
type Instant = string;

/* ------------------------------------------------------------------- evidence items -- */

/** Where the vault got the file. Part of the custody story, not a display label. */
export const EVIDENCE_SOURCES = [
  'DISTRICT_UPLOAD',
  'SOURCE_SYSTEM_EXPORT',
  'STATE_PORTAL',
  'EMAIL_INTAKE',
  'PLATFORM_GENERATED',
] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/**
 * What kind of document this is — section 15's "document classification".
 *
 * Distinct from `DataClassification`, which is how sensitive the contents are. A board
 * minute and a payroll register can share a sensitivity and still be entirely different
 * answers to "what did the district produce?". The list is closed on purpose: an open string
 * here would make evidence-to-requirement matching unreviewable.
 */
export const EVIDENCE_DOCUMENT_CLASSES = [
  'BOARD_MINUTES',
  'BUDGET_ADOPTION',
  'GENERAL_LEDGER_EXPORT',
  'EXPENDITURE_DETAIL',
  'PAYROLL_REGISTER',
  'PERSONNEL_ACTIVITY_REPORT',
  'GRANT_AWARD_NOTIFICATION',
  'STATE_APPLICATION',
  'CHILD_COUNT_CERTIFICATION',
  'POLICY_OR_PROCEDURE',
  'CONTRACT_OR_INVOICE',
  'CORRESPONDENCE',
  'OTHER',
] as const;

export type EvidenceDocumentClass = (typeof EVIDENCE_DOCUMENT_CLASSES)[number];

/**
 * Section 20: "do not hard-code one retention period." A retention class names the policy
 * that decides `retain_until`; the number of years is resolved per tenant, program and
 * contract elsewhere. Storing a class rather than a date is what lets a district's contract
 * change without rewriting the metadata of every file it ever uploaded.
 */
export const RETENTION_CLASSES = [
  'FEDERAL_AWARD_RECORD',
  'STATE_PROGRAM_RECORD',
  'STUDENT_RECORD',
  'DISTRICT_POLICY_RECORD',
  'TRANSIENT_WORKING_COPY',
] as const;

export type RetentionClass = (typeof RETENTION_CLASSES)[number];

/** Section 15's document-processing pipeline, first stage. Everything starts at PENDING. */
export const MALWARE_SCAN_STATUSES = ['PENDING', 'CLEAN', 'INFECTED', 'FAILED'] as const;

export type MalwareScanStatus = (typeof MALWARE_SCAN_STATUSES)[number];

/**
 * Text extraction / OCR, the later pipeline stage. NOT_REQUIRED is a real state: a native
 * spreadsheet export has no text layer to extract and is not thereby a defective document.
 */
export const TEXT_EXTRACTION_STATUSES = ['NOT_REQUIRED', 'PENDING', 'SUCCEEDED', 'FAILED'] as const;

export type TextExtractionStatus = (typeof TEXT_EXTRACTION_STATUSES)[number];

export const EVIDENCE_PERIOD_KINDS = ['FISCAL_YEAR', 'ACADEMIC_YEAR'] as const;

export type EvidencePeriodKind = (typeof EVIDENCE_PERIOD_KINDS)[number];

/**
 * The year the document belongs to. The kind is carried alongside the label because a
 * district's academic year and its fiscal year are different spans, and a maintenance-of-
 * effort comparison that silently mixed them would be comparing the wrong two numbers.
 */
export interface EvidencePeriod {
  readonly kind: EvidencePeriodKind;
  /** As the district writes it: `FY2028`, `2027-2028`. Compared as a label, never parsed. */
  readonly label: string;
}

/** A lowercase hex SHA-256 digest — 64 characters, no `sha256:` prefix, no uppercase. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isSha256Hex(value: string): boolean {
  return SHA256_HEX.test(value);
}

/**
 * A file in the vault, with the full section 15 metadata list.
 *
 * The hash is the identity of the *content*: it is what lets a monitoring packet assert that
 * the PDF a reviewer opens today is byte-for-byte the one the finding was written against.
 */
export interface EvidenceItem {
  readonly id: string;
  readonly tenantId: string;
  readonly organizationId: string;
  /** The funding program the document is filed under, e.g. `IDEA_PART_B`. */
  readonly programId: string;
  readonly period: EvidencePeriod;
  readonly source: EvidenceSource;
  readonly documentClass: EvidenceDocumentClass;
  /** Sensitivity of the contents — the same ladder the module data contracts use. */
  readonly sensitivity: DataClassification;
  readonly sha256: string;
  /** Kept verbatim. Districts recognise their own filenames; the vault does not rename. */
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly uploadedBy: string;
  readonly uploadedAt: Instant;
  readonly retentionClass: RetentionClass;
  /** A legal or audit hold. Blocks automated deletion for as long as it is set (section 20). */
  readonly legalHold: boolean;
  readonly malwareScan: MalwareScanStatus;
  readonly textExtraction: TextExtractionStatus;
}

/** Narrowly: the file came back clean from the scanner. PENDING is not clean yet. */
export function isScanCleared(item: EvidenceItem): boolean {
  return item.malwareScan === 'CLEAN';
}

/**
 * Whether the item may be relied on as evidence at all.
 *
 * Two conditions, both failing closed. The scan must have cleared — PENDING, INFECTED and
 * FAILED are all unusable, and PENDING is the one worth stating out loud: an unscanned file
 * is not a safe file, it is a file nobody has looked at yet. And the content hash must be
 * well-formed, because an item whose digest cannot be checked cannot anchor the provenance
 * chain invariant 3 requires.
 *
 * Text extraction status is deliberately *not* a condition. A scanned board minute whose OCR
 * failed is still a board minute a human can read and accept; only search and AI extraction
 * are degraded, and neither of those decides anything.
 */
export function isUsableAsEvidence(item: EvidenceItem): boolean {
  return isScanCleared(item) && isSha256Hex(item.sha256);
}

/** Section 20: automated deletion is prevented while a legal or audit hold exists. */
export function isDeletionBlocked(item: EvidenceItem): boolean {
  return item.legalHold;
}

/* ------------------------------------------------------------------- evidence links -- */

/** One evidence object may support many of these at once (section 15, relationships). */
export const EVIDENCE_LINK_TARGET_KINDS = [
  'REQUIREMENT',
  'CONTROL',
  'FINDING',
  'CORRECTIVE_ACTION',
] as const;

export type EvidenceLinkTargetKind = (typeof EVIDENCE_LINK_TARGET_KINDS)[number];

export interface EvidenceLinkTarget {
  readonly kind: EvidenceLinkTargetKind;
  readonly id: string;
}

export const EVIDENCE_LINK_DISPOSITIONS = [
  'CANDIDATE',
  'ACCEPTED',
  'REJECTED',
  'SUPERSEDED',
] as const;

export type EvidenceLinkDisposition = (typeof EVIDENCE_LINK_DISPOSITIONS)[number];

/**
 * Who claimed that this document supports this target.
 *
 * A union rather than an optional bag of AI fields, so that an AI-proposed link without an
 * extractor version is not representable. Section 17.2 permits evidence-to-requirement
 * matching as an AI job; section 17.3 requires the model's output to arrive as a structured
 * candidate for a validator or a human — this type is that candidate.
 */
export type EvidenceLinkOrigin =
  | { readonly kind: 'HUMAN'; readonly proposedBy: string }
  | {
      readonly kind: 'AI_SUGGESTION';
      /** The extractor or matcher that proposed the link, e.g. `evidence-matcher`. */
      readonly extractor: string;
      /** Its version, so a later regression can be traced to the build that caused it. */
      readonly extractorVersion: string;
      /**
       * The model's self-reported confidence, 0..1.
       *
       * A plain `number` on purpose, and used only for display and for ordering a review
       * queue — never in arithmetic, never summed, averaged or thresholded into a decision.
       * It is not money and it is not a measurement; it carries no exactness guarantee, so
       * `money.ts` would be the wrong tool and a comparison against a cutoff would be the
       * wrong idea. Confidence sorts a human's worklist. It never decides anything.
       */
      readonly confidence: number;
    };

/** A human's act on a link. Stored, because "who accepted this" is the audit question. */
export interface EvidenceReview {
  readonly reviewerId: string;
  readonly reviewedAt: Instant;
  readonly note?: string;
}

/** The fields every link carries regardless of where its disposition has got to. */
export interface EvidenceLinkCore {
  readonly id: string;
  readonly tenantId: string;
  readonly evidenceItemId: string;
  readonly target: EvidenceLinkTarget;
  readonly origin: EvidenceLinkOrigin;
}

export interface CandidateEvidenceLink extends EvidenceLinkCore {
  readonly disposition: 'CANDIDATE';
}

export interface AcceptedEvidenceLink extends EvidenceLinkCore {
  readonly disposition: 'ACCEPTED';
  /** Required by the type, not by convention: acceptance without a human is not a thing. */
  readonly acceptedBy: EvidenceReview;
}

export interface RejectedEvidenceLink extends EvidenceLinkCore {
  readonly disposition: 'REJECTED';
  readonly rejectedBy: EvidenceReview;
}

export interface SupersededEvidenceLink extends EvidenceLinkCore {
  readonly disposition: 'SUPERSEDED';
  readonly supersededBy: EvidenceReview;
  /**
   * The link that replaced this one. Section 15 keeps SUPERSEDED as a disposition distinct
   * from REJECTED precisely so this pointer exists: the reviewer did not think the old
   * document was wrong, they found a better one, and an audit needs to walk the chain.
   */
  readonly replacedByLinkId: string;
}

export type EvidenceLink =
  CandidateEvidenceLink | AcceptedEvidenceLink | RejectedEvidenceLink | SupersededEvidenceLink;

export function isAiSuggested(link: EvidenceLink): boolean {
  return link.origin.kind === 'AI_SUGGESTION';
}

/**
 * Does this link, backed by this item, actually support its target?
 *
 * The invariant 1 boundary at the evidence layer. Only ACCEPTED counts: a CANDIDATE has been
 * proposed and not reviewed, however sure the model says it is, and a REJECTED or SUPERSEDED
 * link is history. The item is a parameter because a link cannot vouch for the file behind
 * it — an accepted link to an infected or still-unscanned upload supports nothing.
 *
 * Mismatched ids return false rather than throwing. Being handed the wrong item is a caller
 * bug, and the safe answer to "is this evidence?" when the question itself is confused is no.
 */
export function isSupporting(link: EvidenceLink, item: EvidenceItem): boolean {
  if (link.disposition !== 'ACCEPTED') return false;
  if (link.evidenceItemId !== item.id || link.tenantId !== item.tenantId) return false;
  return isUsableAsEvidence(item);
}

/**
 * Order a reviewer's queue.
 *
 * Human-proposed links come first: there is no model claim to weigh, so nothing to triage.
 * AI suggestions follow in descending confidence, ties broken on id so the queue is the same
 * queue on every render and in every test. Note that confidence is only ever *compared* —
 * no subtraction, no scoring — which is the whole of its permitted use.
 */
export function orderForReview(links: readonly EvidenceLink[]): readonly EvidenceLink[] {
  const confidenceOf = (link: EvidenceLink): number =>
    link.origin.kind === 'AI_SUGGESTION' ? link.origin.confidence : Number.POSITIVE_INFINITY;
  return [...links].sort((a, b) => {
    const left = confidenceOf(a);
    const right = confidenceOf(b);
    if (left !== right) return left > right ? -1 : 1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
}

/* ------------------------------------------------------- proposing and reviewing links -- */

export const EVIDENCE_LINK_REFUSAL_REASONS = [
  'MISSING_IDENTIFIER',
  'INCOMPLETE_SUGGESTION',
  'INVALID_CONFIDENCE',
  'WRONG_EVIDENCE_ITEM',
  'EVIDENCE_NOT_USABLE',
  'NOT_A_CANDIDATE',
  'DISPOSITION_IS_FINAL',
  'SELF_SUPERSESSION',
  'REPLACEMENT_MISMATCH',
] as const;

export type EvidenceLinkRefusalReason = (typeof EVIDENCE_LINK_REFUSAL_REASONS)[number];

/**
 * A typed refusal rather than an exception, for the same reason `createFinding` returns one:
 * the API layer (section 23) turns a refusal into a 422 the reviewer can read, not a 500.
 */
export interface EvidenceLinkRefusal {
  readonly outcome: 'REFUSED';
  readonly reason: EvidenceLinkRefusalReason;
  /** Written for the reviewer who tripped it, not for a log line. */
  readonly explanation: string;
}

export type EvidenceLinkResult<T extends EvidenceLink = EvidenceLink> =
  { readonly outcome: 'LINK'; readonly link: T } | EvidenceLinkRefusal;

function refuse(reason: EvidenceLinkRefusalReason, explanation: string): EvidenceLinkRefusal {
  return { outcome: 'REFUSED', reason, explanation };
}

/** A whitespace-only identifier is a missing identifier, as in `finding.ts`. */
function blank(value: string): boolean {
  return value.trim() === '';
}

/**
 * A confidence the platform will accept: a real number in 0..1 inclusive. NaN and Infinity
 * are rejected explicitly — a model client that fails to parse its own response must not be
 * able to put a hole in the review queue's ordering.
 */
export function isConfidence(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export interface EvidenceLinkProposal {
  readonly id: string;
  readonly tenantId: string;
  readonly evidenceItemId: string;
  readonly target: EvidenceLinkTarget;
  readonly origin: EvidenceLinkOrigin;
}

/**
 * Propose a link. Every link — human or model — starts as a CANDIDATE.
 *
 * A human proposal starting at CANDIDATE rather than ACCEPTED is not ceremony: the person who
 * attaches a document and the person who reviews it are frequently not the same person, and
 * collapsing the two would lose the reviewer's name from the audit trail.
 */
export function proposeLink(
  proposal: EvidenceLinkProposal,
): EvidenceLinkResult<CandidateEvidenceLink> {
  const { id, tenantId, evidenceItemId, target, origin } = proposal;
  if (blank(id) || blank(tenantId) || blank(evidenceItemId) || blank(target.id)) {
    return refuse(
      'MISSING_IDENTIFIER',
      'A link needs its own id, a tenant, an evidence item and a target id.',
    );
  }
  if (origin.kind === 'HUMAN' && blank(origin.proposedBy)) {
    return refuse('MISSING_IDENTIFIER', 'A human-proposed link must name who proposed it.');
  }
  if (origin.kind === 'AI_SUGGESTION') {
    // Section 15 requires the extractor and its version on every AI suggestion. Without both,
    // a bad matcher release cannot be traced to the links it produced.
    if (blank(origin.extractor) || blank(origin.extractorVersion)) {
      return refuse(
        'INCOMPLETE_SUGGESTION',
        'An AI-suggested link must record the extractor name and its version.',
      );
    }
    if (!isConfidence(origin.confidence)) {
      return refuse(
        'INVALID_CONFIDENCE',
        `Confidence must be a number in 0..1; received ${String(origin.confidence)}.`,
      );
    }
  }
  return {
    outcome: 'LINK',
    link: { id, tenantId, evidenceItemId, target, origin, disposition: 'CANDIDATE' },
  };
}

function coreOf(link: EvidenceLink): EvidenceLinkCore {
  return {
    id: link.id,
    tenantId: link.tenantId,
    evidenceItemId: link.evidenceItemId,
    target: link.target,
    origin: link.origin,
  };
}

/** REJECTED and SUPERSEDED are the end of a link's life; a further claim is a new link. */
function isFinal(link: EvidenceLink): boolean {
  return link.disposition === 'REJECTED' || link.disposition === 'SUPERSEDED';
}

/**
 * A human accepts the claim. This is the only route to supporting evidence (invariant 1).
 *
 * The item is required, and refused if it is not usable: accepting a link to an unscanned or
 * infected upload would create a record that says a human vouched for a file nobody can open.
 */
export function acceptLink(
  link: EvidenceLink,
  item: EvidenceItem,
  review: EvidenceReview,
): EvidenceLinkResult<AcceptedEvidenceLink> {
  if (blank(review.reviewerId)) {
    return refuse('MISSING_IDENTIFIER', 'Accepting a link must record which human accepted it.');
  }
  if (link.evidenceItemId !== item.id || link.tenantId !== item.tenantId) {
    return refuse(
      'WRONG_EVIDENCE_ITEM',
      `Link ${link.id} is not a link to evidence item ${item.id} in this tenant.`,
    );
  }
  if (isFinal(link)) {
    return refuse(
      'DISPOSITION_IS_FINAL',
      `Link ${link.id} is ${link.disposition}; record a new link rather than reviving this one.`,
    );
  }
  if (link.disposition !== 'CANDIDATE') {
    return refuse('NOT_A_CANDIDATE', `Link ${link.id} is already ${link.disposition}.`);
  }
  if (!isUsableAsEvidence(item)) {
    return refuse(
      'EVIDENCE_NOT_USABLE',
      `Evidence item ${item.id} cannot be accepted: malware scan is ${item.malwareScan} ` +
        'and the content hash must be a lowercase SHA-256 digest.',
    );
  }
  return {
    outcome: 'LINK',
    link: { ...coreOf(link), disposition: 'ACCEPTED', acceptedBy: review },
  };
}

/**
 * A human rejects the claim. Permitted from ACCEPTED as well as CANDIDATE, because a reviewer
 * who realises they accepted the wrong document must be able to say so. Findings already
 * issued are untouched by this: a finalized run is immutable, and the correction shows up in
 * the next run (invariant 4).
 */
export function rejectLink(
  link: EvidenceLink,
  review: EvidenceReview,
): EvidenceLinkResult<RejectedEvidenceLink> {
  if (blank(review.reviewerId)) {
    return refuse('MISSING_IDENTIFIER', 'Rejecting a link must record which human rejected it.');
  }
  if (isFinal(link)) {
    return refuse('DISPOSITION_IS_FINAL', `Link ${link.id} is already ${link.disposition}.`);
  }
  return {
    outcome: 'LINK',
    link: { ...coreOf(link), disposition: 'REJECTED', rejectedBy: review },
  };
}

/**
 * A better document arrives. The old link records which link replaced it and who made the
 * call, so the audit trail answers "what was in front of the reviewer at the time?".
 *
 * The replacement must point at the same target in the same tenant. A "supersession" that
 * quietly changed which requirement was being evidenced would make the chain unreadable —
 * that is two decisions wearing one word.
 */
export function supersedeLink(
  link: EvidenceLink,
  replacement: EvidenceLink,
  review: EvidenceReview,
): EvidenceLinkResult<SupersededEvidenceLink> {
  if (blank(review.reviewerId)) {
    return refuse('MISSING_IDENTIFIER', 'Superseding a link must record which human did it.');
  }
  if (isFinal(link)) {
    return refuse('DISPOSITION_IS_FINAL', `Link ${link.id} is already ${link.disposition}.`);
  }
  if (replacement.id === link.id) {
    return refuse('SELF_SUPERSESSION', `Link ${link.id} cannot supersede itself.`);
  }
  if (
    replacement.tenantId !== link.tenantId ||
    replacement.target.kind !== link.target.kind ||
    replacement.target.id !== link.target.id
  ) {
    return refuse(
      'REPLACEMENT_MISMATCH',
      `Link ${replacement.id} supports a different target and cannot replace link ${link.id}.`,
    );
  }
  return {
    outcome: 'LINK',
    link: {
      ...coreOf(link),
      disposition: 'SUPERSEDED',
      supersededBy: review,
      replacedByLinkId: replacement.id,
    },
  };
}
