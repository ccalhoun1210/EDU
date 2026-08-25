# 0004. Enforce tenant isolation in the database with Postgres RLS

- **Status:** Accepted
- **Date:** 2026-08-25

## Context

The platform holds special-education fiscal data and, in later modules, identifiable
student records, for many districts in one system. A cross-tenant leak here is not a bug
report — it is a FERPA incident, a breach notification, and the end of the product's
credibility with every other district on it.

Application-layer filtering — remembering a `WHERE tenant_id = ?` on every query — fails
open. One forgotten clause in one query, in one report, is a leak, and nothing in the type
system catches it.

## Decision

Every tenant-owned table carries `tenant_id`; sensitive tables use Postgres Row Level
Security with `FORCE ROW LEVEL SECURITY`; the application connects as a non-owner role that
cannot bypass RLS; tenant context is set server-side from the authenticated session and
never read from a request parameter.

Composite keys including `tenant_id` are used where feasible so a cross-tenant foreign key
cannot be created even by mistake:

```sql
PRIMARY KEY (tenant_id, id)
FOREIGN KEY (tenant_id, finding_id) REFERENCES findings (tenant_id, id)
```

## Consequences

- Isolation fails closed. A query missing its tenant predicate returns nothing rather than
  another district's data.
- The migration role and the application role are separate, and the application role must
  never be the schema owner — a schema owner bypasses RLS silently.
- Every request path has to set tenant context before touching the database. Connection
  pooling makes this delicate: pooled connections are reused, so context must be set per
  transaction, not per connection.
- Composite keys make joins more verbose and some ORM patterns awkward. This is accepted.
- Tenant-isolation tests are a required CI category, not optional coverage: for each
  sensitive table, assert that tenant A's session cannot read, update, or delete tenant B's
  rows.

## What would reverse this

Nothing reverses RLS. What may be _added_ is an isolation tier — a dedicated database for a
state agency or a large district — kept behind a repository abstraction so tenant storage
routing changes without touching the domain API.
