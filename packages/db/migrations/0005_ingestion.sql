-- ---------------------------------------------------------------------------
-- 0005_ingestion.sql
--
-- Adds: the read-only ingestion path — source_systems, import_jobs,
-- import_files, import_manifests, raw_records, mapping_templates,
-- mapping_versions, validation_issues, canonical_facts, fact_provenance,
-- data_snapshots, data_snapshot_facts.
--
-- Depends on: 0001, 0002.
-- Depended on by: 0006 (a run binds a data_snapshot) and 0007 (fiscal facts
-- point back at the canonical_fact they were derived from).
--
-- Spec: Master Technical Buildout sections 10 and 11. CLAUDE.md invariants 3,
-- 5 and 6.
--
-- ## The chain this file exists to make unbreakable
--
--   import_file -> raw_record -> (mapping_version) -> canonical_fact
--                                     |
--                              fact_provenance
--
-- and then data_snapshot -> data_snapshot_facts -> canonical_fact, so a run
-- executes against a frozen set of fact versions rather than a moving target
-- (section 11). Invariant 3 says a finding must be traceable all the way back to
-- a source record and the transformation that produced it; every foreign key
-- below is NOT NULL wherever that chain would otherwise be allowed to have a
-- hole in it.
-- ---------------------------------------------------------------------------

-- ----------------------------------------------------------- source_systems --
CREATE TABLE source_systems (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  system_type text NOT NULL CHECK (system_type IN (
    'SIS',
    'IEP',
    'ERP_FINANCE',
    'HR_PAYROLL',
    'STATE_REPORTING',
    'MANUAL_UPLOAD'
  )),
  connector_kind text NOT NULL CHECK (connector_kind IN (
    'CSV_UPLOAD',
    'XLSX_UPLOAD',
    'SFTP',
    'ONEROSTER',
    'ED_FI',
    'VENDOR_API'
  )),
  vendor text,
  display_name text NOT NULL,
  -- The platform is a system of assurance, not a system of record: every
  -- connector is read-only against the district's system. Recorded as a column
  -- so a connector that ever needed write access would be a visible schema
  -- change and a conversation, not a quiet capability.
  is_read_only boolean NOT NULL DEFAULT true CHECK (is_read_only),
  status text NOT NULL DEFAULT 'CONFIGURED'
    CHECK (status IN ('CONFIGURED', 'ACTIVE', 'PAUSED', 'RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id)
);

ALTER TABLE source_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_systems FORCE ROW LEVEL SECURITY;
CREATE POLICY source_systems_isolation ON source_systems
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE TRIGGER source_systems_set_updated_at BEFORE UPDATE ON source_systems
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON source_systems TO complianceos_app;

-- -------------------------------------------------------------- import_jobs --
CREATE TABLE import_jobs (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_system_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN (
    'QUEUED',
    'RUNNING',
    'SUCCEEDED',
    'PARTIALLY_SUCCEEDED',
    'FAILED',
    'CANCELLED'
  )),
  -- Durable background work retries (Inngest). The key makes a retried step
  -- idempotent, so a redelivered event cannot double-import a general ledger.
  idempotency_key text NOT NULL,
  requested_by_user_id uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  raw_record_count bigint NOT NULL DEFAULT 0 CHECK (raw_record_count >= 0),
  error_summary text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, source_system_id) REFERENCES source_systems (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by_user_id) REFERENCES users (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (status <> 'FAILED' OR error_summary IS NOT NULL)
);

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY import_jobs_isolation ON import_jobs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON import_jobs TO complianceos_app;

-- ------------------------------------------------------------- import_files --
CREATE TABLE import_files (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  import_job_id uuid NOT NULL,
  file_name text NOT NULL,
  media_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  -- SHA-256 of the bytes as received. This is the anchor of the whole lineage:
  -- it is what lets someone re-open the exact spreadsheet a finding came from
  -- three years later and confirm it is the same file.
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  storage_ref text NOT NULL,
  row_count bigint CHECK (row_count IS NULL OR row_count >= 0),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, import_job_id) REFERENCES import_jobs (tenant_id, id),
  UNIQUE (tenant_id, import_job_id, file_name)
);

ALTER TABLE import_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_files FORCE ROW LEVEL SECURITY;
CREATE POLICY import_files_isolation ON import_files
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON import_files TO complianceos_app;

-- --------------------------------------------------------- import_manifests --
--
-- What the district SAYS it is sending: the period covered, the row count, the
-- person asserting it. Section 10.5 reconciles the manifest against what
-- actually arrived, and a mismatch is a validation issue rather than a silent
-- partial load.
CREATE TABLE import_manifests (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  import_job_id uuid NOT NULL,
  declared_row_count bigint CHECK (declared_row_count IS NULL OR declared_row_count >= 0),
  -- Declared coverage. Calendar dates: this is the district saying "this file is
  -- our FY2028 general ledger through 30 June", a regulatory-period claim.
  declared_period_start_on date,
  declared_period_end_on date,
  declared_total_amount numeric(18, 2),
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_by_user_id uuid,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, import_job_id) REFERENCES import_jobs (tenant_id, id),
  FOREIGN KEY (tenant_id, submitted_by_user_id) REFERENCES users (tenant_id, id),
  UNIQUE (tenant_id, import_job_id),
  CHECK (declared_period_end_on IS NULL
         OR declared_period_start_on IS NULL
         OR declared_period_end_on >= declared_period_start_on)
);

ALTER TABLE import_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_manifests FORCE ROW LEVEL SECURITY;
CREATE POLICY import_manifests_isolation ON import_manifests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON import_manifests TO complianceos_app;

-- -------------------------------------------------------------- raw_records --
--
-- Section 10.3's raw zone: the district's data exactly as it arrived, before any
-- interpretation. It is never edited — the app role is granted INSERT, SELECT
-- and DELETE but deliberately NOT UPDATE, because a corrected value is a new
-- import, not a rewrite of what was received. DELETE exists only for the section
-- 20 retention engine.
CREATE TABLE raw_records (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  import_file_id uuid NOT NULL,
  row_number bigint NOT NULL CHECK (row_number >= 1),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, import_file_id) REFERENCES import_files (tenant_id, id),
  UNIQUE (tenant_id, import_file_id, row_number)
);

ALTER TABLE raw_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_records FORCE ROW LEVEL SECURITY;
CREATE POLICY raw_records_isolation ON raw_records
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, DELETE ON raw_records TO complianceos_app;

-- -------------------------------------------------------- mapping_templates --
CREATE TABLE mapping_templates (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_system_id uuid NOT NULL,
  name text NOT NULL,
  target_entity text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, source_system_id) REFERENCES source_systems (tenant_id, id),
  UNIQUE (tenant_id, source_system_id, name)
);

ALTER TABLE mapping_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE mapping_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY mapping_templates_isolation ON mapping_templates
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON mapping_templates TO complianceos_app;

-- --------------------------------------------------------- mapping_versions --
--
-- A mapping is versioned for the same reason a rule is: a fact's provenance
-- names the mapping version that produced it, so re-reading a two-year-old
-- finding shows the transformation as it was, not as it is now. `definition` is
-- declarative JSON — column mappings, code translations, unit conversions — and
-- never executable code (invariant 2).
CREATE TABLE mapping_versions (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  mapping_template_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  definition jsonb NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, mapping_template_id) REFERENCES mapping_templates (tenant_id, id),
  UNIQUE (tenant_id, mapping_template_id, version),
  CHECK (status <> 'ACTIVE' OR activated_at IS NOT NULL)
);

ALTER TABLE mapping_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mapping_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY mapping_versions_isolation ON mapping_versions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON mapping_versions TO complianceos_app;

-- -------------------------------------------------------- validation_issues --
--
-- Section 10.5. An ERROR blocks a fact from being produced; a WARNING does not.
-- The distinction matters to invariant 9: data that failed validation is missing
-- data, and missing data yields INDETERMINATE rather than a convenient zero.
CREATE TABLE validation_issues (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  import_job_id uuid NOT NULL,
  raw_record_id uuid,
  severity text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'ERROR')),
  code text NOT NULL,
  message text NOT NULL,
  field_path text,
  observed_value text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution_note text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, import_job_id) REFERENCES import_jobs (tenant_id, id),
  FOREIGN KEY (tenant_id, raw_record_id) REFERENCES raw_records (tenant_id, id),
  CHECK (resolved_at IS NULL OR resolution_note IS NOT NULL)
);

CREATE INDEX validation_issues_by_job
  ON validation_issues (tenant_id, import_job_id, severity);

ALTER TABLE validation_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_issues FORCE ROW LEVEL SECURITY;
CREATE POLICY validation_issues_isolation ON validation_issues
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON validation_issues TO complianceos_app;

-- ---------------------------------------------------------- canonical_facts --
--
-- The normalized layer the rules actually read.
--
-- `numeric_value` is NUMERIC(24, 10) — one exact column wide enough for both
-- money (2 places) and ratios (10 places), with `fact_type` saying which is
-- meant. It is emphatically not double precision: a rounding artifact in a
-- fiscal finding is a compliance defect (invariant 5).
--
-- Facts are versioned rather than updated. A corrected general ledger produces a
-- NEW fact row with `supersedes_fact_id` pointing at the old one, and the old
-- one keeps its place in every snapshot that already referenced it. That is what
-- makes an eighteen-month-old assessment still reproducible (section 2.5).
CREATE TABLE canonical_facts (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  fact_type text NOT NULL CHECK (length(fact_type) > 0),
  -- What the fact is about, within the organization: a fiscal year, a school
  -- site, a federal award. Kept as a type/key pair rather than a dozen nullable
  -- foreign keys, because the fact table serves every module.
  subject_type text NOT NULL,
  subject_key text NOT NULL,
  period_start_on date,
  period_end_on date,
  numeric_value numeric(24, 10),
  text_value text,
  boolean_value boolean,
  unit text,
  classification text NOT NULL DEFAULT 'CONFIDENTIAL' CHECK (classification IN (
    'PUBLIC',
    'INTERNAL',
    'CONFIDENTIAL',
    'STUDENT_PII',
    'HIGHLY_SENSITIVE'
  )),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_fact_id uuid,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes_fact_id) REFERENCES canonical_facts (tenant_id, id),
  UNIQUE (tenant_id, organization_id, fact_type, subject_type, subject_key, version),
  CHECK (period_end_on IS NULL OR period_start_on IS NULL OR period_end_on >= period_start_on),
  -- A fact with no value at all is not a fact. Absence is represented by the
  -- row not existing, which is what makes a rule return INDETERMINATE.
  CHECK (numeric_value IS NOT NULL OR text_value IS NOT NULL OR boolean_value IS NOT NULL)
);

CREATE INDEX canonical_facts_by_type
  ON canonical_facts (tenant_id, organization_id, fact_type);

ALTER TABLE canonical_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_facts FORCE ROW LEVEL SECURITY;
CREATE POLICY canonical_facts_isolation ON canonical_facts
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON canonical_facts TO complianceos_app;

-- ---------------------------------------------------------- fact_provenance --
--
-- Invariant 3's "Input fact -> Source record -> Transformation", as a table.
--
-- One row per fact, and the CHECK at the bottom is the whole point: a fact must
-- come from somewhere. Either a raw record (it was imported) or another fact (it
-- was derived) — never from nowhere. A fact with no origin is exactly the kind
-- of number that turns into a finding nobody can explain.
CREATE TABLE fact_provenance (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  canonical_fact_id uuid NOT NULL,
  raw_record_id uuid,
  import_file_id uuid,
  mapping_version_id uuid,
  derived_from_fact_id uuid,
  -- Named transformation, e.g. 'CSV_COLUMN_MAP', 'SUM_BY_OBJECT_CODE',
  -- 'CURRENCY_NORMALIZE'. Named rather than free text so the lineage view can
  -- group by it and a reviewer can ask "show me everything that was summed".
  transformation text NOT NULL CHECK (length(transformation) > 0),
  transformation_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, canonical_fact_id) REFERENCES canonical_facts (tenant_id, id),
  FOREIGN KEY (tenant_id, raw_record_id) REFERENCES raw_records (tenant_id, id),
  FOREIGN KEY (tenant_id, import_file_id) REFERENCES import_files (tenant_id, id),
  FOREIGN KEY (tenant_id, mapping_version_id) REFERENCES mapping_versions (tenant_id, id),
  FOREIGN KEY (tenant_id, derived_from_fact_id) REFERENCES canonical_facts (tenant_id, id),
  CHECK (raw_record_id IS NOT NULL OR derived_from_fact_id IS NOT NULL)
);

CREATE INDEX fact_provenance_by_fact ON fact_provenance (tenant_id, canonical_fact_id);

ALTER TABLE fact_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_provenance FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_provenance_isolation ON fact_provenance
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, DELETE ON fact_provenance TO complianceos_app;

-- ----------------------------------------------------------- data_snapshots --
--
-- Section 11: "a compliance assessment should never execute against a moving
-- target". A snapshot names the exact fact versions a run may read.
CREATE TABLE data_snapshots (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  label text NOT NULL,
  fiscal_year_id uuid,
  academic_year_id uuid,
  -- Hash over the ordered set of fact ids and their content hashes. Two runs
  -- that quote the same snapshot hash read the same numbers; that is the
  -- machine-checkable form of "historically reproducible".
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  fact_count bigint NOT NULL CHECK (fact_count >= 0),
  taken_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_year_id) REFERENCES fiscal_years (tenant_id, id),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic_years (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users (tenant_id, id)
);

ALTER TABLE data_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY data_snapshots_isolation ON data_snapshots
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, DELETE ON data_snapshots TO complianceos_app;

-- ------------------------------------------------------ data_snapshot_facts --
--
-- The membership itself. No UPDATE privilege: a snapshot's contents are fixed at
-- the moment it is taken, and "amend the snapshot" is not an operation that
-- should exist. Editing this table would silently change what a finalized run
-- was computed from.
CREATE TABLE data_snapshot_facts (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_snapshot_id uuid NOT NULL,
  canonical_fact_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, data_snapshot_id) REFERENCES data_snapshots (tenant_id, id),
  FOREIGN KEY (tenant_id, canonical_fact_id) REFERENCES canonical_facts (tenant_id, id),
  UNIQUE (tenant_id, data_snapshot_id, canonical_fact_id)
);

ALTER TABLE data_snapshot_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_snapshot_facts FORCE ROW LEVEL SECURITY;
CREATE POLICY data_snapshot_facts_isolation ON data_snapshot_facts
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, DELETE ON data_snapshot_facts TO complianceos_app;
