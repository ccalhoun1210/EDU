# 0010. The product surfaces show a worked example, not an empty shell

- **Status:** Accepted
- **Date:** 2026-08-26

## Context

The engine can ingest a district export and reach a cited conclusion. It has been able to
since `packages/assurance` closed the seam between ingestion and evaluation. Nothing rendered
it: the deployed application showed the rule library and nothing else, and the two screens the
buildout names as most important — the assessment (§24) and the finding-detail "Why" (§40) —
did not exist.

They could not be built the obvious way. This deployment has no authentication, no tenant
onboarding and no database connection. There is no district export to read and nowhere to put
one. So the honest options were:

1. An upload form that writes nowhere, over a table with no rows.
2. Nothing, until the database and the auth layer land.
3. The real path, run over a synthetic export, labelled as such.

CLAUDE.md forbids the first outright: no disabled buttons without explanation, no empty tabs,
no "coming soon". The second defers the screens that make the product legible past every other
piece of work, and those screens are how anyone — a reviewer, a district, the person building
the next module — can tell whether the engine is producing something a school administrator
could act on.

## Decision

The assessment and finding-detail surfaces render a **worked example**: a synthetic district
export computed on the server, through the real path, at request time. Every page that renders
it says so.

- Nothing is mocked. The bytes are parsed by the CSV reader, mapped through a versioned
  template, sealed into a content-hashed snapshot, projected into a fact bag, and evaluated by
  the engine against the rule pack the build shipped with. Change a figure in the fixture and
  the numbers on the page move.
- The district is invented and every figure is made up, in a fixture whose header says so and
  which the `data-hygiene` CI job independently guards.
- Where a section 24 question needs a module this build does not contain — evidence, next
  step, owner — the page **names what is missing and why**, rather than showing an empty
  panel. The same holds for navigation: there is no portfolio dashboard entry, because a
  dashboard over one synthetic district is furniture.
- The pages are `force-dynamic` and recompute per request, so a deployment whose regulatory
  content failed to ship fails visibly rather than serving a value baked in at build time.

## Consequences

**A fixture is now reachable from production code.** `apps/web` depends on
`@complianceos/assurance`, which exports the Northfield fixture from its public surface. That
is a real smell and it is the price of the decision. It is bounded by the fixture being one
module, exported deliberately, carrying its own warning, and by the surfaces having exactly
one call site for it — which is also the seam the real data source replaces.

**Somebody will screenshot this and call it the product.** The mitigation is that every page
says the data is synthetic and that the run is not a determination, in the same visual weight
as the result itself. That is not a guarantee; it is the strongest thing available short of
not shipping the screens.

**A build proving the pages compile proves almost nothing.** `force-dynamic` pages that read
files at request time fail in a way a green build hides, and that has happened twice on this
repository. So `scripts/smoke-web.mjs` starts the built server, fetches every route, and
asserts on rendered content — `$4,830,000.00` on the page means the bytes were parsed, mapped,
sealed, evaluated and formatted on the way to the browser. It runs in `pnpm verify` and in CI.
Without it this decision would not be safe to make.

**The finding page is the specification for what a result must carry.** Building it surfaced
two gaps the engine had: a rule had no human-readable name, and a carried-forward determination
had no honest provenance shape (ADR 0009). Both were fixed in the engine rather than papered
over in the page, which is the value of building the screen early rather than last.

## What would reverse this

The first real district. When authentication, tenant onboarding and persistence exist, these
surfaces read a real assessment and the fixture goes back to being a test fixture — the call
site is already isolated for exactly that. Until then, removing the worked example without
replacing it would leave the product's two most important screens undemonstrated, which is a
worse position than the one this decision accepts.
