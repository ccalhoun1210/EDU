-- ---------------------------------------------------------------------------
-- 0003_audit_log.sql
--
-- Adds: audit_events (the section 21 tamper-evident log) and audit_seals (the
-- periodic digest roots sealed into a protected archive).
--
-- Depends on: 0001 (append-only triggers), 0002 (tenants, users).
-- Depended on by: nothing structurally — on purpose. Nothing in the schema
-- foreign-keys INTO the audit log, because a reference from live data to an
-- audit row is a reason someone will eventually want to delete or rewrite one.
--
-- Spec: Master Technical Buildout section 21. Hashing itself lives in
-- packages/domain/src/audit.ts; this table stores what that module computes.
--
-- ## Why the hashes are computed in the application and only stored here
--
-- The chain commits to a canonical serialization of the event — key order,
-- number formatting, absent-versus-null — that is defined once, in TypeScript,
-- and covered by tests. Recomputing it in SQL would create a second definition
-- of "the same event", and the day the two disagree the log becomes unverifiable
-- in exactly the situation where someone is relying on it. So the database's job
-- is to store the hashes, refuse changes, and make a fork of the chain
-- impossible (the UNIQUE on the per-tenant sequence).
--
-- ## Three layers of append-only
--
--   1. privileges — the app role is granted SELECT and INSERT, nothing else;
--   2. triggers   — UPDATE, DELETE and TRUNCATE raise, even for the owner;
--   3. the chain  — anything that got past 1 and 2 is detectable afterwards.
--
-- Any one of these alone is a story. Together they are an audit trail.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_events (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),

  -- Position in this tenant's chain, starting at 1. The UNIQUE below is what
  -- makes a fork impossible: two concurrent writers that both believe they are
  -- appending event 7 cannot both succeed, so one retries against the real head
  -- instead of creating a second branch of history that verifies in isolation.
  sequence_no bigint NOT NULL CHECK (sequence_no >= 1),

  occurred_at timestamptz NOT NULL DEFAULT now(),

  -- Actor. `actor_user_id` is NULL for SYSTEM and SERVICE_ACCOUNT actors, and
  -- the composite foreign key is MATCH SIMPLE (the default), so a NULL actor
  -- skips the check rather than failing it — which is the behaviour we want and
  -- the reason it is not written MATCH FULL.
  actor_user_id uuid,
  actor_type text NOT NULL CHECK (actor_type IN (
    'USER',
    'SUPPORT_USER',
    'SERVICE_ACCOUNT',
    'SYSTEM'
  )),
  -- The actor's name as it stood when the event happened. Denormalised because
  -- people leave, and a log that renders today's directory has rewritten itself.
  actor_display_name text,

  -- Convention is OBJECT.VERB — 'RULE_VERSION.ACTIVATED', 'EVIDENCE.DOWNLOADED'.
  -- Deliberately an open string, not a CHECK: the failure mode of a closed list
  -- is an action that cannot be logged, which is strictly worse than an action
  -- whose name is only conventionally checked.
  action text NOT NULL CHECK (length(action) > 0),
  object_type text NOT NULL,
  object_id text NOT NULL,

  -- Section 21's "before/after metadata where appropriate". Field names and
  -- change indicators, never STUDENT_PII values — otherwise the audit log
  -- becomes the most sensitive table in the system, in the one place nobody
  -- thought to look (invariant 10).
  before_metadata jsonb,
  after_metadata jsonb,

  request_id text NOT NULL,
  ip_address inet,
  session_id text,
  -- Section 19 just-in-time elevation, inlined rather than referenced so the
  -- grant's reason and scope are inside the hash: a support user who later edits
  -- the grant record cannot thereby change what the log says they were allowed
  -- to do at the time.
  support_access jsonb,

  -- The chain. `previous_event_hash` is never NULL: the first event links to a
  -- per-tenant genesis hash, so "no predecessor" and "predecessor removed" are
  -- distinguishable states.
  hash_domain text NOT NULL DEFAULT 'complianceos-edu/audit-chain/v1',
  previous_event_hash text NOT NULL CHECK (previous_event_hash ~ '^[0-9a-f]{64}$'),
  event_hash text NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$'),

  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, sequence_no),
  UNIQUE (tenant_id, event_hash),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES users (tenant_id, id),
  CHECK (actor_type IN ('SYSTEM', 'SERVICE_ACCOUNT') OR actor_user_id IS NOT NULL)
);

CREATE INDEX audit_events_by_object ON audit_events (tenant_id, object_type, object_id);
CREATE INDEX audit_events_by_time ON audit_events (tenant_id, occurred_at DESC);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

-- Two narrow policies rather than one FOR ALL policy. With no UPDATE or DELETE
-- policy present, those commands match no rows for anybody — a second, purely
-- declarative statement of append-only that survives someone mistakenly granting
-- the privilege later.
CREATE POLICY audit_events_read ON audit_events
  FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY audit_events_append ON audit_events
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id());

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_truncate();

-- SELECT and INSERT only. No UPDATE, no DELETE, no TRUNCATE, ever.
GRANT SELECT, INSERT ON audit_events TO complianceos_app;

-- -------------------------------------------------------------- audit_seals --
--
-- Section 21's "periodically seal digest roots into a protected archive". A seal
-- commits to a contiguous range of one tenant's chain, so a whole-range deletion
-- — which the chain alone cannot detect, because what remains still links up —
-- becomes detectable against an archived root.
CREATE TABLE audit_seals (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  first_sequence_no bigint NOT NULL CHECK (first_sequence_no >= 1),
  last_sequence_no bigint NOT NULL,
  event_count bigint NOT NULL CHECK (event_count >= 1),
  root_hash text NOT NULL CHECK (root_hash ~ '^[0-9a-f]{64}$'),
  seal_digest text NOT NULL CHECK (seal_digest ~ '^[0-9a-f]{64}$'),
  hash_domain text NOT NULL DEFAULT 'complianceos-edu/audit-chain/v1',
  sealed_at timestamptz NOT NULL DEFAULT now(),
  -- Where the archived copy lives. Write-once storage outside this database,
  -- because a seal kept only beside the data it protects protects nothing.
  archive_ref text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, first_sequence_no),
  CHECK (last_sequence_no >= first_sequence_no),
  CHECK (event_count = last_sequence_no - first_sequence_no + 1)
);

ALTER TABLE audit_seals ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_seals FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_seals_read ON audit_seals
  FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY audit_seals_append ON audit_seals
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id());

CREATE TRIGGER audit_seals_append_only
  BEFORE UPDATE OR DELETE ON audit_seals
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

GRANT SELECT, INSERT ON audit_seals TO complianceos_app;
