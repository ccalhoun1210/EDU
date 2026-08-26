# IDEA Part B — the excess cost requirement

Rule: `IDEA-EXCESS-COST-001` · Calculator: `idea_excess_cost_v1` · Pack: `US-FED-IDEA-B-2026`

## Read this first

**No regulatory text was retrieved when this document was written.** eCFR is unreachable from
the authoring environment (ADR 0006), so every statement below about what the regulation
requires is an **unverified paraphrase**, including the ones that read like restatements.
Nothing here is quoted. Where this document says the regulation "requires" something, read it
as "the author believes the regulation requires"; the open questions at the end are where that
belief has to be checked against the text.

That warning is not boilerplate. The first round of specifications on this platform opened with
exactly this assurance and then quoted anyway, on four of six documents. One reviewer noted that
_the false assurance is more dangerous than the quotes_, because a reader told the document
paraphrases will trust a quotation mark absolutely. There are no quotation marks around
regulatory language anywhere in this file.

**This specification is a revision.** An earlier one was reviewed adversarially and came back
`needs-revision` with two blocking findings, recorded in
[`README.md`](README.md): a zero children-with-disabilities count produced an automatic PASS,
and an unhandled branch reached a division by zero. Both are addressed below — see
[What makes this INDETERMINATE](#what-makes-this-indeterminate) and
[Where the calculator refuses](#where-the-calculator-refuses) — and neither is addressed by
patching the arithmetic. A requirement of nothing is not a requirement satisfied, and that is a
statement about the law, not about a guard clause.

## What the requirement actually asks

A district gets a Part B subgrant. The money is for the **extra** cost of educating children
with disabilities — not for the baseline cost of educating them, which the district was already
obliged to bear out of the same funds it educates every other child from.

So before a district may charge anything to Part B, it must first have spent, on each child
with a disability, at least what it spends on an average child at that level. Part B pays for
what is left over.

The regulation makes that concrete by computing a threshold. Take everything the district
spent on elementary students last year from every source, strip out the money that is already
earmarked (Part B itself, the named ESEA programs, and the State and local money spent on
children with disabilities), strip out capital outlay and debt service, divide by how many
elementary students it had, and you get the average annual per-student expenditure. Multiply
that by the number of elementary children with disabilities and you have the minimum the
district must spend on them from other sources before Part B funds may be used.

Then do the whole thing again, separately, for secondary. The regulation is explicit that the
two are computed apart and may not be combined — a district cannot average a cheap elementary
programme against an expensive secondary one to clear a threshold at either level.

A district finance director should recognise this as: _what did we spend per head last year,
not counting the categorical money, and have we put at least that much of our own money behind
each child with a disability before billing IDEA?_

## Authorities

| Provision                     | What it does here                                                                                                                                                                     | Confidence                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 34 CFR 300.202(b)             | Requires Part B amounts to be expended for excess costs, and states that excess costs are computed after the deductions below                                                         | High on the substance, medium on the paragraph structure                         |
| 34 CFR 300.16                 | Defines excess costs against the average annual per-student expenditure in the LEA **during the preceding school year**, elementary or secondary as appropriate, after the deductions | High on the definition, medium on the exact deduction list                       |
| Appendix A to 34 CFR part 300 | The worked computation the definition points at: total expenditures, five deductions, divide by enrolment, multiply by the count of children with disabilities                        | Medium — the structure is recalled with confidence, the specimen figures are not |
| 20 U.S.C. 1401(8)             | The statutory definition the regulation implements                                                                                                                                    | Medium                                                                           |
| 20 U.S.C. 1413(a)(2)(A)       | The LEA eligibility condition the requirement sits under                                                                                                                              | Medium                                                                           |

Every one of these is an **unverified source** in the registry. `checkRuleSources` therefore
holds `IDEA-EXCESS-COST-001` at `DRAFT`, and it cannot reach a stage at which it would evaluate
a district's data until the text has been fetched, hashed and archived.

## Input dictionary

Every input is **per level**. The regulation computes elementary and secondary separately, so
the inputs are separate too rather than one set with a level parameter — a single mis-set
parameter would otherwise silently compute the wrong level's threshold with a full provenance
chain behind it.

`ELEMENTARY` and `SECONDARY` below stand for the two prefixes: each row exists twice, as
`elementary_*` and `secondary_*`.

### The preceding-year expenditure base

| Input                                 | Type  | Meaning                                                                                                                                                                                                |
| ------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LEVEL_total_expenditures`            | money | Everything the LEA spent on students at this level in the **preceding** school year, from every source — local, State and Federal, Part B included. Before any deduction.                              |
| `LEVEL_capital_outlay`                | money | Capital outlay at this level, excluded by the definition. A separate input from debt service because districts account for them separately and a combined figure hides which one is missing.           |
| `LEVEL_debt_service`                  | money | Debt service at this level, excluded on the same basis.                                                                                                                                                |
| `LEVEL_part_b_expenditures`           | money | Part B funds actually **expended** at this level in the preceding year. Expended, not received or allocated — see OQ-2.                                                                                |
| `LEVEL_esea_title_i_a_expenditures`   | money | ESEA Title I Part A funds expended at this level.                                                                                                                                                      |
| `LEVEL_esea_title_iii_expenditures`   | money | ESEA Title III Parts A and B funds expended at this level, combined. Combined because the regulation names them together and no step distinguishes them.                                               |
| `LEVEL_state_local_sped_expenditures` | money | State and local funds expended at this level on children with disabilities.                                                                                                                            |
| `LEVEL_state_local_esea_expenditures` | money | State and local funds expended at this level on programmes that would qualify for assistance under the ESEA parts named above. Distinct from the row above and frequently confused with it — see OQ-6. |
| `LEVEL_enrollment_preceding_year`     | count | The number of students enrolled at this level in the preceding year — **all** students, not only those with disabilities. The divisor. Which enrolment figure this is, is OQ-4.                        |

### The current year

| Input                                | Type  | Meaning                                                                                                                                                                               |
| ------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LEVEL_children_with_disabilities`   | count | The number of children with disabilities at this level. The multiplier that turns a per-student average into the LEA's minimum obligation.                                            |
| `LEVEL_non_part_b_spend_on_children` | money | What the LEA actually spent on children with disabilities at this level from sources other than Part B. The figure the threshold is tested against — see OQ-1, which is load-bearing. |

### Scope and attestations

| Input                         | Type    | Meaning                                                                                                                                                                 |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serves_elementary`           | boolean | Whether the LEA operates elementary schools at all. Declared, never inferred from an absent figure — see [Where the calculator refuses](#where-the-calculator-refuses). |
| `serves_secondary`            | boolean | Whether the LEA operates secondary schools at all.                                                                                                                      |
| `preceding_fiscal_year_start` | date    | First day of the year the expenditure base belongs to. Recorded so a reader can check the period alignment that most fiscal errors turn on.                             |
| `current_fiscal_year_start`   | date    | First day of the year under test.                                                                                                                                       |

Nothing here rises above `CONFIDENTIAL`, and no input is a student identifier: every count is
an aggregate. IDEA Fiscal operates with no student PII and this calculator does not change that.

## Method — the algorithm in order

Elementary and secondary run the same eight steps independently. Neither level's result may
influence the other's arithmetic; only the roll-up at the end sees both.

### 1. Does the level apply?

If `serves_LEVEL` is false, the level is `NOT_APPLICABLE` and no step below runs.

If `serves_LEVEL` is **absent**, the level is `INDETERMINATE`. It is not inferred from the
absence of expenditure figures. An LEA that operates secondary schools and failed to export
their expenditures looks identical, at the fact-bag level, to one that operates none — and
guessing wrong in the permissive direction excuses a level from a requirement that binds it.
That is the same reasoning as the applicability guard in the engine (invariant 9).

### 2. Strip capital outlay and debt service

```
adjusted_total = total_expenditures − capital_outlay − debt_service
```

Excluded by the definition itself rather than by the deduction list, and taken first because
the deductions in step 3 are described as coming off a base that already excludes them.

### 3. Subtract the five earmarked amounts

```
deductions = part_b_expenditures
           + esea_title_i_a_expenditures
           + esea_title_iii_expenditures
           + state_local_sped_expenditures
           + state_local_esea_expenditures

net_base = adjusted_total − deductions
```

All five are amounts **expended**, not amounts received or allocated. A district that drew down
a grant and did not spend it has not spent it, and the base is about spending. Whether the
regulation means expended everywhere it could mean received is OQ-2.

### 4. Refuse a negative or zero base

If `net_base` is negative, the deductions exceed the adjusted total. That is not a district
with unusually heavy categorical funding; it is a mapping error or a double count, and the
average per-student expenditure that would follow is meaningless. `MANUAL_REVIEW`, with a
blocking warning naming the two figures.

If `net_base` is exactly zero, the same. A per-student average of zero produces a minimum
obligation of zero, and every district then clears it — recurring failure pattern 2 in the
methodology README, and the shape of the first blocking finding against the earlier
specification.

### 5. Refuse a zero divisor

If `enrollment_preceding_year` is zero while `net_base` is positive, there is no average to
compute and the level is `MANUAL_REVIEW`. This is the division by zero the earlier
specification reached, and it is a refusal rather than a guarded default because a district
that spent money at a level where it enrolled nobody has an accounting problem the platform
cannot resolve.

If enrolment is absent, the level is `INDETERMINATE` and the input is named.

### 6. The average annual per-student expenditure

```
average_per_student = net_base ÷ enrollment_preceding_year
```

Carried at six decimal places. It is an intermediate, not a displayed conclusion, and rounding
it to cents before step 7 would move the threshold by up to half a cent times the number of
children with disabilities — a real number at district scale.

### 7. The minimum the LEA must spend

```
minimum_required = average_per_student × children_with_disabilities
```

Rounded to cents **once**, here, because this is the figure a district is measured against and
a threshold has to be a definite amount of money.

### 8. Compare, but not when the threshold is vacuous

If `children_with_disabilities` is zero, `minimum_required` is zero and any spend clears it.
The calculator reports `NOT_APPLICABLE` for the level with a warning naming the count, and
**never PASS**. A district serving no children with disabilities at a level has not satisfied
the excess cost requirement there; the requirement had nothing to attach to. Reporting PASS
would put a satisfied-looking finding, with a citation, against a question nobody asked — and
it was the first blocking finding against the earlier specification.

Otherwise:

```
margin = non_part_b_spend_on_children − minimum_required
```

`margin ≥ 0` is `PASS`; `margin < 0` is `FAIL` with `shortfall = −margin`. The comparative is
`≥` on the reading that spending exactly the average satisfies "at least the average", and
that reading is **not confirmed** — see OQ-8.

### Roll-up across the two levels

FAIL-dominant, and unanswered outranks satisfied:

1. Either level `FAIL` → **`FAIL`**.
2. Else either level `MANUAL_REVIEW` → **`MANUAL_REVIEW`**.
3. Else either level `INDETERMINATE` → **`INDETERMINATE`**.
4. Else either level `PASS` → **`PASS`**.
5. Else both `NOT_APPLICABLE` → **`NOT_APPLICABLE`**.

This is the opposite of the maintenance-of-effort roll-up, and deliberately so. MOE is
PASS-dominant because the statute offers four alternative methods and satisfying any one
satisfies the standard. Here the two levels are not alternatives — they are two separate
obligations, and the regulation forbids combining them. Failing at secondary is failing.

An implementation must not reuse either the MOE roll-up or `rollUpStatus()` from
`packages/domain`: the first is wrong in direction, the second is the cross-rule precedence for
combining different rules on one subject.

## Rounding and precision

| Quantity                                               | Places | Why                                                                                                  |
| ------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------- |
| Every money input, and every sum or difference of them | 2      | Money. Exact decimal throughout; no float touches any of it (invariant 5).                           |
| `average_per_student`                                  | 6      | An intermediate quotient. Rounding to cents here moves the threshold by up to half a cent per child. |
| `minimum_required`                                     | 2      | The figure a district is measured against. Rounded once, here.                                       |
| `margin`, `shortfall`                                  | 2      | Money.                                                                                               |
| Counts                                                 | 0      | Whole children.                                                                                      |

## What makes this INDETERMINATE

Per level, and the level is named in every case:

| Absent                                                   | Result                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `serves_LEVEL`                                           | `INDETERMINATE`. Never inferred — see step 1.                                                                                   |
| `total_expenditures`, `capital_outlay` or `debt_service` | `INDETERMINATE`. An absent exclusion is not zero: a district with no capital outlay says zero.                                  |
| Any of the five deduction inputs                         | `INDETERMINATE`. Treating an absent deduction as zero inflates the base, the average, and the threshold — against the district. |
| `enrollment_preceding_year`                              | `INDETERMINATE`. Distinct from an enrolment of zero, which is a refusal (step 5).                                               |
| `children_with_disabilities`                             | `INDETERMINATE`. Distinct from a count of zero, which is `NOT_APPLICABLE` (step 8).                                             |
| `non_part_b_spend_on_children`                           | `INDETERMINATE`, **even when the threshold computed cleanly**. The threshold is not the finding; the comparison is.             |

The distinction between absent and zero runs through the whole table and is the single thing
most likely to produce a wrong finding here. Zero is a district's statement; absent is the
platform's ignorance. They are different facts and they produce different statuses.

## Where the calculator refuses

Every refusal is `MANUAL_REVIEW` with a BLOCKING warning naming the provision and the question.

| Code                                  | When                                                                             | What a reviewer must resolve                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXCESS_COST_BASE_NOT_POSITIVE`       | `net_base` ≤ 0 after the deductions                                              | Whether the district's expenditure mapping double-counts a categorical source. Never a PASS.                                                         |
| `EXCESS_COST_NO_ENROLLMENT`           | Enrolment is zero at a level with positive net expenditure                       | The accounting question of spending at a level with no students.                                                                                     |
| `EXCESS_COST_DEDUCTION_EXCEEDS`       | A single deduction alone exceeds the adjusted total                              | Same as the first, isolated to one line so the export can be corrected.                                                                              |
| `EXCESS_COST_PERIOD_MISALIGNED`       | `preceding_fiscal_year_start` is not the year before `current_fiscal_year_start` | Whether the base year is the one the regulation means. Period alignment, not arithmetic — see OQ-3.                                                  |
| `EXCESS_COST_BEFORE_EFFECTIVE_WINDOW` | The year under test begins before this rule version's effective date             | Which text governed then. MANUAL_REVIEW and never NOT_APPLICABLE: the requirement bound the LEA, and it is this calculator that does not reach back. |

`NOT_APPLICABLE` is reserved for the two cases where the requirement genuinely has nothing to
attach to: a level the LEA does not operate, and a level with no children with disabilities.
Neither is a PASS and neither carries a margin. The second carries
`EXCESS_COST_NO_CHILDREN_AT_LEVEL` as a warning rather than a refusal — the arithmetic ran and
produced a threshold; what it did not produce is an obligation.

## What this does NOT conclude

- **It does not verify that Part B funds were spent on excess costs.** It checks that the
  threshold was cleared. Whether what the district charged to Part B beyond it was in fact the
  excess cost of special education and related services is a programmatic question this
  calculator does not reach.
- **It does not audit the expenditure figures.** Every amount is the district's own statement.
  The provenance chain records which cell each came from; it does not make them true.
- **It does not apply any State-imposed requirement.** A State may set a stricter test. That
  belongs in a State pack layered over this federal baseline, with its own authority.
- **It says nothing about children aged 3–5 or 18–21** outside elementary or secondary school.
  Whether the requirement reaches them is OQ-7, and unresolved means unaddressed.
- **It does not compute a repayment.** Unlike maintenance of effort, no consequence is modelled
  here, because what follows a failure is OQ-9.

## Worked example

Synthetic. Northfield Consolidated is invented and no figure below comes from a real LEA.
These are the numbers in `packages/calculators/golden/idea_excess_cost_v1.yaml`, case
`elementary-clears-the-threshold-while-secondary-falls-short`.

**Elementary.**

```
Total expenditures, all sources, preceding year          6,500,000.00
  less capital outlay                                      300,000.00
  less debt service                                        100,000.00
Adjusted total                                           6,100,000.00

  less Part B expended                                     200,000.00
  less ESEA Title I Part A expended                        250,000.00
  less ESEA Title III Parts A and B expended                50,000.00
  less State and local funds for children with disabilities  500,000.00
  less State and local funds for qualifying ESEA programmes  150,000.00
Total deducted                                           1,150,000.00
Net base                                                 4,950,000.00

Average per student = 4,950,000.00 ÷ 900              =    5,500.000000
Minimum required    = 5,500.000000 × 100              =  550,000.00

Actual non-Part-B spend on those children                  562,000.00
Margin = 562,000.00 − 550,000.00                      =     12,000.00   -> PASS
```

**Secondary.**

```
Total expenditures, all sources, preceding year          4,800,000.00
  less capital outlay                                      200,000.00
  less debt service                                         50,000.00
Adjusted total                                           4,550,000.00

  less Part B expended                                     150,000.00
  less ESEA Title I Part A expended                        120,000.00
  less ESEA Title III Parts A and B expended                30,000.00
  less State and local funds for children with disabilities  400,000.00
  less State and local funds for qualifying ESEA programmes   50,000.00
Total deducted                                             750,000.00
Net base                                                 3,800,000.00

Average per student = 3,800,000.00 ÷ 500              =    7,600.000000
Minimum required    = 7,600.000000 × 60               =  456,000.00

Actual non-Part-B spend on those children                  431,000.00
Margin = 431,000.00 − 456,000.00                      =    −25,000.00   -> FAIL
Shortfall                                                   25,000.00
```

**Roll-up.** Elementary PASS, secondary FAIL → **FAIL**. The levels are separate obligations
and the regulation forbids averaging one against the other, which is precisely what a
PASS-dominant roll-up would do here.

## Open questions for legal review

Nine, and the first is the one that decides whether this calculator is measuring the right
thing at all. Every one of them is a place this document resolved an ambiguity by picking, and
the pick is recorded here so a platform interpretation cannot be mistaken for the law.

1. **What is the LEA actually measured against?** Appendix A computes a minimum amount. It does
   not, as recalled, state the compliance test — whether the district must show aggregate
   non-Part-B spending at or above `average × count`, or must show it **per child**, or whether
   the threshold governs only the point at which Part B may begin to be charged rather than a
   testable floor. This specification implements the aggregate reading and takes
   `non_part_b_spend_on_children` as a single figure per level. If the per-child reading is
   right, the input contract is wrong and a district that averaged across children could pass a
   test it should fail. **Outcome-determinative.**
2. **Expended or received?** §300.16 as recalled says amounts _received_ under the named
   programmes, while Appendix A's worked steps read as amounts _expended_. They differ whenever
   a district carries funds over. This specification uses expended throughout, on the reading
   that the base is a spending figure and the deductions must be commensurate. If received is
   right, every deduction input is misdefined.
3. **Which year is "the preceding school year"?** School year and fiscal year are not the same
   period, and the current-year inputs (`children_with_disabilities`,
   `non_part_b_spend_on_children`) are on a different footing from the base-year ones. The
   platform records both dates and refuses a misalignment rather than resolving it, but what
   correct alignment _is_ has not been established.
4. **Which enrolment figure is the divisor?** Average daily membership, average daily
   attendance, a single-day child count, or an end-of-year figure all differ materially, and
   the term as recalled — the average number of students enrolled — does not settle it. The
   divisor moves the threshold proportionally.
5. **Are the deductions level-specific?** Appendix A's example is written for elementary. Where
   a district's categorical spending is not split by level in its ledger, apportioning it is a
   decision the regulation may or may not authorise. This specification requires level-split
   inputs and offers no apportionment.
6. **Do deductions (d) and (e) overlap?** State and local funds for children with disabilities,
   and State and local funds for programmes that would qualify under the named ESEA parts, are
   listed separately. A district running a Title I-qualifying programme that serves children
   with disabilities could plausibly report the same dollars under both, deducting them twice
   and lowering its own threshold. Whether the regulation intends them disjoint is unresolved;
   the calculator cannot detect the double count from the figures alone.
7. **Does the requirement reach ages 3–5 and 18–21?** There is, as recalled, a provision about
   using Part B funds for children at ages where no State or local funds are available for
   children without disabilities. Whether that carves those children out of this computation, or
   changes the counts, is not addressed here at all.
8. **Is the comparative `≥` or `>`?** A district that spent exactly the average passes under one
   reading and fails under the other. Recurring failure pattern 3: this specification asserts
   `≥` and the assertion is not confirmed.
9. **What follows a failure?** Maintenance of effort carries a repayment obligation with a
   named cap. Nothing comparable is modelled here because nothing comparable is known. Until it
   is, a FAIL on this rule states a fact and implies no consequence, and the rule's
   `severityOnFailure` of `HIGH` rather than `CRITICAL` reflects that.

## Before this calculator is wired in

In order, and none of it is optional:

1. Retrieve, hash and archive 34 CFR 300.16, 300.202(b) and Appendix A to part 300, so the
   source registry carries a retrieval record and `checkRuleSources` stops holding the rule at
   `DRAFT` on that ground.
2. Resolve every open question above with a reviewer competent to resolve it. Question 1 first:
   until it is answered, the corpus is pinning the behaviour of a test that may not be the test
   the regulation sets.
3. Obtain the domain and legal review §35 requires.

Revision is not clearance. This document exists so the questions are visible, not so they are
closed.
