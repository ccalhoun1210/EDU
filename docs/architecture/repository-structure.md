# Repository structure

## What exists now

```
apps/
  web/                   Next.js application
    src/app/             The assessment, the finding-detail "Why" screen, the rule library
    src/lib/             Server-side data assembly and the wording the pages delegate to
    src/middleware.ts    The per-request Content-Security-Policy nonce

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
  assurance/             The seam between ingestion and evaluation: import, re-seal over both
                         fact origins, project, evaluate; and the carry-forward that binds a
                         prior determination to the run that made it

rulepacks/
  federal/idea-b/        US-FED-IDEA-B-2026 — federal baseline pack
  sources/               Regulatory source registry with retrieval metadata

scripts/
  smoke-web.mjs          Starts the built server and checks what every route rendered

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
  db/                    (exists) Schema, migrations, data access, RLS policies
  rules-engine/          (exists) AST compiler and evaluation runtime
  calculators/           (exists) Audited statutory calculations + golden test corpora
  ingest/                (exists) Parsing, mapping, validation, provenance, snapshots
  assurance/             (exists) Ingestion to assessment, end to end
  data-contracts/        Canonical import schemas
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
  threat-model/          (exists)
  regulatory-methodology/  (exists)
  data-dictionary/
  api/
  runbooks/
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
