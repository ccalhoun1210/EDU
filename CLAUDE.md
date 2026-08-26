# ComplianceOS EDU

A multi-tenant compliance assurance platform for publicly funded education programs,
starting with IDEA Part B fiscal compliance. The authoritative design document is
`docs/architecture/master-technical-buildout.md`. Read it before any non-trivial change.

## What this product is

A **system of assurance, not a system of record**. Districts keep their SIS, IEP platform,
and ERP. We ingest from them read-only, normalize into a canonical model, evaluate
versioned regulatory rules, explain every result, link results to evidence, and manage
remediation.

The question the product exists to answer: _if this district were monitored today, what
appears satisfied, what is at risk, what evidence supports that, and what happens next?_

## Non-negotiable invariants

These are not style preferences. A change that breaks one of them is wrong even if it
passes CI. If a request appears to require breaking one, stop and say so.

1. **Deterministic rules own compliance decisions.** Rule outcomes come from versioned,
   reproducible logic. AI may classify documents, extract candidate facts, draft
   remediation text, and explain results — all advisory, all validated before becoming
   authoritative. AI is never the final compliance decision-maker.
2. **No arbitrary code in rules.** Rules are declarative data in the restricted DSL
   (`packages/rulepack-sdk/src/expression.ts`). Statutory arithmetic goes in allow-listed,
   versioned calculators that are pure and deterministic — no network, no database, object
   in, object out. Never add an `eval`, `Function`, or raw-expression escape hatch.
3. **Every result carries provenance.** Finding → Rule → Rule version → Regulatory
   authority → Input fact → Source record → Transformation → Data snapshot. A finding
   without that chain must not be creatable.
4. **Finalized runs are immutable.** New data or new rules produce a _new run_. Never
   rewrite a prior result. Never mutate an ACTIVE rule version — supersede it.
5. **Never float money.** Use PostgreSQL `NUMERIC` or integer cents, and a decimal library
   in application code. A rounding artifact in a fiscal finding is a compliance defect.
   `parseFloat` is banned by ESLint for this reason.
6. **Regulatory dates are calendar dates.** SQL `DATE`, `YYYY-MM-DD` strings. Do not
   round-trip a statutory deadline through a UTC timestamp.
7. **Tenant isolation is enforced in the database.** Every tenant-owned table has
   `tenant_id`. Sensitive tables use Postgres RLS with `FORCE`. The app connects as a
   non-owner role. Tenant context is set server-side from the session — a `tenant_id`
   from a browser request is never trusted.
8. **A parent organization does not inherit access to a child's data.** Access is always
   explicit. See `packages/domain/src/organization.ts`.
9. **Missing data yields `INDETERMINATE`.** Never an artificial `PASS` or `FAIL`. See
   `packages/domain/src/evaluation.ts`.
10. **Minimize student PII.** Each module declares its minimum data contract. IDEA Fiscal
    operates with essentially no student PII — keep it that way. Identifiers stay separated
    from analytic records.

## Stack

Deployed on **Vercel**, which replaces the AWS compute/storage/queue layers in the design
doc. The architecture is unchanged; see `docs/adrs/0002-deploy-on-vercel.md` for what was
swapped and what that costs.

| Concern               | Choice                                                              |
| --------------------- | ------------------------------------------------------------------- |
| Language              | TypeScript throughout                                               |
| Web + API             | Next.js App Router on Vercel                                        |
| Database              | Neon Postgres (pooled URL for the app, direct URL for migrations)   |
| Background work       | Inngest — durable steps, replaces SQS + Step Functions              |
| File/evidence storage | Vercel Blob initially; see ADR 0002 for the move to S3 before pilot |
| Validation            | Zod                                                                 |
| Tests                 | Vitest; Playwright for browser tests when the UI exists             |
| Package manager       | pnpm workspaces, Node 22                                            |

## Layout

```
apps/web/              Next.js application — the assessment, the finding "Why", the rule library
packages/domain/       Core vocabulary — evaluation statuses, money, dates, org model, fact origin
packages/rulepack-sdk/ Rule schema, restricted DSL, pack loader, calculator allow-list
packages/rules-engine/ Evaluator, pack layering, explanations, evaluation hash, assessment runs
packages/calculators/  Calculator contract, registry, golden corpora, the statutory arithmetic
packages/ingest/       Parsing, mapping templates, validation, provenance, immutable snapshots
packages/assurance/    District export to assessment, and the carry-forward of determinations
packages/db/           Migrations, RLS policies, tenant-scoped access
rulepacks/             Regulatory content as YAML — federal baseline, then state overlays
scripts/               Checks that need a running server rather than a test runner
docs/architecture/     Design documents, including the master buildout
docs/adrs/             Architecture decision records
docs/regulatory-methodology/  How each regulatory conclusion is derived
docs/threat-model/     Section 37 threats and what mitigates each today
```

Target layout for packages not yet created is in
`docs/architecture/repository-structure.md`. Add a package when its first real consumer
exists, not before.

## Commands

```bash
pnpm install
pnpm dev          # Next dev server
pnpm test         # Vitest across all packages
pnpm typecheck    # tsc project references + Next type check
pnpm lint
pnpm smoke:web    # start the built server and check every route actually renders
pnpm verify       # format + lint + typecheck + test + build + smoke — run before every PR
```

## Working agreements

- **Nothing partial ships.** No disabled buttons without explanation, no empty tabs, no
  "coming soon", no menu items that 404. If it cannot be finished in scope, cut the scope
  explicitly rather than shipping a shell.
- **Tests before calculators.** A regulatory calculator gets its golden test corpus written
  from the statute _first_. The test set is the specification; the function is the
  implementation.
- **Cite the authority.** Every rule carries a citation and a source id. If you cannot
  point at the CFR section or state regulation, the rule is not ready to write.
- **Rules are content, not code.** Regulatory logic never goes into a page component or an
  ad-hoc conditional. It goes in a rule pack.
- **Never commit customer data.** `.gitignore` blocks `*.csv`, `*.xlsx`, `/data/`,
  `/evidence/`. Do not override it. Use synthetic fixtures.
- **Expand/contract migrations.** Additive schema, then compatible app, then backfill, then
  switch, then remove. Never couple a destructive migration to a contract change.
