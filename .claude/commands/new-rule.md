---
description: Author a new regulatory rule in a rule pack, citation-first
argument-hint: <rule-id> <CFR or state citation>
---

Author a new rule: **$ARGUMENTS**

Work in this order. Do not skip ahead — the citation constrains everything after it.

1. **Find the authority first.** Locate the actual regulatory text for the citation. Quote
   the operative sentence in your response. If you cannot find it, stop and say so rather
   than writing a rule from memory of how the requirement usually works.
2. **Decide the subject type.** What is being evaluated — an LEA fiscal year, a student
   case, a district-year? This determines what a finding attaches to.
3. **Enumerate the inputs.** Name every canonical fact the rule reads. Each one must be
   something we could actually ingest from a district system. If an input has no plausible
   source, say so — the rule may need to be `MANUAL_REVIEW` instead.
4. **Choose calculator or condition.** Statutory arithmetic → an allow-listed calculator in
   `packages/rulepack-sdk/src/calculators.ts`. Structural or timeline logic → a condition in
   the restricted DSL. Never both a new calculator and no test corpus.
5. **Write the golden tests before the calculator.** If this rule needs a new calculator,
   write its test cases from the statute first, including the boundary cases the regulation
   names explicitly.
6. **Write the YAML** under the correct pack directory, `lifecycle: DRAFT`.
7. **Validate:** `pnpm test --project rulepack-sdk`.

Report at the end: the citation, what the rule concludes, what makes it `INDETERMINATE`,
and what still needs domain and legal review before it can move past DRAFT.
