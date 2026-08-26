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

**Platform core, and the first two statutory calculators.** The engine and the data path are
built and tested. The two IDEA maintenance-of-effort calculators are implemented against a
47-case golden corpus and run end to end through the engine; the other four are specified and
waiting.

| Package                 | What it does                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/domain`       | Exact-decimal money, calendar arithmetic, canonical hashing, data classification, findings, corrective actions, evidence, retention, audit chain |
| `packages/rulepack-sdk` | Rule schema, restricted DSL, pack loader, regulatory source registry                                                                             |
| `packages/rules-engine` | Three-valued evaluator, pack layering, deterministic explanations, evaluation hash, run orchestration                                            |
| `packages/ingest`       | Strict parsing, versioned mapping templates, validation, reconciliation, provenance, immutable snapshots                                         |
| `packages/db`           | Migrations with composite tenant keys, forced RLS, immutability triggers, append-only audit log                                                  |
| `packages/calculators`  | Calculator contract, registry, golden-corpus runner, purity scan, and the two IDEA maintenance-of-effort calculators                             |

1,072 tests: 1,043 run anywhere, 29 exercise tenant isolation against a real Postgres.

**No rule evaluates district data, and that is enforced rather than merely true.** No
regulatory text has been retrieved in this environment — eCFR is unreachable behind the
egress policy — so every source in the registry is unverified, and a rule citing an
unverified source cannot leave the authoring stages. The entire federal corpus is held at
`DRAFT`. See [ADR 0006](docs/adrs/0006-a-rule-may-not-go-live-on-an-unverified-citation.md).

Each statutory specification was independently reviewed by an adversarial pass that
recomputed every case by hand. All six came back needing revision, with findings including
an order-dependent ceiling and a path where a claimed reduction larger than the comparison
amount produced a trivially passing zero requirement. The calculators are therefore built to a
**refusal policy**: correct where the regulation is unambiguous, and `MANUAL_REVIEW` with the
provision named where it is not.
[ADR 0007](docs/adrs/0007-a-calculator-refuses-rather-than-guesses.md) explains why that is
the right behaviour for a compliance product, and what it costs.

The two maintenance-of-effort calculators are what that policy looks like in code. Where the
regulation is clear they answer exactly — the four measures, the exceptions at 34 CFR 300.204,
the adjustment ceiling at 300.205 apportioned pro rata so no claim is favoured by its position
in a list, per-capita comparisons decided by cross-multiplication so no rounding can flip a
boundary. Where it is not, they evaluate every live reading and refuse when the readings
disagree, naming the provision and the open question. A zero requirement is never a pass, and a
compliance failure is never issued on a calculation that could not be completed.
[`docs/regulatory-methodology/idea-moe.md`](docs/regulatory-methodology/idea-moe.md) is the
specification; `packages/calculators/golden/` is the test corpus a domain reviewer reads.

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
packages/assurance/          District export to assessment, end to end
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

### How it deploys

The Next application lives in `apps/web`, and a Vercel project can be pointed at it two ways.
Both work, deliberately:

| Project Root Directory | Config read            | Output           |
| ---------------------- | ---------------------- | ---------------- |
| repository root        | `vercel.json`          | `apps/web/.next` |
| `apps/web`             | `apps/web/vercel.json` | `.next`          |

Supporting only one is fragile, and it has already broken twice. The Root Directory lives in
the Vercel dashboard, not in this repository: nothing here can test it, nobody reviewing a
diff can see it, and changing it turns every build red with `No Next.js version detected` —
an error that reads like a code problem and is not one. Supporting both removes the class.

Three details make it work, and each looks odd without the reason:

- **`next` is a devDependency of the workspace root**, though the root builds no Next
  application. Vercel's framework detection reads the `package.json` at whichever directory
  the project is rooted at and refuses a root-directory deployment when it finds no `next`
  there, whatever `vercel.json` says. It is a detection shim, not a dependency any root code
  imports.
- **Workspace packages resolve from TypeScript source**, not a built `dist/`. Each package's
  `exports` points at `./src/index.ts` and Next transpiles them, so a deploy needs no separate
  build step for the monorepo. The packages are ESM and import siblings with explicit `.js`
  specifiers, so `next.config.ts` teaches webpack that a `.js` specifier means the `.ts` file
  beside it. `tsc --build` still runs in CI as the typecheck, not as a prerequisite of the
  bundle.
- **The rule packs are read from disk at request time** and nothing imports them, so Next's
  dependency tracing cannot see them. `outputFileTracingIncludes` pulls them into the bundle;
  without it the build succeeds and the deployed application fails on its first request.

Security headers are declared in `next.config.ts` rather than in either `vercel.json`, so they
apply under both layouts and under `next start`.

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
