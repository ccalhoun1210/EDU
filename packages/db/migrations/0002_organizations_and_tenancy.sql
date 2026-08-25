-- ---------------------------------------------------------------------------
-- 0002_organizations_and_tenancy.sql
--
-- Adds: the tenant registry and every tenant-owned table that describes WHO the
-- platform is assessing and WHO may look at it — organizations,
-- organization_relationships, schools_sites, users, memberships, access_scopes,
-- tenant_settings, fiscal_years, academic_years.
--
-- Depends on: 0001 (app role, current_tenant_id()).
-- Depended on by: every tenant-owned table in every later migration, because
-- they all carry `tenant_id uuid NOT NULL REFERENCES tenants (id)` and most
-- carry a composite foreign key to organizations.
--
-- Spec: Master Technical Buildout section 6 (core organization entities) and
-- section 7. CLAUDE.md invariants 7 and 8.
--
-- ## The shape every tenant-owned table in this schema repeats
--
--   tenant_id uuid NOT NULL REFERENCES tenants (id),
--   id        uuid NOT NULL DEFAULT gen_random_uuid(),
--   ...
--   PRIMARY KEY (tenant_id, id),
--   FOREIGN KEY (tenant_id, other_id) REFERENCES other (tenant_id, id)
--
-- The composite key is the point. With a plain `id` primary key, a foreign key
-- only proves the referenced row exists — it says nothing about whose row it is,
-- and one buggy handler that trusts a request parameter can staple tenant B's
-- finding to tenant A's evidence. With `tenant_id` inside the reference, that
-- row is not merely hidden by policy, it cannot be written at all. RLS is the
-- read defence; the composite key is the write defence. Section 7 asks for both.
--
-- Timestamp discipline, which recurs in nearly every table below:
--   *_at  is timestamptz — when the SYSTEM did something. Instants.
--   *_on  is date        — a calendar fact from the regulatory world. Never a
--                          timestamp, because a statutory date pushed through a
--                          UTC instant can land on the previous day and a
--                          deadline off by one is a wrong finding (invariant 6).
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------------ tenants --
--
-- The tenant registry itself. It has no `tenant_id` column because it IS the
-- tenant dimension; its `id` is what every other table points at.
--
-- RLS is ENABLEd but deliberately NOT FORCEd here, unlike every table below.
-- FORCE subjects the table owner to the policy too, and provisioning a new
-- tenant necessarily happens before any session can name that tenant. The app
-- role is not the owner, so ENABLE already confines the application to exactly
-- one row: its own. Tenant creation is an owner-role operation.
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  display_name text NOT NULL CHECK (length(display_name) > 0),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  -- Section 7's isolation tier. Recorded from day one so that moving a state
  -- agency onto a dedicated database later is a routing change, not a schema
  -- change.
  isolation_tier text NOT NULL DEFAULT 'POOLED'
    CHECK (isolation_tier IN ('POOLED', 'DEDICATED_SCHEMA', 'DEDICATED_DATABASE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenants_self ON tenants
  USING (id = current_tenant_id());

CREATE TRIGGER tenants_set_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT ON tenants TO complianceos_app;

-- ---------------------------------------------------------- tenant_settings --
CREATE TABLE tenant_settings (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  setting_key text NOT NULL CHECK (setting_key ~ '^[a-z][a-z0-9_.]*$'),
  setting_value jsonb NOT NULL,
  -- Section 27's tenant-aware feature flags live here too; a flag is a setting
  -- with a boolean value, not a second mechanism.
  is_feature_flag boolean NOT NULL DEFAULT false,
  updated_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, setting_key)
);

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_settings_isolation ON tenant_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE TRIGGER tenant_settings_set_updated_at BEFORE UPDATE ON tenant_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_settings TO complianceos_app;

-- ------------------------------------------------------------ organizations --
--
-- `organization_type` repeats the union in packages/domain/src/organization.ts.
-- The duplication is deliberate and tested: src/canonical.test.ts asserts the
-- two lists are identical, so adding a type in TypeScript without widening the
-- constraint fails CI rather than failing at 2am on an INSERT.
CREATE TABLE organizations (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_type text NOT NULL CHECK (organization_type IN (
    'STATE_AGENCY',
    'LEA_DISTRICT',
    'SCHOOL',
    'EARLY_INTERVENTION_PROGRAM',
    'OTHER_MONITORED_ENTITY'
  )),
  legal_name text NOT NULL CHECK (length(legal_name) > 0),
  short_name text,
  -- USPS code of the state whose regulations overlay the federal baseline. The
  -- state overlay pack is selected from this, so it is not decoration.
  state_code text CHECK (state_code ~ '^[A-Z]{2}$'),
  nces_id text,
  state_agency_id text,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'MERGED', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, state_code, state_agency_id)
);

CREATE INDEX organizations_by_type ON organizations (tenant_id, organization_type);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_isolation ON organizations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON organizations TO complianceos_app;

-- ----------------------------------------------- organization_relationships --
--
-- CLAUDE.md invariant 8, and the most important comment in this file:
--
--   THIS TABLE IS NOT CONSULTED BY ANY RLS POLICY, AND MUST NEVER BE.
--
-- It records that a state agency oversees a district, or that a district is the
-- fiscal agent for a consortium. It records nothing whatsoever about who may
-- read what. A parent organization does not inherit access to a child's data;
-- access comes from access_scopes and from nowhere else. The moment a policy
-- joins through here, "the SEA can see all its LEAs" becomes true by accident
-- for every tenant, and a district that agreed to share one fiscal year has
-- shared its whole history.
--
-- If a state agency genuinely needs to see a district's data, someone grants an
-- access_scope, an audit event records who granted it, and it can be revoked.
CREATE TABLE organization_relationships (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  parent_organization_id uuid NOT NULL,
  child_organization_id uuid NOT NULL,
  relationship_type text NOT NULL CHECK (relationship_type IN (
    'OVERSIGHT',
    'GEOGRAPHIC',
    'FISCAL_AGENT',
    'CONSORTIUM_MEMBER'
  )),
  effective_start_on date NOT NULL,
  effective_end_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, child_organization_id) REFERENCES organizations (tenant_id, id),
  CHECK (parent_organization_id <> child_organization_id),
  CHECK (effective_end_on IS NULL OR effective_end_on >= effective_start_on)
);

CREATE INDEX organization_relationships_by_child
  ON organization_relationships (tenant_id, child_organization_id);

ALTER TABLE organization_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_relationships FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_relationships_isolation ON organization_relationships
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON organization_relationships TO complianceos_app;

-- ------------------------------------------------------------ schools_sites --
CREATE TABLE schools_sites (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  site_name text NOT NULL CHECK (length(site_name) > 0),
  nces_school_id text,
  state_school_id text,
  grade_span_low text,
  grade_span_high text,
  is_charter boolean NOT NULL DEFAULT false,
  opened_on date,
  closed_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  CHECK (closed_on IS NULL OR opened_on IS NULL OR closed_on >= opened_on)
);

ALTER TABLE schools_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools_sites FORCE ROW LEVEL SECURITY;
CREATE POLICY schools_sites_isolation ON schools_sites
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE TRIGGER schools_sites_set_updated_at BEFORE UPDATE ON schools_sites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON schools_sites TO complianceos_app;

-- ------------------------------------------------------------------- users --
--
-- Users are TENANT-OWNED, which is a real decision and not an oversight.
--
-- The obvious alternative is one global `users` table keyed by identity-provider
-- subject, with memberships pointing into it. That models a consultant who works
-- for three districts more elegantly, and it leaks: tenant A's session can then
-- read tenant B's staff directory — names, work emails, who the special
-- education director is — because the row has no tenant to filter on. That is a
-- roster of a district's employees, obtainable by any other district on the
-- platform, and no amount of application-layer care makes it not so.
--
-- So identity is federated (subject_id from the IdP) but the user RECORD is per
-- tenant. One human working for two districts has two rows, correlated only by
-- the identity provider, and each district sees exactly its own.
CREATE TABLE users (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  -- The IdP subject claim (WorkOS/Auth0/SAML NameID). Never a password hash:
  -- this platform does not store credentials (section 18).
  subject_id text NOT NULL CHECK (length(subject_id) > 0),
  email text NOT NULL CHECK (position('@' IN email) > 1),
  display_name text NOT NULL CHECK (length(display_name) > 0),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'DEPROVISIONED')),
  -- Section 19: vendor staff are marked, so support access is attributable and
  -- can be reported on separately from district activity.
  is_vendor_staff boolean NOT NULL DEFAULT false,
  mfa_enrolled boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, subject_id),
  UNIQUE (tenant_id, email)
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_isolation ON users
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON users TO complianceos_app;

-- ------------------------------------------------------------- memberships --
--
-- Role assignment. The role list is section 18's representative roles; it is a
-- CHECK rather than a lookup table because these are platform vocabulary, not
-- tenant-configurable data, and a typo should be rejected at write time.
CREATE TABLE memberships (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN (
    'DISTRICT_ADMINISTRATOR',
    'SPECIAL_EDUCATION_DIRECTOR',
    'FEDERAL_PROGRAMS_DIRECTOR',
    'FISCAL_OFFICER',
    'COMPLIANCE_REVIEWER',
    'SCHOOL_ADMINISTRATOR',
    'EVIDENCE_CONTRIBUTOR',
    'READ_ONLY',
    'STATE_REVIEWER'
  )),
  -- Section 18's attribute side. These are capabilities a role does not imply:
  -- exporting a district's data and reading student identifiers are separately
  -- granted, so "Read Only" cannot quietly mean "may export everything".
  may_export boolean NOT NULL DEFAULT false,
  may_read_student_identity boolean NOT NULL DEFAULT false,
  may_configure boolean NOT NULL DEFAULT false,
  granted_by_user_id uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, granted_by_user_id) REFERENCES users (tenant_id, id),
  UNIQUE (tenant_id, user_id, role)
);

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_isolation ON memberships
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO complianceos_app;

-- ------------------------------------------------------------ access_scopes --
--
-- The ONLY thing that grants access to an organization's data (invariant 8).
-- One row per (membership, organization) the membership may reach. There is no
-- inheritance, no wildcard, and no join through organization_relationships: a
-- state agency user who should see forty districts has forty rows, each one
-- granted by a named person at a recorded time and individually revocable.
--
-- Forty rows is the correct amount of friction for that decision.
CREATE TABLE access_scopes (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  -- NULL school_site_id means the whole organization; a value narrows the scope
  -- to one site (section 18's school scope).
  school_site_id uuid,
  -- NULL module means every module the tenant has enabled.
  module text CHECK (module IS NULL OR module IN (
    'IDEA_FISCAL',
    'DISPROPORTIONALITY',
    'SPED_PROGRAMMATIC'
  )),
  granted_by_user_id uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revocation_reason text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, school_site_id) REFERENCES schools_sites (tenant_id, id),
  FOREIGN KEY (tenant_id, granted_by_user_id) REFERENCES users (tenant_id, id),
  CHECK (revoked_at IS NULL OR revocation_reason IS NOT NULL)
);

CREATE INDEX access_scopes_by_membership ON access_scopes (tenant_id, membership_id);

ALTER TABLE access_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_scopes FORCE ROW LEVEL SECURITY;
CREATE POLICY access_scopes_isolation ON access_scopes
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON access_scopes TO complianceos_app;

-- ------------------------------------------------------------ fiscal_years --
--
-- A fiscal year is a district-scoped calendar fact, so every boundary here is a
-- DATE. `label` is stored as the state writes it ("FY2028") and compared as a
-- label, never parsed — a state defines its own year and a report that renames a
-- district's fiscal year is a report the business officer stops trusting.
CREATE TABLE fiscal_years (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  label text NOT NULL CHECK (length(label) > 0),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  -- The federal fiscal year the appropriation belongs to, which is not always
  -- the district year the money is spent in. Maintenance of effort compares
  -- district years; grant period of performance runs on federal years.
  federal_fiscal_year integer CHECK (federal_fiscal_year BETWEEN 1975 AND 2200),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('PLANNED', 'OPEN', 'CLOSED', 'AUDITED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  UNIQUE (tenant_id, organization_id, label),
  CHECK (ends_on > starts_on)
);

ALTER TABLE fiscal_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_years FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_years_isolation ON fiscal_years
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON fiscal_years TO complianceos_app;

-- ---------------------------------------------------------- academic_years --
CREATE TABLE academic_years (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  label text NOT NULL CHECK (length(label) > 0),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  -- The child-count date the year's IDEA counts are taken on — 1 December in
  -- most states (34 CFR 300.641). A DATE, emphatically: proportionate share and
  -- MOE both key off it, and a day's drift moves a child between years.
  child_count_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  UNIQUE (tenant_id, organization_id, label),
  CHECK (ends_on > starts_on),
  CHECK (child_count_on IS NULL OR child_count_on BETWEEN starts_on AND ends_on)
);

ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_years FORCE ROW LEVEL SECURITY;
CREATE POLICY academic_years_isolation ON academic_years
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON academic_years TO complianceos_app;
