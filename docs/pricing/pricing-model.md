# Pricing model and pricing page

**Date:** 2026-08-25
**Status:** recommendation. Numbers are modeled, not tested against a single real buyer.

---

## 1. What the research actually supports

Start with an honest limit: **there is no usable public benchmark for K-12 special-education
software pricing.** Frontline, PowerSchool, Infinite Campus and every serious incumbent quote
privately. What surfaces in search is SEO filler with invented ranges. Any pricing document
that cites "the market rate is $X per student" is citing content marketing.

So this model is not built from comparables. It is built from three things that _can_ be
verified:

1. **The size of the grant being protected**, from federal appropriation and child-count data.
2. **The statutory ceiling on what a district can lose**, from 34 CFR 300.203(d).
3. **The structure of the market** — how many districts there are, how they cluster by size,
   and how the small ones actually buy.

That is a stronger foundation than a comparables table anyway, because it prices the risk
rather than the software.

---

## 2. The unit of pricing

**Price against the district's IDEA Part B allocation, not enrollment and not seats.**

Every K-12 vendor prices per student, because every K-12 vendor sells something students use.
Nobody uses this product but a handful of administrators, so per-seat pricing would put the
price at roughly zero for a large district and make it impossible to capture value. Per-total-
enrollment is closer, but it prices the wrong denominator — two districts of equal size can
differ two-fold in children with disabilities served, and it is _that_ number that drives both
the grant and the exposure.

The allocation is the right basis for three reasons:

- It is exactly what the product protects.
- It is public data — state allocation tables and the annual child count — so a price is
  verifiable by the buyer rather than asserted by us.
- The product already ingests child count. Pricing uses a number we can show them.

Practical proxy: **children with disabilities served**, which converts to allocation at roughly
$1,600 per child (derivation below).

### Derivation

|                                                                          |                 |
| ------------------------------------------------------------------------ | --------------- |
| IDEA Part B §611 appropriation (FY2023, most recent published on ed.gov) | $14,193,704,000 |
| Children ages 3–21 served under IDEA (2022–23, NCES)                     | 7,500,000       |
| Gross federal dollars per child served                                   | **$1,892**      |
| Net after an illustrative 15% SEA set-aside                              | **≈ $1,600**    |

The set-aside is not fixed nationally — states reserve varying amounts for state-level
activities — so $1,600 is a modeling assumption, not a fact. Use the actual state allocation
table when quoting a real district.

---

## 3. The value anchor

Under **34 CFR 300.203(d)**, when an LEA fails to maintain effort the SEA must repay the
Department in **non-federal funds**, in an amount equal to the shortfall **or the LEA's Part B
subgrant for that year, whichever is lower** — and recovers it from the district.

That gives a clean, statutory ceiling on exposure: **the district cannot lose more than its
annual subgrant, and it loses it in local dollars.**

| Children served | IDEA Part B grant ≈ | Maximum MOE exposure |
| --------------- | ------------------- | -------------------- |
| 150             | $240,000            | $240,000             |
| 400             | $640,000            | $640,000             |
| 1,000           | $1,600,000          | $1,600,000           |
| 3,000           | $4,800,000          | $4,800,000           |

This is the number the pricing conversation should anchor on, and it is why a percentage-of-
grant model is defensible rather than arbitrary. We are not pricing a dashboard. We are pricing
against a bounded, statutory, local-dollar liability.

---

## 4. The structure — marginal bands, not tiers

Flat-rate tiers break. Modeling them produced a price that _fell_ from $48,000 to $38,500 as a
district grew from 2,000 to 3,000 children — the classic tier-boundary inversion, where the
buyer is rewarded for being bigger. Any tiered table needs checking for this before it is
published; ours did not survive it.

Use **marginal bands on the allocation**, the way tax brackets work. Each band of the grant is
charged at a declining rate, which guarantees the price always rises with size while the
effective rate always falls.

| Band of IDEA Part B allocation | Rate       |
| ------------------------------ | ---------- |
| First $500,000                 | 2.5%       |
| $500,000 – $2,000,000          | 1.5%       |
| $2,000,000 – $5,000,000        | 0.9%       |
| Above $5,000,000               | 0.5%       |
| **Annual floor**               | **$9,000** |

### Resulting prices

| Children served | IDEA grant ≈ | Annual price | % of grant | Per child | Channel        |
| --------------- | ------------ | ------------ | ---------- | --------- | -------------- |
| 75              | $120,000     | $9,000       | 7.50%      | $120      | ESA / co-op    |
| 150             | $240,000     | $9,000       | 3.75%      | $60       | ESA / co-op    |
| 250             | $400,000     | $10,000      | 2.50%      | $40       | Direct         |
| 400             | $640,000     | $14,500      | 2.27%      | $36       | Direct         |
| 500             | $800,000     | $17,000      | 2.12%      | $34       | Direct         |
| 750             | $1,200,000   | $23,000      | 1.92%      | $31       | Direct         |
| 1,000           | $1,600,000   | $29,000      | 1.81%      | $29       | Direct         |
| 1,500           | $2,400,000   | $38,500      | 1.60%      | $26       | Direct         |
| 2,000           | $3,200,000   | $46,000      | 1.44%      | $23       | Direct         |
| 3,000           | $4,800,000   | $60,000      | 1.25%      | $20       | Direct, custom |
| 5,000           | $8,000,000   | $77,000      | 0.96%      | $15       | Direct, custom |
| 8,000           | $12,800,000  | $101,000     | 0.79%      | $13       | Direct, custom |
| 15,000          | $24,000,000  | $157,000     | 0.65%      | $10       | Direct, custom |

Verified computationally: price rises monotonically with size, and the effective rate declines
monotonically. Prices rounded to the nearest $500.

---

## 5. The small-district problem, and the channel that solves it

Look at the top two rows. At 75–150 children served, the $9,000 floor is 3.75%–7.5% of the
grant. That is not a price a small district will pay, and it is not a district that can be sold
to profitably direct — the sales and support cost exceeds the contract.

This is not a rounding error in the market. By NCES district counts, roughly **one in three
districts enrolls under 600 students**, and districts under 2,500 students are about 70% of all
districts while serving under 17% of students. Direct sales cannot reach them.

**They are reached through educational service agencies.** ESAs — BOCES, AEAs, RESAs, ESCs,
intermediate units — are the standing structure through which small and rural districts get
special-education administration. AESA reports **more than 550 ESAs across 44 states**, and
their common services already include special-education record-keeping, grant management, and
compliance assistance. That is our category, delivered by an organization that already has the
relationship and the trust.

Three channels, three products:

| Channel          | Who signs                                       | Shape                                                                                                                         |
| ---------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Direct**       | District, 250+ children served                  | The band table above                                                                                                          |
| **ESA / co-op**  | The service agency, covering N member districts | One contract, per-member rate at a discount to the floor; the ESA is the administrator                                        |
| **State agency** | SEA                                             | Different product — monitoring across every LEA in the state. Price against state-level activity funds, not a district budget |

The SEA channel has a specific funding advantage worth noting: state-level IDEA funds may be
reserved for activities that **explicitly include monitoring, enforcement, and complaint
investigation**. That is a named, fundable line for exactly what the SEA version does.

---

## 6. The question that comes before price

**Which pot of money pays for it?** This is the first question in every one of these sales, and
getting it right matters more than the number.

What the regulations actually say:

- **34 CFR 300.202** — Part B funds must be used only for the _excess costs_ of providing
  special education, and must supplement rather than supplant. It does not speak to
  administrative or program-support costs either way.
- **34 CFR 300.208(c)** — permissive use includes purchasing technology for "recordkeeping,
  data collection, and related case management activities" for personnel implementing **IEP
  case management** duties. That is a plausible fit for the _programmatic_ module later. It is
  a stretch for the fiscal module, which is not IEP case management.

So the likely path for the fiscal module is as an **administrative cost allocable to the Part B
grant under 2 CFR Part 200**, not under 300.208(c). _That has not been confirmed and should
not be asserted to a buyer._ It is a question for the district's federal-programs director and
their SEA, and the honest sales position is to ask it rather than answer it.

### The MOE ratchet — a hypothesis, not a claim

There is a second-order effect here that may matter more than the price, and I want to set it
out with the reasoning visible because it is **not verified**.

All four MOE methods count state and local funds and exclude federal funds. If a district buys
this system with **local funds**, and that purchase counts as an expenditure "for the education
of children with disabilities," then:

1. It enters the MOE baseline for that year.
2. The following year's required level includes it.
3. If the district later cancels, it must backfill that amount with other special-education
   spending or fail MOE.

Buying with **federal Part B funds** would have no such effect, since federal funds are
excluded from every method.

**The uncertain link is step 1** — whether a compliance system is an expenditure "for the
education of children with disabilities" for MOE purposes. If it is, the funding-source
decision has a permanent effect on the district's floor, and that is a genuinely useful thing
to raise on a call. If it is not, the argument evaporates.

**Do not put this in sales material until a school finance attorney or an SEA fiscal contact
confirms it.** Raising it as a question is credible; asserting it wrongly to a business manager
is the fastest way to lose one.

---

## 7. The pricing page

### Publish the numbers

Every incumbent hides behind "Request a Quote." Publishing is the differentiating move here,
and not for the usual transparency reasons:

**A district budget request happens months before a purchase.** A special-education director
building next year's budget in February needs a number to put in a line item. If getting one
requires a sales call, the line item does not get created, and the purchase cannot happen in
the following fiscal year at all. Hiding the price does not delay the deal — it skips the
budget cycle and costs a year.

### Build the calculator, not a tier grid

The page's centerpiece should be an input — _children with disabilities served_ — that returns
two numbers side by side:

> **Your IDEA Part B grant at risk:** $640,000
> **Your annual price:** $14,500 — 2.3% of the grant

Then show the band arithmetic underneath, the way the product shows its own work. This is the
pricing page as a demo of the product principle: no black box, every number explained. No
competitor's pricing page can do this, because no competitor's product is built around
explaining a calculation.

### Structure

1. The calculator, above the fold.
2. The band table, shown openly.
3. **What's included** — every district gets the whole fiscal module. No feature gating by
   tier. Gating compliance checks by price tier is indefensible when the checks are statutory.
4. **How districts pay for it** — name the funding-source question honestly and offer to work
   it through with their federal-programs director. Do not claim IDEA funds cover it.
5. **Small district? Talk to your ESA.** Name the channel rather than pretending the floor
   works for everyone.
6. **State agency?** Separate route, separate conversation.
7. Procurement facts: fiscal-year alignment, W-9 and vendor onboarding, cooperative-contract
   availability, data-privacy agreement, and the accessibility conformance report.

### What must not be on it

Do not price modules that do not exist. The evidence vault, programmatic SPED monitoring and
disproportionality are roadmap, not SKUs. A pricing page listing a greyed-out "Coming soon"
tier violates the no-half-done rule and tells a buyer the product is thinner than the page
implies. Price the fiscal module. Name the rest as roadmap in prose, with no price.

---

## 8. Open questions before this is real

1. **Nothing here has been tested against a buyer.** The bands are modeled from grant size and
   statutory exposure — defensible logic, zero market evidence. The first three pilot
   conversations should test the number explicitly, not just the product.
2. **Whether the fiscal module is payable from Part B funds**, and under what authority.
3. **The MOE ratchet hypothesis** in §6.
4. **ESA economics** — what an ESA will pay per member district, and whether they resell or
   administer. This determines whether 70% of the market is reachable at all.
5. **Multi-year vs annual.** Districts often prefer multi-year for budget stability; a
   three-year term at a discount may beat annual, and also protects against the cancel-and-
   backfill problem in §6 if that turns out to be real.
6. **What a failed MOE actually costs in practice** — the statutory ceiling is the subgrant,
   but typical real shortfalls are unknown to me. If median shortfalls are small, the anchor
   weakens and pricing should shift toward time saved rather than risk avoided.

---

## 9. Sources

**Read directly:**

- [34 CFR 300.202](https://www.ecfr.gov/current/title-34/subtitle-B/chapter-III/part-300/subpart-C/section-300.202) — use of amounts, excess costs, supplement-not-supplant.
- [34 CFR 300.208](https://www.law.cornell.edu/cfr/text/34/300.208) — permissive use of funds, including the case-management technology provision.
- [IDEA Grants to States (Part B, Sec. 611)](https://www.ed.gov/grants-and-programs/formula-grants/formula-grants-special-populations/idea-grants-states-part-b-sec-611) — FY2023 appropriation; state-level activities including monitoring and enforcement.
- [NCES — Students with Disabilities](https://nces.ed.gov/programs/coe/indicator/cgg/students-with-disabilities) — 7.5 million served, 15% of enrollment, 2022–23.
- [NCES Digest table 214.20](https://nces.ed.gov/programs/digest/d16/tables/dt16_214.20.asp) — district counts by enrollment band.
- [NASDSE — Educational Service Agencies and special education](https://nasdse.org/docs/134_d712955b-12c7-4820-9158-f043df9d5b50.pdf) — ESA role; AESA figure of 550+ agencies in 44 states.

**Computed here, not cited:** the per-child allocation, every price in the band table, and the
monotonicity and degression checks.

**Known-stale:** the district-size distribution is 2014–15, the newest year in that NCES table.
The _shape_ — a long tail of very small districts, a handful of very large ones — is stable and
is all the tier design depends on, but do not quote the counts as current. The appropriation
figure is FY2023 and is the most recent published on that ed.gov page; a current-year number
should be pulled from the FY2026 congressional justification before it goes in any material.
