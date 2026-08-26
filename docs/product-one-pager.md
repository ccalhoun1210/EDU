# ComplianceOS EDU

**Compliance assurance infrastructure for publicly funded education programs.**
First paid module: IDEA Part B fiscal assurance.

---

## The problem

A school district spends federal special-education money under rules it cannot fully see.
Maintenance of effort, excess cost, proportionate share, CEIS — each is a separate
calculation, drawing on data from a different system, governed by federal regulation with a
state overlay on top, and nobody in the building owns the whole picture.

Districts find out they were non-compliant when a monitor tells them, and by then the fiscal
year is closed and the money has to come back out of local funds. The Department recovers
the shortfall from the state, and the state recovers it from the district — in non-federal
dollars.

The current tooling is a spreadsheet a business manager inherited from a predecessor, plus a
consultant who visits once a year.

## What we are building

A platform that answers one question, continuously:

> **If this district were monitored or audited today, what appears satisfied, what is at
> risk, what evidence supports that conclusion, and what needs to happen next?**

It ingests data from the systems districts already run — SIS, IEP platform, ERP —
normalizes it into a canonical model, evaluates versioned regulatory rules against it, and
explains every result down to the source record.

**It is a system of assurance, not a system of record.** The district's existing systems
stay authoritative. We read from them. We never write back. That constraint is what makes
the product installable in a district that has no appetite for another migration.

## Why this is hard, and why that is the opportunity

Special-education fiscal rules do not behave the way general accounting intuition expects.
Three examples the product has to get right, and a spreadsheet almost never does:

- **Maintenance of effort has two separate standards, not one.** The eligibility standard
  tests next year's *budget*; the compliance standard tests last year's *actual
  expenditures*. A district can pass one and fail the other in the same year.
- **A district can qualify four different ways** — local funds only, state and local
  combined, and each of those on a per-child basis — and needs only one to pass. Most
  districts do not know they can test all four, and a tool that checks only one method
  reports a failure that is not a failure.
- **Failing MOE does not reset the baseline.** Under the subsequent-years rule, the level
  required the following year is the level that *would* have been required absent the
  failure — not the reduced amount actually spent. A district that models next year from
  what it really spent digs the hole deeper.

Encoding this correctly, per state, with citations and effective dates, is the work. It is
also the barrier to entry.

## How it is built

**Deterministic rules own every compliance decision.** Outcomes come from versioned logic
that can be reproduced years later from the same data snapshot and rule-pack version. AI
classifies documents, extracts candidate facts, and drafts remediation language — always
advisory, always validated by a person before it becomes authoritative. AI never issues a
determination.

**Every conclusion has a Why.** No school administrator is asked to trust a black box. Each
result shows the requirement, the citation, the rule-pack version, the data snapshot, the
input values, the arithmetic, the source file and rows it came from, and which of the
alternative methods pass.

**Regulatory logic is content, not code.** Federal baseline, state overlay, local policy
overlay — layered, versioned, reviewable by an attorney who does not read TypeScript.
Adding Alabama does not mean forking the product.

**History is reproducible.** A finalized assessment is immutable. Ask what the platform
concluded on a date, and it reconstructs that answer exactly.

## What we are deliberately not building

Not an IEP authoring platform. Not an SIS. Not an ERP. Not a Medicaid billing engine. Not a
generalized workflow builder. Not autonomous write-back into district systems. Each of
those trades a narrow, defensible product for a large support burden.

## Where it goes

The same engine extends without re-architecture:

| | |
|---|---|
| **Now** | IDEA fiscal — MOE, excess cost, proportionate share, CEIS/CCEIS |
| **Next** | Evidence vault, corrective actions, monitoring readiness |
| **Then** | Programmatic SPED monitoring — Child Find and evaluation timelines; significant disproportionality |
| **Later** | Title I and federal programs, Part C, Head Start, subrecipient monitoring, Section 504 |
| **Buyer shift** | District-side assurance tool → multi-state platform → state-agency monitoring |

## The defensible asset

Not the dashboard, and not the model. It is the versioned regulatory graph with source
provenance, the audited calculator library, the reusable state rule packs, the canonical
compliance ontology that turns many vendor schemas into one, the evidence graph, and the
integration library. Those compound. A competitor starting today starts at zero on all six.

## Status

Phase 0. The repository, rule-pack engine, restricted rule DSL, and CI baseline are built,
with the federal IDEA Part B rules encoded and carrying their CFR citations. Calculators are
specified and not yet implemented — by design, the golden test corpus is written from the
statute before the function.

The first milestone is not a dashboard. It is a deterministic, tested, source-cited engine
that can ingest a district export and reproduce an IDEA fiscal assessment from an immutable
snapshot.
