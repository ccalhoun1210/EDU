# 0001. Use a pnpm monorepo with a modular monolith

- **Status:** Accepted
- **Date:** 2026-08-25

## Context

The platform spans a customer web app, an API, background workers, an internal rules-admin
app, and a large body of shared domain logic. Regulatory content, calculators, and the
canonical data model are used by all of them and must stay version-locked: a rule pack, the
calculator it invokes, and the engine that runs it have to move together or historical runs
stop reproducing.

Splitting into separate services and repositories this early would put a network boundary
and an independent release cycle between components that must agree exactly.

## Decision

One repository, pnpm workspaces, with the primary application built as a modular monolith;
extract a service only when scale, a security boundary, or genuinely independent deployment
demands it.

## Consequences

- Domain, rule schema, and calculators are imported directly and typechecked together, so a
  breaking change surfaces at build time rather than in production.
- CI runs the whole verification pass on every PR. This gets slower as the repo grows and
  will eventually need per-package task filtering.
- A single deployment unit means an unrelated change can force a redeploy of everything.
- Team boundaries have to be maintained by CODEOWNERS and review discipline rather than by
  repository permissions.

## What would reverse this

A component with materially different security requirements — most likely the internal
rules-admin application, which handles pre-publication regulatory content and should not
share a runtime with customer-facing code once real districts are on the platform.
