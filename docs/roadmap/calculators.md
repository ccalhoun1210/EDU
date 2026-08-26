# Calculator roadmap

The allow-list in `packages/rulepack-sdk/src/calculators.ts` holds only the calculators the
current release ships rules for, and CI fails on any name there that no rule invokes. This
file holds the names that were removed from it, so the intent is not lost and the promise is
not made twice.

A name moves back to the allow-list in the same change that adds its implementation and its
golden test corpus — never before. The corpus is written from the statute first; the
function is the implementation of the test set, not the other way around.

## Deferred out of the current release

| Calculator                        | What it blocks                                                                   | Why it is not in this release                                                                                                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idea_proportionate_share_v1`     | Equitable services for parentally-placed private school children (IDEA §300.133) | Needs the child-count-based proportionate share method and a consultation record model. The requirement also has a counterparty who can escalate to the SEA, so the evidence trail matters more than the arithmetic. |
| `idea_cceis_v1`                   | GaDOE CFM 18.3 — comprehensive coordinated early intervening services            | Only applies to LEAs identified with significant disproportionality. Depends on the risk ratio calculators below.                                                                                                    |
| `risk_ratio_v1`                   | Significant disproportionality determination                                     | State-determined thresholds, minimum cell sizes and n-sizes vary; this is a state overlay problem before it is a calculator problem.                                                                                 |
| `alternate_risk_ratio_v1`         | Significant disproportionality where the comparison group is too small           | Same as above.                                                                                                                                                                                                       |
| `state_child_find_deadline_al_v1` | Alabama child find timelines                                                     | Out of scope while Georgia is the only modelled state.                                                                                                                                                               |

## Shipped, declared, not yet implemented

These three are on the allow-list because shipped rules reference them. None is implemented,
and every rule that references one is `DRAFT` and must stay there until the implementation
and corpus land.

| Calculator                | Rule                       | Authority         |
| ------------------------- | -------------------------- | ----------------- |
| `idea_moe_eligibility_v1` | `IDEA-MOE-ELIGIBILITY-001` | 34 CFR 300.203(a) |
| `idea_moe_compliance_v1`  | `IDEA-MOE-COMPLIANCE-001`  | 34 CFR 300.203(b) |
| `idea_excess_cost_v1`     | `IDEA-EXCESS-COST-001`     | 34 CFR 300.202(b) |

Build order is `idea_excess_cost_v1` first. It is annual and formulaic rather than
continuous, it is scored as its own indicator in Georgia (CFM 18.2), and no software
anywhere — commercial or state-built — currently computes it.
