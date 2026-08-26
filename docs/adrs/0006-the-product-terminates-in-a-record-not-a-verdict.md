# 0006. Terminate the product in a defensible record, not in a compliance verdict

- **Status:** Accepted
- **Date:** 2026-08-26

## Context

Phase 0 built a rule schema, a restricted DSL, a pack loader and a calculator allow-list,
and pointed all of it at a single output: an evaluation status. That was the wrong terminus,
and market research finished on 2026-08-26 is what showed it.

Three findings forced the decision.

**Districts are largely passing the arithmetic and failing the paperwork.** The one complete
Georgia Cross-Functional Monitoring result we could obtain — Cherokee County, FY2025, 57
indicators — scored Met on both IDEA fiscal indicators a calculator would own, 18.1
maintenance of effort and 18.2 excess cost. The single Did Not Meet was 16.1, Title III
entrance and exit procedures, because a written manual omitted four parameters and one
student's reclassification was never considered. The corrective action was eight items of
_write the rule down and prove you told the schools_. The federal audit record has the same
shape: ED OIG's finding against a Seattle contract was that the purchase was fine and the
file was not.

**The record has to outlive the person who made it.** Federal programs are monitored one to
five years after the year of spending. The Washington State Auditor's finding against Tenino
School District names the cause explicitly — turnover in the business manager position. A
conclusion without its inputs, their sources, and the method applied is not defensible by a
successor, and a successor is usually who has to defend it.

**No competitor occupies either half alone, and neither half is defensible alone.** State
grants systems do workflow and compute none of the statutory tests; their own procurement
documents do not mention maintenance of effort, comparability or time and effort. The one
LEA-side product with published pricing is a document repository at $600 per district plus
$600 per Title I school. A document store cannot tell a director that a workpaper is stale;
a calculator cannot produce the file a monitor asks for.

This ADR is cheap to adopt because the calculators, the persistence layer and the evaluation
runtime had not been written yet. Nothing is discarded.

## Decision

A rule run produces a workpaper — citation, pack version, every input with its provenance,
the statutory method applied, the result and a rendered explanation — which attaches to a
numbered indicator of a state monitoring instrument alongside documents and narrative, and
the product's terminal output is an attested binder assembled in the state's own indicator
order.

## Consequences

- The customer sees their own vocabulary. A director does not ask whether
  `IDEA-EXCESS-COST-001` passed; they ask whether 18.2 will be Met. Instruments are modelled
  as content under `/instruments` and indicator numbering is the state's, never ours.
- `EvaluationStatus` stops being the product and becomes a field on a workpaper. The
  precedence in `@complianceos/domain` is unchanged and is now also what rolls workpapers up
  to an indicator, so `INDETERMINATE` outranking `PASS` holds at every level.
- Inputs must carry provenance — kind, description, who supplied it, when, and the evidence
  it was read from. This is the largest new cost. It makes every ingestion path heavier and
  it is the entire reason a FY2026 run is still readable in FY2031.
- Attestation freezes an assertion. Corrections supersede rather than edit, mirroring rule
  versioning under ADR 0003. This will feel obstructive to users who expect to fix a typo,
  and the obstruction is the feature.
- A binder finalizes whole or not at all, with no override flag. `finalizeBinder` throws
  when any in-scope indicator is missing or still a draft. A document that presents itself
  as a district's monitoring record while silently omitting an indicator is worse than no
  document, because it will be believed.
- Evidence integrity is hashed at capture. Hashing is not a substitute for write-once
  storage; it is what makes write-once storage checkable. The storage posture recorded as
  open in ADR 0002 is now load-bearing rather than a nice-to-have — an evidence system with
  mutable evidence is worse than none.
- Each new state is a new instrument file, and instruments are reissued annually. The
  maintenance surface grows by one file per state per year on top of the rule corpus. This
  is the same bet as ADR 0003 and it is the moat: Georgia's indicator 18.5, a $14,400 parent
  mentor minimum with no federal analogue, is precisely what a national vendor will not
  build.
- Invariant 3 promises `Finding → Rule → Rule version → Regulatory`, but `RuleSchema` has no
  per-rule version field — a rule's version is the version of the pack that published it.
  `RuleProvenance` therefore records `packId`, `packVersion` and `ruleId` together. This is a
  deliberate substitution, not an omission. If rules ever version independently of their
  pack, that is a new ADR and a migration.

## What would reverse this

Evidence that districts will pay for a calculation on its own. Concretely: prospect
conversations in which a director asks for the maintenance of effort number and declines the
binder, or a competitor shipping a bare calculator that wins seats without an evidence
trail. The five Georgia district conversations scheduled before the persistence layer is
built are the test. If the binder is not what they react to, this ADR is wrong and the
product should narrow back to the calculation.
