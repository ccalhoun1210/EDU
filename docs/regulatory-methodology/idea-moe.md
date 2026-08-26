# IDEA Part B maintenance of effort — LEA eligibility and compliance

Calculators: `idea_moe_eligibility_v1`, `idea_moe_compliance_v1`
Rules: `IDEA-MOE-ELIGIBILITY-001`, `IDEA-MOE-COMPLIANCE-001` (pack `US-FED-IDEA-B-2026`)
Golden corpora: `packages/calculators/golden/idea_moe_eligibility_v1.yaml`,
`packages/calculators/golden/idea_moe_compliance_v1.yaml`

## Read this first

**No regulatory text was retrieved while this document was written.** eCFR is unreachable
from the authoring environment; the egress policy refuses the request. That is recorded in
`docs/adrs/0006-a-rule-may-not-go-live-on-an-unverified-citation.md`, and it is why both
rules are held at **DRAFT** and may not reach `STAGED` — the stage at which a rule first
touches real district data — until the sources are fetched, hashed and archived.

Consequences a reader must carry through the whole document:

- Every statement here about what a provision requires is an **unverified paraphrase from
  working knowledge**. It is not a quotation, and no passage in this document is marked as
  quotation, in quotation marks or in italics, by design. If you need the operative
  language, retrieve it from the primary source. Do not take it from here.
- The **paragraph lettering** — `300.203(a)(1)(i)`–`(iv)`, the `(c)(1)`/`(c)(2)` split,
  the `(a)`–`(e)` lettering in `300.204`, and which paragraph of `300.205` carries the
  State prohibition — is recalled, not checked.
- The **effective date** used by both calculators is the rule's declared
  `effective.start`. Whether the rule's window or the pack's window governs is open
  question **OQ-25**, and no case in either corpus pins the exact boundary date for that
  reason.

The design principle for both calculators follows from that: **be right where the
regulation is unambiguous, and refuse to answer where it is not**, naming the provision and
the open question so a reviewing attorney knows what to resolve. A refusal is
`MANUAL_REVIEW` with a `BLOCKING` warning. It is never a guess dressed as a status.

## What the requirement asks

An LEA that receives IDEA Part B subgrant funds must keep spending its own money on the
education of children with disabilities at the level it spent before. There are two tests
and they are not the same test.

**Eligibility, 34 CFR 300.203(a).** Before the year runs: has the LEA _budgeted_ at least
what it _spent_ in the most recent year for which it has final figures? Answered on
budgeted amounts, against actuals, prospectively. Failing it means the LEA is not eligible
for its subgrant until it fixes the budget.

**Compliance, 34 CFR 300.203(b).** After the year closes: did the LEA in fact _spend_ at
least what it spent the year before? Answered on actuals against actuals. Failing it means
money goes back to the Department, so the finding severity is CRITICAL.

Both tests offer the same four measures, and satisfying **any one** of them satisfies the
test:

| Method key                   | Measure                                               |
| ---------------------------- | ----------------------------------------------------- |
| `LOCAL_ONLY`                 | Local funds only, total dollars                       |
| `STATE_AND_LOCAL`            | State and local funds combined, total dollars         |
| `LOCAL_PER_CAPITA`           | Local funds only, dollars per child with a disability |
| `STATE_AND_LOCAL_PER_CAPITA` | State and local funds combined, per child             |

Both are subject to the exceptions at 34 CFR 300.204 and the adjustment at 34 CFR 300.205,
and both are governed by the subsequent-years rule at 34 CFR 300.203(c): after a year in
which the LEA failed, the level required of it is what would have been required absent the
failure, not the reduced level it actually reached. A failure does not ratchet the bar down.

## Authorities

| Citation             | What it does here                                                                                                                                                           | Confidence                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 34 CFR 300.203(a)    | The eligibility (budget) standard and its four methods                                                                                                                      | High on substance, medium on subparagraph lettering                                |
| 34 CFR 300.203(a)(2) | Permits anticipating 300.204 and 300.205 amounts when setting the budget                                                                                                    | High on substance                                                                  |
| 34 CFR 300.203(a)(3) | Excludes federally accountable expenditures from the determination                                                                                                          | High that the exclusion exists; medium that it reaches the compliance test — OQ-20 |
| 34 CFR 300.203(b)    | The compliance (actual expenditure) standard and its four methods                                                                                                           | High on substance and on the four methods                                          |
| 34 CFR 300.203(c)    | Subsequent years — no ratchet-down after a failure; a transition clause for the years beginning July 1 2013 and July 1 2014                                                 | High on the no-ratchet substance, medium on the paragraph split and the dates      |
| 34 CFR 300.203(d)    | Repayment of non-Federal funds on a compliance failure, capped at the LEA's subgrant                                                                                        | Medium-high; the cap's location in the section is uncertain                        |
| 34 CFR 300.204       | Five exceptions permitting a reduction to the extent attributable to the ground                                                                                             | High on the five grounds, medium on the lettering                                  |
| 34 CFR 300.205       | Adjustment of not more than half the section 611 allocation increase; ESEA-use condition; SEA prohibition; coordinated early intervening services consume the same headroom | High on the fifty-percent rule and the section 611 base, medium on lettering       |
| 34 CFR 300.226       | The coordinated early intervening services reservation that interlocks with 300.205                                                                                         | Medium-high                                                                        |
| 34 CFR 300.704(c)    | The State high cost fund whose assumption of cost is a 300.204 ground                                                                                                       | Medium-high                                                                        |
| 20 U.S.C. 1413(a)(2) | The statutory condition the regulations implement; no arithmetic derives from it                                                                                            | Medium-high                                                                        |

Sub-regulatory guidance — the 2015 final-rule preamble and OSEP's questions and answers on
maintenance of effort — is the source of several positions below and **was not available**.
Every place a position rests on it is flagged inline and restated in the open questions.

## Input dictionary

Naming rules, applying to both calculators: canonical `snake_case`; money is a plain decimal
string with two fractional digits and never a number; counts are non-negative integers;
dates are `YYYY-MM-DD` calendar dates and, for fiscal years, the first day of the year.
IDEA Fiscal is a no-student-PII module: every count is an aggregate and no exception entry
may carry a student name, student identifier, staff name or date of birth. Identifying
material stays in the evidence document behind a reference.

Both rules' `inputs` arrays must be extended to the full list below before either
calculator is wired in. An input the rule does not declare has no provenance chain, and
`CalculationStep.inputsUsed` cannot name it (invariant 3).

### Shared by both calculators

| Input                                   | Type    | Definition                                                                                                                                                                                                                                                      |
| --------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `current_fiscal_year_start`             | date    | First day of the fiscal year under test.                                                                                                                                                                                                                        |
| `federal_funds_excluded`                | boolean | Attestation carried from the ingest transformation that no expenditure from federal funds the LEA or SEA must account for federally is included in any amount. `false` is a known-bad input, not a gap.                                                         |
| `comparison_fiscal_year_start`          | date    | First day of the fiscal year the comparison amounts belong to. Selected by the pipeline, validated here.                                                                                                                                                        |
| `comparison_basis`                      | enum    | `ACTUAL_EXPENDITURE` or `REQUIRED_LEVEL_AFTER_FAILURE`. Declares which pair of comparison amounts is operative.                                                                                                                                                 |
| `moe_status_source_run_id`              | string  | The finalized `idea_moe_compliance_v1` run, or the SEA determination of record, that establishes the declared prior-year status. Required whenever that status is `MET` or `NOT_MET`, so the subsequent-years branch does not dead-end at an unattributed enum. |
| `comparison_actual_local`               | money   | Comparison-year actual expenditure, local funds only. Operative when the basis is `ACTUAL_EXPENDITURE`.                                                                                                                                                         |
| `comparison_actual_state_local`         | money   | Same, State and local combined.                                                                                                                                                                                                                                 |
| `comparison_child_count`                | count   | Children with disabilities in the comparison year. Pairs with the actual amounts.                                                                                                                                                                               |
| `comparison_required_level_local`       | money   | The local-funds level that would have been required absent a prior failure. Operative when the basis is `REQUIRED_LEVEL_AFTER_FAILURE`. **A distinct input from `comparison_actual_local`** — see OQ-3.                                                         |
| `comparison_required_level_state_local` | money   | Same, State and local combined.                                                                                                                                                                                                                                 |
| `comparison_required_level_child_count` | count   | The child count declared to pair with the carried-forward required level. A distinct input because which fiscal year's count belongs with a reconstructed level is unresolved — OQ-4.                                                                           |
| `claimed_exceptions`                    | list    | 34 CFR 300.204 claims. Element shape below.                                                                                                                                                                                                                     |
| `claimed_adjustments_300_205`           | list    | 34 CFR 300.205 claims, at most one per `source`. Element: `{ source, amount }`. A duplicate `source` is a validation failure.                                                                                                                                   |
| `part_b_611_allocation_current`         | money   | Section 611 allocation for the year under test. Needed only to validate a 300.205 claim.                                                                                                                                                                        |
| `part_b_611_allocation_prior`           | money   | Section 611 allocation for the preceding year.                                                                                                                                                                                                                  |
| `ceis_amount_300_226`                   | money   | Coordinated early intervening services amount under 34 CFR 300.226 — reserved, in the eligibility test; expended, in the compliance test. Consumes the 300.205 ceiling.                                                                                         |
| `sea_prohibition_300_205_ground`        | enum    | `NONE`, `FAPE_CAPACITY_DETERMINATION`, or `ENFORCEMENT_ACTION_UNDER_SECTION_616`. An enumerated ground rather than a bare boolean, so a prohibition is a determination of record.                                                                               |
| `sea_prohibition_300_205_evidence_ref`  | string  | Evidence for that determination. Required when the ground is not `NONE`.                                                                                                                                                                                        |
| `esea_use_condition_attested`           | boolean | Whether the LEA has shown it used an equal amount of local funds on ESEA-supportable activities. Absent makes a 300.205 claim unvalidatable; `false` disallows it.                                                                                              |

### `idea_moe_eligibility_v1` only

| Input                                     | Type  | Definition                                                                                    |
| ----------------------------------------- | ----- | --------------------------------------------------------------------------------------------- |
| `most_recent_available_fiscal_year_start` | date  | First day of the most recent fiscal year for which the LEA has final expenditure information. |
| `most_recent_available_year_moe_status`   | enum  | `MET`, `NOT_MET` or `UNKNOWN` — the compliance outcome for that year.                         |
| `current_budget_local`                    | money | Amount budgeted from local funds only for the budget year.                                    |
| `current_budget_state_local`              | money | Amount budgeted from State and local funds combined.                                          |
| `current_child_count`                     | count | Children with disabilities projected or officially adopted for the budget year.               |

### `idea_moe_compliance_v1` only

| Input                         | Type  | Definition                                                                                                                                                                               |
| ----------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `current_fiscal_year_end`     | date  | Last day of the closed fiscal year under test.                                                                                                                                           |
| `lea_part_b_subgrant_amount`  | money | The LEA's Part B subgrant for the year. Used only for the 300.203(d) cap.                                                                                                                |
| `current_actual_local`        | money | Actual expenditure for the year, local funds only.                                                                                                                                       |
| `current_actual_state_local`  | money | Same, State and local combined.                                                                                                                                                          |
| `current_child_count`         | count | Children with disabilities served in the year under test.                                                                                                                                |
| `comparison_year_moe_status`  | enum  | `MET`, `NOT_MET` or `UNKNOWN` for the comparison year.                                                                                                                                   |
| `comparison_year_methods_met` | list  | The methods under which the LEA met the standard in the comparison year. Empty is legal and meaningful. Used only to detect where the two readings of 300.203(c) can diverge — see OQ-9. |

### `claimed_exceptions[]` element

| Field                      | Type                   | Notes                                                                                                                                                                                                     |
| -------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ground`                   | enum                   | Exactly one of the five codes below. **Any other value is a validation failure**, never a silently accepted or silently discarded claim.                                                                  |
| `source`                   | enum                   | `LOCAL` or `STATE_AND_LOCAL`. One entry per measure the LEA claims against; the calculator never infers one from the other, because the two measures have different denominators of eligible expenditure. |
| `amount`                   | money                  | Non-negative.                                                                                                                                                                                             |
| `basis_description`        | string                 | Narrative for the explanation panel. Never used in arithmetic.                                                                                                                                            |
| `event_fiscal_year_start`  | date                   | The fiscal year the underlying event occurred in, so a downstream rule can detect the same event claimed against successive years — OQ-16.                                                                |
| `evidence_ref`             | string, optional       | Absence does not reject the claim; it marks it unverified.                                                                                                                                                |
| `timing`                   | enum, eligibility only | `TAKEN_INTERVENING` or `EXPECTED_BUDGET_YEAR`. 300.203(a)(2) permits anticipating a reduction; the compliance test does not, so the field does not exist there.                                           |
| `personnel_departure_type` | enum                   | Required if and only if the ground is `VOLUNTARY_DEPARTURE_OF_PERSONNEL`: `VOLUNTARY`, `RETIREMENT` or `JUST_CAUSE`.                                                                                      |
| `child_departure_reason`   | enum                   | Required if and only if the ground is `TERMINATION_OF_EXCEPTIONALLY_COSTLY_PROGRAM`: `LEFT_JURISDICTION`, `AGED_OUT_OF_FAPE_OBLIGATION` or `NO_LONGER_NEEDS_PROGRAM`.                                     |
| `sea_determination_ref`    | string                 | Required if and only if the ground is `TERMINATION_OF_EXCEPTIONALLY_COSTLY_PROGRAM`, because that ground is conditioned on an SEA determination.                                                          |

The five permitted grounds, and only these five:

| `ground`                                               | Authority         |
| ------------------------------------------------------ | ----------------- |
| `VOLUNTARY_DEPARTURE_OF_PERSONNEL`                     | 34 CFR 300.204(a) |
| `DECREASE_IN_ENROLLMENT_OF_CHILDREN_WITH_DISABILITIES` | 34 CFR 300.204(b) |
| `TERMINATION_OF_EXCEPTIONALLY_COSTLY_PROGRAM`          | 34 CFR 300.204(c) |
| `TERMINATION_OF_LONG_TERM_PURCHASE`                    | 34 CFR 300.204(d) |
| `HIGH_COST_FUND_ASSUMPTION`                            | 34 CFR 300.204(e) |

## Method — the algorithm in order

Both calculators run the same shape. Where they differ it is named.

### 1. Validate before anything else

Collect every validation problem; do not stop at the first, so a district is told once what
it owes rather than three times in three runs. Any of the following returns `MANUAL_REVIEW`
with `methodStatus` set to `MANUAL_REVIEW` for all four methods and `qualifyingMethods`
empty:

- a `claimed_exceptions` entry whose `ground` is not one of the five enumerated codes
  (`UNRECOGNISED_EXCEPTION_GROUND`);
- a ground-specific field absent or outside its enum — the personnel departure type, the
  child departure reason, or the SEA determination reference
  (`EXCEPTION_GROUND_CONDITION_NOT_SUPPLIED`);
- a negative money value or a malformed decimal string;
- a duplicate `source` in `claimed_adjustments_300_205`;
- an SEA prohibition ground other than `NONE` with no evidence reference;
- compliance only: `current_actual_state_local` below `current_actual_local`, or the same
  inversion in the comparison amounts, since the combined measure contains the local one.

Validation runs **first**, before the applicability gates, so a gate can never suppress a
problem the reviewer needed to see.

### 2. Effective window

`current_fiscal_year_start` earlier than the rule's declared `effective.start` returns
`MANUAL_REVIEW` with `OUTSIDE_RULE_EFFECTIVE_WINDOW`. Calendar-date comparison on the
strings; no timezone conversion and no timestamp round-trip (invariant 6).

Not `NOT_APPLICABLE`. `NOT_APPLICABLE` is conclusive in `packages/domain/src/evaluation.ts`
and reads to a district and an SEA as _the requirement did not apply to you_. That is false:
the requirement applied under the earlier text. What does not apply is this calculator
version. See OQ-25 on which effective window governs.

### 3. Federal-funds gate

`federal_funds_excluded` absent returns `INDETERMINATE` naming it. `false` returns
`MANUAL_REVIEW` with `FEDERAL_FUNDS_NOT_EXCLUDED`: the amounts arrived, on the wrong basis,
and no arithmetic on them measures the thing the regulation names.

### 4. Subgrant gate — compliance only

`lea_part_b_subgrant_amount` equal to zero **as a decimal** returns `MANUAL_REVIEW` with
`NO_PART_B_SUBGRANT_FOR_THE_YEAR`. The comparison is a decimal comparison, never a string
comparison: `"0"`, `"0.00"` and `"0.000"` are one fact and must not produce three statuses.
Whether such an LEA is outside the compliance standard is OQ-15; `NOT_APPLICABLE` would
answer it.

Absent is different from zero and is handled at step 10.

### 5. Comparison-basis consistency

The calculator **validates** the selection; it does not perform it. Selecting the comparison
year and reconstructing a required level after a failure means reading finalized prior runs,
which a pure calculator may not do. All of the following return `MANUAL_REVIEW`:

| Condition                                                                                | Warning                              |
| ---------------------------------------------------------------------------------------- | ------------------------------------ |
| Prior-year status is `UNKNOWN`                                                           | `COMPARISON_YEAR_MOE_STATUS_UNKNOWN` |
| `comparison_fiscal_year_start` not earlier than `current_fiscal_year_start`              | `COMPARISON_YEAR_NOT_PRIOR`          |
| Status `MET` but the basis is not `ACTUAL_EXPENDITURE`                                   | `COMPARISON_BASIS_INCONSISTENT`      |
| Status `NOT_MET` but the basis is not `REQUIRED_LEVEL_AFTER_FAILURE`                     | `COMPARISON_BASIS_INCONSISTENT`      |
| Eligibility, status `MET`, and the comparison year is not the most recent available year | `COMPARISON_BASIS_INCONSISTENT`      |
| Compliance, status `MET`, and `comparison_year_methods_met` is empty                     | `COMPARISON_BASIS_INCONSISTENT`      |
| Compliance, status `NOT_MET`, and `comparison_year_methods_met` is non-empty             | `COMPARISON_BASIS_INCONSISTENT`      |

A `NOT_MET` year may itself be the comparison year: the required level carried forward may
belong to the failure year. The eligibility algorithm therefore accepts
`comparison_fiscal_year_start` equal to `most_recent_available_fiscal_year_start` on the
`REQUIRED_LEVEL_AFTER_FAILURE` branch, which the draft specification forbade — see OQ-3.

The comparison amounts are then selected by basis: `ACTUAL_EXPENDITURE` reads the
`comparison_actual_*` pair with `comparison_child_count`; `REQUIRED_LEVEL_AFTER_FAILURE`
reads the `comparison_required_level_*` pair with `comparison_required_level_child_count`.
Both pairs may be supplied; only the declared one enters the arithmetic. The other is still
emitted in the step list, so a reviewer can see the figure that was _not_ used.

### 6. The 300.205 ceiling — order-independent by construction

With no `claimed_adjustments_300_205` entries the allowed adjustment is zero and no ceiling
is computed. Otherwise, in order:

1. SEA prohibition ground other than `NONE` — allowed total is `0.00`, warning
   `ADJUSTMENT_300_205_PROHIBITED_BY_SEA`.
2. `esea_use_condition_attested` is `false` — allowed total is `0.00`, warning
   `ADJUSTMENT_300_205_ESEA_CONDITION_NOT_MET`.
3. `esea_use_condition_attested` absent, or either section 611 allocation absent — the
   claims are **unvalidatable**: allowed at `0.00` and marked set aside, warning
   `ADJUSTMENT_300_205_UNVALIDATABLE`. See step 10 for how a set-aside resolves.
4. Otherwise:

```
allocation_increase = max(0, part_b_611_allocation_current - part_b_611_allocation_prior)
half_increase       = allocation_increase x 0.5, rounded TOWARD ZERO at the cent
ceiling             = max(0, half_increase - ceis_amount_300_226)
claimed_total       = sum of entry.amount
if claimed_total <= ceiling:  every entry allowed in full
else:                         allowed(i) = floor_2dp(entry.amount x ceiling / claimed_total)
                              then distribute ceiling - sum(allowed) one cent at a time,
                              LOCAL before STATE_AND_LOCAL
                              warning ADJUSTMENT_300_205_CAPPED
```

The apportionment is a function of the claims and their `source`, never of their position in
the array. Consuming the ceiling in list order — the draft algorithm — made the result a
function of how an upstream ingest happened to order a logically unordered list, which
defeats reproducibility of a finalized run outright (invariant 4). Because at most one entry
per source is permitted, the canonical order for the residual cent is fully determined.
`exception-300-205-claim-order-does-not-change-the-result` in the eligibility corpus is the
same claims reversed, asserting identical output.

### 7. Reduction totals, and the refusal at the comparison amount

```
reduction_local        = sum of 300.204 amounts with source LOCAL
                       + allowed 300.205 amount with source LOCAL
reduction_state_local  = the same for STATE_AND_LOCAL
```

**If `reduction_local` is greater than or equal to the operative comparison local amount, or
`reduction_state_local` greater than or equal to the operative comparison State-and-local
amount, the whole run returns `MANUAL_REVIEW`** with
`REDUCTION_NOT_LESS_THAN_COMPARISON_AMOUNT`.

The same test catches a second, different problem: a comparison amount of zero with no
reduction claimed against it. The required level is zero either way and the refusal is the
same, but the warning is `ZERO_COMPARISON_AMOUNT`, because naming a claimed reduction to a
reviewer who is looking at an empty claim list sends them hunting for something that is not
there.

This is the one place the calculator refuses on arithmetic alone rather than on an
interpretive gap. Clamping the required level to zero — the draft behaviour — makes any
non-negative amount a PASS on a test with a repayment attached, so a single bad ingest
mapping produces a clean result on the most consequential requirement in the module. A
required level of zero is never a PASS.

The refusal is whole-run rather than per-source, for two reasons. A claim that consumes an
entire measure puts the whole submission in question. And a `BLOCKING` warning may not
accompany a PASS under the calculator contract, so a per-source refusal that still allowed
another method to carry a PASS would have to downgrade its own warning to hide the problem.

### 8. Required levels and the total-amount methods

```
required_local        = comparison_local        - reduction_local
required_state_local  = comparison_state_local  - reduction_state_local
```

Both are strictly positive, guaranteed by step 7. No clamp is needed and none is applied.

```
LOCAL_ONLY       passes iff current_local       >= required_local
STATE_AND_LOCAL  passes iff current_state_local >= required_state_local
```

**The test is greater-than-or-equal.** An LEA that budgets or spends to the penny what it
spent before has budgeted at least that amount and has reduced nothing. Implementing a
strict inequality would fail a district for doing exactly what the regulation asks. This is
the single most consequential boundary decision in either calculator and it is listed as
OQ-1 because the operative comparative has not been read.

`margin` is `current - required`, exact, at two places. `shortfall` is `max(0, -margin)`.

### 9. The per-capita methods

**Decided without dividing.** Division produces a repeating decimal for most child counts,
and truncating it can flip a near-boundary result. Both counts are non-negative integers, so
cross-multiplication preserves the inequality exactly. The quotients are computed too, but
only for display in the step list; they are never the operands of a comparison. Writing
`C` for the current amount, `n` for the current child count, `T` for the comparison amount,
`Nc` for the comparison child count and `R` for the reduction against that source:

```
Reading A - the reduction is a current-year event spread over current-year children
    C/n >= T/Nc - R/n     <=>     (C + R) x Nc >= T x n

Reading B - the reduction comes off the comparison-year numerator
    C/n >= (T - R)/Nc     <=>     C x Nc >= (T - R) x n
```

The two readings coincide exactly when `R` is zero or when `n` equals `Nc`. Where they
diverge they diverge in the direction that matters: under falling enrollment reading A sets
the lower bar. Which one the regulation requires is unresolved (OQ-5), so:

> **The method is evaluated under every live reading. If they agree, that is the method's
> status. If they disagree, the method is `MANUAL_REVIEW` with
> `PER_CAPITA_REDUCTION_BASIS_DISPUTED`.**

A third reading enters whenever a `DECREASE_IN_ENROLLMENT_OF_CHILDREN_WITH_DISABILITIES`
claim applies to the source: the claim admitted, and the claim excluded from the per-capita
method on the ground that the denominator already normalises for enrollment. Excluding it is
a platform interpretation with no textual hook and it runs against the LEA; admitting it may
credit one enrollment decline twice. That is OQ-6, and it is resolved the same way — the
method is evaluated under both treatments, and a disagreement is
`ENROLLMENT_EXCEPTION_PER_CAPITA_DISPUTED`.

**Zero denominators.** A per-capita method whose current or comparison child count is zero is
`NOT_APPLICABLE` for that method, with `ZERO_CURRENT_CHILD_COUNT` or
`ZERO_COMPARISON_CHILD_COUNT`. A zero denominator is not a zero requirement, and treating it
as one manufactures a PASS.

**Per-capita dollar shortfall — compliance only.** Where a per-capita method fails,
`shortfallByMethod` reports the dollars by which the LEA fell short in current-year terms,
`(RHS - LHS) / Nc` computed from the exact cross-products and rounded once at the end. It is
never computed by subtracting two already-rounded per-child values. Where the live readings
FAIL at different magnitudes the entry is `null` with `SHORTFALL_AMOUNT_DISPUTED`; the
status is unaffected, because all live readings agreed it was a failure.

### 10. Roll-up

Evaluated in this order, and this order only:

1. Any method `PASS` → **`PASS`**. One qualifying method satisfies the standard, and missing
   data or an unresolved question on another method cannot unmake it.
2. Else any method `MANUAL_REVIEW` → **`MANUAL_REVIEW`**.
3. Else any method `INDETERMINATE` → **`INDETERMINATE`**.
4. Else at least one `FAIL` and every other method `FAIL` or `NOT_APPLICABLE` → **`FAIL`**.
5. Else, every method `NOT_APPLICABLE` → **`INDETERMINATE`** with `NO_METHOD_COMPUTABLE`.

Rule 4 is why two failing methods and two unanswerable methods is `INDETERMINATE`, never
`FAIL`. On the compliance side that is invariant 9 in its sharpest form: the platform will
not tell a district it owes a repayment on the strength of a calculation it could not
complete.

This roll-up is PASS-dominant and is **internal to the calculator**. It implements the
statutory disjunction between the four methods. It is not the platform's cross-rule
precedence: `rollUpStatus()` in `packages/domain/src/evaluation.ts` is FAIL-dominant and
INDETERMINATE-over-PASS, which remains correct for combining different rules on one subject.
An implementation must not reuse `rollUpStatus()` here.

**Set-aside resolution.** A 300.205 claim set aside at step 6 was allowed at zero, which is
the conservative direction — it can only raise the bar. So the evaluation already ran
without it. If the method passes anyway, the absent allocation could not have changed the
answer and the method is `PASS`. If it fails, the method is `INDETERMINATE` with the absent
allocation names in `missingInputs`. The same logic governs an absent
`lea_part_b_subgrant_amount` on the compliance side: a `PASS` stands, a `FAIL` becomes
`INDETERMINATE` with `REPAYMENT_CANNOT_BE_BOUNDED`, because the finding is the failure and
its consequence together and the platform does not publish half of it.

**The determination the next year reads.** On the compliance side the roll-up is also an
answer to the question the _following_ year asks: did this LEA maintain effort? The next
year's run consumes that as `comparison_year_moe_status`, whose vocabulary is
`MET | NOT_MET | UNKNOWN` and not `PASS | FAIL | …`. So the calculator states it in that
vocabulary itself, as `output.moeStatus`: `PASS` → `MET`, `FAIL` → `NOT_MET`, everything else
→ `UNKNOWN`.

`UNKNOWN` is deliberate and is a value rather than a gap — the eligibility calculator handles
it explicitly and routes the run to review with a named remedy. Mapping an unanswered question
to `NOT_MET` would invent a failure and, through 300.203(c), a bar the LEA never earned;
mapping it to `MET` would invent compliance. The eligibility calculator emits no `moeStatus` at
all: it tests a _budget_ for the year ahead, which is a projection, and 300.203(c) carries
forward a determination about a year that has closed.

Stating it here is what makes the carry-forward mechanical rather than editorial. The value a
later year reads is taken from the finalized result by
`carryForward` (`packages/assurance/src/carry-forward.ts`), which stamps that result's own
evaluation hash onto the fact, so a prior-year status can be checked against the run that
produced it instead of trusted. Before this, translating `PASS` into `MET` happened wherever
somebody carried a value across — by hand, and unverifiably.

### 11. Consequence — compliance only

On `FAIL`, the calculator reports `shortfallByMethod` for all four methods,
`smallestShortfall`, `largestShortfall`, and

```
repaymentExposureBounds = { low:  min(smallestShortfall, lea_part_b_subgrant_amount),
                            high: min(largestShortfall,  lea_part_b_subgrant_amount) }
```

with `REPAYMENT_METHOD_SELECTION_UNRESOLVED` at `WARNING` severity. It does **not** report a
single repayment figure. Which method's shortfall fixes the amount is OQ-12, the amount is
what a district actually pays, and the draft's minimum-across-methods rule is both unverified
and not commensurable — a per-capita dollar shortfall is a synthetic quantity, not an amount
by which the LEA reduced expenditure, and under falling enrollment it is systematically the
smallest. Where the subgrant cap binds at both ends the range collapses and the exposure can
be stated without waiting on counsel, which the corpus pins.

`repaymentExposureBounds` is `null` on every status other than `FAIL` — not zero, which would
assert that a liability was computed and came out at nothing.

### 12. Forward-looking and evidentiary signals — never a status

Neither calculator returns `RISK`, and neither invents a threshold. The statute sets no de
minimis band, and a platform that invents one substitutes its judgment for the statutory
test. A district-defined early-warning band belongs in a local rule pack layered over this
federal baseline, not in a federal calculator.

Where a forward-looking or evidentiary signal is useful it is a named output field that the
UI labels as a platform figure:

| Output                                          | Calculator  | Meaning                                                                                                                                                          |
| ----------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectedShortfallByMethod`                    | eligibility | The shortfall each method would show if every reduction with `timing = EXPECTED_BUDGET_YEAR` failed to materialise. `0.00` where the method would still qualify. |
| `qualifiesOnlyOnExpectedReductions`             | eligibility | True where every qualifying method depends on anticipated reductions.                                                                                            |
| `shortfallIfUnverifiedClaimsDisallowedByMethod` | compliance  | The shortfall each method would show if every claim lacking an evidence reference were disallowed.                                                               |
| `qualifyingMethodsDependOnUnverifiedClaims`     | compliance  | True where removing **all** unverified reductions at once flips every qualifying method to FAIL.                                                                 |
| `dataGapsObserved`                              | both        | Absent inputs the evaluation touched but the result did not depend on.                                                                                           |

The dependence test is deliberately computed over the **set** of unverified claims, not one
claim at a time. Two unevidenced claims of 60,000.00 and 55,000.00 against a margin of
65,000.00 are individually immaterial and jointly decisive; testing them one at a time
reports a clean result on a year that passes only because both were accepted. The compliance
corpus pins exactly that arithmetic.

`missingInputs` carries only inputs the result depended on, matching the calculator
contract, and `dataGapsObserved` carries the rest. Conflating them would tell a district to
supply a figure that could not have changed its answer, and would make the two genuinely
different situations indistinguishable.

## Rounding and precision

**The regulation prescribes no rounding rule anywhere in this calculation.** No precision for
per-capita amounts, no direction, no tolerance. Everything below other than the 300.205
ceiling is a platform presentation decision, and full precision is carried into every
decision so that the choice cannot affect an outcome.

| Quantity                                                                                 | Rule                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every money value crossing a boundary                                                    | Plain decimal string, exactly two places. Never a float; `parseFloat` is banned by ESLint (invariant 5).                                                                                                                                                                                                                                               |
| Allocation increase, reduction totals, required levels, margins, total-method shortfalls | Exact. Sums and differences of two-place values are two-place. No rounding at all.                                                                                                                                                                                                                                                                     |
| Half the section 611 allocation increase                                                 | Rounded **toward zero** at the cent. This is the only directional rounding in either calculator and it is deliberate: the ceiling is a statutory maximum, and rounding a maximum up would authorise a reduction the regulation does not.                                                                                                               |
| Pro-rata apportionment of the ceiling                                                    | Each share floored at the cent, then the residual — at most one cent, since at most two claims exist — assigned to the `LOCAL` claim. The total allowed never exceeds the ceiling.                                                                                                                                                                     |
| Per-capita quotients                                                                     | Computed at full working precision, reported at **six decimal places, half away from zero**, unit `USD_PER_CHILD`. Display only.                                                                                                                                                                                                                       |
| Per-capita comparisons                                                                   | **Exact.** Cross-multiplied integers and two-place decimals. No quotient is ever an operand of a comparison.                                                                                                                                                                                                                                           |
| Per-capita margins and shortfalls, in dollars                                            | Computed from the exact cross-products and rounded once, at the end, to two places. Never by subtracting two already-rounded values. A magnitude that is genuinely non-zero but rounds to nothing is floored at one cent: a measure that failed must not report a shortfall of `0.00`, least of all on the calculator whose output bounds a repayment. |
| Per-capita margins and shortfalls, per child                                             | The same cross-products, rounded once to six places. Eligibility only, under `marginPerChildByMethod` and `projectedShortfallPerChildByMethod`.                                                                                                                                                                                                        |
| A rounded zero                                                                           | Emitted unsigned. A true margin of `-0.0000097` rounds to `0.000000`, not `-0.000000`: a signed zero does not survive a round trip through `NUMERIC` or through two decimal serialisers, and a finalized run must reproduce byte for byte. The sign lives in the method's status, which is authoritative.                                              |

`PER_CHILD_DP` in `packages/calculators/src/types.ts` fixes `USD_PER_CHILD` at six places, and
`formatAmount` emits a rounded-away zero unsigned so `-0.000000` cannot reach a hash or a
screen. `moe-findings.test.ts` asserts every step value matches the precision its declared unit
prescribes.

**Displayed values must not be re-derived from.** Two per-child levels that differ in the
seventh decimal place round to the same string. The UI must present each method's status
beside its margin and must never invite a reader to infer the status from the displayed sign.

## What makes a result INDETERMINATE

Missing means absent, empty or null. Present-but-invalid is a validation failure and a
`MANUAL_REVIEW`, which is a different thing and must not be collapsed into `INDETERMINATE`.

| Absent input                                                                             | Effect                                                                                                                                                           |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `current_fiscal_year_start`                                                              | Whole run `INDETERMINATE`; applicability cannot be established.                                                                                                  |
| `federal_funds_excluded`                                                                 | Whole run `INDETERMINATE`.                                                                                                                                       |
| `comparison_fiscal_year_start`, `comparison_basis`, or the prior-year status enum        | Whole run `INDETERMINATE`; the comparison basis is undeclared.                                                                                                   |
| The operative comparison local amount                                                    | `LOCAL_ONLY` and `LOCAL_PER_CAPITA` `INDETERMINATE`.                                                                                                             |
| The operative comparison State-and-local amount                                          | `STATE_AND_LOCAL` and `STATE_AND_LOCAL_PER_CAPITA` `INDETERMINATE`.                                                                                              |
| The current local or State-and-local amount                                              | The two methods on that source `INDETERMINATE`.                                                                                                                  |
| The operative comparison child count                                                     | Both per-capita methods `INDETERMINATE`. The total methods are unaffected.                                                                                       |
| `current_child_count`                                                                    | Both per-capita methods `INDETERMINATE`.                                                                                                                         |
| `claimed_exceptions` or `claimed_adjustments_300_205`                                    | Treated as empty. An LEA claiming nothing has given a complete answer, and the unreduced level is the conservative direction.                                    |
| A section 611 allocation, or `esea_use_condition_attested`, with a 300.205 claim present | The claim is set aside; step 10's resolution decides between `PASS` and `INDETERMINATE`.                                                                         |
| A section 611 allocation with no 300.205 claim                                           | No effect. Not required.                                                                                                                                         |
| `ceis_amount_300_226` with a 300.205 claim present                                       | The claim is set aside. It is **not** defaulted to zero: a zero default enlarges the ceiling, which runs in the LEA's favour on a figure nobody supplied. OQ-10. |
| An exception's `evidence_ref`                                                            | Not missing data. Marks the claim unverified.                                                                                                                    |
| `lea_part_b_subgrant_amount` (compliance)                                                | A `PASS` stands. A `FAIL` becomes `INDETERMINATE` with `REPAYMENT_CANNOT_BE_BOUNDED`.                                                                            |
| `moe_status_source_run_id` while the status is `MET` or `NOT_MET`                        | Whole run `INDETERMINATE`; the subsequent-years premise has no provenance.                                                                                       |

A status enum whose value is `UNKNOWN` is **not** a missing input — the field was supplied.
It is a `MANUAL_REVIEW` whose warning names the remedy: a finalized `idea_moe_compliance_v1`
run for that fiscal year, or an SEA determination of record.

## Every refusal branch, and why it refuses

| Warning code                                | Trigger                                                                                                                                                             | Why not an answer                                                                                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNRECOGNISED_EXCEPTION_GROUND`             | A `claimed_exceptions` entry naming a ground outside the enumerated five                                                                                            | Admitting it lets the platform reduce a required level on a basis the regulation does not recognise; discarding it silently reports a status while the district believes it is relying on the claim.                      |
| `EXCEPTION_GROUND_CONDITION_NOT_SUPPLIED`   | A ground-specific field absent — in particular the SEA determination that a program was exceptionally costly                                                        | The ground is conditioned on the determination. Without it the claim is not the thing the provision describes.                                                                                                            |
| `REDUCTION_NOT_LESS_THAN_COMPARISON_AMOUNT` | Reductions against a source at or above that source's comparison amount                                                                                             | A required level of zero makes any non-negative amount a PASS on a test with a repayment attached.                                                                                                                        |
| `FEDERAL_FUNDS_NOT_EXCLUDED`                | The attestation is present and false                                                                                                                                | The amounts are not on the statutory basis; no arithmetic on them measures the requirement.                                                                                                                               |
| `OUTSIDE_RULE_EFFECTIVE_WINDOW`             | Fiscal year earlier than the implemented text                                                                                                                       | The requirement applied under the prior text. `NOT_APPLICABLE` would report an exemption that does not exist.                                                                                                             |
| `COMPARISON_YEAR_MOE_STATUS_UNKNOWN`        | Prior-year status supplied as `UNKNOWN`                                                                                                                             | Without knowing whether the prior year failed, the comparison basis is undetermined and no comparison is meaningful.                                                                                                      |
| `COMPARISON_YEAR_NOT_PRIOR`                 | Comparison year not earlier than the year under test                                                                                                                | A year cannot be its own comparison year.                                                                                                                                                                                 |
| `COMPARISON_BASIS_INCONSISTENT`             | The declared basis contradicts the declared prior-year status                                                                                                       | The most likely cause is an ingest-mapping error; the next most likely is an LEA measuring against its own reduced level. Both need a person.                                                                             |
| `COMPARISON_BASIS_READING_DISPUTED`         | Compliance: the comparison year was met under some but not all methods, and the two readings of the subsequent-years rule give a method different comparison levels | OQ-9. The difference decides whether a repayment is owed.                                                                                                                                                                 |
| `PER_CAPITA_REDUCTION_BASIS_DISPUTED`       | The two readings of how a reduction enters a per-capita method disagree on that method's status                                                                     | OQ-5.                                                                                                                                                                                                                     |
| `ENROLLMENT_EXCEPTION_PER_CAPITA_DISPUTED`  | Admitting and excluding a 300.204(b) claim from a per-capita method disagree on that method's status                                                                | OQ-6. The exclusion is a platform invention that runs against the LEA; admitting it may double-count.                                                                                                                     |
| `ZERO_COMPARISON_AMOUNT`                    | The same branch as the row above, reached with no reduction claimed: the comparison-year amount for a measure is itself zero                                        | The required level is zero, so any figure clears it. Either that measure genuinely had no expenditure — in which case maintenance of effort is not the question to ask of it — or the figure did not survive the mapping. |
| `NO_PART_B_SUBGRANT_FOR_THE_YEAR`           | Compliance: the subgrant is decimal-zero                                                                                                                            | OQ-15. `NOT_APPLICABLE` would answer it, and the year's levels still set the next year's bar.                                                                                                                             |

Non-refusing warnings, all at `WARNING` or `INFO` severity and all compatible with a
conclusive status: `ADJUSTMENT_300_205_CAPPED`, `ADJUSTMENT_300_205_PROHIBITED_BY_SEA`,
`ADJUSTMENT_300_205_ESEA_CONDITION_NOT_MET`, `ADJUSTMENT_300_205_UNVALIDATABLE`,
`ZERO_CURRENT_CHILD_COUNT`, `ZERO_COMPARISON_CHILD_COUNT`, `NO_METHOD_COMPUTABLE`,
`REPAYMENT_METHOD_SELECTION_UNRESOLVED`, `REPAYMENT_CANNOT_BE_BOUNDED`,
`SHORTFALL_AMOUNT_DISPUTED`, `QUALIFICATION_DEPENDS_ON_UNVERIFIED_CLAIMS`.

A `BLOCKING` warning accompanies `MANUAL_REVIEW` and never a `PASS`, per the calculator
contract. That constraint is why every refusal above is whole-run or produces a method status
that cannot be counted as qualifying.

## Severity, and why the two rules differ

`IDEA-MOE-COMPLIANCE-001` fails at `CRITICAL`. `IDEA-MOE-ELIGIBILITY-001` fails at `HIGH`.

Both carried `CRITICAL` until the adversarial review pointed out that the whole design rests on
the two consequences being different, and that this was the one place the distinction was not
reflected. A compliance failure means non-Federal funds go back to the Department: the money
has already been spent, or not spent, and the year is closed. An eligibility failure means the
LEA is not eligible for its subgrant until it fixes the budget — serious, but prospective and
recoverable by an act the LEA can still take.

Grading them identically would tell a district facing a fixable budget problem that it is in
the same position as one facing a repayment demand, and would make a severity-sorted worklist
useless for triage. The severity is a platform judgement about consequence, not a reading of
the regulation, and OQ-26 asks a reviewer to confirm what an eligibility failure actually
obliges before either rule leaves DRAFT.

## What these calculators do NOT conclude

- Whether a claimed 34 CFR 300.204 exception is **factually supported**. The calculator
  reads amounts and grounds and applies the arithmetic ceilings the regulation imposes. It
  does not test whether personnel departed, whether a program was exceptionally costly, or
  whether the claimed amount is attributable to the ground.
- Whether the same underlying event has been **claimed against successive years**. The
  calculator is pure and holds no cross-year state. `event_fiscal_year_start` and
  `evidence_ref` exist so a downstream rule or the pipeline can detect recycling; that
  assurance lives elsewhere and is not delivered here. OQ-16.
- Whether the **ESEA-use condition** at 300.205 was actually satisfied. The calculator
  consumes an attestation.
- Whether the **fund category definitions** are right — what counts as local funds, whether
  an intermediate-unit levy or a Medicaid reimbursement belongs inside them, whether capital
  is in or out. Period-alignment and category-definition errors dominate real
  maintenance-of-effort findings far more than arithmetic errors do, and none of them is
  visible here. OQ-18, OQ-20.
- Whether the **child count basis** is consistent between years. The calculator trusts the
  caller. OQ-19.
- The **repayment amount** on a compliance failure. It reports a bounded range. OQ-12.
- Anything about a **State overlay**. This is the federal floor. Several States impose a
  stricter standard or prescribe the count date and the fund definitions, and a district in
  such a State must not be shown this result as the complete answer. OQ-24.
- Anything about **LEA reorganisations** — mergers, splits, transfers of schools. The
  comparison figures for a reorganised LEA are not reconstructible here and must route to a
  manual path rather than to an inferred allocation. OQ-23.

## Worked examples

Synthetic figures. No number below comes from a real LEA. Each matches a golden case exactly.

### A. Eligibility, ordinary passing year

`pass-all-four-methods-with-no-reduction-claimed`. Budget year beginning 2027-07-01. The
most recent year with final figures is the year beginning 2025-07-01, in which the LEA met
the standard, so that is the comparison year and the basis is actual expenditure.

| Quantity                   | Comparison year (actual) | Budget year (budgeted) |
| -------------------------- | ------------------------ | ---------------------- |
| Local funds only           | 12,400,000.00            | 12,650,000.00          |
| State and local funds      | 18,900,000.00            | 19,050,000.00          |
| Children with disabilities | 1,024                    | 1,010                  |

```
LOCAL_ONLY        12,650,000.00 - 12,400,000.00 = +250,000.00           PASS
STATE_AND_LOCAL   19,050,000.00 - 18,900,000.00 = +150,000.00           PASS
LOCAL_PER_CAPITA  12,650,000.00 x 1,024 = 12,953,600,000.00
                  12,400,000.00 x 1,010 = 12,524,000,000.00             PASS
STATE_AND_LOCAL_PER_CAPITA
                  19,050,000.00 x 1,024 = 19,507,200,000.00
                  18,900,000.00 x 1,010 = 19,089,000,000.00             PASS
```

Displayed quotients, six places: comparison local per child 12,109.375000; budgeted local per
child 12,524.752475. They appear in the step list and decide nothing.

### B. Eligibility, the year after a failure

`subsequent-year-uses-the-declared-required-level-not-the-failure-year-actual`. Same budget
year. The most recent year with final figures is 2025-26 and the LEA **failed** it, spending
11,700,000.00 from local funds. The declared level that would have been required absent the
failure is 12,400,000.00 local and 18,900,000.00 State and local, with a declared count of
1,031. The LEA budgets 12,000,000.00 and 18,300,000.00 against a projected count of 1,002.

Both figures are supplied and they are different inputs. Against the failure year's actual
the LEA would appear to gain 300,000.00; that comparison is not available to it.

```
LOCAL_ONLY        12,000,000.00 - 12,400,000.00 = -400,000.00           FAIL
STATE_AND_LOCAL   18,300,000.00 - 18,900,000.00 = -600,000.00           FAIL
LOCAL_PER_CAPITA  12,000,000.00 x 1,031 = 12,372,000,000.00
                  12,400,000.00 x 1,002 = 12,424,800,000.00             FAIL
STATE_AND_LOCAL_PER_CAPITA
                  18,300,000.00 x 1,031 = 18,867,300,000.00
                  18,900,000.00 x 1,002 = 18,937,800,000.00             FAIL
```

The whole difference between this and an apparent pass is the comparison basis, which is why
OQ-3 is the most important item in this document.

### C. Compliance, the 300.205 ceiling apportioned across two claims

`exception-300-205-ceiling-applies-to-the-total-and-is-apportioned-pro-rata` in the
eligibility corpus, same arithmetic.

```
allocation increase   1,480,000.00 - 1,180,000.00        =   300,000.00
half, toward zero at the cent                            =   150,000.00
less coordinated early intervening services                 -20,000.00
ceiling                                                  =   130,000.00

claimed  LOCAL 120,000.00 + STATE_AND_LOCAL 80,000.00    =   200,000.00   over the ceiling
allowed  LOCAL            120,000.00 x 130,000 / 200,000 =    78,000.00
         STATE_AND_LOCAL   80,000.00 x 130,000 / 200,000 =    52,000.00
                                                    sum  =   130,000.00
```

Reversing the two claims changes nothing, which the companion case asserts. Consuming the
ceiling in list order would instead have given the first-listed claim its full amount.

### D. Compliance, a refusal that prevents a repayment demand

`manual-review-per-capita-reduction-basis-decides-the-method`. Local expenditure
7,600,000.00 against a comparison of 10,000,000.00, child count falling from 1,000 to 800,
with a 400,000.00 termination-of-long-term-purchase claim.

```
Reading A  (7,600,000.00 + 400,000.00) x 1,000 = 8,000,000,000.00
            10,000,000.00              x   800 = 8,000,000,000.00   equal    PASS
Reading B   7,600,000.00               x 1,000 = 7,600,000,000.00
             9,600,000.00              x   800 = 7,680,000,000.00            FAIL
```

Three methods have already failed. Reading B makes it four and produces a repayment; reading
A makes the year compliant. The calculator refuses the method, so the run is `MANUAL_REVIEW`
and a person sees both computations. That is the whole design in one case: the arithmetic is
exact, the law is not settled, and the platform says so instead of choosing.

## Open questions for legal review

Nothing here is rhetorical. Each item is a place where the implementation had to choose and
the choice is not compelled by the face of the regulation as recalled. Neither rule may leave
DRAFT until each is resolved in writing and the answer is recorded on the rule version. Items
marked **outcome-determinative** change a district's result in at least one golden case.

### On the text itself

1. **Confirm the comparative is inclusive.** Both calculators test greater-than-or-equal, and
   exact equality passes. Two boundary cases in each corpus turn on it, and a strict
   inequality would fail a district for spending precisely what it spent before. This was
   asserted as settled in the draft specifications and belongs here instead.
   **Outcome-determinative.**
2. **Confirm every citation and every paragraph letter against the primary source.** Nothing
   was fetched. Confirm the enumeration of the four methods in `300.203(a)` and `(b)`, the
   content of `(a)(2)` and `(a)(3)`, the `(c)(1)`/`(c)(2)` split, the `(a)`–`(e)` lettering in
   `300.204`, whether the State prohibition sits at `300.205(b)` or `(c)`, and whether the
   repayment cap sits at `300.203(d)`. Record the retrieval date and hash on the rule version.
   Nothing in this document may be used as the source for any of it.

### On the comparison year

3. **Does the subsequent-years rule mean the level that would have been required, or the
   amount actually spent in the last year the LEA met the standard?** These are different
   quantities and the draft specifications conflated them. This document models them as
   distinct inputs and consumes the declared required level, so the calculator cannot
   silently substitute one for the other — but the pipeline that populates
   `comparison_required_level_*` still needs the answer. Related: how far does the chain run
   through consecutive failures, and do exceptions taken during the intervening failure years
   reduce the carried-forward level? **Outcome-determinative.**
4. **Which fiscal year's child count pairs with a carried-forward required level?** The
   reconstructed level belongs to no year's actual count. `comparison_required_level_child_count`
   is a separate declared input for that reason; the answer determines what the pipeline must
   put in it. **Outcome-determinative.**
5. **How does a reduction enter a per-capita method?** Spread over the current year's
   children, or taken off the comparison year's numerator? The readings agree only when the
   counts are equal. The calculator refuses whenever they disagree on a method's status, which
   is safe but means a district with falling enrollment and any claimed reduction may get no
   per-capita answer at all until this is settled. **Outcome-determinative.**
6. **May the enrollment-decrease exception be claimed against a per-capita method?** The
   per-capita denominator already normalises for enrollment, so admitting the exception may
   credit one decline twice; excluding it is a platform interpretation with no textual hook
   and it raises the bar. The calculator refuses where the treatments disagree.
   **Outcome-determinative.**
7. **Does the subsequent-years rule reach the eligibility standard at all?** It is phrased in
   terms of the level of expenditure required, which is the language of the compliance test.
   Both calculators apply it to both tests. If that is wrong, every district that failed gets
   a materially lower eligibility bar. **Outcome-determinative.**
8. **What makes information available** for the purpose of selecting the eligibility
   comparison year — closed books, an audited annual report, a State expenditure report the
   SEA has accepted? The platform accepts the LEA's assertion with no test. Should a
   comparison year more than two years before the budget year be flagged?

9. **Does the subsequent-years rule carry forward per measure, or on the standard as a
   whole?** An LEA that met the standard in the comparison year under the State-and-local
   measures only has, on one reading, simply met it — there was no failure, so nothing is
   carried forward and every measure is tested against that year's actuals. On the other
   reading the rule attaches to each measure, so the two local measures were not met and
   their bar is the level that would have been required then, which nobody supplies. The
   calculator refuses the affected measures rather than choosing, with
   `COMPARISON_BASIS_READING_DISPUTED`, and `comparison_year_methods_met` exists solely to
   detect the divergence. On the compliance side the difference decides whether a district
   owes a repayment. **Outcome-determinative.**

### On the exceptions and the adjustment

10. **Should an absent coordinated-early-intervening-services amount, alongside a 300.205
    claim, set the claim aside rather than default to zero?** This document sets it aside,
    because a zero default enlarges the ceiling in the LEA's favour on a figure nobody
    supplied. Confirm. Also confirm whether comprehensive services required on a significant
    disproportionality identification offset the ceiling the same way voluntary ones do, and
    which year's reservation offsets which year's ceiling.
11. **Is the 300.205 ceiling shared across the local and the State-and-local measures, or is
    there one per measure?** This document applies one shared ceiling apportioned pro rata.
    If the ceiling is per-source, the apportionment is wrong in the LEA's disfavour. Confirm
    also whether the adjustment reaches the State-and-local measures at all, or only local.
12. **Which method's shortfall fixes the repayment on a compliance failure?** The calculator
    reports a range rather than a figure. The candidates are the smallest shortfall across the
    methods, the shortfall under the method the LEA relied on, the shortfall under the method
    used in the comparison year, and the largest. **This is the dollar amount a district
    pays.** Note that a per-capita dollar shortfall is a synthetic quantity and may not be
    commensurable with a total-amount shortfall at all. **Outcome-determinative.**
13. **Is the 50 percent base the section 611 allocation only, or 611 plus 619?** The input
    names say 611. If preschool funds belong in the base, every adjustment case changes.
14. **Is the ESEA-use condition a condition precedent** whose failure invalidates the
    reduction, or an independent obligation with its own remedy? This document disallows the
    claim when the attestation is false and sets it aside when the attestation is absent. If
    it is an independent obligation, both treatments are too strict.
15. **Is an LEA that received no Part B subgrant outside the compliance standard?** The
    calculator refuses rather than answering. Confirm, and confirm the treatment of an LEA
    that received a subgrant but drew none of it, and one whose subgrant was withheld
    mid-year. **Outcome-determinative.**
16. **Is a 300.204 reduction consumed once, or does it persist against successive years?** The
    same personnel departure claimed in three successive years compounds against a baseline
    that may itself trace to one comparison year. The calculator cannot detect it. Confirm
    what the pipeline must enforce, and whether `event_fiscal_year_start` plus an evidence
    reference is enough to detect a repeat.
17. **What is the claimable amount under each ground?** For a personnel departure, the full
    salary and benefits or the net differential after the replacement's cost? For the high
    cost fund, the amount assumed or the LEA's net decrease? Considered and rejected here: a
    rule that a claim may not exceed the observed year-over-year decrease. It is
    arithmetically equivalent to requiring exact equality at the boundary, since a method
    passes precisely when the claim reaches the decrease, so it would forbid every use of the
    exceptions rather than constrain them. Some other proportionality test may be needed and
    this document does not have one.

### On the inputs

18. **Define local funds and State and local funds.** Intermediate-unit and county funds,
    dedicated special education levies, tuition and Medicaid reimbursement, in-kind and
    central-office allocations, capital against operating. Both calculators take the boundary
    as given.
19. **Which child count is the per-capita denominator** — a December 1 count, an October
    count, a State-prescribed date, or an LEA projection for a budget year? The regulation
    does not say and this document does not say. Should a `child_count_basis` enum be required,
    with a mismatch between the two years refused?
20. **Does the federal-funds exclusion govern the compliance test?** It is written into the
    eligibility paragraph. Both calculators apply it to both, on the view that it follows from
    what the fund categories mean. Confirm, and confirm the treatment of Medicaid
    reimbursement and other quasi-federal revenue.
21. **Is a projected budget-year child count admissible at all**, given the comparison side is
    an actual count, and what must the LEA document to support it?

### On status and process

22. **Is an inconsistent comparison-basis declaration a refusal or a failure?** An LEA
    measuring against its own reduced level has arguably not met the standard. This document
    treats it as a data-integrity problem, because the inconsistency is at least as likely to
    be an ingest-mapping error as a district position.
23. **LEA reorganisations.** Out of scope for both `_v1` calculators. Confirm that a merged,
    split or dissolved LEA routes to an explicit manual path and never to an inferred
    allocation of comparison-year figures.
24. **State overlays.** Confirm the overlay mechanism, and confirm what the interface tells a
    district in a State whose standard is stricter than this federal floor.
25. **Rule effective window against pack effective window.** `IDEA-MOE-ELIGIBILITY-001`
    declares `2015-07-01`; pack `US-FED-IDEA-B-2026` declares `2026-07-01`. Which governs
    applicability? No golden case pins the boundary date until this is answered — both
    effective-date cases use a year well before either.
26. **What does an eligibility failure oblige?** Withholding of the subgrant, a budget
    amendment window, a conditional award? The remediation workflow attached to the finding
    depends on the answer.
27. **Is an attached evidence document enough** for the platform to treat a claim as verified,
    or must a human attest? The dependence flag currently keys off the reference alone. If
    attestation is required, an `attested_by_ref` field is needed.
28. **Does the platform report PASS with a non-empty `dataGapsObserved`?** Both calculators
    do, on the ground that an input that could not have changed the answer did not decide
    anything. Confirm that a finding may issue on facts the LEA did not itself assert — the
    set-aside resolution reports PASS where a method clears the _higher_ bar, which is
    conservative but is not the district's own case.

## Before either calculator is wired in

Three of the four items below are done, and each is now held in place by a test rather than
by this list — a checklist nobody re-reads is not a control.

- **Done.** `inputs` on both rule files names every input above. The engine hands a calculator
  `projectInputs(rule.inputs, facts)` and nothing else, so an under-declared array starves the
  calculator and returns INDETERMINATE for every district while every golden case still
  passes. `packages/calculators/src/rule-contract.test.ts` asserts the two agree in both
  directions, and `packages/rules-engine/src/idea-fiscal-e2e.test.ts` runs the real pack
  against the real calculators to catch it dynamically.
- **Done.** `outputSchema` on both rule files matches the emitted object, checked against a
  real run rather than against a list, so a field renamed in the implementation fails the test.
- **Done.** `PER_CHILD_DP` in `packages/calculators/src/types.ts` fixes `USD_PER_CHILD` at six
  places, and `formatAmount` now emits a rounded-away zero unsigned so that `-0.000000` cannot
  reach a hash or a screen.
- **Outstanding, and the one that matters.** Retrieve, hash and archive every source in the
  authorities table, then re-check every paraphrase in this document against it. Both gates
  are required and neither substitutes for the other: retrieval proves the text was obtained,
  domain review proves the rule implements it. Until then both rules stay at `DRAFT` and
  neither may evaluate a district's data.

One further item is now an open question rather than a task, because it is a presentation
decision with no obviously right answer: **the two calculators report per-capita magnitudes in
different units — **resolved, and worth recording because the first fix was wrong.**

`marginByMethod`, `shortfallByMethod` and the counterfactual maps now carry current-year
dollars at two places for all four measures on **both** calculators. Eligibility additionally
emits `marginPerChildByMethod` and `projectedShortfallPerChildByMethod`, per child at six
places, with `null` against the two total-amount measures because a total-amount measure has no
per-child magnitude and dividing one out would invent a quantity the regulation does not
describe. Both come from the same exact cross-products.

The first attempt was a `perCapitaMagnitudeUnit` field naming which unit a result used. It was
rejected on review for two reasons. It never existed — the field was documented here and
implemented nowhere, so the only stated safeguard against the collision was fictitious, which
is a worse failure than the collision. And even built, a label is the wrong shape of fix: a
reader scanning a column of figures does not consult a sibling field first. One key must mean
one unit.
