# 0007. A calculator refuses to answer where the regulation is ambiguous

- **Status:** Accepted
- **Date:** 2026-08-25

## Context

Each statutory calculator was specified before implementation, and each specification was then
reviewed by an independent adversarial pass that recomputed every golden case by hand and
checked the algorithm against the cited provision. Every specification reviewed came back
`needs-revision`, and the blocking findings were not arithmetic slips. They were places where
the specification had _resolved an ambiguity by picking_ — and where the pick was invisible in
the output.

Three examples, all real:

- The 34 CFR 300.205 adjustment ceiling was consumed across claimed entries "in list order", so
  the result depended on the order of an array. Two runs over the same district data could
  disagree, which defeats reproducibility (§2.5) outright.
- A claimed 34 CFR 300.204 exception larger than the entire comparison-year amount clamped the
  required level to zero, and any non-negative budget then passed. A mis-mapped column could
  produce a confident PASS on the requirement whose failure carries a repayment obligation.
- The 34 CFR 300.203(c) subsequent-year rule conflated two different quantities — the level
  that would have been required absent a failure, and what the LEA actually spent in the last
  year it met the requirement. They are not the same number and the specification used them
  interchangeably.

None of these would have failed a test. Each produces a well-formed finding with a full
provenance chain, a citation, and a reproducible hash — and the wrong answer.

The underlying condition is not going away soon: no regulatory text was retrieved during this
build (ADR 0006), and even with the text, several of these questions are genuine legal
judgements rather than reading-comprehension problems.

## Decision

A calculator is correct where the regulation is unambiguous, and **refuses to answer where it
is not**. A refusal is `MANUAL_REVIEW` carrying a BLOCKING warning that names the provision and
states the question. It is never a PASS, never a FAIL, and never a silently chosen default.

Concretely:

1. A claimed exception naming no enumerated statutory ground is a validation failure.
2. A required level of zero is never a PASS. Total claimed reductions at or above the
   comparison amount are refused.
3. Where a ceiling is apportioned across several claims, apportionment is pro rata on the
   total — order-independent by construction, not by convention.
4. Anything requiring a prior finalized run arrives as a declared input. A pure calculator
   cannot read history, so it validates the inputs' consistency and refuses when they disagree,
   rather than inferring.
5. A zero denominator makes a per-capita method `NOT_APPLICABLE`, never a satisfied one.
6. A period governed by superseded regulatory text is `MANUAL_REVIEW`, not `NOT_APPLICABLE` —
   the requirement applied; this calculator version does not implement it.
7. **No status is invented.** There is no RISK band, because the statute sets no de minimis
   margin and inventing one substitutes platform judgement for the statutory test.

## Consequences

**Districts will see "this needs review" on cases a competent human could decide.** That is the
cost, and it is the right cost. The alternative is a platform that answers everything and is
quietly wrong on the hard cases — which is worse than a dashboard, because it carries a
citation.

**A refusal is actionable, not a shrug.** Each names its provision and its question, so the
output doubles as the work list for the regulatory content team. The count of refusals is a
measurable backlog that shrinks as questions are resolved, rather than an unknown quantity of
wrong answers that never surfaces.

**Statutory judgement and platform judgement become architecturally separate.** This is the
consequence with the longest reach. A federal calculator computes only what the regulation
requires. A forward-looking signal — "at risk before fiscal close", an early warning at a
margin a district cares about — is a _platform_ judgement, and it now has a proper home: a rule
in a state or local pack, layered over the federal baseline, with its own id, its own severity,
and its own authority (district policy, not the CFR).

That falls out of §8.1's existing rule that a local pack may define internal controls and
earlier warning thresholds. What is new is the recognition that this is the _only_ place such
judgements may live. A federal calculator that emitted RISK would be asserting, with a CFR
citation attached, something the CFR does not say.

**The refusal branches are themselves untested against the regulation.** They are conservative,
which limits the damage, but "we refuse in this situation" is still a claim about what the law
leaves open, and a reviewing attorney may well resolve several of them into ordinary PASS or
FAIL logic. Every one is recorded in `docs/regulatory-methodology/` under open questions.

## What would reverse this

Nothing reverses the principle. Individual refusal branches should disappear one at a time as
legal review resolves them — and each disappearance is a rule-pack release with a shadow-run
impact report (§9), not a quiet code change.

The one thing that would reverse it wholesale is discovering that districts prefer a confident
wrong answer to an honest refusal. If that turns out to be true, this is not the product to
build.
