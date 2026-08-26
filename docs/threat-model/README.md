# Threat model

Spec: Master Technical Buildout §37. It lists thirteen threats and their primary mitigations.
This document takes each one and records what in this repository actually mitigates it today —
with file references — and what does not exist yet.

A mitigation nobody can point at is a plan. And a threat model listing only what has been done
is marketing, so the gaps are stated in the same voice as the controls.

**Status vocabulary**

| Status        | Meaning                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `ENFORCED`    | Code prevents it, and a test fails if that stops being true.             |
| `PARTIAL`     | Some of the control exists; the gap is named.                            |
| `DESIGNED`    | The shape is decided and represented in types or schema; no runtime yet. |
| `NOT STARTED` | Named here so it is not discovered during a district's security review.  |

---

## 1. Cross-tenant data leak

**Status: PARTIAL**

The severest threat in a multi-tenant compliance platform, and the one a district's security
questionnaire will ask about first.

- Every tenant-owned table carries `tenant_id`, the primary key is `(tenant_id, id)`, and every
  foreign key between tenant-owned tables carries `tenant_id` in the composite reference — so a
  cross-tenant row cannot be created even by buggy application code
  (`packages/db/migrations/`).
- Row Level Security is `FORCE`d, and policies read the tenant from a server-set session GUC,
  never from client input. The application connects as a non-owner role.
- Tenant context is transaction-local, so it cannot leak to the next borrower of a pooled
  connection (`packages/db/src/client.ts`).
- Static assertions over the migration files check the invariants hold for every table, and run
  in CI with no infrastructure.
- The §26.4 attack suite — read another tenant by id, attach evidence across tenants, reach
  foreign rows through a filter, bulk-export across the boundary — runs against a real Postgres.

**Gap.** The application layer above the database does not exist yet, so there is no HTTP
request path to attack. The isolation suite proves the database refuses; it does not yet prove
the API never asks the wrong question. That test arrives with the API.

## 2. Compromised support user

**Status: NOT STARTED**

§19 requires just-in-time elevation with a stated reason, limited scope, an expiry, an audit
event and a PII-access flag; and it forbids unrestricted "impersonate customer".

`audit_events` carries a support-access context field, so the log is shaped for it. Nothing
grants or checks support access yet, because there is no vendor console.

## 3. Malicious file

**Status: DESIGNED**

`ImportRequest` requires a `ScanResult`, and a file whose status is not `CLEAN` never reaches
the parser (`packages/ingest/src/pipeline.ts`). The scan is a precondition the type system
enforces rather than a step in a diagram nothing checks.

**Gap.** No scanner is wired up. The gate is real; the thing behind it is not. A caller must
currently state what the scan concluded, which is honest but is not protection.

## 4. Import poisoning

**Status: ENFORCED**

A district export is untrusted input, and the failure mode is not a crash — it is a plausible
number computed from data that was silently mangled.

- No silent coercion anywhere. A currency string that does not parse is a reported issue on a
  named row and column, never a zero (`packages/ingest/src/transform.ts`).
- The currency parser is deliberately narrow: `1.234,56` in a European locale is **rejected**
  rather than read as `1.234`, which would be wrong by three orders of magnitude.
- Ragged rows are returned _and_ reported, never padded or truncated
  (`packages/ingest/src/csv.ts`).
- Reconciliation throws unless rows received equals rows accepted plus rows quarantined
  exactly (`packages/ingest/src/reconcile.ts`).
- Two rows disagreeing about one fact quarantine the row; the platform picks neither
  (`packages/ingest/src/pipeline.ts`), and `projectFactBag` throws rather than choosing.
- An unmapped enumeration value is an error, not a pass-through — a category silently dropped
  from a count is a wrong denominator.

## 5. Prompt injection

**Status: NOT STARTED**

No AI is wired into this build. §17.3's boundary — imported documents are untrusted, the model
gets no tool authority, output is structured and validated before it becomes a fact — is
recorded in ADR 0005 and must be built with the first AI feature, not after it.

## 6. Rule tampering

**Status: PARTIAL**

- Rules are declarative data in a restricted DSL with no escape into JavaScript, and the
  calculator allow-list is checked at publication, including through nested `compute` operands
  (`packages/rulepack-sdk/src/expression.ts`).
- A local pack cannot redefine a rule id owned by a federal or state pack, whatever the as-of
  date (`packages/rules-engine/src/resolve.ts`). A district cannot quietly relax a federal
  requirement and have the platform report compliance with it.
- The lifecycle refuses to let an unreviewed rule reach a district: a run is `official` only
  when every rule it evaluated was `ACTIVE`.

**Gap.** §25 requires rule publication to produce a _signed_ immutable artifact. Packs are
loaded from the filesystem and validated; they are not signed, so integrity currently rests on
repository access control and code review rather than on a signature.

## 7. Stale regulation

**Status: ENFORCED** (for the gate; see the caveat)

A rule written from memory, or from a regulation as it stood before an amendment, produces
confident findings that are wrong and that look exactly like findings that are right.

A source carries a retrieval record — retrieved date, document hash, archive reference, who —
and a rule citing a source without one cannot reach `STAGED`, `SHADOW` or `ACTIVE`
(`packages/rulepack-sdk/src/source.ts`, ADR 0006). CI enforces it.

Because the hash is over the document bytes, a scheduled re-fetch producing a different hash is
the §9 "source change detected" trigger.

**Caveat that matters.** The gate proves a citation points at a document somebody retrieved. It
does not prove the rule implements that document — that is a domain reviewer's judgement, and
§35 requires both. A green source check must never be read as "the rules are right".

**Current state:** all thirteen federal sources are unretrieved, so the entire rule corpus is
held at `DRAFT`. That is the gate working, not the gate failing.

## 8. Incorrect formula

**Status: PARTIAL**

- All money and ratio arithmetic is exact decimal; `parseFloat` is banned by ESLint and
  `canonicalize` refuses to hash a fractional number, so a float cannot reach a snapshot
  without something failing loudly (`packages/domain/src/money.ts`, `canonical.ts`).
- Statutory arithmetic lives in versioned calculators with golden test corpora authored from
  the statute before the implementation.
- Calculators are pure — no clock, no network, no database — so a result is reproducible.

**Gap.** Independent _domain_ review. The specifications were derived without access to the
regulatory text (see §7 above), and several algorithm decisions are explicitly marked as
platform interpretations awaiting legal review rather than as settled readings of the
regulation. Those are listed in each calculator's methodology document.

## 9. Audit-log manipulation

**Status: ENFORCED**

`packages/domain/src/audit.ts` chains each event to its predecessor over a canonical
serialization. The chain detects the four actual attacks — mutating an event, deleting one from
the middle, inserting one, and reordering — not merely mutation, which a naive per-row hash
would be all that catches.

`audit_events` has no `UPDATE` or `DELETE` privilege for the application role and a trigger
that raises regardless, so append-only is a database property.

**Gap.** ADR 0002 notes it: there is no WORM storage. Sealed digest roots live in the same
database as the events. Hash chaining detects tampering; it does not prevent an actor with
database ownership from rewriting the chain wholesale. Closing that means S3 Object Lock or an
external seal.

## 10. Connector credential theft

**Status: NOT STARTED**

No connectors exist. §10.1 sequences them after file upload deliberately.

## 11. Excessive export

**Status: NOT STARTED**

No export path exists yet. When one does it needs authorization, step-up auth, an audit event
and a rate limit — and the audit event is the part most likely to be forgotten, because the
other three are visible in the UI and it is not.

## 12. PII in logs

**Status: DESIGNED**

Each module declares a ceiling on the data classification it may read, and IDEA Fiscal's
ceiling is below `STUDENT_PII` — enforced by a test
(`packages/domain/src/classification.ts`). No logging exists yet, so there is nothing to
redact; the redaction schema must land with the logger rather than after it.

## 13. Deleted required evidence

**Status: ENFORCED**

`packages/domain/src/retention.ts` resolves the _longest_ applicable retention period rather
than the first match, so a shorter tenant policy cannot undercut a federal floor. A legal or
audit hold blocks deletion regardless of whether the retention period has expired — a hold
outranks expiry, and an expired record under hold is still undeletable.

Retention anchors to a named event rather than to record creation, because 2 CFR 200.334's
period runs from submission of the final expenditure report, not from when the row was written.

---

## Threats this table does not cover

Named so their absence is deliberate.

- **Denial of service.** Deferred to the platform layer (§19's WAF and rate limiting). No
  application-level quota exists.
- **Insider modification of a rule pack via repository access.** Mitigated by branch protection
  and required review, which are process controls outside this codebase. Signed pack artifacts
  (§6 above) would move it inside.
- **Supply chain.** §19 lists Dependabot, CodeQL, secret and container scanning, and SBOM
  generation. CI currently runs none of them.
- **Availability and recovery.** §29's RPO/RTO targets are untested, and §29 itself says not to
  claim them contractually until they have been.
