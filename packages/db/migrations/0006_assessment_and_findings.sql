-- ---------------------------------------------------------------------------
-- 0006_assessment_and_findings.sql
--
-- Adds: assessment_runs, evaluation_results, evaluation_result_inputs, findings,
-- finding_dispositions, finding_disposition_evidence, evidence_items,
-- evidence_links, corrective_actions, action_updates, attestations, report_runs.
--
-- Depends on: 0001 (immutability triggers), 0002, 0004 (rule content), 0005
-- (data_snapshots, canonical_facts).
-- Depended on by: 0007, which links fiscal inputs to the canonical facts an
-- evaluation reads.
--
-- Spec: Master Technical Buildout sections 8.7, 11, 15, 16 and 22.
-- CLAUDE.md invariants 3, 4 and 9.
--
-- ## Where invariant 3 is actually enforced
--
-- The provenance chain is
--
--   finding -> evaluation_result -> assessment_run -> data_snapshot -> facts
--      \-> rule_version -> regulatory_source
--
-- and the columns that carry it — evaluation_result_id, rule_version_id,
-- data_snapshot_id, engine_version, evaluation_hash — are all NOT NULL on
-- findings. "A finding without that chain must not be creatable" is a statement
-- about the database, not about a service method that could be bypassed by a
-- backfill script.
--
-- ## Where invariant 4 is enforced
--
-- Two triggers from 0001: one refuses any change to a FINALIZED run, the other
-- refuses any change to a result belonging to one. Findings themselves carry no
-- mutable status column at all — a finding IS the engine's answer, and the human
-- overlay lives in finding_dispositions as separate, additive rows. There is
-- therefore no column anyone could edit to make an inconvenient finding go away.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------- assessment_runs --
CREATE TABLE assessment_runs (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  module text NOT NULL CHECK (module IN (
    'IDEA_FISCAL',
    'DISPROPORTIONALITY',
    'SPED_PROGRAMMATIC'
  )),
  -- Section 12.2's what-if runs share the whole machinery. The kind travels on
  -- the run so a scenario can never be mistaken for an assessment of record —
  -- and, below, so a scenario can never be finalized.
  kind text NOT NULL DEFAULT 'ACTUAL' CHECK (kind IN ('ACTUAL', 'SCENARIO')),
  scope_type text NOT NULL CHECK (scope_type IN (
    'ORGANIZATION',
    'SCHOOL_SITE',
    'FEDERAL_AWARD'
  )),
  -- Empty means every subject of `scope_type` in the organization.
  scope_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  program_year_kind text NOT NULL CHECK (program_year_kind IN ('FISCAL', 'ACADEMIC')),
  -- The year label as the state writes it. Compared as a label, never parsed.
  program_year_label text NOT NULL,
  fiscal_year_id uuid,
  academic_year_id uuid,

  -- The four bindings section 11 requires. All NOT NULL: a run that cannot say
  -- which rules, which engine and which data produced it is not reproducible,
  -- and an irreproducible run is not evidence of anything.
  rule_pack_version_id uuid NOT NULL REFERENCES rule_pack_versions (id),
  engine_version text NOT NULL CHECK (length(engine_version) > 0),
  data_snapshot_id uuid NOT NULL,

  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING',
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'FINALIZED'
  )),
  requested_by_user_id uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  finalized_at timestamptz,
  -- The run this one is compared against on the section 11 diff screen
  -- (resolved / new / unchanged).
  previous_run_id uuid,
  failure_reason text,

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_year_id) REFERENCES fiscal_years (tenant_id, id),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic_years (tenant_id, id),
  FOREIGN KEY (tenant_id, data_snapshot_id) REFERENCES data_snapshots (tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by_user_id) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, previous_run_id) REFERENCES assessment_runs (tenant_id, id),
  CHECK ((status = 'FINALIZED') = (finalized_at IS NOT NULL)),
  CHECK (status <> 'FAILED' OR failure_reason IS NOT NULL),
  -- A what-if is never the assessment of record.
  CHECK (kind <> 'SCENARIO' OR status <> 'FINALIZED'),
  CHECK (previous_run_id IS NULL OR previous_run_id <> id)
);

CREATE INDEX assessment_runs_by_org
  ON assessment_runs (tenant_id, organization_id, module, requested_at DESC);

ALTER TABLE assessment_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY assessment_runs_isolation ON assessment_runs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE TRIGGER assessment_runs_finalized_immutable
  BEFORE UPDATE OR DELETE ON assessment_runs
  FOR EACH ROW EXECUTE FUNCTION forbid_finalized_run_change();

GRANT SELECT, INSERT, UPDATE, DELETE ON assessment_runs TO complianceos_app;

-- -------------------------------------------------------- evaluation_results --
--
-- One row per (rule version, subject) evaluated in a run — section 8.7.
--
-- The last CHECK is invariant 9 in the database: INDETERMINATE means the rule
-- could not be answered, and a result that says so must say why. Equally, a
-- PASS may not carry an indeterminacy reason, which stops the shape "we could
-- not tell, so we called it a pass" from being representable at all.
CREATE TABLE evaluation_results (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  assessment_run_id uuid NOT NULL,
  rule_version_id uuid NOT NULL REFERENCES rule_versions (id),
  subject_type text NOT NULL CHECK (subject_type IN (
    'ORGANIZATION',
    'SCHOOL_SITE',
    'FISCAL_YEAR',
    'FEDERAL_AWARD',
    'SPECIAL_ED_CASE'
  )),
  subject_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'PASS',
    'FAIL',
    'RISK',
    'INDETERMINATE',
    'MANUAL_REVIEW',
    'NOT_APPLICABLE'
  )),
  severity text NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  -- Every intermediate the calculators produced, as canonical decimal STRINGS
  -- inside the JSON document. Not JSON numbers: JSON numbers are IEEE-754
  -- doubles the moment anything parses them, and a maintenance-of-effort
  -- shortfall that changed by a cent on its way through a report would be a
  -- compliance defect (invariant 5).
  computed_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation text NOT NULL,
  indeterminate_reason text,
  -- Hash over the canonical form of inputs, rule version and outputs. What lets
  -- a monitor confirm the result shown today is the result the engine computed.
  evaluation_hash text NOT NULL CHECK (evaluation_hash ~ '^[0-9a-f]{64}$'),
  evaluated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, assessment_run_id) REFERENCES assessment_runs (tenant_id, id),
  UNIQUE (tenant_id, assessment_run_id, rule_version_id, subject_type, subject_id),
  CHECK ((status = 'INDETERMINATE') = (indeterminate_reason IS NOT NULL))
);

CREATE INDEX evaluation_results_by_run
  ON evaluation_results (tenant_id, assessment_run_id, status);

ALTER TABLE evaluation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_results FORCE ROW LEVEL SECURITY;
CREATE POLICY evaluation_results_isolation ON evaluation_results
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE TRIGGER evaluation_results_finalized_immutable
  BEFORE UPDATE OR DELETE ON evaluation_results
  FOR EACH ROW EXECUTE FUNCTION forbid_finalized_run_result_change();

GRANT SELECT, INSERT, UPDATE, DELETE ON evaluation_results TO complianceos_app;

-- -------------------------------------------------- evaluation_result_inputs --
--
-- "Input fact" in invariant 3's chain, as real referential integrity rather than
-- an array of loose ids. This is the join a district's business officer walks
-- backwards when they ask "which numbers produced this?", and the answer has to
-- survive a rule pack being republished.
CREATE TABLE evaluation_result_inputs (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  evaluation_result_id uuid NOT NULL,
  canonical_fact_id uuid NOT NULL,
  -- The name the rule's expression referred to this fact by, e.g.
  -- 'priorYearLocalExpenditure'. Without it the lineage view can list the facts
  -- but cannot say which slot each one filled.
  input_name text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, evaluation_result_id) REFERENCES evaluation_results (tenant_id, id),
  FOREIGN KEY (tenant_id, canonical_fact_id) REFERENCES canonical_facts (tenant_id, id),
  UNIQUE (tenant_id, evaluation_result_id, input_name, canonical_fact_id)
);

ALTER TABLE evaluation_result_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_result_inputs FORCE ROW LEVEL SECURITY;
CREATE POLICY evaluation_result_inputs_isolation ON evaluation_result_inputs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, DELETE ON evaluation_result_inputs TO complianceos_app;

-- ----------------------------------------------------------------- findings --
--
-- Note what is NOT here: a mutable status column. A finding is the deterministic
-- engine's answer, frozen. Human judgement is recorded in finding_dispositions
-- as append-only rows, and remediation progress lives in corrective_actions.
-- Splitting them means nobody can quietly edit a finding into compliance, and a
-- monitor reading the audit file sees both what the system found and what the
-- district said about it.
CREATE TABLE findings (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,

  -- Provenance. Every one of these is NOT NULL by design (invariant 3).
  assessment_run_id uuid NOT NULL,
  evaluation_result_id uuid NOT NULL,
  rule_id text NOT NULL REFERENCES rules (id),
  rule_version_id uuid NOT NULL REFERENCES rule_versions (id),
  data_snapshot_id uuid NOT NULL,
  engine_version text NOT NULL CHECK (length(engine_version) > 0),
  evaluation_hash text NOT NULL CHECK (evaluation_hash ~ '^[0-9a-f]{64}$'),
  requirement_id text REFERENCES requirements (id),

  system_status text NOT NULL CHECK (system_status IN ('FAIL', 'RISK', 'MANUAL_REVIEW')),
  severity text NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  subject_type text NOT NULL CHECK (subject_type IN (
    'ORGANIZATION',
    'SCHOOL_SITE',
    'FISCAL_YEAR',
    'FEDERAL_AWARD',
    'SPECIAL_ED_CASE'
  )),
  subject_id text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  -- The date of the run that produced it. A calendar date because it is the date
  -- a district and a monitor will both cite (invariant 6).
  detected_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, assessment_run_id) REFERENCES assessment_runs (tenant_id, id),
  FOREIGN KEY (tenant_id, evaluation_result_id) REFERENCES evaluation_results (tenant_id, id),
  FOREIGN KEY (tenant_id, data_snapshot_id) REFERENCES data_snapshots (tenant_id, id),
  -- One finding per result. A second finding from the same evaluation would be
  -- the same fact counted twice on a district's dashboard.
  UNIQUE (tenant_id, evaluation_result_id)
);

CREATE INDEX findings_by_run ON findings (tenant_id, assessment_run_id, severity);
CREATE INDEX findings_by_org ON findings (tenant_id, organization_id, detected_on DESC);

ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings FORCE ROW LEVEL SECURITY;
CREATE POLICY findings_isolation ON findings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, DELETE ON findings TO complianceos_app;

-- ------------------------------------------------------ finding_dispositions --
--
-- The human overlay, additive and attributed. `reason` is NOT NULL for every
-- kind, not just the excusing ones: there is no kind for which an unexplained
-- override of a deterministic result belongs in an audit file.
CREATE TABLE finding_dispositions (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'ACKNOWLEDGED',
    'ACCEPTED_EXCEPTION',
    'DISPUTED',
    'REMEDIATION_PLANNED',
    'RESOLVED',
    'FALSE_POSITIVE'
  )),
  reviewer_user_id uuid NOT NULL,
  -- Stored rather than joined at render time: the attribution has to survive the
  -- reviewer leaving the district.
  reviewer_name text NOT NULL,
  recorded_on date NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  superseded_by_disposition_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, finding_id) REFERENCES findings (tenant_id, id),
  FOREIGN KEY (tenant_id, reviewer_user_id) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, superseded_by_disposition_id)
    REFERENCES finding_dispositions (tenant_id, id)
);

CREATE INDEX finding_dispositions_by_finding
  ON finding_dispositions (tenant_id, finding_id, recorded_on DESC);

ALTER TABLE finding_dispositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finding_dispositions FORCE ROW LEVEL SECURITY;
CREATE POLICY finding_dispositions_isolation ON finding_dispositions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON finding_dispositions TO complianceos_app;

-- ------------------------------------------------------------ evidence_items --
--
-- Section 15. Two different notions of "classification" sit in this table and
-- they are not the same thing: `classification` is how sensitive the contents
-- are (section 20), `document_class` is what kind of document it is. A board
-- minute and a payroll register can share a sensitivity and be entirely
-- different evidence.
CREATE TABLE evidence_items (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  source text NOT NULL CHECK (source IN (
    'DISTRICT_UPLOAD',
    'SOURCE_SYSTEM_EXPORT',
    'STATE_PORTAL',
    'EMAIL_INTAKE',
    'PLATFORM_GENERATED'
  )),
  document_class text NOT NULL CHECK (document_class IN (
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
    'OTHER'
  )),
  classification text NOT NULL CHECK (classification IN (
    'PUBLIC',
    'INTERNAL',
    'CONFIDENTIAL',
    'STUDENT_PII',
    'HIGHLY_SENSITIVE'
  )),
  retention_class text NOT NULL CHECK (retention_class IN (
    'FEDERAL_AWARD_RECORD',
    'STATE_PROGRAM_RECORD',
    'STUDENT_RECORD',
    'DISTRICT_POLICY_RECORD',
    'TRANSIENT_WORKING_COPY'
  )),
  media_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  storage_ref text NOT NULL,
  -- The regulatory period the document evidences, with its kind, because a
  -- district's academic year and fiscal year are different spans.
  period_kind text CHECK (period_kind IN ('FISCAL_YEAR', 'ACADEMIC_YEAR')),
  period_label text,
  malware_scan_status text NOT NULL DEFAULT 'PENDING'
    CHECK (malware_scan_status IN ('PENDING', 'CLEAN', 'INFECTED', 'FAILED')),
  text_extraction_status text NOT NULL DEFAULT 'PENDING'
    CHECK (text_extraction_status IN ('NOT_REQUIRED', 'PENDING', 'SUCCEEDED', 'FAILED')),
  -- Retention: a calendar date, because the obligation is expressed in years
  -- from a fiscal event and is asserted to auditors as a date.
  retain_until_on date,
  uploaded_by_user_id uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, uploaded_by_user_id) REFERENCES users (tenant_id, id),
  -- Deduplicated WITHIN a tenant only. A global unique on content_hash would be
  -- cheaper storage and a disclosure: it would tell one district that another
  -- holds a byte-identical document.
  UNIQUE (tenant_id, content_hash),
  CHECK ((period_kind IS NULL) = (period_label IS NULL))
);

ALTER TABLE evidence_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_items FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_items_isolation ON evidence_items
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON evidence_items TO complianceos_app;

-- ------------------------------------------------------------ evidence_links --
--
-- "Attach evidence across tenants" is one of the section 26.4 attacks, and this
-- table is where it would happen. The target is modelled as one nullable typed
-- column per kind with a composite foreign key on each, rather than a
-- (target_type, target_id) pair, precisely because a text id has no referential
-- integrity and no tenant in it. Here the database refuses the cross-tenant
-- attachment outright — there is no code path, buggy or malicious, that can
-- create the row.
--
-- CONTROL is absent from the kind list because `controls` does not exist yet.
-- The constraint permits exactly the targets the schema can actually enforce;
-- adding controls means adding a column, a foreign key and a kind together.
CREATE TABLE evidence_links (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  evidence_item_id uuid NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN (
    'REQUIREMENT',
    'FINDING',
    'CORRECTIVE_ACTION'
  )),
  finding_id uuid,
  corrective_action_id uuid,
  requirement_id text REFERENCES requirements (id),
  note text,
  linked_by_user_id uuid,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, evidence_item_id) REFERENCES evidence_items (tenant_id, id),
  FOREIGN KEY (tenant_id, finding_id) REFERENCES findings (tenant_id, id),
  FOREIGN KEY (tenant_id, linked_by_user_id) REFERENCES users (tenant_id, id),
  -- Exactly one target, and it must be the one the kind names.
  CHECK (
    (target_kind = 'FINDING' AND finding_id IS NOT NULL
       AND corrective_action_id IS NULL AND requirement_id IS NULL)
    OR (target_kind = 'CORRECTIVE_ACTION' AND corrective_action_id IS NOT NULL
       AND finding_id IS NULL AND requirement_id IS NULL)
    OR (target_kind = 'REQUIREMENT' AND requirement_id IS NOT NULL
       AND finding_id IS NULL AND corrective_action_id IS NULL)
  )
);

CREATE INDEX evidence_links_by_item ON evidence_links (tenant_id, evidence_item_id);

ALTER TABLE evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_links FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_links_isolation ON evidence_links
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, DELETE ON evidence_links TO complianceos_app;

-- ------------------------------------------------------- corrective_actions --
--
-- Section 16. Both child-specific and systemic remediation are trackable, and
-- they are separate variants rather than a flag because they carry different
-- evidence. `case_reference` is a pseudonymous handle into the case record and
-- is never a student name or district student number (invariant 10).
CREATE TABLE corrective_actions (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN (
    'DRAFT',
    'ASSIGNED',
    'IN_PROGRESS',
    'EVIDENCE_SUBMITTED',
    'REVIEW',
    'VERIFIED',
    'CLOSED'
  )),
  remediation_scope text NOT NULL CHECK (remediation_scope IN ('CHILD_SPECIFIC', 'SYSTEMIC')),
  case_reference text,
  owner_user_id uuid,
  reviewer_user_id uuid,
  due_on date,
  completed_on date,
  verification_outcome text CHECK (verification_outcome IN ('CORRECTED', 'NOT_CORRECTED')),
  verification_narrative text,
  verified_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, finding_id) REFERENCES findings (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, reviewer_user_id) REFERENCES users (tenant_id, id),
  CHECK ((remediation_scope = 'CHILD_SPECIFIC') = (case_reference IS NOT NULL)),
  CHECK ((verification_outcome IS NULL) = (verified_on IS NULL)),
  CHECK (verification_outcome IS NULL OR verification_narrative IS NOT NULL),
  -- The section 16 guards: an action cannot leave DRAFT without an owner and a
  -- due date, and cannot be VERIFIED or CLOSED without a recorded outcome.
  CHECK (state = 'DRAFT' OR (owner_user_id IS NOT NULL AND due_on IS NOT NULL)),
  CHECK (state NOT IN ('VERIFIED', 'CLOSED') OR verification_outcome IS NOT NULL)
);

CREATE INDEX corrective_actions_by_finding ON corrective_actions (tenant_id, finding_id);
CREATE INDEX corrective_actions_by_due ON corrective_actions (tenant_id, state, due_on);

ALTER TABLE corrective_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrective_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY corrective_actions_isolation ON corrective_actions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE TRIGGER corrective_actions_set_updated_at BEFORE UPDATE ON corrective_actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON corrective_actions TO complianceos_app;

-- The evidence_links -> corrective_actions composite foreign key is added here
-- rather than inline above because corrective_actions is created after
-- evidence_links (evidence may be attached to either, and one of the two tables
-- has to come first). Adding it as a constraint keeps the tenant column inside
-- the reference, which is the whole point.
ALTER TABLE evidence_links
  ADD CONSTRAINT evidence_links_corrective_action_fkey
  FOREIGN KEY (tenant_id, corrective_action_id) REFERENCES corrective_actions (tenant_id, id);

-- --------------------------------------------- finding_disposition_evidence --
CREATE TABLE finding_disposition_evidence (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  finding_disposition_id uuid NOT NULL,
  evidence_item_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, finding_disposition_id)
    REFERENCES finding_dispositions (tenant_id, id),
  FOREIGN KEY (tenant_id, evidence_item_id) REFERENCES evidence_items (tenant_id, id),
  UNIQUE (tenant_id, finding_disposition_id, evidence_item_id)
);

ALTER TABLE finding_disposition_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE finding_disposition_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY finding_disposition_evidence_isolation ON finding_disposition_evidence
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, DELETE ON finding_disposition_evidence TO complianceos_app;

-- ------------------------------------------------------------ action_updates --
CREATE TABLE action_updates (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  corrective_action_id uuid NOT NULL,
  update_kind text NOT NULL CHECK (update_kind IN (
    'NOTE',
    'STATE_CHANGE',
    'OWNER_CHANGE',
    'DUE_DATE_CHANGE',
    'EVIDENCE_ADDED',
    'VERIFICATION'
  )),
  body text NOT NULL,
  previous_state text,
  new_state text,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, corrective_action_id) REFERENCES corrective_actions (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users (tenant_id, id),
  CHECK (update_kind <> 'STATE_CHANGE' OR (previous_state IS NOT NULL AND new_state IS NOT NULL))
);

CREATE INDEX action_updates_by_action
  ON action_updates (tenant_id, corrective_action_id, created_at DESC);

ALTER TABLE action_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_updates FORCE ROW LEVEL SECURITY;
CREATE POLICY action_updates_isolation ON action_updates
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Append-only: the remediation narrative is what a monitor reads, and an edited
-- history is not a history.
GRANT SELECT, INSERT ON action_updates TO complianceos_app;

-- ------------------------------------------------------------- attestations --
--
-- A named person asserting something to a regulator. `statement_hash` commits to
-- the exact wording they saw, so a later change to the attestation template
-- cannot retroactively alter what a superintendent signed. No UPDATE privilege,
-- for the same reason.
CREATE TABLE attestations (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  assessment_run_id uuid,
  statement text NOT NULL,
  statement_hash text NOT NULL CHECK (statement_hash ~ '^[0-9a-f]{64}$'),
  attested_by_user_id uuid NOT NULL,
  attester_name text NOT NULL,
  attester_role_title text NOT NULL,
  period_start_on date,
  period_end_on date,
  attested_at timestamptz NOT NULL DEFAULT now(),
  ip_address inet,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, assessment_run_id) REFERENCES assessment_runs (tenant_id, id),
  FOREIGN KEY (tenant_id, attested_by_user_id) REFERENCES users (tenant_id, id),
  CHECK (period_end_on IS NULL OR period_start_on IS NULL OR period_end_on >= period_start_on)
);

ALTER TABLE attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE attestations FORCE ROW LEVEL SECURITY;
CREATE POLICY attestations_isolation ON attestations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT ON attestations TO complianceos_app;

-- ------------------------------------------------------------- report_runs --
--
-- Section 22: "reports are derived from finalized assessment runs. Never build a
-- report directly from live mutable tables." The trigger below enforces that
-- rather than trusting the report service, because a report handed to a state
-- monitor is the most consequential artifact this platform produces and it must
-- not be possible to generate one from a run whose numbers can still change.
CREATE TABLE report_runs (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  assessment_run_id uuid NOT NULL,
  report_type text NOT NULL,
  format text NOT NULL CHECK (format IN ('PDF', 'XLSX', 'CSV', 'JSON')),
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_ref text,
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  requested_by_user_id uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  generated_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, assessment_run_id) REFERENCES assessment_runs (tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by_user_id) REFERENCES users (tenant_id, id),
  CHECK ((status = 'SUCCEEDED') = (storage_ref IS NOT NULL AND content_hash IS NOT NULL))
);

ALTER TABLE report_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY report_runs_isolation ON report_runs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Schema-qualified via TG_TABLE_SCHEMA for the same reason as the immutability
-- triggers in 0001: an unqualified lookup would resolve against the caller's
-- search_path, and the caller is the application role.
CREATE OR REPLACE FUNCTION require_finalized_run_for_report() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  run_status text;
BEGIN
  EXECUTE format(
    'SELECT status FROM %I.assessment_runs WHERE tenant_id = $1 AND id = $2',
    TG_TABLE_SCHEMA
  )
  INTO run_status
  USING NEW.tenant_id, NEW.assessment_run_id;

  IF run_status IS DISTINCT FROM 'FINALIZED' THEN
    RAISE EXCEPTION
      'report_runs may only be created from a FINALIZED assessment run (run % is %)',
      NEW.assessment_run_id, coalesce(run_status, 'not visible')
      USING ERRCODE = 'CO004',
            HINT = 'Finalize the assessment run before generating a report.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER report_runs_require_finalized_run
  BEFORE INSERT ON report_runs
  FOR EACH ROW EXECUTE FUNCTION require_finalized_run_for_report();

GRANT SELECT, INSERT, UPDATE ON report_runs TO complianceos_app;
