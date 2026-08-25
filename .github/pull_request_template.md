## What changed

<!-- One paragraph. What does this do and why now? -->

## Invariants

Check every box, or explain in the box why it does not apply.

- [ ] No compliance decision moved out of deterministic, versioned logic
- [ ] No arbitrary code execution added to rule evaluation
- [ ] Provenance chain intact for any new result or finding
- [ ] No mutation of a finalized run or an ACTIVE rule version
- [ ] No floating-point arithmetic on money or ratios
- [ ] Tenant isolation preserved (`tenant_id`, RLS, server-set tenant context)
- [ ] Missing data yields `INDETERMINATE`, not a manufactured PASS/FAIL
- [ ] No student PII added beyond the module's declared data contract
- [ ] No customer data, real district names, or populated `.env` in the diff

## Regulatory changes

<!-- If this touches a rule pack: cite the authority, name the rule versions added or
     superseded, and state where the change is in the review lifecycle. Delete if N/A. -->

## Scope

- [ ] Everything user-visible in this change is complete — no disabled controls, empty
      tabs, "coming soon", or routes that 404

## Verification

<!-- Paste the result of `pnpm verify`, plus anything you checked by hand. -->
