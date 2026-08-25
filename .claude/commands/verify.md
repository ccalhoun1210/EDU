---
description: Full pre-PR verification with an honest report
---

Run the complete verification pass and report what actually happened.

```bash
pnpm verify
```

Then check what CI cannot:

1. **Rule packs** — does every rule still carry a citation and a source id?
2. **Invariants** — read the diff against the ten invariants in `CLAUDE.md`. Name any that
   the change touches, and say whether it holds or breaks them.
3. **Data hygiene** — does the diff contain any customer data, real district names, real
   student records, or a populated `.env`?
4. **Scope** — is anything in this change half-finished and user-visible? A disabled
   control, an empty state, a route that 404s?

Report failures plainly with the actual error output. Do not summarize a failing run as
"mostly passing".
