# 0005. AI output is advisory and never a compliance decision

- **Status:** Accepted
- **Date:** 2026-08-25

## Context

Language models are useful here: classifying uploaded documents, extracting candidate facts
from PDFs, drafting corrective-action language, summarizing monitoring packets, explaining
a result in plain English. They are also non-deterministic, and their output cannot be
reproduced from an input snapshot years later.

A compliance conclusion that cannot be reproduced cannot be defended. If a district is told
it failed maintenance of effort, that conclusion has to be re-derivable, line by line, from
the data and the rule version that produced it.

Document ingestion also creates a prompt-injection surface: uploaded files come from
outside the trust boundary and may contain text engineered to steer a model.

## Decision

Deterministic rule and calculator output is the only source of compliance status. AI output
is advisory: it may propose a fact, a classification, or a draft, and a human validates it
before it becomes authoritative. Document content is always treated as untrusted data,
never as instructions.

## Consequences

- Every AI-derived fact carries a provenance marker distinguishing it from an ingested or
  human-entered fact, and the UI must show that distinction rather than hiding it.
- Extraction is a suggestion queue with a review step, not a write path into canonical
  facts.
- Result explanations are generated from deterministic templates. A model may improve the
  prose; it may not change the numbers or the conclusion.
- All model calls go through a gateway that logs prompts, responses, model version, and
  cost — an unlogged model call is not permitted.
- Customer data is not used for training by default.
- This is slower than letting a model read a district's documents and populate the model
  directly. That speed is exactly what would make a finding indefensible.

## What would reverse this

Nothing in the current regulatory environment. If a monitoring authority were ever to
accept probabilistic determination, this would be revisited — and until then, a request to
"just let the model decide" is a request to break the product's core promise.
