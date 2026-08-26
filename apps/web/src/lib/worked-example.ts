/**
 * The one assessment this deployment can show, computed on the server at request time.
 *
 * ## Why a fixture and not a district
 *
 * There is no district here. This deployment has no authentication, no tenant onboarding and
 * no database connection, so there is no district export to read and nowhere to put one. What
 * the platform *does* have is a complete, tested path from uploaded bytes to a cited finding,
 * and the honest thing to put on screen is that path running — over a synthetic export whose
 * every figure is invented, labelled as such on every page that renders it.
 *
 * The alternative would be an upload form that writes nowhere and a table with no rows. That
 * is the "coming soon" shell CLAUDE.md forbids; this is not. Nothing below is a mock: the
 * bytes are parsed by the real CSV reader, mapped by a real versioned template, sealed into a
 * real content-hashed snapshot, and evaluated by the real engine against the rule pack that
 * shipped with this build. Change a figure in the fixture and the numbers on the page move.
 *
 * ## Why it is recomputed per request
 *
 * `assessDistrictExport` is pure and reads no clock, so the result is identical every time.
 * Recomputing keeps the page honest about the build it is serving: the pack is re-read from
 * disk, so a deployment whose regulatory content failed to ship fails visibly here rather
 * than serving a value baked in at build time.
 */

import { cache } from 'react';
import { CALCULATORS } from '@complianceos/calculators';
import {
  assessDistrictExport,
  IMPORT_JOB_ID,
  NORTHFIELD_EXPORT_CSV,
  NORTHFIELD_METHODS_MET,
  NORTHFIELD_PRIOR_DETERMINATIONS,
  NORTHFIELD_SOURCE_HASH,
  NORTHFIELD_STATUS_SOURCE,
  NORTHFIELD_TEMPLATE,
  type AssessDistrictExportOutcome,
} from '@complianceos/assurance';
import {
  ALLOWED_CALCULATORS,
  loadRulePack,
  loadSourceRegistries,
  type LoadedRulePack,
  type RegulatorySource,
} from '@complianceos/rulepack-sdk';
import { PACK_DIR, SOURCES_DIR } from './repo.js';

/** Who the assessment is about. Invented; see the fixture's own header. */
export const SUBJECT = {
  subjectType: 'lea_fiscal_year',
  subjectId: 'LEA-0417:2026',
  organizationId: 'LEA-0417',
  displayName: 'Northfield Consolidated School District, Unit 3',
  fiscalYear: 'FY2026',
} as const;

/**
 * The date the run was evaluated as of.
 *
 * Fixed rather than `new Date()`. The engine refuses to read a clock so that a finalized run
 * reproduces years later, and a page that fed it today's date would produce a different run
 * on every request while claiming to show the same one.
 */
const EVALUATED_AT = '2026-08-01T00:00:00.000Z';
const AS_OF = '2026-08-01';
const RUN_ID = 'run_northfield_0001';
const SNAPSHOT_ID = 'snap_northfield_fy2026';

export const UPLOAD = {
  sourceFileId: 'file_northfield_fy2026',
  originalFilename: 'northfield-fiscal-fy2026.csv',
  sourceHash: NORTHFIELD_SOURCE_HASH,
  uploadedAt: EVALUATED_AT,
  uploadedBy: 'business.officer@northfield.example',
} as const;

export interface WorkedExample {
  readonly outcome: AssessDistrictExportOutcome;
  readonly pack: LoadedRulePack;
  readonly sources: readonly RegulatorySource[];
}

/**
 * `cache` deduplicates within a single request, so a page and the components under it share
 * one computation instead of parsing the pack once per call site.
 */
export const workedExample = cache(async (): Promise<WorkedExample> => {
  const [pack, sources] = await Promise.all([
    loadRulePack(PACK_DIR, ALLOWED_CALCULATORS),
    loadSourceRegistries(SOURCES_DIR),
  ]);

  const outcome = assessDistrictExport({
    import: {
      importJobId: IMPORT_JOB_ID,
      tenantId: 'tenant_northfield',
      organizationId: SUBJECT.organizationId,
      snapshotId: SNAPSHOT_ID,
      createdAt: EVALUATED_AT,
      file: { ...UPLOAD },
      scan: { status: 'CLEAN', scanner: 'synthetic-fixture', scannedAt: EVALUATED_AT },
      content: NORTHFIELD_EXPORT_CSV,
      template: NORTHFIELD_TEMPLATE,
      subject: {
        subjectType: SUBJECT.subjectType,
        keyFields: ['lea_id', 'fiscal_year_key'],
        separator: ':',
      },
    },
    priorDeterminations: [
      ...NORTHFIELD_PRIOR_DETERMINATIONS,
      NORTHFIELD_METHODS_MET,
      NORTHFIELD_STATUS_SOURCE,
    ],
    subject: { subjectType: SUBJECT.subjectType, subjectId: SUBJECT.subjectId },
    context: {
      tenantId: 'tenant_northfield',
      organizationId: SUBJECT.organizationId,
      assessmentRunId: RUN_ID,
      evaluatedAt: EVALUATED_AT,
    },
    packs: [pack],
    asOf: AS_OF,
    calculators: CALCULATORS,
    // DRAFT because nothing in this pack has been through the review section 35 requires.
    // Evaluating it is how the content gets reviewed; `official` stays false, and every
    // surface that renders a result says so.
    includeLifecycles: ['DRAFT'],
  });

  return { outcome, pack, sources };
});
