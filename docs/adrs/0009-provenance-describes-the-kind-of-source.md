# 0009. Provenance describes the kind of source, and a determination is bound to its run

- **Status:** Accepted
- **Date:** 2026-08-26

## Context

ADR 0008 gave every fact an origin — whose statement it is. It did not give the provenance
record a way to describe _what kind of thing_ the source was, and those came apart immediately.

`FactProvenance` had one shape: a row in an uploaded file. Source file, source hash, row,
physical line, columns, raw cell text, mapping template, transformation chain. That is exactly
right for the overwhelming majority of facts, and it is what makes §10.6 — _"a finding must be
able to show the exact underlying source data"_ — true rather than aspirational.

It is wrong for the facts that decide the hardest cases. A maintenance-of-effort determination
needs the prior year's compliance status, and that is not in any spreadsheet: the platform
concluded it, in a finalized run. Recorded in the only shape available, it came out as
`sourceRow: 1`, `sourceFields: ['comparison_year_moe_status']`, and a `sourceHash` naming an
unrelated upload. A finding-detail screen rendering that sends a business officer looking for
a cell that does not exist, and a monitor who goes looking finds a citation that is false.

The deeper problem was that nothing bound the fact to the run it named.
`moe_status_source_run_id` was a string beside another string. Any value could sit next to any
run id, and the provenance chain would look complete all the way back to a finalized run that
concluded the opposite — which is the fabrication 34 CFR 300.203(c) exists to prevent, wearing
a correct-looking chain. ADR 0008 stopped a _district_ from asserting a determination. It did
nothing about a determination asserted by the platform that the platform never made.

## Decision

`FactProvenance` is a **discriminated union**, and a carried-forward determination is bound to
the computation it came from by that computation's own evaluation hash.

- `FILE_ROW` describes a cell in an export, unchanged.
- `DETERMINATION` describes a computation: the run, the rule, the pack id and version, the
  engine version, the snapshot that run read, the **evaluation hash** of the result carried
  forward, the dotted path the value was read from, and when it was determined.
- `buildSnapshot` refuses a fact whose provenance shape does not match what its origin claims.
  Checked at sealing, not at projection: once an incoherent chain is inside the content hash,
  the hash certifies the incoherence.
- Three origins — `DISTRICT_ATTESTATION`, `SEA_DETERMINATION`, `PLATFORM_REFERENCE` — have no
  shape designed and are **refused** rather than fitted to one of the two that exist.
- `carryForward` is the only sanctioned way to build a determination fact. It reads the value
  out of the finalized `EvaluationResult` — there is no parameter for it — and stamps that
  result's identifiers on. A fact cannot claim a status the run it cites did not reach.
- `verifyCarriedForward` checks the other direction: the run and rule must be among the
  finalized results, the hash must match, and the value must still read out of the recorded
  path. Three roots are readable — `status`, `assessmentRunId` and `output.*`. A rule's inputs
  and steps are how it reached its conclusion, not the conclusion, and carrying one forward
  would let a later run treat a working figure as a determination of record.
- The whole determination record is inside the snapshot content hash. Outside it, the binding
  could be repointed at a run that concluded the opposite and `verifySnapshot` would certify
  the result.

## Consequences

**The calculator had to state its conclusion twice, in two vocabularies.** The next year reads
`comparison_year_moe_status`, which is `MET | NOT_MET | UNKNOWN`; an evaluation status is
`PASS | FAIL | …`. Translating between them used to happen wherever somebody carried a value
across — by hand, in prose, unverifiably. The compliance calculator now emits
`output.moeStatus` so the carry-forward reads a value rather than reinterpreting one. That is
a real cost: two representations of one conclusion, which must not drift. It is bounded by
being computed in one place from the roll-up.

**Three origins are now unusable.** Nothing produces them today, so nothing is blocked, and
the first producer gets an error naming what has to be built. The alternative — reuse a shape
for something it does not describe — is what produced this ADR.

**The binding is a hash comparison, not a signature.** A caller that supplies a fabricated
`EvaluationResult` alongside a fabricated fact gets a consistent pair. This defends against a
value edited in isolation, a chain repointed after sealing, and a prior run whose conclusion
has since changed. It does not defend against an attacker who controls the whole input.
Closing that means finalized results read from append-only storage the application cannot
rewrite (§21), rather than passed in as an argument.

**Every consumer of provenance must now narrow before reading.** Code that used to write
`provenance.sourceRow` has to establish that there is a row first. That is the type system
surfacing a question the old shape let callers skip, and the finding-detail screen is the
place it matters: it renders a filename and a cell for one kind and a run and a rule for the
other, because those are the two different things a reader would go and look at.

## What would reverse this

A third and fourth variant arriving would not reverse it — that is the design working. What
would is discovering that the variants share almost every field in practice, at which point
the union is ceremony over a single record with optional parts. The signal is a `switch` whose
branches become identical.

The hash binding should be superseded, not reversed, once finalized results live in
append-only storage: the verification then reads the prior result from the record rather than
from an argument, and the caller can no longer supply both halves of a consistent lie.
