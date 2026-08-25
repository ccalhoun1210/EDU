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

**Phase 0 — foundation.** What works today:

- Rule-pack schema, restricted rule DSL, and pack loader, with validation in CI
- Federal IDEA Part B baseline pack: three fiscal rules, each carrying its CFR citation
- Core domain vocabulary — evaluation statuses, organization model, explicit access scopes
- A public landing page at `/` describing the product, its invariants, and its current stage
- A rule library at `/rule-pack` that loads the committed rule pack and reports what parsed

No rule is evaluated yet. Calculators are declared in the registry and not implemented; no
rule has passed legal review. The roadmap is §32 of the master technical buildout.

## Getting started

Requires Node 22 and pnpm.

```bash
pnpm install
pnpm dev              # http://localhost:3000
```

Copy `.env.example` to `.env.local` and fill in what you need. `pnpm dev` runs without any
of it — nothing is wired to a database yet.

Set `NEXT_PUBLIC_CONTACT_EMAIL` to the address the landing page's calls to action should
reach. It falls back to the placeholder in `apps/web/src/site.ts`, which must be replaced
with a real inbox before the site is announced anywhere.

## Commands

| Command          | What it does                                           |
| ---------------- | ------------------------------------------------------ |
| `pnpm dev`       | Next dev server                                        |
| `pnpm test`      | Vitest across all packages                             |
| `pnpm typecheck` | Project references plus the Next type check            |
| `pnpm lint`      | ESLint                                                 |
| `pnpm build`     | Production build                                       |
| `pnpm verify`    | format + lint + typecheck + test — run before every PR |

## Layout

```
apps/web/               Next.js application — landing page and rule library
packages/domain/        Evaluation vocabulary, organization model, access rules
packages/rulepack-sdk/  Rule schema, DSL, loader, calculator allow-list
rulepacks/              Regulatory content as YAML
docs/architecture/      Design documents and the master technical buildout
docs/adrs/              Architecture decision records
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
