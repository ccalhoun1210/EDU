# Repository structure

## What exists now

```
apps/
  web/                   Next.js application — web UI and route handlers

packages/
  domain/                Evaluation vocabulary, exact-decimal money, calendar arithmetic,
                         canonical hashing, data classification, findings, corrective actions,
                         assessment runs, evidence, retention, the audit hash chain
  rulepack-sdk/          Rule schema, restricted DSL, pack loader, calculator allow-list,
                         regulatory source registry
  rules-engine/          Three-valued DSL evaluator, pack layering, deterministic explanations,
                         evaluation hash, assessment run orchestration
  calculators/           Calculator contract, registry, golden corpus runner, purity scan
  ingest/                CSV parsing, mapping templates, transformations, validation,
                         reconciliation, provenance, immutable data snapshots
  db/                    Migrations, RLS policies, tenant-scoped access, migration runner

rulepacks/
  federal/idea-b/        US-FED-IDEA-B-2026 — federal baseline pack
  sources/               Regulatory source registry with retrieval metadata

docs/
  architecture/          Design documents, including the master technical buildout
  adrs/                  Architecture decision records
  regulatory-methodology/  How each regulatory conclusion is derived
  threat-model/          Section 37 threats mapped to what mitigates them today
```

## Target structure

From §5 of the master technical buildout, adjusted for the Vercel deployment in ADR 0002.
These directories are **not** created ahead of use. An empty package with a stub export is
worse than no package: it looks like a seam that exists and is not one.

```
apps/
  web/                   Customer application (exists)
  rules-admin/           Internal regulatory-content application

packages/
  domain/                (exists)
  rulepack-sdk/          (exists)
  db/                    Schema, migrations, data access, RLS policies
  data-contracts/        Canonical import schemas
  rules-engine/          AST compiler and evaluation runtime
  calculators/           Audited statutory calculations + golden test corpora
  integrations/          Connector abstractions (SIS, IEP, ERP)
  documents/             Evidence and document processing
  reporting/             Report templates and exporters
  auth/                  Identity, RBAC, ABAC helpers
  ui/                    Shared design system
  observability/         Logs, traces, metrics
  security/              Encryption, redaction, audit helpers

rulepacks/
  federal/
    idea-b/              (exists)
    uniform-guidance/
  states/
    alabama/
      idea-b/
      federal-programs/

docs/
  architecture/          (exists)
  adrs/                  (exists)
  threat-model/
  data-dictionary/
  api/
  runbooks/
  regulatory-methodology/  (exists)
```

## Differences from the buildout

- **No `apps/api` or `apps/worker`.** On Vercel the API is Next.js route handlers inside
  `apps/web`, and background work runs as Inngest functions rather than a long-lived worker
  process. If the API later needs an independent deployment or a different security
  boundary, it splits out then — see ADR 0001.
- **No `infra/terraform`.** Vercel project settings and `vercel.json` replace it. Database
  schema still lives in `packages/db` as migrations, which is where the durable
  infrastructure state actually is.

## When to add a package

When its first real consumer exists and there is working code with tests to put in it. Add
the package in the same change as the code that needs it, not before.
