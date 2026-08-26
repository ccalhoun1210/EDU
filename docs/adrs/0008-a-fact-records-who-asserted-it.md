# 0008. A canonical fact records who asserted it, and a field states who may

- **Status:** Accepted
- **Date:** 2026-08-26

## Context

Every canonical fact carried a `DataClassification` — how sensitive the value is. Nothing
carried the other question, and for a compliance platform it is the load-bearing one: _whose
statement is this?_

The two are independent. A district's expenditure total and the platform's own prior
determination about that district are both `CONFIDENTIAL`, and only one of them may arrive in
a spreadsheet the district uploads.

Without that distinction the ingestion path had a hole with no floor under it. A
`MappingTemplate` may target any canonical field name — the schema constrained only
uniqueness — and a projected fact bag is flat. By the time the engine read a value it could
not tell a figure the district reported from a determination the platform had made.

So an uploaded export could supply `comparison_year_moe_status`,
`comparison_year_methods_met` and `comparison_required_level_*`. A district could declare its
own prior year compliant and set the level carried forward to any number it liked — and
34 CFR 300.203(c) exists precisely to stop a failing year from lowering the following year's
bar. The resulting finding would have carried a complete, correct-looking provenance chain,
pointing at the district's own cell.

Nothing already in place would have fired. The value parses, the row is well-formed, the
reconciliation balances, the hash verifies. Threat 4 in the threat model covered import
_poisoning_ — coercion, ragged rows, conflicting values, silent discards — and every
mitigation there is about data arriving mangled. None is about a perfectly well-formed value
in a field the district has no standing to write.

## Decision

Every `CanonicalFact` carries a **`FactOrigin`** alongside its classification, and every
canonical field declares which origins may supply it, with the reasoning recorded beside it.

- Five origins: `DISTRICT_EXPORT`, `DISTRICT_ATTESTATION`, `PLATFORM_DETERMINATION`,
  `SEA_DETERMINATION`, `PLATFORM_REFERENCE`. The list is not a trust ranking to compare
  numerically; permission is an explicit set per field.
- The ingest pipeline stamps `DISTRICT_EXPORT` on everything it produces, and it is **not a
  parameter**. An import cannot elect to speak with the platform's authority.
- `projectFactBag` refuses a fact whose origin the field does not permit — **throwing rather
  than dropping**. Dropping would make the field absent, the calculator would return
  `INDETERMINATE`, and the district would be told it was missing a figure it had in fact
  supplied, hiding an attempted assertion behind a data-quality message.
- The check happens at projection because that is the last point at which a fact still knows
  where it came from. Past that line the bag is flat.
- `origin` is inside the snapshot content hash. Outside it, a sealed snapshot could be edited
  to relabel a district's figure as a platform determination and `verifySnapshot` would still
  return true.

## Consequences

**An unregistered field defaults to what a district may assert**, which is right for ordinary
data and wrong for a determination — and the danger is asymmetric. Forgetting to register an
expenditure figure costs nothing; forgetting to register a prior-year compliance status leaves
a hole exactly where the attack is. The default stays permissive because the alternative makes
every ordinary field ceremony, and `packages/calculators/src/fact-origin.test.ts` carries the
weight instead: every input any implemented calculator declares must have an explicit answer,
as a registry entry or as a line in a district-may-assert list. A new platform-owned input that
nobody classifies fails the build.

**Somebody has to decide, per field, in prose.** The registry stores a `why` for each entry and
a test requires it to be substantive. That is deliberate friction: the answer for a field like
`federal_funds_excluded` — yes, the district may assert it, because it is exactly the
district's attestation and nobody else can make it — is not obvious from the name, and a
reviewer asking "should a district be able to state this?" needs the reasoning rather than a
boolean.

**Some legitimate data is now harder to record.** An SEA prohibition on the 34 CFR 300.205
adjustment cannot arrive in a district export even when the district has the document,
because an LEA that could state one could also suppress one. That is the correct trade and it
means the SEA-facing path has to exist before those fields can be populated at all.

**Origin does not say what kind of source is behind the fact.** That is a separate axis and it
was wrong for a year; see ADR 0009.

## What would reverse this

Nothing reverses recording the origin. What could change is the shape of the registry: if the
number of platform-owned fields grows past what a hand-maintained list can hold, the
declaration belongs on the calculator's own input specification, where the field is defined,
rather than in a central table. The signal is a registry that reviewers stop reading.
