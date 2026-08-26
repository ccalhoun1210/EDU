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

**Platform core, the first two statutory calculators, and the screens that render them.** The
engine and the data path are built and tested. The two IDEA maintenance-of-effort calculators
are implemented against a 47-case golden corpus and run end to end through the engine; the
other four are specified and waiting. A district export goes in and a cited assessment comes
out, on screen, with every figure traceable to the cell or the prior run it came from.

| Package                 | What it does                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/domain`       | Exact-decimal money, calendar arithmetic, canonical hashing, data classification, findings, corrective actions, evidence, retention, audit chain       |
| `packages/rulepack-sdk` | Rule schema, restricted DSL, pack loader, regulatory source registry                                                                                   |
| `packages/rules-engine` | Three-valued evaluator, pack layering, deterministic explanations, evaluation hash, run orchestration                                                  |
| `packages/ingest`       | Strict parsing, versioned mapping templates, validation, reconciliation, provenance, immutable snapshots                                               |
| `packages/db`           | Migrations with composite tenant keys, forced RLS, immutability triggers, append-only audit log                                                        |
| `packages/calculators`  | Calculator contract, registry, golden-corpus runner, purity scan, and the two IDEA maintenance-of-effort calculators                                   |
| `packages/assurance`    | The seam: a district export in, an assessment out — import, re-seal, project, evaluate, with the prior determinations bound to the runs that made them |
| `apps/web`              | The assessment surface, the finding-detail "Why" screen, and the rule library                                                                          |

1,167 tests: 1,138 run anywhere, 29 exercise tenant isolation against a real Postgres. A route
smoke test fetches every page from a built server and checks what it rendered.

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

### What you can see

`pnpm dev` serves three surfaces. All of them read the rule pack that shipped with the build,
from disk, on each request.

- **The assessment** — one subject, one run: what is satisfied, what is not determined, what
  is outstanding on each requirement, and the import and snapshot the whole thing rests on.
- **The finding detail** — §40's "Why" screen. The rule and the version of it, the shown work
  step by step with the provision each step derives from, every figure the calculation read,
  and where each one came from: a filename, row and cell for a district's own figure; a
  finalized run, rule and evaluation hash for a determination carried forward.
- **The rule library** — the regulatory content itself, and whether each rule's citation has
  been retrieved and its arithmetic written.

The district is **synthetic** and every figure is invented; there is no authentication, no
onboarding and no database, so there is nowhere for a real export to go. What runs is the real
path, not a mock. Where a screen cannot answer something the buildout asks of it — what
evidence is required, what to do next, who owns remediation — it names the missing module
rather than showing an empty panel.
[ADR 0010](docs/adrs/0010-the-product-surfaces-show-a-worked-example.md) records why that was
the right way to ship these screens, and what it costs.

### Who is entitled to say what

A finding is only as good as its weakest link, and two of them were weak.

A canonical fact records **who asserted it**, not just how sensitive it is, and each field
declares which origins may supply it. Without that, an uploaded spreadsheet could have
supplied its own prior-year compliance status — and 34 CFR 300.203(c) exists precisely so a
failing year cannot lower the next year's bar. The resulting finding would have carried a
complete, correct-looking provenance chain pointing at the district's own cell.
[ADR 0008](docs/adrs/0008-a-fact-records-who-asserted-it.md).

Provenance records **what kind of source** is behind a fact. A determination carried forward
from a finalized run has no spreadsheet cell, and describing one as though it did produced a
citation that was false. It now names the run, the rule and that result's evaluation hash, so
a prior-year status can be checked against the computation that produced it rather than
trusted. [ADR 0009](docs/adrs/0009-provenance-describes-the-kind-of-source.md).

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

| Command          | What it does                                                           |
| ---------------- | ---------------------------------------------------------------------- |
| `pnpm dev`       | Next dev server                                                        |
| `pnpm test`      | Vitest across all packages                                             |
| `pnpm typecheck` | Project references plus the Next type check                            |
| `pnpm lint`      | ESLint                                                                 |
| `pnpm build`     | Production build                                                       |
| `pnpm smoke:web` | Start the built server and check every route renders                   |
| `pnpm verify`    | format + lint + typecheck + test + build + smoke — run before every PR |

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

Security headers are declared in the framework rather than in either `vercel.json`, so they
apply under both layouts and under `next start`. The static ones are in `next.config.ts`; the
Content-Security-Policy is issued per request by `apps/web/src/middleware.ts`, because it
carries a nonce. It used to be static, on the premise that the app uses no inline script — the
App Router streams its payload through nine of them, so `script-src 'self'` meant React never
hydrated. `pnpm smoke:web` now fails if the header is missing, if it carries no nonce, or if
the served HTML's inline scripts do not carry that same nonce.

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
