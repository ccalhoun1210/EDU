-- ---------------------------------------------------------------------------
-- 0001_foundation.sql
--
-- Adds: the non-owner application role, the tenant-context accessor that every
-- RLS policy reads, and the trigger functions that make finalized runs and the
-- audit log immutable in the database rather than only in application code.
--
-- Depended on by: every later migration. Nothing here may be dropped or
-- redefined destructively; a change to the tenant accessor changes the meaning
-- of every policy in the schema at once.
--
-- Spec: Master Technical Buildout sections 7 and 21. ADR 0004.
-- CLAUDE.md invariants 4 and 7.
--
-- Objects are created UNQUALIFIED on purpose. The migration runner sets
-- `search_path` to the target schema for the duration of each migration, so the
-- same file installs the schema into `public` in production and into a throwaway
-- schema in the isolation test suite. Policy and trigger definitions bind to
-- functions by OID at CREATE time, so they keep pointing at the accessor in
-- their own schema afterwards.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------ the app role --
--
-- Section 7: "never use the schema-owner role from the application". The owner
-- role runs migrations; this role runs the product. It is deliberately created
-- with NOLOGIN here and no BYPASSRLS: the deployment gives it a password (or a
-- managed credential) out of band, and a role that could bypass RLS would make
-- every policy below decorative.
--
-- Idempotent because a Postgres role is cluster-scoped, not schema-scoped: on a
-- shared CI cluster the second scratch schema finds the role already there.
-- In a managed environment (Neon) the role may be provisioned by the platform
-- before this runs, which is also fine — we only ever add to it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'complianceos_app') THEN
    CREATE ROLE complianceos_app NOLOGIN NOBYPASSRLS;
  END IF;
END;
$$;

DO $$
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO complianceos_app', current_schema());
END;
$$;

-- --------------------------------------------------------- tenant context --
--
-- The single source of tenant identity for every policy in the schema.
--
-- `current_setting(..., true)` is the missing_ok form: when the GUC has never
-- been set it returns NULL rather than raising. That is the behaviour we want,
-- because `tenant_id = NULL` is NULL, a policy predicate that is not true, and
-- the row is invisible. Isolation therefore FAILS CLOSED: a code path that
-- forgets to establish tenant context reads nothing at all, which is a loud,
-- obvious bug, instead of reading everything, which is a breach.
--
-- The GUC is namespaced `complianceos.tenant_id` because a two-part name is the
-- only kind Postgres lets an unprivileged session define. It is set with
-- set_config(..., is_local => true) inside a transaction — see src/client.ts for
-- why transaction-local and not session-level.
--
-- The `::uuid` cast is load-bearing: a session that sets the GUC to something
-- that is not a UUID gets an error, not a silent NULL that would merely look
-- like "no rows".
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql
  STABLE
AS $$
  SELECT nullif(current_setting('complianceos.tenant_id', true), '')::uuid
$$;

COMMENT ON FUNCTION current_tenant_id() IS
  'Tenant identity for RLS, read from the server-set complianceos.tenant_id GUC. '
  'Never populated from a browser request (buildout section 7).';

-- ------------------------------------------------------- immutability: runs --
--
-- CLAUDE.md invariant 4. A finalized assessment run is the evidentiary record of
-- what the platform concluded on a given day from a given snapshot under a given
-- rule-pack version. New data produces a NEW run.
--
-- The trigger fires on the OLD row, so the QUEUED -> ... -> FINALIZED transition
-- itself is allowed; only a change to an already-finalized run is refused.
CREATE OR REPLACE FUNCTION forbid_finalized_run_change() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'FINALIZED' THEN
    RAISE EXCEPTION
      'assessment run %/% is FINALIZED and cannot be changed (% refused)',
      OLD.tenant_id, OLD.id, TG_OP
      USING ERRCODE = 'CO001',
            HINT = 'Finalized runs are immutable. Start a new assessment run instead.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- The same invariant, one level down: a result belonging to a finalized run is
-- part of that record.
--
-- The parent lookup uses TG_TABLE_SCHEMA rather than an unqualified table name.
-- An unqualified reference inside a plpgsql body resolves against the CALLER's
-- search_path, so the application role could shadow `assessment_runs` with its
-- own table and walk straight past this check. Resolving against the schema the
-- trigger's own table lives in closes that.
CREATE OR REPLACE FUNCTION forbid_finalized_run_result_change() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
BEGIN
  EXECUTE format(
    'SELECT status FROM %I.assessment_runs WHERE tenant_id = $1 AND id = $2',
    TG_TABLE_SCHEMA
  )
  INTO parent_status
  USING OLD.tenant_id, OLD.assessment_run_id;

  IF parent_status = 'FINALIZED' THEN
    RAISE EXCEPTION
      'evaluation result %/% belongs to FINALIZED run % and cannot be changed (% refused)',
      OLD.tenant_id, OLD.id, OLD.assessment_run_id, TG_OP
      USING ERRCODE = 'CO001',
            HINT = 'Finalized runs are immutable. Start a new assessment run instead.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------- append-only audit --
--
-- Section 21. The hash chain detects tampering after the fact; this refuses it
-- up front. Both are needed: the trigger stops the ordinary mistake (a cleanup
-- script, a careless UPDATE), the chain catches the adversary who got around the
-- trigger. Privileges are the third layer — the app role is never granted
-- UPDATE, DELETE or TRUNCATE on audit_events.
CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '%.% is append-only; % is not permitted',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'CO002',
          HINT = 'Record a compensating event. Audit history is never edited.';
END;
$$;

-- Statement-level counterpart. Row triggers do not fire for TRUNCATE, and a
-- TRUNCATE that emptied the audit log would leave no row to have fired one.
CREATE OR REPLACE FUNCTION forbid_audit_truncate() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '%.% is append-only; TRUNCATE is not permitted',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'CO002';
END;
$$;

-- ------------------------------------------------------------- housekeeping --
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION current_tenant_id() TO complianceos_app;
