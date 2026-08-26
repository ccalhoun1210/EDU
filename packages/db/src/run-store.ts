/**
 * Writing an assessment run and reading it back.
 *
 * Spec: Master Technical Buildout sections 11 and 22. CLAUDE.md invariants 3 and 4.
 *
 * ## Where invariant 3 is actually kept
 *
 * "Finding → Rule → Rule version → Regulatory authority → Input fact → Source record →
 * Transformation → Data snapshot. A finding without that chain must not be creatable."
 *
 * The schema enforces most of that with NOT NULL foreign keys: `evaluation_results` cannot
 * exist without a `rule_version_id` and an `assessment_run_id`, and the run cannot exist
 * without a `data_snapshot_id` and a `rule_pack_version_id`. What the schema cannot enforce
 * is the link from a result to the facts it read — `evaluation_result_inputs` is a table
 * anyone could simply not write.
 *
 * So this module writes it, and writes it from the engine's own record of which inputs it
 * consumed rather than from a guess. A result whose inputs cannot be resolved to stored
 * facts is a result this module refuses to write at all: see `MissingInputFactError`. The
 * alternative — writing the finding and skipping the inputs — produces exactly the finding
 * invariant 3 says must not be creatable, and produces it silently.
 *
 * ## Rule versions must already exist
 *
 * `assessment_runs.rule_pack_version_id` and `evaluation_results.rule_version_id` are NOT
 * NULL references into the regulatory content tables, which are global and installed by the
 * owner (migration 0004). The application role has SELECT on them and nothing more.
 *
 * That is deliberate and it has a consequence worth stating: a run cannot be recorded
 * against a rule pack that has not been published into the database, even though the engine
 * can happily evaluate one read from a YAML file on disk. `scripts/publish-rulepack.mjs`
 * is what closes that gap. A deployment that evaluates against content the database has
 * never seen can show a result on screen but cannot store it — which is the right way round,
 * because a stored finding is the one somebody might later cite.
 */

import type { Database } from './client.js';
import { factKey } from './import-store.js';

type Conn = Parameters<Parameters<Database['withTenant']>[1]>[0];

/** Raised rather than writing a finding whose inputs cannot be traced. Invariant 3. */
export class MissingInputFactError extends Error {
  constructor(
    readonly ruleId: string,
    readonly inputName: string,
  ) {
    super(
      `Rule ${ruleId} read input "${inputName}", but no stored fact matches it. Refusing to ` +
        'write a finding whose provenance chain is broken (CLAUDE.md invariant 3).',
    );
    this.name = 'MissingInputFactError';
  }
}

/** Raised when the regulatory content a run cites is not in this database. */
export class UnpublishedRuleError extends Error {
  constructor(readonly ruleId: string) {
    super(
      `Rule ${ruleId} is not published in this database, so a result citing it cannot be ` +
        'stored. Run `pnpm db:publish:rulepack` first.',
    );
    this.name = 'UnpublishedRuleError';
  }
}

/**
 * One evaluated rule, in the shape this module needs.
 *
 * Structural rather than an import of `EvaluationResult`, so `packages/db` stays below the
 * engine rather than beside it.
 */
export interface StorableResult {
  readonly ruleId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly status: string;
  readonly severityOnFailure: string;
  readonly explanation: string;
  readonly evaluationHash: string;
  readonly output: Readonly<Record<string, unknown>>;
  readonly missingInputs: readonly string[];
  /**
   * The facts the engine actually read, by input name.
   *
   * `null` where the input was absent — which is how a rule reaches INDETERMINATE, and which
   * must not be written as an input link to a fact that was never there.
   */
  readonly inputFacts: Readonly<
    Record<string, { subjectType: string; subjectId: string; field: string } | null>
  >;
}

export interface PersistRunRequest {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly dataSnapshotId: string;
  readonly factIds: ReadonlyMap<string, string>;
  readonly requestedByUserId: string;
  readonly engineVersion: string;
  readonly rulePackId: string;
  readonly rulePackVersion: string;
  readonly programYearKind: 'FISCAL' | 'ACADEMIC';
  readonly programYearLabel: string;
  readonly fiscalYearId?: string;
  readonly results: readonly StorableResult[];
  /**
   * Whether to finalize the run.
   *
   * A FINALIZED run is immutable — the schema's own trigger refuses any later change to it
   * or to its results (invariant 4). Finalizing is therefore a decision, not a default: an
   * advisory run over DRAFT rules has nothing to protect and everything to gain from being
   * replaceable.
   */
  readonly finalize: boolean;
}

async function ruleVersionIds(
  db: Conn,
  rulePackId: string,
  rulePackVersion: string,
  ruleIds: readonly string[],
): Promise<{ packVersionId: string; byRuleId: Map<string, string> }> {
  const pack = await db.query<{ id: string }>(
    `SELECT id FROM rule_pack_versions WHERE pack_id = $1 AND version = $2`,
    [rulePackId, rulePackVersion],
  );
  const packVersionId = pack.rows[0]?.id;
  if (packVersionId === undefined) {
    throw new UnpublishedRuleError(`${rulePackId}@${rulePackVersion}`);
  }

  const versions = await db.query<{ rule_id: string; id: string }>(
    `SELECT rule_id, id FROM rule_versions
      WHERE rule_pack_version_id = $1 AND rule_id = ANY($2::text[])`,
    [packVersionId, [...ruleIds]],
  );

  const byRuleId = new Map(versions.rows.map((row) => [row.rule_id, row.id]));
  for (const ruleId of ruleIds) {
    if (!byRuleId.has(ruleId)) throw new UnpublishedRuleError(ruleId);
  }
  return { packVersionId, byRuleId };
}

/**
 * Write a run, its results, and the link from each result to the facts it read.
 *
 * One transaction. A run whose results are half-written would report a different roll-up
 * than the engine computed, and there is no honest way to display that.
 */
export function persistRun(
  database: Database,
  request: PersistRunRequest,
): Promise<{ assessmentRunId: string }> {
  return database.withTenant(request.tenantId, async (db) => {
    const { packVersionId, byRuleId } = await ruleVersionIds(
      db,
      request.rulePackId,
      request.rulePackVersion,
      request.results.map((result) => result.ruleId),
    );

    // Written as COMPLETED even when it is about to be finalized. Invariant 4's trigger
    // refuses any write touching an already-FINALIZED run — including inserting the results
    // — and it is right to: a run that could still gain a finding after being finalized is
    // not immutable. So the results go in first and FINALIZED is the last thing that
    // happens, which is also the honest order: nothing is final until it is all there.
    const run = await db.query<{ id: string }>(
      `INSERT INTO assessment_runs
         (tenant_id, organization_id, module, kind, scope_type, program_year_kind,
          program_year_label, fiscal_year_id, rule_pack_version_id, engine_version,
          data_snapshot_id, status, requested_by_user_id, started_at, completed_at)
       VALUES ($1, $2, 'IDEA_FISCAL', 'ACTUAL', 'ORGANIZATION', $3, $4, $5, $6, $7, $8,
               'COMPLETED', $9, now(), now())
       RETURNING id`,
      [
        request.tenantId,
        request.organizationId,
        request.programYearKind,
        request.programYearLabel,
        request.fiscalYearId ?? null,
        packVersionId,
        request.engineVersion,
        request.dataSnapshotId,
        request.requestedByUserId,
      ],
    );
    const assessmentRunId = run.rows[0]?.id;
    if (assessmentRunId === undefined) throw new Error('assessment_runs insert returned no id');

    for (const result of request.results) {
      const ruleVersionId = byRuleId.get(result.ruleId);
      if (ruleVersionId === undefined) throw new UnpublishedRuleError(result.ruleId);

      const inserted = await db.query<{ id: string }>(
        `INSERT INTO evaluation_results
           (tenant_id, assessment_run_id, rule_version_id, subject_type, subject_id, status,
            severity, computed_values, explanation, indeterminate_reason, evaluation_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
         RETURNING id`,
        [
          request.tenantId,
          assessmentRunId,
          ruleVersionId,
          result.subjectType,
          result.subjectId,
          result.status,
          result.severityOnFailure,
          JSON.stringify(result.output),
          result.explanation,
          // The schema CHECKs that this is present exactly when the status is INDETERMINATE,
          // so it is derived from the status rather than passed separately — two sources for
          // one fact is how they come to disagree.
          result.status === 'INDETERMINATE'
            ? `Waiting on: ${result.missingInputs.join(', ') || 'an input the platform does not hold'}`
            : null,
          result.evaluationHash,
        ],
      );
      const resultId = inserted.rows[0]?.id;
      if (resultId === undefined) throw new Error('evaluation_results insert returned no id');

      for (const [inputName, fact] of Object.entries(result.inputFacts)) {
        // An absent input is why a rule is INDETERMINATE. Writing a link for it would claim
        // the rule read a fact that does not exist.
        if (fact === null) continue;

        const canonicalFactId = request.factIds.get(factKey(fact));
        if (canonicalFactId === undefined) {
          throw new MissingInputFactError(result.ruleId, inputName);
        }

        await db.query(
          `INSERT INTO evaluation_result_inputs
             (tenant_id, evaluation_result_id, canonical_fact_id, input_name)
           VALUES ($1, $2, $3, $4)`,
          [request.tenantId, resultId, canonicalFactId, inputName],
        );
      }
    }

    if (request.finalize) {
      // The trigger reads OLD.status, so this one transition is permitted and every later
      // change to the run or its results is not. Same transaction: a run that reached
      // COMPLETED and then failed to finalize would be a second, silently different record
      // of the same assessment.
      await db.query(
        `UPDATE assessment_runs SET status = 'FINALIZED', finalized_at = now() WHERE id = $1`,
        [assessmentRunId],
      );
    }

    return { assessmentRunId };
  });
}

export interface StoredRunSummary {
  readonly assessmentRunId: string;
  readonly organizationId: string;
  readonly programYearLabel: string;
  readonly status: string;
  readonly finalized: boolean;
  readonly completedAt: Date | null;
  readonly dataSnapshotId: string;
  readonly snapshotContentHash: string;
  readonly factCount: number;
  readonly rulePackId: string;
  readonly rulePackVersion: string;
  readonly engineVersion: string;
}

export interface StoredResult {
  readonly ruleId: string;
  readonly ruleTitle: string;
  readonly authorityCitation: string;
  readonly authorityUrl: string | null;
  readonly status: string;
  readonly severity: string;
  readonly explanation: string;
  readonly indeterminateReason: string | null;
  readonly evaluationHash: string;
  readonly output: Readonly<Record<string, unknown>>;
}

/**
 * The most recent run for an organization, or null.
 *
 * Ordered by `completed_at` and then `id`, because two runs completing inside the same
 * millisecond is not impossible and "whichever the planner returned first" is not an order.
 */
export function latestRun(
  database: Database,
  tenantId: string,
  organizationId: string,
): Promise<StoredRunSummary | null> {
  return database.withTenant(tenantId, async (db) => {
    const found = await db.query<{
      id: string;
      organization_id: string;
      program_year_label: string;
      status: string;
      finalized_at: Date | null;
      completed_at: Date | null;
      data_snapshot_id: string;
      content_hash: string;
      fact_count: string;
      pack_id: string;
      version: string;
      engine_version: string;
    }>(
      `SELECT r.id, r.organization_id, r.program_year_label, r.status, r.finalized_at,
              r.completed_at, r.data_snapshot_id, s.content_hash, s.fact_count,
              pv.pack_id, pv.version, r.engine_version
         FROM assessment_runs r
         JOIN data_snapshots s ON s.tenant_id = r.tenant_id AND s.id = r.data_snapshot_id
         JOIN rule_pack_versions pv ON pv.id = r.rule_pack_version_id
        WHERE r.organization_id = $1 AND r.kind = 'ACTUAL'
        ORDER BY r.completed_at DESC NULLS LAST, r.id DESC
        LIMIT 1`,
      [organizationId],
    );

    const row = found.rows[0];
    if (row === undefined) return null;

    return {
      assessmentRunId: row.id,
      organizationId: row.organization_id,
      programYearLabel: row.program_year_label,
      status: row.status,
      finalized: row.finalized_at !== null,
      completedAt: row.completed_at,
      dataSnapshotId: row.data_snapshot_id,
      snapshotContentHash: row.content_hash,
      // bigint, which the driver hands back as a string so a large one cannot be silently
      // rounded through a double. Two facts is not large; the coercion is here so the type
      // on `StoredRunSummary` is the truth rather than an aspiration.
      factCount: Number(row.fact_count),
      rulePackId: row.pack_id,
      rulePackVersion: row.version,
      engineVersion: row.engine_version,
    };
  });
}

/** The results of a stored run, with the rule and authority each one cites. */
export function resultsForRun(
  database: Database,
  tenantId: string,
  assessmentRunId: string,
): Promise<readonly StoredResult[]> {
  return database.withTenant(tenantId, async (db) => {
    const found = await db.query<{
      rule_id: string;
      title: string;
      authority_citation: string;
      official_url: string | null;
      status: string;
      severity: string;
      explanation: string;
      indeterminate_reason: string | null;
      evaluation_hash: string;
      computed_values: Record<string, unknown> | null;
    }>(
      `SELECT ru.id AS rule_id, ru.title, rv.authority_citation, rs.official_url,
              er.status, er.severity, er.explanation, er.indeterminate_reason,
              er.evaluation_hash, er.computed_values
         FROM evaluation_results er
         JOIN rule_versions rv ON rv.id = er.rule_version_id
         JOIN rules ru ON ru.id = rv.rule_id
         LEFT JOIN regulatory_sources rs ON rs.id = rv.source_id
        WHERE er.assessment_run_id = $1
        ORDER BY ru.id`,
      [assessmentRunId],
    );

    return found.rows.map((row) => ({
      ruleId: row.rule_id,
      ruleTitle: row.title,
      authorityCitation: row.authority_citation,
      authorityUrl: row.official_url,
      status: row.status,
      severity: row.severity,
      explanation: row.explanation,
      indeterminateReason: row.indeterminate_reason,
      evaluationHash: row.evaluation_hash,
      output: row.computed_values ?? {},
    }));
  });
}
