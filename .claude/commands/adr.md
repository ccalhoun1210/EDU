---
description: Record an architecture decision
argument-hint: <short title of the decision>
---

Write an ADR for: **$ARGUMENTS**

Read the existing ADRs in `docs/adrs/` first so numbering is right and you do not
contradict a standing decision without saying so explicitly.

Use the template in `docs/adrs/TEMPLATE.md`. The sections that matter most:

- **Context** — what forced the decision. Include the constraint, not just the goal.
- **Decision** — stated in one sentence, in the active voice.
- **Consequences** — what this costs, including what it makes harder. An ADR with only
  upside in this section is not finished.
- **What would reverse this** — the concrete signal that should make a future reader
  revisit the decision.

If this decision supersedes an earlier ADR, mark the old one `Superseded by NNNN` rather
than editing it.
