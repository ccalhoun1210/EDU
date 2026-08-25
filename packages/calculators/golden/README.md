# Golden test corpora

Spec: Master Technical Buildout §26.1 — *"This is the most important test suite in the
company."*

One YAML file per calculator. `src/golden.test.ts` loads every `.yaml` here and runs each case
against the registered calculator; `src/golden.ts` holds the schema.

This directory is tracked even when empty, because `loadGoldenCorpora` treats a missing corpus
directory as an error rather than as "no cases". That is deliberate: a calculators package with
no corpus is a repository fault, and the alternative — an empty result — is a test suite that
passes by finding nothing.

## Writing a corpus

The corpus is written **before** the calculator, from the statute. The test set is the
specification; the function is the implementation. A corpus for a calculator that does not exist
yet reports as a skip naming how many cases are waiting, which is the intended state during
authoring.

```yaml
calculator: idea_moe_eligibility_v1
authority:
  - 34 CFR 300.203(a)
notes: >-
  Anything a reviewer must know before reading the cases — in particular, any place these
  cases encode a platform interpretation rather than a settled reading of the regulation.

cases:
  - case: local-only-budget-exceeds-prior-actual
    intent: pass
    asserts: >-
      An LEA budgeting more local funds than it spent in the comparison year satisfies
      eligibility on the local-only method, and one qualifying method is sufficient.
    inputs:
      current_budget_local: '5250000.00'
      comparison_actual_local: '5100000.00'
    expect:
      status: PASS
      output:
        qualifyingMethods: [LOCAL_ONLY]
      steps:
        required_local: '5100000.00'
    derivation: |
      Required (local only) = comparison-year actual local = 5,100,000.00
      Budgeted local                                       = 5,250,000.00
      Margin = 5,250,000.00 - 5,100,000.00                 =   150,000.00  -> PASS
```

## Rules for a case

- **Money is a quoted decimal string.** Unquoted, YAML reads `5250000.00` as a float and the
  specification itself loses precision. The schema rejects a fractional number for this reason.
- **`derivation` shows the arithmetic in prose.** Nothing executes it. Its job is to let a
  reviewer check an expected value by hand, and to make it obvious when an expectation has been
  adjusted to match a buggy implementation — the derivation and the expectation stop agreeing.
- **`asserts` states the regulatory point** the case pins down, in one sentence. It becomes the
  test name, so a failure reads as a statement about the law rather than as a case id.
- **`output` and `steps` are subset matches.** A case pins the values it is about, not the whole
  result.
- Every calculator must cover `pass`, `fail`, `boundary` and `missing-data`. `exception` and
  `historical` are required wherever the statute has one.
- **Never use real district data.** Synthesize figures at realistic district scale.
