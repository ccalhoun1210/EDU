import 'server-only';

/**
 * A district's own assessment: uploading an export, and reading the run that came of it.
 *
 * Spec: Master Technical Buildout sections 10, 11 and 24. CLAUDE.md invariants 3, 7 and 9.
 *
 * `worked-example.ts` runs the whole path in memory over a synthetic export, which is what a
 * deployment with no database can honestly show. This module is the same path with the two
 * ends attached: bytes arrive from a signed-in officer's browser, and the run is written down
 * so that tomorrow's page shows what was concluded today rather than recomputing it.
 *
 * ## Which organization
 *
 * The principal's, read from its access scopes — never from the request. A form field naming
 * an organization would be the hole invariant 7 describes, one level up from `tenant_id`: a
 * fiscal officer at one district could post an upload against another's. A principal scoped
 * to two organizations is refused rather than guessed, for the same reason the Neon Auth
 * provider refuses two memberships with no active organization.
 *
 * ## What is stored and what is not
 *
 * Everything the engine read and everything it concluded, including its own record of which
 * facts each result consumed. Not the roll-up sentence, not the sorted table — those are
 * rendered from the stored results, so a change to the wording cannot make a stored finding
 * say something new.
 */

import {
  MissingInputFactError,
  UnpublishedRuleError,
  UnstorableProvenanceError,
  latestRun,
  persistImport,
  persistRun,
  resultsForRun,
  type StorableFact,
  type StorableResult,
  type StoredResult,
  type StoredRunSummary,
} from '@complianceos/db';
import { can, type Principal } from '@complianceos/identity';
import { CALCULATORS } from '@complianceos/calculators';
import {
  assessDistrictExport,
  NORTHFIELD_TEMPLATE,
  type AssessDistrictExportOutcome,
} from '@complianceos/assurance';
import { ALLOWED_CALCULATORS, loadRulePack } from '@complianceos/rulepack-sdk';
import type { ScanStatus } from '@complianceos/ingest';
import { createHash, randomUUID } from 'node:crypto';
import { connected } from './roster.js';
import { PACK_DIR } from './repo.js';

/**
 * The mapping template a district fiscal export is read through.
 *
 * `GENERIC_ERP_CSV` targeting `lea_fiscal_year` — it is the general IDEA fiscal template
 * despite the fixture-flavoured id it was first authored under. The id is part of every
 * fact's provenance and of the snapshot hash, so renaming it would invalidate stored
 * lineage for a cosmetic gain; the upload page names it on screen instead.
 */
const TEMPLATE = NORTHFIELD_TEMPLATE;

/** Named on screen, so an officer can tell whether their export matches what is expected. */
export const TEMPLATE_ID = TEMPLATE.templateId;
export const TEMPLATE_VERSION = TEMPLATE.version;

/** Why an upload was not accepted. Each one is something the officer can act on. */
export type UploadRefusal =
  | { readonly kind: 'NOT_CONNECTED'; readonly detail: string }
  | { readonly kind: 'NOT_PERMITTED'; readonly detail: string }
  | { readonly kind: 'NO_ORGANIZATION'; readonly detail: string }
  | { readonly kind: 'NOT_SCANNED'; readonly detail: string }
  | { readonly kind: 'REJECTED'; readonly outcome: AssessDistrictExportOutcome }
  | { readonly kind: 'ALREADY_IMPORTED'; readonly detail: string }
  | { readonly kind: 'CONTENT_NOT_PUBLISHED'; readonly detail: string }
  | { readonly kind: 'BROKEN_PROVENANCE'; readonly detail: string };

export type UploadResult =
  | { readonly ok: true; readonly assessmentRunId: string; readonly factCount: number }
  | { readonly ok: false; readonly refusal: UploadRefusal };

/**
 * The organization this principal assesses, or `null`.
 *
 * A scope with `schoolSiteId` set still names its organization — a site-scoped reviewer
 * belongs to one district — so the distinct organizations across all scopes are what matter.
 */
export function organizationFor(principal: Principal): string | null {
  const organizations = new Set(principal.scopes.map((scope) => scope.organizationId));
  if (organizations.size !== 1) return null;
  return [...organizations][0] ?? null;
}

/** The stored assessment for this principal's organization, or `null` if there is none. */
export async function storedAssessment(
  principal: Principal,
): Promise<{ run: StoredRunSummary; results: readonly StoredResult[] } | null> {
  const config = connected();
  if (config === null) return null;

  const organizationId = organizationFor(principal);
  if (organizationId === null) return null;

  const run = await latestRun(config.database, principal.tenantId, organizationId);
  if (run === null) return null;

  const results = await resultsForRun(config.database, principal.tenantId, run.assessmentRunId);
  return { run, results };
}

/**
 * The facts the engine read for one result, by input name.
 *
 * The engine records `computedInputs` — the value it saw for each declared input, or `null`
 * where the snapshot had none. `projectFactBag` builds that bag from the snapshot facts for
 * one subject keyed by field name, so an input that was read corresponds to the fact
 * `(subjectType, subjectId, inputName)` of the subject being assessed. A `null` stays `null`:
 * that absence is why the rule is INDETERMINATE (invariant 9), and claiming it read a fact
 * would be a link to something that was never there.
 */
function inputFactsOf(result: {
  subjectType: string;
  subjectId: string;
  computedInputs: Readonly<Record<string, unknown>>;
}): StorableResult['inputFacts'] {
  const inputs: Record<string, { subjectType: string; subjectId: string; field: string } | null> =
    {};
  for (const [name, value] of Object.entries(result.computedInputs)) {
    inputs[name] =
      value === null
        ? null
        : { subjectType: result.subjectType, subjectId: result.subjectId, field: name };
  }
  return inputs;
}

export interface UploadRequest {
  readonly principal: Principal;
  readonly fileName: string;
  readonly bytes: Buffer;
  /** Supplied by the caller, never read from a clock here. See `worked-example.ts`. */
  readonly uploadedAt: string;
  /** The calendar date the rules are resolved as of. Invariant 6: a date, not a timestamp. */
  readonly asOf: string;
}

/**
 * Ingest a district export, evaluate it, and store both.
 *
 * The evaluation is not stored separately from the import: they go in one after the other
 * within the same request, and a failure to store the run leaves the import behind
 * deliberately. The import is a district's own data and is worth keeping even when the
 * assessment could not be recorded — the alternative, discarding an upload because the rule
 * pack was not published, would throw away the district's work to tidy up ours.
 */
export async function ingestDistrictExport(request: UploadRequest): Promise<UploadResult> {
  const config = connected();
  if (config === null) {
    return {
      ok: false,
      refusal: {
        kind: 'NOT_CONNECTED',
        detail: 'This deployment has no database configured, so an upload has nowhere to go.',
      },
    };
  }

  const { principal } = request;
  // Uploading a general ledger is a configuration act, not a read. A reviewer with read-only
  // access to the assessment must not be able to change what it is computed from.
  if (!can(principal, 'CONFIGURE')) {
    return {
      ok: false,
      refusal: {
        kind: 'NOT_PERMITTED',
        detail:
          'Uploading a district export requires the configure capability. Your roles here are ' +
          'read-only for this district.',
      },
    };
  }

  const organizationId = organizationFor(principal);
  if (organizationId === null) {
    return {
      ok: false,
      refusal: {
        kind: 'NO_ORGANIZATION',
        detail:
          principal.scopes.length === 0
            ? 'Your account has no access scope, so there is no organization to assess.'
            : 'Your account is scoped to more than one organization. Which district this ' +
              'export belongs to is not something this page may guess.',
      },
    };
  }

  // Stated before the import runs, because `runImport` refuses a file it was told nothing
  // reliable about and the refusal has to name what is missing.
  const scan = scanVerdict(request.uploadedAt);
  if (scan.status === 'NOT_SCANNED' && !acceptsUnscanned()) {
    return {
      ok: false,
      refusal: {
        kind: 'NOT_SCANNED',
        detail:
          'No malware scanner is configured for this deployment, so an uploaded file cannot ' +
          'be cleared. Configure one, or set UPLOAD_ACCEPT_UNSCANNED=true to accept unscanned ' +
          'uploads — which is recorded on every import and shown on every screen that renders ' +
          'it.',
      },
    };
  }

  const pack = await loadRulePack(PACK_DIR, ALLOWED_CALCULATORS);

  const sourceHash = createHash('sha256').update(request.bytes).digest('hex');
  const importJobId = randomUUID();
  const snapshotId = randomUUID();

  const outcome = assessDistrictExport({
    import: {
      importJobId,
      tenantId: principal.tenantId,
      organizationId,
      snapshotId,
      createdAt: request.uploadedAt,
      file: {
        sourceFileId: importJobId,
        originalFilename: request.fileName,
        sourceHash,
        uploadedAt: request.uploadedAt,
        uploadedBy: principal.email,
      },
      scan,
      acknowledgeUnscanned: scan.status === 'NOT_SCANNED',
      content: request.bytes.toString('utf8'),
      template: TEMPLATE,
      subject: {
        subjectType: TEMPLATE.targetEntity,
        keyFields: ['lea_id', 'fiscal_year_key'],
        separator: ':',
      },
    },
    // Nothing carried forward. A prior determination binds to a finalized run of this
    // platform, and this district has none stored yet; the rules that need one reach
    // INDETERMINATE, which is invariant 9 and is the truthful answer.
    priorDeterminations: [],
    // Deliberately omitted: the subject key is built by the template from transformed values,
    // so the import is the only thing that can say which subject this row is about. See the
    // note on `AssessDistrictExportRequest.subject`.
    context: {
      tenantId: principal.tenantId,
      organizationId,
      assessmentRunId: importJobId,
      evaluatedAt: request.uploadedAt,
    },
    packs: [pack],
    asOf: request.asOf,
    calculators: CALCULATORS,
    // DRAFT, because nothing in this pack has been through the review section 35 requires.
    // Every surface that renders a result from it says so.
    includeLifecycles: ['DRAFT'],
  });

  if (outcome.snapshot === undefined || outcome.assessment === undefined) {
    return { ok: false, refusal: { kind: 'REJECTED', outcome } };
  }

  const { snapshot, assessment } = outcome;

  let stored;
  try {
    stored = await persistImport(config.database, {
      tenantId: principal.tenantId,
      organizationId,
      sourceSystemId: await manualUploadSource(config.database, principal.tenantId, organizationId),
      requestedByUserId: principal.userId,
      // The bytes' own hash. Re-posting the identical file — a browser retrying a slow upload —
      // hits the UNIQUE on (tenant_id, idempotency_key) rather than producing a second
      // assessment nobody can tell apart from the first.
      idempotencyKey: `upload:${sourceHash}`,
      file: {
        fileName: request.fileName,
        mediaType: 'text/csv',
        bytes: request.bytes,
        rows: outcome.import.rows ?? [],
        scan,
      },
      snapshot: {
        organizationId,
        label: request.fileName,
        contentHash: snapshot.contentHash,
        facts: snapshot.facts.map((fact): StorableFact => ({
          subjectType: fact.subjectType,
          subjectId: fact.subjectId,
          field: fact.field,
          value: fact.value,
          valueType: fact.valueType,
          classification: fact.classification,
          origin: fact.origin,
          // Spread rather than passed: `FactProvenance` is a tagged union, and the store
          // treats provenance as bag data it writes to jsonb and reads two keys out of.
          provenance: { ...fact.provenance },
        })),
      },
    });
  } catch (error) {
    // The idempotency key is the file's own hash, so this is a browser retrying a slow
    // upload or an officer pressing the button twice — not an error to show as one. The
    // first import stands, and its run is what the page already shows.
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        refusal: {
          kind: 'ALREADY_IMPORTED',
          detail:
            'This exact file has already been imported for your district. The assessment made ' +
            'from it is the one shown; re-uploading identical bytes would produce a second run ' +
            'nobody could tell apart from the first.',
        },
      };
    }
    throw error;
  }

  try {
    const { assessmentRunId } = await persistRun(config.database, {
      tenantId: principal.tenantId,
      organizationId,
      dataSnapshotId: stored.dataSnapshotId,
      factIds: stored.factIds,
      requestedByUserId: principal.userId,
      engineVersion: assessment.results[0]?.engineVersion ?? '0.0.0',
      rulePackId: pack.manifest.packId,
      rulePackVersion: pack.manifest.version,
      programYearKind: 'FISCAL',
      programYearLabel: fiscalYearOf(assessment.subject.subjectId),
      results: assessment.results.map((result): StorableResult => ({
        ruleId: result.ruleId,
        subjectType: findingSubjectType(result.subjectType),
        subjectId: result.subjectId,
        status: result.status,
        severityOnFailure: result.severityOnFailure,
        explanation: result.explanation,
        evaluationHash: result.evaluationHash,
        output: result.output,
        missingInputs: result.missingInputs,
        inputFacts: inputFactsOf(result),
      })),
      // Not finalized. Every rule in this pack is DRAFT, so the run is advisory: there is
      // nothing here worth freezing, and freezing it would prevent a re-run once the content
      // has been through review.
      finalize: false,
    });

    return { ok: true, assessmentRunId, factCount: snapshot.facts.length };
  } catch (error) {
    if (error instanceof UnpublishedRuleError) {
      return {
        ok: false,
        refusal: {
          kind: 'CONTENT_NOT_PUBLISHED',
          detail:
            `${error.message} The export was stored; only the assessment could not be. ` +
            'Publish the rule pack and upload again.',
        },
      };
    }
    if (error instanceof MissingInputFactError || error instanceof UnstorableProvenanceError) {
      return { ok: false, refusal: { kind: 'BROKEN_PROVENANCE', detail: error.message } };
    }
    throw error;
  }
}

/**
 * The `source_systems` row every manual upload for this organization is recorded against.
 *
 * Created on first use rather than at onboarding, because a district that never uploads
 * anything should not carry a connector row claiming it did. `CSV_UPLOAD` against
 * `ERP_FINANCE` is what actually happened, and `is_read_only` is true by schema default:
 * the platform never writes back to a district's system.
 */
async function manualUploadSource(
  database: NonNullable<ReturnType<typeof connected>>['database'],
  tenantId: string,
  organizationId: string,
): Promise<string> {
  return database.withTenant(tenantId, async (db) => {
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM source_systems
        WHERE organization_id = $1 AND connector_kind = 'CSV_UPLOAD'
        ORDER BY created_at
        LIMIT 1`,
      [organizationId],
    );
    const found = existing.rows[0]?.id;
    if (found !== undefined) return found;

    const inserted = await db.query<{ id: string }>(
      `INSERT INTO source_systems
         (tenant_id, organization_id, system_type, connector_kind, display_name, status)
       VALUES ($1, $2, 'ERP_FINANCE', 'CSV_UPLOAD', 'District fiscal export (manual)', 'ACTIVE')
       RETURNING id`,
      [tenantId, organizationId],
    );
    const id = inserted.rows[0]?.id;
    if (id === undefined) throw new Error('source_systems insert returned no id');
    return id;
  });
}

/** `LEA-0417:2026` -> `FY2026`. The program year a run is filed under. */
function fiscalYearOf(subjectId: string): string {
  const year = subjectId.split(':').at(-1) ?? '';
  return /^\d{4}$/.test(year) ? `FY${year}` : subjectId;
}

/**
 * What scanned this upload, or the truthful admission that nothing did.
 *
 * There is no scanner on this deployment (see the threat model, "Malicious file"), so the
 * only honest verdict is `NOT_SCANNED` with `none-configured` as the scanner. When one is
 * wired up, this is the single function that changes and every caller keeps working.
 *
 * `scannedAt` is the caller's timestamp, not a clock read here — a verdict has to be dated,
 * and a module that reads the clock cannot be tested for what it recorded.
 */
function scanVerdict(at: string): { status: ScanStatus; scanner: string; scannedAt: string } {
  return { status: 'NOT_SCANNED', scanner: 'none-configured', scannedAt: at };
}

/**
 * Whether this deployment has said, out loud, that it accepts unscanned uploads.
 *
 * Only the exact string `true`. A truthy-ish value — `1`, `yes`, an empty string that some
 * shell produced — should not turn off a security control, and a variable set by accident
 * should not either.
 */
function acceptsUnscanned(): boolean {
  return process.env['UPLOAD_ACCEPT_UNSCANNED'] === 'true';
}

/**
 * Whether an error is Postgres refusing a duplicate.
 *
 * Matched on SQLSTATE rather than on the message, which is localized and which names the
 * constraint in a form that changes when the constraint is renamed.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

/**
 * The engine's subject type, in the vocabulary a stored finding uses.
 *
 * Two different vocabularies, deliberately. `lea_fiscal_year` is a mapping template's target
 * entity — what a row of an uploaded file is about. `FISCAL_YEAR` is what a *finding* is
 * about, from `FINDING_SUBJECT_TYPES`, and `evaluation_results.subject_type` is CHECKed
 * against it so that a monitor filtering findings by subject gets a closed set rather than
 * whatever an ingestion template happened to be called.
 *
 * Translated explicitly rather than by uppercasing. An unmapped subject type is a refusal,
 * not a guess: storing a finding under the wrong subject makes it invisible to the filter a
 * reviewer would use to find it, which is indistinguishable from not storing it at all.
 */
const FINDING_SUBJECTS: Readonly<Record<string, string>> = {
  lea_fiscal_year: 'FISCAL_YEAR',
  LEA_FISCAL_YEAR: 'FISCAL_YEAR',
  organization: 'ORGANIZATION',
  ORGANIZATION: 'ORGANIZATION',
  school_site: 'SCHOOL_SITE',
  SCHOOL_SITE: 'SCHOOL_SITE',
  federal_award: 'FEDERAL_AWARD',
  FEDERAL_AWARD: 'FEDERAL_AWARD',
  special_ed_case: 'SPECIAL_ED_CASE',
  SPECIAL_ED_CASE: 'SPECIAL_ED_CASE',
};

function findingSubjectType(subjectType: string): string {
  const mapped = FINDING_SUBJECTS[subjectType];
  if (mapped === undefined) {
    throw new Error(
      `A rule evaluated the subject type ${JSON.stringify(subjectType)}, which has no finding ` +
        'subject type. Add it to FINDING_SUBJECT_TYPES and to this map before storing results ' +
        'against it — a finding filed under the wrong subject is one nobody will find.',
    );
  }
  return mapped;
}
