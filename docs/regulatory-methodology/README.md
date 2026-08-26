# Regulatory methodology

Every conclusion this platform reaches has to be explainable to someone who did not write
the code: a district finance director, a state monitor, an auditor, an attorney. This
directory holds that explanation, one document per requirement area.

A methodology document is written **before** the calculator it describes, and it is what
the golden test corpus is derived from.

## Required sections

**Authority.** Citation, link, and one sentence on what the provision requires.

Quote the regulation verbatim **only from a source with a retrieval record** — one whose
official text has been fetched, hashed and archived (see
[ADR 0006](../adrs/0006-a-rule-may-not-go-live-on-an-unverified-citation.md)). Otherwise
paraphrase, and say that you are paraphrasing.

This rule exists because it was broken. The first round of specifications were written with
no access to eCFR, and several of them opened with an explicit assurance that nothing was
quoted verbatim and then quoted anyway. The adversarial reviews flagged it on four of six
documents, one noting that _the false assurance is more dangerous than the quotes_ — a
reader who has been told the document paraphrases will trust a quotation mark absolutely.

**What the requirement actually asks.** In plain English, one paragraph, without restating
the citation. The test: could a district finance director read this and recognize their own
situation?

**Inputs.** Every fact required, named exactly as it appears in the rule's `inputs` array,
with the district system it plausibly comes from and what it means. Include the units and
the fiscal period each input belongs to — most errors in fiscal compliance are period
alignment errors, not arithmetic errors.

**Method.** The calculation or test, step by step, in the order a person would do it by
hand. Where the regulation names alternative methods, all of them, with the rule that
selects between them.

**Boundary cases named in the regulation.** Exceptions, adjustments, thresholds, and what
the regulation says happens exactly at a threshold rather than above or below it.

A boundary is a legal conclusion, not a detail. Whether a test is `>=` or `>` decides real
cases — an LEA that budgeted exactly what it spent passes under one reading and fails under
the other. If the comparative has not been confirmed against retrieved text, it belongs in
the open questions, however obvious it seems.

**What makes this INDETERMINATE.** Which missing inputs make the question unanswerable. Be
specific: a missing child count is not the same as a missing expenditure category, and they
produce different explanations for the user.

**Where the calculator refuses.** Every branch that returns `MANUAL_REVIEW` rather than an
answer, and the question a reviewer must resolve to remove it. See
[ADR 0007](../adrs/0007-a-calculator-refuses-rather-than-guesses.md).

**What this does NOT conclude.** The limits of the check. A platform that quietly implies
more assurance than it delivers is worse than one that says plainly where its coverage ends.

**Worked example.** Real arithmetic on synthetic numbers, showing the intermediate values,
matching the golden test corpus exactly. Never use a real district's figures.

**Open questions for legal review.** Everything a reviewing attorney must confirm. Be
generous. A question listed here costs a review; a question resolved silently costs a wrong
compliance finding for a school district.

## Rules

- Where sources disagree — federal guidance against state guidance, or two readings of the
  same section — document the conflict rather than picking one silently. Say which reading
  the platform implements and why.
- Cite the regulation as it read on a date, and record that date. Regulations are amended.
- No worked example uses real district data, real student records, or real dollar figures
  from an actual LEA.
- A specification that resolves an ambiguity must say so in the open questions. Resolving
  one in the method section and omitting it from the questions is how a platform
  interpretation becomes indistinguishable from the law.

## Current state of the corpus

Six statutory calculators were specified, and each specification was independently reviewed
by an adversarial pass that recomputed every golden case by hand and checked the algorithm
against its cited provision.

**All six came back needing revision.** That consistency is the finding. The reviews did not
turn up arithmetic slips; they turned up places where a specification resolved a genuine
ambiguity by picking, and where the pick was invisible in the output — a well-formed result
with a citation, a provenance chain and a reproducible hash, and the wrong answer.

| Calculator                    | Verdict        | Representative blocking finding                                                                                                         |
| ----------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `idea_moe_eligibility_v1`     | revised, built | The 300.205 ceiling was consumed across claims in array order, making the result depend on input ordering                               |
| `idea_moe_compliance_v1`      | revised, built | A per-capita carve-out for the 300.204(b) exception with no textual basis, driving a CRITICAL finding and a repayment demand            |
| `idea_excess_cost_v1`         | needs-revision | A zero children-used count produced an automatic PASS, and an unhandled branch reached a division by zero                               |
| `idea_proportionate_share_v1` | needs-revision | One count date used for two different counts from two different sources, on opposite sides of the ratio                                 |
| `idea_cceis_v1`               | needs-revision | One of two grammatical readings of 300.226(a) implemented without the other being named; missing population data became an overall PASS |
| `risk_ratio_v1`               | needs-revision | A strictly-greater-than boundary asserted as settled law rather than left open                                                          |

The two maintenance-of-effort calculators have since been respecified against those findings
and implemented: [`idea-moe.md`](idea-moe.md) is the revised methodology, and the corpora at
`packages/calculators/golden/` carry 47 cases between them. The ceiling is now apportioned
pro rata rather than consumed in list order; the enrollment carve-out is not decided but
evaluated under every live reading and refused where they disagree. Revision is not clearance:
both remain at `DRAFT` behind the source gate, and the open questions in that document still
have to be answered by someone competent to answer them.

Recurring across the set, and worth watching for in any future specification:

1. **Verbatim quotation from an unretrieved source**, under an explicit assurance that
   nothing was quoted. Four of six.
2. **A zero denominator or a zero requirement producing a PASS.** A requirement of nothing
   is not a requirement satisfied.
3. **Boundary comparatives asserted rather than questioned.**
4. **Order-dependent apportionment**, which breaks reproducibility outright.
5. **An ambiguity resolved in the method and absent from the open questions.**

None of these calculators may leave `DRAFT`, the two implemented ones included. Doing so
requires, in order: retrieving and hashing the cited sources; resolving each open question with
a reviewer competent to do so; and the domain and legal approvals that §35 requires. The
refusal branches themselves are claims about what the law leaves open, and a reviewer may well
collapse several of them back into ordinary PASS/FAIL logic.

Two controls exist so that "held at DRAFT" is a property of the system rather than a note in a
document. `checkRuleSources` refuses to let a rule citing an unverified source reach `STAGED`,
`SHADOW` or `ACTIVE`, and it runs in CI. And an assessment run reports `official: false` unless
every rule it evaluated was `ACTIVE`, so a result produced during authoring cannot be presented
to a district or an SEA as a finding.
