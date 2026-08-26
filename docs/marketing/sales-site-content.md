# Sales site — content

**Date:** 2026-08-25
**Built from:** the master technical buildout, `docs/regulatory-methodology/idea-moe.md`,
`docs/design/landing-page-direction.md`, `docs/pricing/pricing-model.md`, and state SEA
guidance read directly (Texas, Wisconsin, New York, Washington).

Everything below is drafted as usable copy, not as a brief about copy. Where a claim needs
verification before publishing, it is flagged inline.

---

## 0. What the research changed

Three findings reshaped this content. They are what make it specific rather than generic.

**1. The competitor is a spreadsheet the state hands out.** Every state publishes its own MOE
calculator — Texas ships separate Excel workbooks for districts and charters plus an exceptions
workbook; New York publishes year-specific eligibility and compliance calculators; Washington
has a guidance handbook; Wisconsin now drives monitoring off WISEdata Finance submissions. The
district's current process is *filling in the state's spreadsheet once a year*. That is what we
are replacing, and the copy should name it, because every reader recognizes it instantly.

**2. Districts learn they failed roughly eight months after they could still have fixed it.**
Wisconsin publishes its calendar: certification July 1, prior-year claim amendments close
September 30, DPI reviews and notifies failures in October, **final determinations and penalty
notices in February–March**, corrective action from April. The fiscal year those numbers
describe ended the previous June 30. This gap is the product's entire reason to exist, and it
is a fact from a state agency's own page rather than a claim we invented.

**3. The exceptions window is measured in days.** Texas gives an LEA **ten business days** from
publication of the preliminary compliance review to file its exceptions workbook, a
superintendent-signed certification, and supporting documentation. Ten business days to
assemble evidence for retirements, enrollment decreases, and terminated high-cost programs
spanning a year that closed months earlier. This is the sharpest value moment in the entire
product and no generic compliance pitch will find it.

---

## 1. Messaging spine

One paragraph everything else derives from:

> ComplianceOS EDU tells a school district where it stands on IDEA fiscal compliance **while
> the year is still open** — continuously, from the data its own systems already produce, with
> every conclusion traced to the regulation and the source record behind it. Districts find out
> today from a state spreadsheet, months after the fiscal year closed, when nothing can be
> changed and the shortfall comes out of local funds.

Three claims, in priority order:

| | Claim | Proof |
|---|---|---|
| 1 | **You find out in time** | Continuous evaluation against an open year vs. Feb–March determinations |
| 2 | **You can defend every number** | Citation, rule version, snapshot, inputs, source rows |
| 3 | **You test all four methods, not one** | Most districts and most tools check one and report false failures |

---

## 2. WHAT IT IS

### Page headline

> **Know where your IDEA fiscal compliance stands — while you can still do something about it.**
>
> ComplianceOS EDU evaluates maintenance of effort, excess cost, proportionate share and CEIS
> against your district's real numbers, continuously, and shows its work down to the source row.

### The plain-language definition

Use this wording consistently. It is the sentence a director will repeat to their
superintendent, so it has to survive being repeated.

> It is a **compliance assurance layer**. It does not replace your student information system,
> your IEP platform, or your ERP — it reads from them, applies the federal and state rules that
> govern your special-education spending, and tells you what a monitor would find.

### Body copy

> Your district already produces every number IDEA fiscal compliance depends on. Expenditures
> sit in your ERP. Child counts sit in your SIS and in the state submission you file every
> year. The rules sit in 34 CFR Part 300 and in your state's administrative code.
>
> What does not exist is anything that holds those three together and answers the only question
> that matters: **if we were monitored today, what would they find?**
>
> Today that question gets answered once a year, by hand, in a spreadsheet your state education
> agency publishes — and the answer arrives after the fiscal year has closed. ComplianceOS EDU
> answers it continuously, from the same data, using versioned rules that carry their own
> citations.

### What it is not — put this on the page

Objection-killers work better as a stated section than as answers to questions the visitor
never gets to ask.

> **It does not write to your systems.** Every integration is read-only. Your SIS and IEP
> platform remain the systems of record. There is no migration, and nothing we do can corrupt
> your student data.
>
> **It is not an IEP platform, an SIS, or an ERP.** We are not asking you to replace anything.
>
> **It does not make the compliance determination for you.** Every result comes from
> deterministic, versioned rules you can inspect, with the regulation cited. Where judgment is
> required — a claimed exception, a disputed expenditure code — it routes to a person and says
> so.
>
> **AI does not decide anything.** It reads documents, proposes facts, and drafts language. A
> human validates before anything becomes authoritative. A conclusion a model produced could
> not be reproduced two years from now, and a conclusion that cannot be reproduced cannot be
> defended.

---

## 3. HOW IT WORKS

Give this its own page. It is the page that converts a skeptical business manager, because it
is the page that proves we understand the work.

### The six steps, in the buyer's language

**1 — Connect what you already have.**
Read-only exports or connections from your ERP, SIS, and IEP platform. No migration, no
write-back, no change to how your staff work. If your data comes out as a spreadsheet, that is
a supported input; most districts start there.

**2 — Normalize into one picture.**
Expenditure lines, fund codes, enrollment, child count and program data from different systems
get mapped into a single model. Mapping is explicit and reviewable — you can see which of your
fund codes we treated as local, which as state, and which we excluded as federal. Get that
mapping wrong and every downstream number is wrong, so we show it rather than assume it.

**3 — Freeze a snapshot.**
Every assessment runs against an immutable snapshot of your data at a moment in time, with a
snapshot ID. This is what makes a result reproducible. When someone asks in 2029 what the
system concluded in October 2027, we reconstruct it exactly — same data, same rule versions,
same answer.

**4 — Evaluate versioned rules.**
Federal baseline rules, your state's overlay, and any local policy layered on top. Each rule
carries its citation, its authority, and the dates it was in force, so a run selects the rules
that actually applied on its as-of date. Rules are content, not code — reviewable by your
attorney without reading software.

**5 — Explain every result.**
No status appears without its reasoning. See §4.

**6 — Attach evidence and manage what follows.**
Findings link to the documents that support or resolve them, and corrective actions track
through to closure. When the state asks, the packet is already assembled.

### The Why panel — feature this prominently

This is the single most persuasive asset the product has. Show it as a rendered UI element on
the page, not as a bullet.

```
STATUS: AT RISK

Requirement      IDEA Part B — LEA Maintenance of Effort
Authority        34 CFR § 300.203
Rule pack        US-FED-IDEA-B-2028.2
Data snapshot    DS-01JXYZ...

Why              Current projected state + local expenditure is $21,640 below
                 the required comparison level under this method.

Inputs           Current projection        $4,823,114
                 Required level            $4,844,754
                 Difference                  -$21,640

Source           FY2028 Budget Export.xlsx — rows 412-587, fund codes 27xx

Other methods    2 of 4 currently pass

Next step        Review qualifying methods and documented exceptions before
                 fiscal close.
```

Caption it:

> Every conclusion in ComplianceOS EDU looks like this. No black box, no score, no
> "compliance health" percentage — the requirement, the regulation, the arithmetic, and the
> rows it came from.

### The four methods — its own section

> **IDEA gives your district four ways to satisfy maintenance of effort. You only need one.**
>
> Local funds only, state and local funds combined, and each of those on a per-child basis.
> Most tools — and most spreadsheets — check the one that seems obvious. If your child count
> fell, the total-basis methods come under pressure while the per-capita methods may pass
> comfortably. Check only the first and you will report a failure that is not a failure.
>
> ComplianceOS EDU evaluates all four, every time, and shows the margin on each.

*(Worked illustration for the page — synthetic figures, verified arithmetic:)*

| Method | Comparison year | Current year | Result |
|---|---|---|---|
| Local funds, total | $4,200,000 | $4,150,000 | **Short $50,000** |
| Local funds, per child | $10,194.17 | $10,375.00 | Passes by $180.83 |
| State + local, total | $6,800,000 | $6,900,000 | Passes by $100,000 |
| State + local, per child | $16,504.85 | $17,250.00 | Passes by $745.15 |

> Three of four methods qualify. This district is compliant. A single-method check would have
> reported a $50,000 failure and started a repayment conversation.

### The subsequent-years rule — the credibility section

> **A year you failed does not lower next year's bar.**
>
> If your district missed MOE, the level required the following year is the level that *would*
> have been required had you not missed it — not the reduced amount you actually spent. As OSEP
> puts it, the required level is the one from the last year the LEA met MOE.
>
> Districts that rebuild next year's budget from what they really spent dig the hole deeper
> without knowing it. ComplianceOS EDU carries the required level forward as a tracked fact, so
> your baseline is right even after a bad year.

*Verified across three sources: the 2015 final rule, Wisconsin DPI quoting OSEP, and Texas
Education Agency. Safe to publish.*

---

## 4. WHAT IT IS WORTH

Four distinct value arguments. Lead with the first — it is the one that lands.

### Value 1 — Time, and it is the whole game

> **The fiscal year ends June 30. You find out in February.**
>
> Wisconsin's published calendar is typical: districts certify on July 1, prior-year claim
> amendments close September 30, the state reviews and notifies failures in October, and final
> determinations with penalty notices arrive in **February and March**.
>
> The year those numbers describe ended the previous June. By the time a district learns it
> failed, roughly eight months have passed since the last day it could have moved a dollar.
> Every remedy — shifting an expenditure, documenting an exception, adjusting a budget — was
> available in March and gone by October.
>
> ComplianceOS EDU runs the same tests continuously, against the open year. The finding arrives
> while it is still a decision instead of a bill.

### Value 2 — A bounded, statutory, local-dollar liability

> **What a failed MOE actually costs.**
>
> Under 34 CFR § 300.203(d), when an LEA fails to maintain effort, the state must repay the
> Department in **non-federal funds** — the amount of the shortfall, or the district's Part B
> subgrant for that year, whichever is lower — and recovers it from the district.
>
> Two things follow. The exposure is capped at your annual subgrant. And it is paid in local
> dollars, from a budget already written, in a year when nothing was set aside for it.

| Children served | Your IDEA Part B grant ≈ | Maximum exposure |
|---|---|---|
| 400 | $640,000 | $640,000 |
| 1,000 | $1,600,000 | $1,600,000 |
| 3,000 | $4,800,000 | $4,800,000 |

> At a district of 400 children served, ComplianceOS EDU costs about **2.3% of the grant it
> protects**.

### Value 3 — The ten-day window

This is the most concrete, least-expected value in the product. Give it a section.

> **When the state asks, you have days — not weeks — to prove it.**
>
> In Texas, an LEA gets **ten business days** from the preliminary compliance review to submit
> its exceptions workbook, a superintendent-signed certification, and supporting documentation
> for every exception it claims. Other states run comparable windows.
>
> The exceptions themselves are real money: the voluntary departure of special-education
> personnel, a decrease in enrollment of children with disabilities, the end of an exceptionally
> costly program for a particular child, the end of a long-term purchase. Each one can lawfully
> reduce what you were required to spend — **if you can evidence it inside the window.**
>
> Ten business days to reconstruct a year that closed months ago is how legitimate exceptions
> go unclaimed and districts repay money they did not owe.
>
> ComplianceOS EDU tracks exception-eligible events as they happen and keeps the supporting
> evidence linked to them. When the window opens, the packet is already built.

### Value 4 — Defensibility

> Every conclusion carries its citation, its rule version, the data snapshot it ran against,
> and the source rows behind each input. A finalized assessment is immutable — new data
> produces a new run, never a rewritten one.
>
> When a monitor asks how you reached a number, you show them. When they ask what you concluded
> two years ago, you reproduce it exactly.

### Value 5 — The one we are not claiming yet

Staff time saved is the obvious fifth argument and we have no basis for it. We do not know how
many hours a district spends on the state's MOE workbook. **Do not put an hours-saved or
ROI-multiple claim on the site** until we have asked five districts. An invented efficiency
statistic is the single easiest way to lose a business manager who does this work themselves.

---

## 5. Page inventory and what each page must do

| Page | Job | Must contain |
|---|---|---|
| **Home** | Qualify the visitor in 10 seconds | The question headline, the named requirements, the Why panel, read-only reassurance, trust row |
| **How it works** | Convert the skeptic | The six steps, the Why panel expanded, the four-methods worked example, the subsequent-years section |
| **IDEA fiscal** | Depth per requirement | MOE, excess cost, proportionate share, CEIS/CCEIS — one section each, with the citation |
| **Pricing** | Enable a budget line item | Calculator, band table, funding-source honesty, ESA route (see the pricing doc) |
| **Trust** | Survive procurement | Accessibility conformance report, FERPA terms, data-privacy agreement, security posture, data residency, subprocessors |
| **For state agencies** | A different buyer | Monitoring across LEAs; state-level IDEA funds may be reserved for monitoring and enforcement |
| **Resources** | Earn the search traffic | See §7 |
| **About** | Answer "who are you" | The honest version — see §6 |

---

## 6. Objection handling

Write these into the pages rather than saving them for calls.

| Objection | Response |
|---|---|
| *"We already have a spreadsheet from the state."* | So does every district — and it answers the question once, after the year has closed. We run the same tests continuously against the open year, and we keep the evidence for the exceptions window. |
| *"We can't take on another system."* | You are not replacing anything. Read-only, no migration, no change to how staff work. Most districts start by sending the exports they already produce. |
| *"How do I know your numbers are right?"* | Every number shows its arithmetic, its inputs, the rows they came from, and the regulation it applies. Check any of them. That is the product. |
| *"Is this AI deciding our compliance?"* | No. Rules are deterministic and versioned. AI reads documents and drafts language; a person validates before anything counts. |
| *"We're a small district."* | Direct pricing starts above roughly 250 children served. Below that, talk to your ESA — the economics work through them. |
| *"You're a new company."* | Stated plainly on the About page. What we offer instead of a customer list: an architecture built so every conclusion is reproducible and inspectable, and a rule corpus with its citations visible. Judge the work. |
| *"Can we pay for this with IDEA funds?"* | The honest answer: it depends on how your district and SEA treat administrative costs, and we will work it through with your federal-programs director. We do not assert it. |

---

## 7. Resource content — the state MOE hub

The highest-value organic content for this audience is not thought leadership. It is
**regulatory reference the district's own state agency writes badly**.

Build one page per state: what that state's MOE process actually is, which workbook it
publishes, when its deadlines fall, what its exceptions process requires, and what its
terminology means. Texas alone involves PEIMS, SHARS, and SOF; a director in a neighboring
state has no idea what those are and a director in Texas searches for them by name.

Launch order should follow where we can actually serve a district, starting with Alabama, then
the states whose guidance is already public and detailed — Texas, Wisconsin, New York,
Washington.

Supporting pieces, each answering a question a finance director actually types:

- What happens if our district fails IDEA maintenance of effort?
- The four MOE methods, explained with worked numbers
- MOE exceptions under 34 CFR 300.204 — what qualifies and what evidence you need
- Eligibility standard vs. compliance standard — why you can pass one and fail the other
- The subsequent-years rule: why a failed year does not reset your baseline
- Excess cost: the calculation, worked
- The 50% adjustment under 300.205 — and why CEIS spending eats into it

Every one of these should link its authority and show real arithmetic. The content *is* the
product demonstration.

### Editorial calendar, anchored to the real cycle

| When | What districts are doing | What to publish |
|---|---|---|
| Feb–Apr | Building next year's budget | Eligibility standard; budgeting to pass MOE |
| Jun–Jul | Fiscal close; certifications | Closing the year cleanly; what to document now |
| Sep–Oct | Claim amendments close; preliminary reviews | The exceptions window; evidence checklists |
| Feb–Mar | Final determinations and penalty notices | What to do if you received one; corrective action |

---

## 8. Proof assets to build, in order

1. **The Why panel**, rendered from real output. Everything else is decoration until this
   exists.
2. **An interactive four-methods demo** — visitor enters two years of numbers and child counts,
   sees all four methods and their margins. It is the product's core insight in thirty seconds,
   it requires no login, and it is the highest-converting asset available.
3. **The pricing calculator** (see the pricing doc).
4. **A sample fiscal report packet**, synthetic, downloadable — what a monitor would receive.
5. **The accessibility conformance report.** Not marketing, but it gates procurement.
6. **A named practitioner reference.** Not available pre-pilot. Design the slot; leave it
   unpublished rather than filling it with stock.

---

## 9. Claims register — what is safe to publish

**Verified, publishable as written:**

- The two standards, the four methods, and the phrases "most recent fiscal year for which
  information is available" and "the preceding fiscal year" — three independent sources.
- The subsequent-years rule — 2015 final rule, Wisconsin DPI quoting OSEP, and TEA.
- § 300.203(d) repayment in non-federal funds, capped at the subgrant.
- The § 300.204 exception categories and the § 300.205 50% adjustment with CEIS counting toward
  the cap.
- Texas's ten-business-day exceptions window and Wisconsin's compliance calendar, attributed to
  those states.
- All arithmetic in the four-methods example — computed and checked.

**Do not publish without further work:**

- **Any hours-saved, ROI, or efficiency figure.** No basis exists.
- **That IDEA funds can pay for the product.** Unresolved — see the pricing doc.
- **The MOE ratchet hypothesis** (buying with local funds raising your MOE floor). Unverified;
  raise as a question on a call, never in writing.
- **Generalizing one state's calendar to all states.** Wisconsin's dates are Wisconsin's. Say
  "typical" only where we have checked more than one, and attribute.
- **Whether TEA's per-test-method baseline tracking is the national rule.** Texas describes the
  baseline as the last year the LEA met MOE *for that specific test method*; Wisconsin does not
  mention a per-method split. This affects the calculator and should be resolved before any
  claim about how the baseline is tracked.

---

## 10. Sources read directly

- [Texas Education Agency — IDEA-B LEA Maintenance of Effort](https://tea.texas.gov/finance-and-grants/grants/federal-fiscal-compliance-and-reporting/idea-fiscal-compliance/idea-b-lea-maintenance-of-effort)
- [Wisconsin DPI — IDEA Maintenance of Effort](https://dpi.wi.gov/sped/educators/fiscal/maintenance-of-effort)
- [NYSED — LEA MOE calculator guidance, 2025–26 eligibility standard](https://www.nysed.gov/special-education/guidance-complete-lea-maintenance-effort-moe-calculator-2025-2026-eligibility)
- [Washington OSPI — LEA MOE guidance handbook](https://ospi.k12.wa.us/sites/default/files/2023-08/moe-guidance-handbook.pdf) *(surfaced in search; not read)*
- Federal authorities and the derivation of every figure: see
  `docs/regulatory-methodology/idea-moe.md` and `docs/pricing/pricing-model.md`.
