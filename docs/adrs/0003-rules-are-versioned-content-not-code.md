# 0003. Keep regulatory logic in versioned content, not in application code

- **Status:** Accepted
- **Date:** 2026-08-25

## Context

Federal and state education regulation changes on its own schedule, and a compliance
conclusion has to be reproducible years after it was reached: what did the platform
conclude on a given date, using the rules and data that existed then?

If a threshold lives in a page component or a service conditional, a rule change becomes a
code change and a redeploy, the old logic is gone from the running system, and nobody
outside engineering can review what the platform believes the law requires.

## Decision

Regulatory logic lives in versioned rule packs authored as YAML under `/rulepacks`,
validated by `@complianceos/rulepack-sdk`, with statutory arithmetic delegated to
allow-listed, versioned calculator functions.

## Consequences

- A domain expert or reviewing attorney can read a rule without reading TypeScript.
- Rule packs layer — federal baseline, state overlay, local policy overlay — so Alabama can
  tighten a federal requirement without forking it.
- Every rule carries its citation, source id, and effective window, so a finding can be
  traced to the regulation and a run can select the rules in force on its as-of date.
- The DSL is deliberately small and has no escape into JavaScript. Anything it cannot
  express requires a new calculator, which is a reviewed, tested, versioned addition rather
  than an inline expression. This is friction, and it is the point.
- Two things now have to be kept in sync: the rule schema and the calculator registry. CI
  validates every pack against both on each PR.
- Authoring tooling is required eventually. YAML by hand does not scale to a multi-state
  rule corpus, which is what the internal rules-admin application in the buildout is for.

## What would reverse this

Nothing short of abandoning multi-state support. The alternative — regulatory conditionals
in application code — fails the reproducibility requirement in §2.5 of the buildout on its
first real audit.
