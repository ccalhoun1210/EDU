# IDEA Part B — LEA Maintenance of Effort

**Rules covered:** `IDEA-MOE-ELIGIBILITY-001`, `IDEA-MOE-COMPLIANCE-001`
**Calculators:** `idea_moe_eligibility_v1`, `idea_moe_compliance_v1`
**Status:** methodology drafted; calculators not implemented; no legal review
**Sources read:** 2026-08-25

---

## 1. Authority

| | |
|---|---|
| Primary | 34 CFR 300.203 — Maintenance of effort |
| Exceptions | 34 CFR 300.204 — Exception to maintenance of effort |
| Adjustment | 34 CFR 300.205 — Adjustment to local fiscal efforts in certain fiscal years |
| Statute | IDEA § 613(a)(2)(A)(iii) |
| Amended | 2015 final rule, effective **July 1, 2015** |
| State overlay | Alabama — **not yet written.** This document is the federal baseline only. |

The operative phrases, quoted from the regulation:

- Eligibility standard, § 300.203(a) — compares against **"the most recent fiscal year for which
  information is available."**
- Compliance standard, § 300.203(b) — Part B funds **"must not be used to reduce the level of
  expenditures for the education of children with disabilities"** below **"the preceding fiscal
  year."**

Both phrases were confirmed across three independent reads (eCFR, Cornell LII, and the
Department's 2020 IDEA fiscal-flexibility Q&A). See §10 for what was *not* confirmed.

---

## 2. What the requirement actually asks

A district that accepts IDEA Part B money agrees not to quietly shift the cost of educating
children with disabilities off its own books and onto the federal grant. Each year it has to
keep spending its own money — state and local, or local alone — at roughly the level it spent
the year before.

There are **two separate tests**, and a district can pass one and fail the other in the same
year:

- **Eligibility** is forward-looking. Before the year starts, does the district's *budget*
  commit enough of its own funds? This is a condition of receiving the subgrant at all.
- **Compliance** is backward-looking. After the year closes, did the district's *actual
  expenditures* hold the line? This is what a monitor tests, and what triggers repayment.

Getting this wrong is expensive in a specific way: under § 300.203(d) the SEA must repay the
shortfall to the Department **in non-federal funds**, and the state recovers it from the
district. The money comes out of local dollars, after the fiscal year has closed, when nothing
can be changed.

---

## 3. The four methods

A district may satisfy either standard by **any one** of four methods. Only one has to pass.

| # | Method | Basis |
|---|---|---|
| 1 | Local funds only | Total |
| 2 | Local funds only | Per capita |
| 3 | State and local funds combined | Total |
| 4 | State and local funds combined | Per capita |

Federal funds are excluded from every method.

"Per capita" means per child with a disability served, so a per-capita method can pass while
the corresponding total method fails when the child count has fallen.

**This is the single most common source of false findings.** A tool that checks only the
state-and-local total — the intuitive one — will report a failure for a district that
comfortably passes on local funds per capita. The platform must evaluate all four, report which
pass, and treat the requirement as satisfied if any one does.

---

## 4. The comparison year, and a conflict worth naming

The regulation and common field practice describe the compliance baseline differently, and the
difference is not cosmetic.

**What the text says.** § 300.203(b) names **the preceding fiscal year**. In the 2015
rulemaking the Department considered and *rejected* a commenter proposal to use the most recent
year in which the LEA met MOE, reasoning that a single consistent comparison year across
methods is simpler for LEAs.

**What practitioners say.** MOE is routinely described in the field as comparing against "the
most recent year in which the district met MOE."

**How both can be true.** § 300.203(c), the subsequent-years rule, provides that after a year in
which an LEA failed to maintain effort, the level required in the following year is *the level
that would have been required in the absence of that failure* — not the reduced amount the LEA
actually spent.

So:

> The comparison **year** is the preceding fiscal year.
> The comparison **level** is the level that was properly required of that year, which is not
> necessarily what was spent in it.

A failed year does not lower the bar. This is why the shorthand usually produces the right
answer, and why it stops producing the right answer after two consecutive failures or a change
of method — cases where the platform must follow the text, not the shorthand.

**Practical consequence.** A district that models next year from what it actually spent, after a
year it failed, digs the hole deeper. The platform must therefore carry the *required* level
forward as a stored fact, not recompute it from expenditures.

---

## 5. Inputs

### Compliance standard (`idea_moe_compliance_v1`)

| Input | Meaning | Likely source | Period |
|---|---|---|---|
| `current_actual_local` | Actual local-only expenditures for children with disabilities | ERP / general ledger, year-end | FY N |
| `current_actual_state_local` | Actual state + local expenditures, same population | ERP / general ledger, year-end | FY N |
| `comparison_actual_local` | Local-only expenditures | ERP, closed year | FY N−1 |
| `comparison_actual_state_local` | State + local expenditures | ERP, closed year | FY N−1 |
| `current_child_count` | Children with disabilities served | SIS / state child-count submission | FY N |
| `comparison_child_count` | Children with disabilities served | SIS / state child-count submission | FY N−1 |
| `claimed_exceptions` | Reductions claimed under § 300.204, itemized by category | District attestation + supporting evidence | FY N |
| `claimed_adjustment` | Reduction taken under § 300.205 | District attestation | FY N |

### Missing from the rule as currently written

The subsequent-years rule in §4 cannot be evaluated from the inputs above. Two more are
required and are **not** in `IDEA-MOE-COMPLIANCE-001.yaml` today:

- `comparison_year_moe_met` — did the LEA meet MOE in FY N−1?
- `comparison_required_level_by_method` — the level that was *required* of FY N−1, per method,
  carried forward from that year's assessment.

The rule YAML must be amended before the calculator is written. Without these, the platform
would silently apply the naive comparison and understate the requirement for any district
recovering from a failed year — exactly the error the subsequent-years rule exists to prevent.

### Units and period alignment

- Money: whole dollars, **decimal arithmetic only**. Never floating point.
- Child counts: integers.
- Fiscal years: LEA fiscal years vary; align by the district's own fiscal calendar, never assume
  July 1–June 30.
- **Period alignment is the dominant error class in fiscal compliance — more so than
  arithmetic.** An expenditure booked to the wrong fiscal year moves both sides of the
  comparison. Every input must carry the fiscal period it belongs to, and the calculator must
  reject a comparison whose two sides are not exactly one period apart.

---

## 6. Method

For the **compliance** standard, for fiscal year N:

1. Establish the comparison level for each method:
   - If the LEA met MOE in FY N−1, the comparison level is FY N−1 actual expenditures for that
     method.
   - If the LEA did **not** meet MOE in FY N−1, the comparison level is the level that was
     required of FY N−1 for that method (§ 300.203(c)).
2. Compute FY N actual expenditures for each method:
   - Methods 1 and 3: the total.
   - Methods 2 and 4: total ÷ child count for that year.
3. Apply any § 300.204 exceptions and any § 300.205 adjustment as permitted reductions to the
   required level.
4. For each method, compare FY N against the comparison level.
5. If **any** method meets or exceeds its comparison level → `PASS`. Report every method's
   margin, not just the winning one.
6. If **no** method meets its level → `FAIL`, with the shortfall for the method that came
   closest, since that is the figure that governs repayment exposure.

The **eligibility** standard runs the same comparison with budgeted amounts for the upcoming
year against the most recent fiscal year for which information is available.

---

## 7. Boundary cases

- **Exactly equal passes.** The regulation forbids reducing *below* the prior level. Equality is
  compliance. A strict `>` comparison would manufacture a finding.
- **No intermediate rounding on per-capita methods.** Compute the quotient at full decimal
  precision and compare. Rounding each side to cents before comparing can flip a result that
  sits within a dollar per child. *(Platform decision — see §10.)*
- **Zero or missing child count** on either side of a per-capita method → that method is
  `INDETERMINATE`. Never divide by zero, and never fall back to the total method silently.
- **Child count fell** between the two years → the total-basis methods are under pressure while
  the per-capita methods may be unaffected. This is also the fact pattern § 300.204(b)
  contemplates. Surface it as an explanation, not just a number.
- **Multiple consecutive failure years** → the required level chains backward through
  § 300.203(c) to the last properly-required level. Do not re-derive it from expenditures.

---

## 8. Exceptions and adjustment

### § 300.204 — Exceptions

An LEA may reduce below the prior year's level to the extent the reduction is attributable to:

| | |
|---|---|
| (a) | Voluntary departure — by retirement or otherwise — or departure for just cause, of special education or related services personnel |
| (b) | A decrease in the enrollment of children with disabilities |
| (c) | Termination of the obligation to provide an exceptionally costly program for a particular child who left the jurisdiction, aged out of FAPE eligibility, or no longer needs the program |
| (d) | Termination of costly expenditures for long-term purchases, such as equipment acquisition or facility construction |
| (e) | Assumption of cost by the SEA's high cost fund |

Each claimed exception is a **fact requiring evidence**, not a number a district may assert.
The platform should treat an unevidenced exception as `MANUAL_REVIEW`, never as an accepted
reduction.

### § 300.205 — Adjustment

When an LEA's Part B allocation exceeds the prior year's, it may reduce its required MOE
expenditures by **not more than 50 percent of that excess**, and must then spend an equal amount
of local funds on activities authorized under the ESEA.

The SEA must prohibit the adjustment where the LEA cannot establish and maintain FAPE programs
meeting § 613(a), or where the SEA has taken enforcement action under § 616. Funds spent on
early intervening services under § 300.226 **count toward** the 50 percent cap — so an LEA
running CEIS has less adjustment headroom than the raw arithmetic suggests.

---

## 9. `INDETERMINATE` conditions

Missing data produces `INDETERMINATE`, never a manufactured pass or fail. The explanation must
name the specific missing input, because the remedies differ:

| Missing | Effect |
|---|---|
| Either child count | Per-capita methods `INDETERMINATE`; total methods may still resolve |
| Either expenditure figure for a method | That method `INDETERMINATE` |
| `comparison_year_moe_met` | Whole rule `INDETERMINATE` — the comparison level cannot be established |
| Fiscal periods not exactly one year apart | Whole rule `INDETERMINATE` — do not compare |
| Exceptions claimed without evidence | `MANUAL_REVIEW` |

If some methods resolve and at least one **passes**, the overall result is `PASS` — one passing
method satisfies the requirement regardless of what could not be computed elsewhere. If some
methods resolve, all resolved ones fail, and any remains indeterminate, the result is
`INDETERMINATE`, not `FAIL`: an uncomputed method might have passed.

---

## 10. What this does NOT conclude

- It does not verify that the underlying expenditures were **allowable** under 2 CFR Part 200,
  or that they were properly coded to special education. It tests the level, not the legitimacy.
- It does not test excess cost, proportionate share, or CEIS/CCEIS. Those are separate
  requirements with separate rules.
- It does not apply any **state** overlay. Alabama may impose a stricter standard or additional
  evidence requirements; none are encoded yet.
- It does not adjudicate claimed § 300.204 exceptions. It records them and routes them for
  review.
- It does not determine the repayment amount owed. It reports the shortfall.

### Unverified — resolve before this leaves DRAFT

1. **§ 300.203(c) verbatim text.** The subsequent-years mechanics in §4 come from a summary of
   the 2015 final-rule preamble, **not** from the regulation's own words. The paragraph
   structure — (c)(1) for FY2014/FY2015, (c)(2) for local-only methods, (c)(3) for
   state-and-local methods — needs confirming against the raw text, and the per-method split
   matters for step 1 of §6.
2. **Whether the eligibility standard's comparison year is itself constrained** by a prior MOE
   failure, or only the compliance standard is.
3. **Child count definition and as-of date** — which count (state child count submission,
   December 1, October 1) the methods use, and whether it differs by state.
4. **Rounding convention** for per-capita comparisons. §7 states a platform decision; no
   authority for it has been read.
5. **Alabama overlay** in full.

---

## 11. Worked example

Synthetic figures. Not a real district.

**Example Consolidated School District**, FY2027 compliance test. The LEA met MOE in FY2026, so
the comparison level is FY2026 actual expenditures.

| | FY2026 (comparison) | FY2027 (current) |
|---|---|---|
| Local funds only | $4,200,000 | $4,150,000 |
| State and local funds | $6,800,000 | $6,900,000 |
| Children with disabilities served | 412 | 400 |

**Method 1 — local only, total**
$4,150,000 vs $4,200,000 → short **$50,000** → **FAIL**

**Method 2 — local only, per capita**
Comparison: $4,200,000 ÷ 412 = **$10,194.17475728**
Current: $4,150,000 ÷ 400 = **$10,375.00000000**
Margin **+$180.82524272** per child → **PASS**

**Method 3 — state and local, total**
$6,900,000 vs $6,800,000 → margin **+$100,000** → **PASS**

**Method 4 — state and local, per capita**
Comparison: $6,800,000 ÷ 412 = **$16,504.85436893**
Current: $6,900,000 ÷ 400 = **$17,250.00000000**
Margin **+$745.14563107** per child → **PASS**

**Result: `PASS`** — 3 of 4 methods qualify.

Note what a single-method tool would have reported. Checking only local-funds-only on a total
basis yields a $50,000 failure and a repayment conversation. The district is compliant, and the
child-count decline from 412 to 400 is the reason the total method falls while the per-capita
methods clear comfortably.

These four cases, with their exact expected margins, are the first entries in the golden test
corpus for `idea_moe_compliance_v1`.
