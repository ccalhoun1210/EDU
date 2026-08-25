-- ---------------------------------------------------------------------------
-- 0004_regulatory_content.sql
--
-- Adds: regulatory_sources, requirements, rule_packs, rule_pack_versions,
-- rules, rule_versions — the published regulatory content — plus the one
-- tenant-owned table that says which of it a district is being assessed under,
-- rule_pack_activations.
--
-- Depends on: 0001, 0002 (tenants, organizations, users).
-- Depended on by: 0006 (assessment_runs, evaluation_results, findings all point
-- at a rule_pack_version or a rule_version and cannot exist without one).
--
-- Spec: Master Technical Buildout sections 8, 9 and 2.4. ADR 0003, ADR 0006.
-- CLAUDE.md invariants 3 and 4.
--
-- ## Why these tables carry no tenant_id
--
-- Regulatory content is PUBLISHED, not owned. 34 CFR 300.203 says the same thing
-- to every district in the country, and Alabama's overlay says the same thing to
-- every Alabama district. A per-tenant copy of the federal baseline would mean
-- fifty districts could each be evaluated against a subtly different version of
-- the same regulation, and the phrase "reproducible rule outcome" would stop
-- meaning anything.
--
-- The tables are therefore global, they carry no tenant_id, they have no RLS,
-- and the application role has SELECT and nothing else — content is installed by
-- the publish pipeline running as the owner, from the YAML under /rulepacks
-- (ADR 0003). What varies per tenant is which pack versions apply to which
-- organization, and that is rule_pack_activations at the bottom of this file,
-- which is tenant-owned and behaves like everything else in the schema.
--
-- The consequence for invariant 3 is worth stating: a finding's provenance chain
-- crosses from tenant-owned data into global content at exactly one point, the
-- rule_version. That reference is a plain foreign key rather than a composite
-- one, because there is no tenant on the far side of it to match.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------ regulatory_sources --
--
-- Section 9 and ADR 0006. `retrieved_on` / `document_hash` are the verification
-- evidence: proof that somebody actually fetched the official text and hashed
-- it, rather than writing a rule from memory. A source without them is usable
-- for DRAFT authoring and for nothing else, which is enforced in the rule-pack
-- SDK and mirrored by the constraint below — verification is all-or-nothing, so
-- a half-filled retrieval record cannot masquerade as a checked citation.
CREATE TABLE regulatory_sources (
  id text PRIMARY KEY CHECK (id ~ '^[A-Z0-9][A-Z0-9._-]*$'),
  jurisdiction text NOT NULL,
  publisher text NOT NULL,
  title text NOT NULL,
  citation text NOT NULL,
  official_url text NOT NULL,
  published_on date,
  effective_start_on date NOT NULL,
  effective_end_on date,
  programs text[] NOT NULL CHECK (array_length(programs, 1) >= 1),
  supersedes_source_id text REFERENCES regulatory_sources (id),
  retrieved_on date,
  document_hash text CHECK (document_hash ~ '^[0-9a-f]{64}$'),
  archive_ref text,
  retrieved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_end_on IS NULL OR effective_end_on >= effective_start_on),
  CHECK (
    (retrieved_on IS NULL AND document_hash IS NULL
      AND archive_ref IS NULL AND retrieved_by IS NULL)
    OR
    (retrieved_on IS NOT NULL AND document_hash IS NOT NULL
      AND archive_ref IS NOT NULL AND retrieved_by IS NOT NULL)
  )
);

GRANT SELECT ON regulatory_sources TO complianceos_app;

-- ------------------------------------------------------------ requirements --
--
-- The obligation a rule tests. Kept separate from the rule because one
-- requirement is usually tested by several rules, and because a district's
-- compliance posture is reported per requirement, not per rule.
CREATE TABLE requirements (
  id text PRIMARY KEY CHECK (id ~ '^[A-Z0-9][A-Z0-9._-]*$'),
  source_id text NOT NULL REFERENCES regulatory_sources (id),
  program text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  citation text NOT NULL,
  effective_start_on date NOT NULL,
  effective_end_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_end_on IS NULL OR effective_end_on >= effective_start_on)
);

GRANT SELECT ON requirements TO complianceos_app;

-- -------------------------------------------------------------- rule_packs --
CREATE TABLE rule_packs (
  id text PRIMARY KEY CHECK (id ~ '^[A-Z0-9][A-Z0-9._-]*$'),
  jurisdiction text NOT NULL,
  program text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  -- A state overlay declares the baseline it extends. Section 8.1's hierarchy.
  extends_pack_id text REFERENCES rule_packs (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (extends_pack_id IS NULL OR extends_pack_id <> id)
);

GRANT SELECT ON rule_packs TO complianceos_app;

-- ------------------------------------------------------ rule_pack_versions --
--
-- `content_hash` is what makes a run reproducible: an assessment run records the
-- pack version it used, and the hash proves the bytes behind that version have
-- not moved since (section 2.5).
CREATE TABLE rule_pack_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id text NOT NULL REFERENCES rule_packs (id),
  version text NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  status text NOT NULL CHECK (status IN (
    'DRAFT',
    'DOMAIN_REVIEWED',
    'LEGAL_REVIEWED',
    'QA_APPROVED',
    'STAGED',
    'SHADOW',
    'ACTIVE',
    'SUPERSEDED'
  )),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  engine_min_version text NOT NULL,
  effective_start_on date NOT NULL,
  effective_end_on date,
  published_at timestamptz,
  superseded_by_version_id uuid REFERENCES rule_pack_versions (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, version),
  CHECK (effective_end_on IS NULL OR effective_end_on >= effective_start_on),
  CHECK (status <> 'SUPERSEDED' OR superseded_by_version_id IS NOT NULL)
);

GRANT SELECT ON rule_pack_versions TO complianceos_app;

-- ------------------------------------------------------------------- rules --
CREATE TABLE rules (
  id text PRIMARY KEY CHECK (id ~ '^[A-Z0-9][A-Z0-9._-]*$'),
  pack_id text NOT NULL REFERENCES rule_packs (id),
  requirement_id text REFERENCES requirements (id),
  title text NOT NULL,
  subject_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON rules TO complianceos_app;

-- ------------------------------------------------------------ rule_versions --
--
-- `logic` is the declarative expression from the restricted DSL, stored as the
-- JSON the rule-pack SDK validated. It is data. There is no column here that
-- could hold executable code, and there must never be one (invariant 2).
CREATE TABLE rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id text NOT NULL REFERENCES rules (id),
  rule_pack_version_id uuid NOT NULL REFERENCES rule_pack_versions (id),
  version integer NOT NULL CHECK (version >= 1),
  lifecycle text NOT NULL CHECK (lifecycle IN (
    'DRAFT',
    'DOMAIN_REVIEWED',
    'LEGAL_REVIEWED',
    'QA_APPROVED',
    'STAGED',
    'SHADOW',
    'ACTIVE',
    'SUPERSEDED'
  )),
  severity text NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  -- Invariant 3's "regulatory authority" link, and ADR 0006: a rule may not go
  -- live on an unverified citation. Both columns are NOT NULL because a rule
  -- that cannot name its authority is not ready to be written at all.
  authority_citation text NOT NULL,
  source_id text NOT NULL REFERENCES regulatory_sources (id),
  logic jsonb NOT NULL,
  explanation_template text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  effective_start_on date NOT NULL,
  effective_end_on date,
  approved_by text,
  approved_at timestamptz,
  superseded_by_version_id uuid REFERENCES rule_versions (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, version),
  CHECK (effective_end_on IS NULL OR effective_end_on >= effective_start_on),
  CHECK (lifecycle <> 'SUPERSEDED' OR superseded_by_version_id IS NOT NULL)
);

CREATE INDEX rule_versions_by_pack_version ON rule_versions (rule_pack_version_id);

GRANT SELECT ON rule_versions TO complianceos_app;

-- Invariant 4, second half: never mutate an ACTIVE rule version — supersede it.
--
-- The one update an ACTIVE version may receive is the retirement bookkeeping
-- that points it at its successor. Everything else about it — the logic, the
-- citation, the severity, the effective window — is frozen, because findings
-- already reference it and a district must be able to see the rule exactly as it
-- was applied to them.
CREATE OR REPLACE FUNCTION forbid_active_rule_version_change() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.lifecycle <> 'ACTIVE' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'rule version % is ACTIVE and cannot be deleted', OLD.id
      USING ERRCODE = 'CO003',
            HINT = 'Supersede the version. Findings already cite it.';
  END IF;

  IF NEW.lifecycle <> 'SUPERSEDED'
     OR NEW.rule_id IS DISTINCT FROM OLD.rule_id
     OR NEW.rule_pack_version_id IS DISTINCT FROM OLD.rule_pack_version_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.severity IS DISTINCT FROM OLD.severity
     OR NEW.authority_citation IS DISTINCT FROM OLD.authority_citation
     OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.logic IS DISTINCT FROM OLD.logic
     OR NEW.explanation_template IS DISTINCT FROM OLD.explanation_template
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.effective_start_on IS DISTINCT FROM OLD.effective_start_on
  THEN
    RAISE EXCEPTION 'rule version % is ACTIVE; only supersession may change it', OLD.id
      USING ERRCODE = 'CO003',
            HINT = 'Publish a new rule version instead of editing this one.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER rule_versions_immutable_when_active
  BEFORE UPDATE OR DELETE ON rule_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_active_rule_version_change();

-- ------------------------------------------------------ rule_pack_activations --
--
-- Tenant-owned, and the only tenant-specific thing about regulatory content:
-- which published pack version governs which organization, from when. A district
-- moving onto a new state overlay is a row here, and a run records the pack
-- version it actually used, so this table is a scheduling record and never a
-- substitute for the run's own provenance.
CREATE TABLE rule_pack_activations (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  rule_pack_version_id uuid NOT NULL REFERENCES rule_pack_versions (id),
  activated_on date NOT NULL,
  deactivated_on date,
  activated_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, activated_by_user_id) REFERENCES users (tenant_id, id),
  UNIQUE (tenant_id, organization_id, rule_pack_version_id, activated_on),
  CHECK (deactivated_on IS NULL OR deactivated_on >= activated_on)
);

ALTER TABLE rule_pack_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_pack_activations FORCE ROW LEVEL SECURITY;
CREATE POLICY rule_pack_activations_isolation ON rule_pack_activations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON rule_pack_activations TO complianceos_app;
