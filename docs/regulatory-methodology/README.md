# Regulatory methodology

Every conclusion this platform reaches has to be explainable to someone who did not write
the code: a district finance director, a state monitor, an auditor, an attorney. This
directory holds that explanation, one document per requirement area.

A methodology document is written **before** the calculator it describes, and it is what
the golden test corpus is derived from.

## Required sections

**Authority.** The exact regulatory text, quoted, with citation and a link to the source.
Federal first, then any state overlay, with the state citation given separately.

**What the requirement actually asks.** In plain English, one paragraph, without
restating the citation. The test: could a district finance director read this and recognize
their own situation?

**Inputs.** Every fact required, named exactly as it appears in the rule's `inputs` array,
with the district system it plausibly comes from and what it means. Include the units and
the fiscal period each input belongs to — most errors in fiscal compliance are period
alignment errors, not arithmetic errors.

**Method.** The calculation or test, step by step, in the order a person would do it by
hand. Where the regulation names alternative methods, all of them, with the rule that
selects between them.

**Boundary cases named in the regulation.** Exceptions, adjustments, thresholds, and what
the regulation says happens exactly at a threshold rather than above or below it.

**What makes this INDETERMINATE.** Which missing inputs make the question unanswerable.
Be specific: a missing child count is not the same as a missing expenditure category, and
they produce different explanations for the user.

**What this does NOT conclude.** The limits of the check. A platform that quietly implies
more assurance than it delivers is worse than one that says plainly where its coverage
ends.

**Worked example.** Real arithmetic on synthetic numbers, showing the intermediate values,
matching the golden test corpus exactly. Never use a real district's figures.

## Rules

- Where sources disagree — federal guidance against state guidance, or two readings of the
  same section — document the conflict rather than picking one silently. Say which reading
  the platform implements and why.
- Cite the regulation as it read on a date, and record that date. Regulations are amended.
- No worked example uses real district data, real student records, or real dollar figures
  from an actual LEA.
