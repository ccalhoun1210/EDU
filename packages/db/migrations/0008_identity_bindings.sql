-- ---------------------------------------------------------------------------
-- 0008_identity_bindings.sql
--
-- Adds: identity_organization_bindings — the map from an identity provider's
-- organization to a ComplianceOS tenant. Grants the application role read
-- access to a Neon Auth schema, if one is present.
--
-- Depends on: 0001 (the complianceos_app role), 0002 (tenants).
-- Depended on by: packages/identity's provider adapters, which cannot resolve
-- a claim to a tenant without this.
--
-- Spec: Master Technical Buildout section 18. CLAUDE.md invariant 7.
--
-- ## Why this table exists, and why it is not a column on `tenants`
--
-- A sign-in has to answer "which tenant?" before it has tenant context, and
-- `tenants` is behind an RLS policy keyed on exactly the context the lookup is
-- trying to establish (`USING (id = current_tenant_id())`). The application
-- role is NOBYPASSRLS, so it cannot scan `tenants` to find the mapping. Putting
-- the binding on `tenants` as a column would therefore produce a table the
-- application can never read at the one moment it needs to.
--
-- So the binding lives in its own global table, outside tenant scope. That is
-- not a hole in the isolation model: this table holds no tenant data. It holds
-- platform configuration — which federated connection belongs to which
-- district — which the operator sets up and which must be legible before
-- anybody is authenticated. It is the same category as `rule_packs`.
--
-- ## Why it is provider-agnostic
--
-- Section 18 asks for "an abstraction that permits replacement". A column named
-- for one vendor would make replacing that vendor a migration. `provider` is an
-- open string — 'neon-auth', 'workos', 'auth0', a district's own SAML
-- connection — and `provider_organization_id` is whatever that provider calls
-- its organization. Two providers can coexist during a migration between them,
-- which is the situation the abstraction exists for.
--
-- ## What the uniqueness protects
--
-- The unique index is on (provider, provider_organization_id), so one
-- connection cannot be bound to two tenants. Without it, an operator error
-- would make a sign-in resolve to whichever tenant the query happened to return
-- first, and a district would see another district's assessment. The reverse
-- direction is deliberately NOT unique: one tenant may be reachable through
-- more than one connection — a district federating both Entra and a legacy SAML
-- during a cutover is an ordinary thing to want.

CREATE TABLE identity_organization_bindings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),

  -- Which identity provider. Open string rather than a CHECK: the failure mode
  -- of a closed list here is a district that cannot be onboarded until someone
  -- ships a migration, which is worse than a name only conventionally checked.
  provider text NOT NULL CHECK (length(provider) > 0),

  -- The provider's own identifier for the organization. Text, not uuid: WorkOS
  -- uses `org_...`, Auth0 uses a connection name, Neon Auth uses a uuid. Storing
  -- the widest of those keeps the column honest about what it holds.
  provider_organization_id text NOT NULL CHECK (length(provider_organization_id) > 0),

  -- `bound_tenant_id`, not `tenant_id`, and the name is doing real work. Every table in
  -- this schema carrying a column called `tenant_id` is tenant-OWNED: composite primary key
  -- led by it, FORCE RLS, a policy reading the GUC. `canonical.test.ts` enforces exactly
  -- that, and it caught this table when the column was called `tenant_id`.
  --
  -- This row is not owned by the district it names; it points at one. Naming it differently
  -- keeps the guard strict for every table that really is tenant data, and tells a reader
  -- the difference without them having to look up an exception list.
  bound_tenant_id uuid NOT NULL REFERENCES tenants (id),

  -- An operator can disable a binding without deleting it, so that revoking a
  -- district's federation is reversible and leaves a record. A disabled binding
  -- is invisible to the resolver.
  disabled_at timestamptz,
  disabled_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  CHECK (disabled_at IS NULL OR disabled_reason IS NOT NULL)
);

CREATE UNIQUE INDEX identity_organization_bindings_connection
  ON identity_organization_bindings (provider, provider_organization_id);

CREATE INDEX identity_organization_bindings_tenant
  ON identity_organization_bindings (bound_tenant_id);

COMMENT ON TABLE identity_organization_bindings IS
  'Maps an identity provider organization to a tenant. Global rather than '
  'tenant-scoped because a sign-in must read it before tenant context exists '
  '(buildout section 18).';

CREATE TRIGGER identity_organization_bindings_set_updated_at
  BEFORE UPDATE ON identity_organization_bindings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- SELECT only. The application resolves logins through this table; it never
-- onboards a district, which is an administrative act performed by the owner.
GRANT SELECT ON identity_organization_bindings TO complianceos_app;

-- ---------------------------------------------------------------------------
-- Neon Auth, where it is present.
--
-- Neon Auth installs a `neon_auth` schema (Better Auth's tables) alongside the
-- application's own. It is managed by Neon, not by these migrations: this file
-- must never create, alter or drop anything inside it. What it does is grant the
-- application role the read access it needs to validate a session, and nothing
-- more — no INSERT, no UPDATE, and no access to `neon_auth.account`, which holds
-- password hashes and OAuth tokens the platform has no business reading.
--
-- Guarded, because most deployments have no such schema: CI runs against a plain
-- Postgres service container, and a developer's local database has whatever they
-- created. An unguarded GRANT would make every one of those migrations fail.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'neon_auth') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA neon_auth TO complianceos_app';

    -- Named one by one rather than ALL TABLES IN SCHEMA, so that a table added
    -- to neon_auth by a future Neon Auth upgrade is not silently granted. In
    -- particular `account` must stay unreadable.
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'neon_auth' AND tablename = 'session') THEN
      EXECUTE 'GRANT SELECT ON neon_auth.session TO complianceos_app';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'neon_auth' AND tablename = 'user') THEN
      EXECUTE 'GRANT SELECT ON neon_auth."user" TO complianceos_app';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'neon_auth' AND tablename = 'organization') THEN
      EXECUTE 'GRANT SELECT ON neon_auth.organization TO complianceos_app';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'neon_auth' AND tablename = 'member') THEN
      EXECUTE 'GRANT SELECT ON neon_auth.member TO complianceos_app';
    END IF;
  END IF;
END
$$;
