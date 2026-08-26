# v0 prompt — sales page

**Date:** 2026-08-26
**Supersedes the page structure in:** `docs/design/landing-page-direction.md` §6, which was
written before ADR 0006. Everything else in that document — audience, the ADA Title II
constraint, the palette, the type choice, the six-state status rule — still stands and is
carried into the prompt below.

## What changed and why the prompt reflects it

ADR 0006 moved the product's terminus from a compliance verdict to an attested binder. The
old page structure led with "a worked result" meaning the Why panel — status, citation,
inputs, arithmetic. That is still the most persuasive asset, but it is now one panel inside a
larger artifact, and the larger artifact is the thing that is hard to copy. The hero should
show the binder.

Two other changes worth knowing before you read the prompt:

- **Section 18 is the concrete anchor.** GaDOE's Cross-Functional Monitoring instrument scores
  IDEA fiscal on exactly five indicators. Naming them is the fastest credibility signal
  available to a Georgia buyer, and it costs nothing.
- **Nothing in the trust row is claimed yet.** SOC 2, the ACR, the Student Privacy Pledge — none
  of these is real today. The prompt tells v0 to build the row and leave the claims out. An
  unbacked badge is worse than no badge, and on a compliance product it is disqualifying.

## Before you paste

The live demo binder is at `docs/demo/section-18-binder.html`. Open it, screenshot the top
third, and have it ready — the prompt asks for a hero built around that image. v0 will
otherwise invent a generic dashboard mock, which is the single fastest way to make this page
look like every other compliance product.

---

## The prompt

```
Build a marketing page for ComplianceOS EDU, a compliance product sold to K-12 school
district administrators. Next.js App Router, TypeScript, Tailwind, shadcn/ui on Radix.
Single page, sectioned. No dark mode.

AUDIENCE AND REGISTER
The reader is a district special-education director, federal programs director, business
manager or CFO — a public-sector employee evaluating a vendor that will touch federal grant
compliance. They are scanning for reasons to disqualify.

Do NOT build the GRC-SaaS look: no dark hero, no purple-to-blue gradient, no floating glass
cards, no "get compliant in days". That style is calibrated for a startup CTO buying SOC 2 on
a credit card and it reads to this audience as a vendor who has never sat through a
monitoring visit. The right register is enterprise-formal with educational warmth —
professional, legible, plain typography, outcome-led headline. Think a document a business
manager can put in front of a superintendent.

TYPOGRAPHY
Public Sans for everything, loaded via next/font, with a real fallback stack. Set a type
scale and stay on it. Headings get text-wrap: balance. Running text near 65 characters wide.
Use tabular-nums anywhere digits line up.

COLOR TOKENS — use these exact values, do not substitute
  ink (body text)        #14171C
  navy (primary)         #123A6B
  muted (secondary text) #5B6472
  surface                #FFFFFF
  surface-muted          #F5F7FA
  border-decorative      #D8DDE5   dividers between sections ONLY
  border-interactive     #8A93A3   every control boundary, input outline, checkbox

#D8DDE5 fails WCAG 1.4.11 at 1.36:1 — it must never appear on an interactive boundary.

STATUS TOKENS — the product has six states, not two
  PASS            #1D6B45
  FAIL            #A8231C
  RISK            #8A5A12
  INDETERMINATE   #4A5568
  MANUAL_REVIEW   #5B3E90
  NOT_APPLICABLE  #6B7280

Two hard rules. Never encode a status by color alone — every status needs an icon or shape
plus a text label (WCAG 1.4.1, and the product's output gets printed in black and white).
And INDETERMINATE must read as neutral slate, never amber. Amber is RISK, which is a real
finding. INDETERMINATE is the honest answer when data is missing and it is the state that
most distinguishes this product from a spreadsheet.

ACCESSIBILITY IS A GATE, NOT A POLISH PASS
WCAG 2.1 AA throughout. Visible keyboard focus on every interactive element, a skip link,
correct heading order, real landmarks, form labels tied to inputs, and prefers-reduced-motion
respected. Districts serving 50,000+ residents must conform by April 26 2027 and are
procuring against it now. A compliance vendor shipping an inaccessible page is disqualified.

PAGE STRUCTURE, in this order

1. HERO — the binder, not a slogan.
   Headline: "If your district were monitored today, what would they find?"
   Subhead: "ComplianceOS EDU assembles the record before the monitor asks for it —
   maintenance of effort, excess cost, CEIS and proportionate share, each traced to the
   regulation and the source row behind it."
   Two CTAs: "Request a demo" and "Talk to us about your state". The second converts better
   with this audience because it acknowledges that state rules differ, which is what they are
   worried about.
   Alongside the copy, place the supplied screenshot of the Section 18 binder in a plain
   bordered frame — border-interactive, no drop shadow, no browser chrome, no perspective
   tilt, no floating. It is a document; show it as one. Do not invent a dashboard mock.

2. THE PROBLEM, IN THEIR WORDS — three short columns, no icons.
   "You find out too late." A district learns it failed roughly eight months after the fiscal
   year closed, when nothing can be changed and the shortfall comes out of local funds.
   "The finding is usually the file, not the math." Federal programs are monitored one to five
   years after the year of spending. The purchase was fine; the documentation wasn't.
   "The person who knows why is gone." Turnover takes the only working memory of why a cost
   was allowable and where the minutes are — and the successor has to defend it.

3. WHAT A MONITOR ACTUALLY ASKS FOR — the Georgia anchor.
   Georgia's Cross-Functional Monitoring instrument scores IDEA fiscal on five numbered
   indicators. List them as a plain table with the state's own numbering:
     18.1  Maintenance of effort
     18.2  Annual excess cost calculation
     18.3  Comprehensive CEIS
     18.4  High-cost grant
     18.5  Parent mentor minimum — a Georgia rule with no federal analogue
   Caption: "Your indicators, your numbering. Not ours."

4. A WORKED RESULT — the most persuasive asset on the page.
   Reproduce one workpaper as real HTML, not an image: status chip with icon and label, the
   regulation cited, the rule pack and version, which of the four statutory methods was
   applied, a table of inputs with where each number came from and who supplied it, and the
   conclusion in plain language. Use the maintenance of effort example. No competitor
   screenshot looks like this.

5. WHAT IT DOES NOT DO — a stated section, not an FAQ.
   Read-only; every integration reads, nothing writes back. Your SIS and IEP platform remain
   the systems of record. It is not an SIS, an IEP platform or an ERP. It does not make the
   determination for you — results come from deterministic versioned rules you can inspect,
   and where judgment is required it routes to a person and says so. AI does not decide
   anything: it reads documents and drafts language, a human validates before anything becomes
   authoritative.

6. TRUST ROW — build the component, leave the claims out.
   Slots for FERPA contractual terms, Student Privacy Pledge, SOC 2 status, an accessibility
   statement linking an ACR, and data residency. NONE of these is true today. Render each slot
   with the label and the text "In progress — ask us where this stands." Do not invent badges,
   certifications, seals, compliance logos or dates.

7. PROOF — designed and empty.
   Build the testimonial slot for one named practitioner with their district attributed, then
   leave it commented out with a note that it ships when a pilot district agrees to be named.
   Do NOT write a placeholder quote, invent a district, or use a stock photo of a person. A
   fabricated endorsement on a compliance product is disqualifying.

8. CLOSING CTA — repeat the two buttons, on surface-muted.

WRITING
Active voice. Name things the way a district administrator names them: "maintenance of
effort", not "MOE compliance automation". Every button says exactly what happens. No
exclamation marks, no "seamless", no "effortless", no em-dash-heavy startup cadence.

DO NOT INVENT: customer names, district names, logos, certifications, badges, statistics,
percentages, dollar figures, or testimonials. Where a number would sit, leave the slot and
label it.
```

---

## After v0 returns

Three things to check before any of it lands in `apps/web`:

1. **Contrast.** v0 will lighten `muted` or `border-interactive` if it thinks the page looks
   heavy. Re-check every pair against the ratios in `docs/design/landing-page-direction.md` §5.
2. **Status by colour alone.** The most common regression. Every chip needs its icon and its
   text label, and the page has to survive being printed in black and white.
3. **Invented trust signals.** Check for badges, seals, percentages and testimonials that were
   not in the prompt. Delete anything we cannot back today.
