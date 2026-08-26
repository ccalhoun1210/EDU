# Landing page and design system — direction

**Date:** 2026-08-25
**Status:** recommendation, not yet implemented

---

## 1. Who is looking at this page

District special-education directors, business managers and CFOs, federal-programs
directors — and later, state education agency monitoring staff. Public-sector employees
evaluating a vendor that will touch federal grant compliance.

This rules out an entire visual genre. The GRC-SaaS look — dark hero, purple-to-blue
gradient, floating glass cards, "Get compliant in days" — is calibrated for a startup CTO
buying SOC 2 on a credit card. Put it in front of a district business manager and it reads
as a vendor who has never sat through a monitoring visit. Vanta, Drata and Secureframe are
the closest analogues by *product category* and the wrong reference by *audience*. Worth
looking at once to know what not to do.

The incumbent in this space is Frontline Education. Their special-programs page is
enterprise-formal with educational warmth: professional, legible, plain typography,
outcome-led headline, a named practitioner testimonial with their district attributed, a
case study, and a trust row carrying a **Student Privacy Pledge badge** plus explicit
security and accessibility statements. That trust row is the part to copy. It is what a
district looks for before it looks at anything else.

---

## 2. The hard constraint — this is not optional

Under the **ADA Title II web rule**, public entities must conform to **WCAG 2.1 Level AA**:

| Entity | Deadline |
|---|---|
| Jurisdictions serving 50,000+ residents | **April 26, 2027** |
| Jurisdictions under 50,000 | April 26, 2028 |
| Special district governments | April 26, 2028 |

School districts are covered by the population of the jurisdiction they serve — city
district by city population, county district by county population, independent district by
census estimate. *(Read from ada.gov directly — see §7.)*

Two consequences:

1. **Our product is web content a public entity uses.** Shipping something that fails WCAG
   2.1 AA hands a district a problem in the same year they are being audited for it. For a
   compliance product, that is disqualifying in a way it would not be for a lesson-planning
   tool.
2. **The near deadline is eight months out.** Districts serving 50,000+ are procuring
   against it *now*. Accessibility is not a Phase 4 polish item; it is a Phase 1 gate.

**The lever most people miss:** a component library gives you accessible components. It
does not give you the artifact procurement actually asks for. That artifact is an
**Accessibility Conformance Report** — an ACR, authored against the VPAT template — and it
must describe *our product*, not Radix's or USWDS's. No library produces one. Budget a real
audit against WCAG 2.1 AA before the first district contract and treat the ACR as a
deliverable with an owner, like the security package in §30 of the buildout.

---

## 3. Design system — recommendation

**Use shadcn/ui on Radix primitives with Tailwind. Treat USWDS as the reference standard,
not the skin.**

### The three candidates

| | What it is | Verdict |
|---|---|---|
| **USWDS** `@uswds/uswds` 3.14.0 | The federal government's design system. Sass + CSS + JS (now built on `lit`). No official React library; `@trussworks/react-uswds` 12.0.0 is the community React wrapper — actively maintained, published two weeks ago, peer-supports React 19. | Reference, not skin |
| **Radix + Tailwind (shadcn/ui)** | Unstyled accessible primitives you copy into your repo and own. | **Recommended base** |
| **React Aria Components** 1.20.0 | Adobe's primitives. Strongest assistive-technology behavior of the three. | Use for the hard components |

### Why not USWDS as the skin

It is genuinely excellent and battle-tested for accessibility, and a state-agency buyer will
recognize it instantly. But its visual identity is unmistakably *federal government*. A
private vendor wearing it looks like it is presenting itself as a government entity, which
is a bad thing to imply to the people who administer federal grants. It also gives you no
differentiation — every page looks like every other .gov — and it drags a Sass build into a
Tailwind project.

What to take from it instead: the **patterns**. Form error handling, required-field marking,
focus states, skip links, alert and validation structures. When a component is ambiguous,
check what USWDS does and do that. In procurement conversations, "we follow USWDS patterns"
is a credible sentence, and it is only credible if it is true.

`@trussworks/react-uswds` stays worth a second look for the **internal rules-admin app**,
where gov familiarity is a feature and visual differentiation is worthless.

### Where to reach past shadcn

shadcn's accessibility is a floor, not a guarantee — you still own contrast, focus order,
form semantics, and live regions. For components where the accessible behavior is genuinely
hard, use the primitive rather than hand-rolling: dialogs, menus, comboboxes, date pickers,
and sortable/filterable tables. React Aria is the stronger choice for the data table, which
this product will lean on heavily.

---

## 4. A design requirement that comes from the domain

The evaluation vocabulary has **six** states, not two: `PASS`, `FAIL`, `RISK`,
`INDETERMINATE`, `MANUAL_REVIEW`, `NOT_APPLICABLE`.

Two things follow, and both are design-system decisions rather than page decisions:

1. **Never encode status by color alone.** WCAG 1.4.1. Every status needs a shape or icon
   and a text label alongside the color. This is also just correct for the product — a
   printed monitoring packet is black and white.
2. **`INDETERMINATE` must not look like a failure.** It is the honest answer when data is
   missing, and it is the status that most distinguishes this product from a spreadsheet.
   Give it a neutral slate, not amber. Amber belongs to `RISK`, which is a real finding.

---

## 5. Palette and type

Institutional and restrained. The page's job is to look like something a business manager
can put in front of a superintendent.

### Type

**Public Sans** — the neutral sans from USWDS, open source. It signals the right register
without cloning USWDS's visual identity, and it was drawn for exactly this reading context.
Self-host via `@fontsource/public-sans` (5.3.0) or `next/font`; do not rely on a CDN, since
a district network may block it.

### Core tokens

| Token | Hex | Contrast on white | On `#F5F7FA` |
|---|---|---|---|
| `ink` — body text | `#14171C` | 17.96 AAA | 16.74 AAA |
| `navy` — primary | `#123A6B` | 11.39 AAA | 10.62 AAA |
| `muted` — secondary text | `#5B6472` | 5.98 AA | 5.57 AA |
| surface | `#FFFFFF` | — | — |
| surface-muted | `#F5F7FA` | — | — |
| border-decorative | `#D8DDE5` | 1.36 — dividers only | — |
| **border-interactive** | `#8A93A3` | **3.10 — meets 1.4.11** | — |

White on `navy` is 11.39:1.

**Do not use `#D8DDE5` on an input outline, checkbox, or any control boundary.** At 1.36:1
it fails WCAG 1.4.11 non-text contrast. It is fine as a decorative rule between sections.
Interactive boundaries use `#8A93A3` or darker.

### Status tokens

| Status | Hex | On white | On `#F5F7FA` |
|---|---|---|---|
| `PASS` | `#1D6B45` | 6.48 AA | 6.04 AA |
| `FAIL` | `#A8231C` | 7.19 AAA | 6.70 AA |
| `RISK` | `#8A5A12` | 5.91 AA | 5.51 AA |
| `INDETERMINATE` | `#4A5568` | 7.53 AAA | 7.01 AAA |
| `MANUAL_REVIEW` | `#5B3E90` | 8.28 AAA | 7.71 AAA |
| `NOT_APPLICABLE` | `#6B7280` | 4.83 AA | 4.50 AA |

Every ratio above was computed, not estimated — see §7. All pass AA for normal text on both
surfaces. `NOT_APPLICABLE` at 4.50 on the muted surface is at the line; do not lighten it.

---

## 6. Page structure

Order matters more than styling here. A district evaluator is scanning for reasons to
disqualify.

1. **Hero.** Lead with the question the product answers, not a feature. "If this district
   were monitored today…" is the headline; the subhead names IDEA Part B fiscal compliance
   so the visitor knows in two seconds whether this is for them.
2. **The problem, in their words.** MOE, excess cost, proportionate share, CEIS. Using the
   exact vocabulary is the fastest credibility signal available and costs nothing.
3. **A worked result.** Show the "Why" panel from §40 of the buildout — status, citation,
   rule-pack version, inputs, arithmetic, source rows. This is the single most persuasive
   asset the product has, and no competitor screenshot looks like it. Build this before
   building a features grid.
4. **What it does not do.** Read-only, never writes back to your SIS or IEP system. This is
   an objection-killer, not a limitation, and it belongs above the fold of the second screen.
5. **Trust row.** FERPA contractual terms, Student Privacy Pledge, SOC 2 status,
   accessibility statement with the ACR linked, data residency. Frontline puts this on the
   page; so should we. Ship it empty of claims we cannot support — an unbacked badge is
   worse than no badge.
6. **Proof.** One named practitioner with their district attributed beats three anonymous
   quotes. Not available pre-pilot — leave the slot designed and unpublished rather than
   filling it with stock.
7. **CTA.** "Request a demo" and "Talk to us about your state." The second converts better
   with SEA-adjacent buyers because it acknowledges that state rules differ, which is the
   thing they are worried about.

---

## 7. Sources, and what I verified myself

**Read directly:**

- [ADA Title II web rule](https://www.ada.gov/resources/2024-03-08-web-rule/) — WCAG 2.1 AA
  standard and the 2027/2028 deadlines, quoted above.
- [Frontline Education — Special Programs](https://www.frontlineeducation.com/special-programs/)
  — the incumbent's design and trust row.
- [USWDS](https://designsystem.digital.gov/) and
  [how to use it](https://designsystem.digital.gov/how-to-use-uswds/).
- Package facts — versions, peer dependencies, React 19 support, last publish dates — read
  from the npm registry directly, not from documentation.
- **Every contrast ratio in §5** was computed with the WCAG relative-luminance formula, not
  taken from a palette tool.

**Not verified:**

- [Accessible design using USWDS](https://www.section508.gov/develop/accessible-design-using-uswds/)
  — surfaced in search, not read.
- Whether Public Sans is served by Google Fonts. Egress from this environment blocked the
  check. The `@fontsource` package was confirmed and is the better route regardless.
- Frontline's page was read through a text extraction, so the *description* of their palette
  and typography is second-hand. The structural facts — testimonial, case study, privacy
  pledge badge, security and accessibility statements — are reliable; "modern, clean
  typography" is not something I saw.
- Whether an independent school district counts as a "special district government" for the
  2028 deadline rather than following its jurisdiction's population. This changes the
  deadline by a year for a large share of the market and is worth a definitive answer
  before it goes in any sales material.
