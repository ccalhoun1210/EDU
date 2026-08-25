# ComplianceOS EDU

Compliance assurance for publicly funded education programs, beginning with IDEA Part B
fiscal compliance.

The platform ingests data from systems districts already use, normalizes it into a
canonical model, evaluates versioned regulatory rules, explains every result, links results
to evidence, and manages remediation. It answers one question:

> If this district were monitored or audited today, what appears satisfied, what is at
> risk, what evidence supports that conclusion, and what needs to happen next?

It is a **system of assurance, not a system of record**. The district's SIS, IEP platform,
and ERP remain authoritative. Integrations are read-only.

## Status

**Platform core.** The engine and the data path are built and tested; the statutory
calculators are the work in progress.

| Package                 | What it does                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/domain`       | Exact-decimal money, calendar arithmetic, canonical hashing, data classification, findings, corrective actions, evidence, retention, audit chain |
| `packages/rulepack-sdk` | Rule schema, restricted DSL, pack loader, regulatory source registry                                                                             |
| `packages/rules-engine` | Three-valued evaluator, pack layering, deterministic explanations, evaluation hash, run orchestration                                            |
| `packages/ingest`       | Strict parsing, versioned mapping templates, validation, reconciliation, provenance, immutable snapshots                                         |
| `packages/db`           | Migrations with composite tenant keys, forced RLS, immutability triggers, append-only audit log                                                  |
| `packages/calculators`  | Calculator contract, registry, golden-corpus runner, purity scan. Statutory calculators in progress                                              |

999 tests: 970 run anywhere, 29 exercise tenant isolation against a real Postgres.

**No rule evaluates district data, and that is enforced rather than merely true.** No
regulatory text has been retrieved in this environment — eCFR is unreachable behind the
egress policy — so every source in the registry is unverified, and a rule citing an
unverified source cannot leave the authoring stages. The entire federal corpus is held at
`DRAFT`. See [ADR 0006](docs/adrs/0006-a-rule-may-not-go-live-on-an-unverified-citation.md).

Each statutory specification was independently reviewed by an adversarial pass that
recomputed every case by hand. All six came back needing revision, with findings including
an order-dependent ceiling and a path where a claimed reduction larger than the comparison
amount produced a trivially passing zero requirement. The calculators are therefore being
built to a **refusal policy**: correct where the regulation is unambiguous, and
`MANUAL_REVIEW` with the provision named where it is not.
[ADR 0007](docs/adrs/0007-a-calculator-refuses-rather-than-guesses.md) explains why that is
the right behaviour for a compliance product, and what it costs.

The roadmap is §32 of the master technical buildout.

## Getting started

Requires Node 22 and pnpm.

```bash
pnpm install
pnpm dev              # http://localhost:3000
```

Copy `.env.example` to `.env.local` and fill in what you need. `pnpm dev` runs without any
of it — nothing is wired to a database yet.

## Commands

| Command          | What it does                                           |
| ---------------- | ------------------------------------------------------ |
| `pnpm dev`       | Next dev server                                        |
| `pnpm test`      | Vitest across all packages                             |
| `pnpm typecheck` | Project references plus the Next type check            |
| `pnpm lint`      | ESLint                                                 |
| `pnpm build`     | Production build                                       |
| `pnpm verify`    | format + lint + typecheck + test — run before every PR |

The tenant-isolation suite skips without a database. To run it:

```bash
DATABASE_URL=postgres://postgres@localhost:5432/complianceos_test pnpm exec vitest run --project db
```

CI runs it against a Postgres service container, and fails rather than skips if that job
does not supply a database — a suite that silently skips would report that isolation holds
without having checked it.

## Layout

```
apps/web/                    Next.js application
packages/domain/             Core vocabulary: money, dates, hashing, findings, evidence, audit
packages/rulepack-sdk/       Rule schema, DSL, loader, source registry
packages/rules-engine/       Evaluator, pack resolver, explanations, assessment runs
packages/calculators/        Calculator contract, registry, golden corpora
packages/ingest/             Parsing, mapping, validation, provenance, snapshots
packages/db/                 Migrations, RLS policies, tenant-scoped access
rulepacks/                   Regulatory content as YAML, plus the source registry
docs/architecture/           Design documents and the master technical buildout
docs/adrs/                   Architecture decision records
docs/regulatory-methodology/ How each regulatory conclusion is derived
docs/threat-model/           Section 37 threats and what mitigates each today
```

## Deployment

Vercel, with Neon Postgres, Inngest for durable background work, and Vercel Blob for
objects. This differs from the AWS design in the buildout; ADR 0002 records the swap and
what it costs, including the procurement questions to close before a district contract.

## Contributing

Read `CLAUDE.md` first. It lists ten invariants that govern this codebase — determinism,
provenance, immutability, tenant isolation, decimal money arithmetic among them. A change
that breaks one is wrong even if CI passes.

Regulatory content follows `docs/regulatory-methodology/README.md`: the methodology
document and the golden tests are written from the statute before the calculator.

## Data handling

Customer data never enters this repository. `.gitignore` blocks data file extensions and
env files, and CI fails a PR that gets past it. Use synthetic fixtures. No worked example
in the docs uses a real district's figures.
