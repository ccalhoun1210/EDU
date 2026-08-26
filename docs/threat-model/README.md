# Threat model

Spec: Master Technical Buildout §37. It lists thirteen threats and their primary mitigations.
This document takes each one and records what in this repository actually mitigates it today —
with file references — and what does not exist yet.

A mitigation nobody can point at is a plan. And a threat model listing only what has been done
is marketing, so the gaps are stated in the same voice as the controls.

Entries 1–13 are §37's, in its order. Entry 14 is not in §37: it arrived with the product
surfaces, because a browser-rendered page is a threat surface the buildout's list predates.

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

A deployment with no scanner cannot honestly claim `CLEAN`, and claiming `PENDING` would
promise a scan nobody will run. `NOT_SCANNED` is the terminal status for that case
(`IMPORT_SCAN_STATUSES`), and it does not pass the gate on its own: `runImport` refuses it
unless the caller sets `acknowledgeUnscanned`, and the web upload path sets that only when
the deployment has set `UPLOAD_ACCEPT_UNSCANNED=true`. An import admitted that way carries a
`FILE_NOT_SCANNED` warning, and the verdict is stored on `import_files` — status, scanner and
time together, by CHECK — so a monitor asking eighteen months later whether this general
ledger was ever scanned gets an answer instead of a silence.

**Gap.** No scanner is wired up. The gate is real; the thing behind it is not. What has
changed is that the absence is now recorded rather than papered over, and that a deployment
has to write down that it is accepting the risk. That is honesty, not protection: a
deployment taking uploads from outside the operator's own organization needs a scanner.

## 4. Import poisoning

**Status: ENFORCED**

A district export is untrusted input, and there are two distinct failure modes. Neither is a
crash. One is a plausible number computed from data that was silently mangled; the other is a
perfectly well-formed value in a field the district has no standing to write at all.

### Mangling

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

### Authority

This half was missing, and the entry claimed ENFORCED without it. A `MappingTemplate` may
target any canonical field name — the schema constrained only uniqueness — and a projected
fact bag is flat, so by the time the engine saw a value it could not tell a figure the
district reported from a determination the platform had made.

That let an uploaded spreadsheet supply `comparison_year_moe_status`,
`comparison_year_methods_met` and `comparison_required_level_*`. A district could declare its
own prior year compliant and set the level carried forward to whatever it liked — and
34 CFR 300.203(c) exists precisely to stop a failing year from lowering the next year's bar.
The resulting finding would have carried a complete, correct-looking provenance chain, pointing
at the district's own cell. Nothing in the list above would have fired: the value parses, the
row is well-formed, the reconciliation balances.

- Every `CanonicalFact` carries a **`FactOrigin`** alongside its classification. Classification
  says how sensitive a value is; origin says whose statement it is
  (`packages/domain/src/fact-origin.ts`).
- The ingest pipeline stamps `DISTRICT_EXPORT` on everything it produces, and it is not a
  parameter. An import cannot elect to speak with the platform's authority.
- Each canonical field states which origins may supply it, with the reasoning written next to
  it. `projectFactBag` refuses a fact whose origin is not permitted — **throwing rather than
  dropping**, because dropping would make the field absent, the calculator would return
  INDETERMINATE, and the district would be told it was missing a figure it had supplied, hiding
  an attempted assertion behind a data-quality message.
- Authority is checked at projection because that is the last point at which a fact still knows
  where it came from.
- `origin` is inside the snapshot content hash. Outside it, a sealed snapshot could be edited
  to relabel a district's figure as a platform determination with `verifySnapshot` still
  returning true.
- An unregistered field defaults to what a district may assert, which is right for ordinary
  data and wrong for a determination — so `packages/calculators/src/fact-origin.test.ts`
  requires every input any implemented calculator declares to have an explicit answer, as a
  registry entry or as a line in its district-may-assert list. A new platform-owned input that
  nobody classifies fails the build rather than shipping as a hole.

### Shape

Origin says who asserted a fact; it does not say what kind of source is behind it, and until
those came apart the record could describe the wrong one. `FactProvenance` had exactly one
shape — a row in an uploaded file — so a prior-year determination carried forward from a
finalized run was recorded with `sourceRow: 1` and a `sourceHash` naming an unrelated upload.
Not merely unhelpful: a finding-detail screen citing row 1, column
`comparison_year_moe_status` sends a business officer looking for a cell that does not exist,
and a monitor who goes looking finds a citation that is false.

Worse, nothing bound the fact to the run it named. `moe_status_source_run_id` was a string
beside another string; any value could sit next to any run id and the chain would look
complete all the way back to a finalized run that concluded the opposite.

- `FactProvenance` is a discriminated union. `FILE_ROW` describes a cell in an export;
  `DETERMINATION` describes a computation, naming the run, the rule, the pack version, the
  engine, the snapshot it read and the **evaluation hash** of the result carried forward
  (`packages/ingest/src/provenance.ts`).
- `buildSnapshot` refuses a fact whose provenance shape does not match what its origin claims
  — checked at sealing, because once an incoherent chain is inside the content hash the hash
  certifies the incoherence.
- Three origins — `DISTRICT_ATTESTATION`, `SEA_DETERMINATION`, `PLATFORM_REFERENCE` — have no
  shape designed yet and are **refused** rather than squeezed into one of the two that exist.
  Nothing produces them today, so nothing is blocked; the first producer gets an error naming
  what has to be built. Reusing a shape for something it does not describe is what produced
  this entry.
- `carryForward` is the only sanctioned way to build a determination fact. It reads the value
  out of the finalized `EvaluationResult` — there is no parameter for it — and stamps that
  result's own identifiers on. A carried-forward fact cannot state a status the run it cites
  did not reach (`packages/assurance/src/carry-forward.ts`).
- `verifyCarriedForward` closes the loop from the other side: the named run and rule must be
  among the finalized results, the evaluation hash must match, and the value must still read
  out of the recorded path. The hash covers the rule, pack version, engine, snapshot, inputs
  and result, and excludes the timestamp and run id — so it survives re-running a prior year
  unchanged and breaks the moment that conclusion is different.
- The whole determination record is inside the snapshot content hash, evaluation hash
  included. Outside it, the binding could be repointed at a run that concluded the opposite
  and `verifySnapshot` would certify the result.

Still open: the binding is a hash comparison against results the caller supplies, not a
signature. A caller that supplies a fabricated `EvaluationResult` alongside a fabricated fact
gets a consistent pair. Closing that means finalized results being read from storage that the
application cannot rewrite — an append-only table with its own integrity chain (§21) — rather
than passed in.

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

## 14. Injected script in a product surface

**Status: PARTIAL**

The surfaces render values a district supplied — a filename, a raw cell as it appeared, an LEA
name. React escapes them, and nothing here builds HTML by hand or uses `dangerouslySetInnerHTML`,
so the ordinary reflected path is closed by construction. What that does not cover is a bug
that reopens it later, which is what a Content-Security-Policy is for.

The policy was declared and, for a while, wrong in a way that read as strict. It said
`script-src 'self'` on the premise that the application uses no inline script; the App Router
streams its server-rendered payload through inline `<script>` tags, so the policy blocked the
framework's own scripts and React never hydrated. Nothing on these pages needs hydration yet,
which is precisely why it went unnoticed — the symptom was console errors, not a broken
screen, and the first interactive control would have found it the hard way. Before that it
lived in a `vercel.json` the deployment did not read, and was absent entirely.

- The policy is issued per request by `apps/web/src/middleware.ts` with a fresh nonce, set on
  the request headers so the renderer stamps it onto the scripts it emits and on the response
  so the browser enforces it. `strict-dynamic` then covers the chunks those scripts load
  without the policy enumerating them.
- It is declared in exactly one place. A second `Content-Security-Policy` from
  `next.config.ts` would be enforced as the intersection of the two, silently reinstating the
  bug.
- `scripts/smoke-web.mjs` fails the build if the header is missing, if it carries no nonce, or
  if any inline script in the served HTML lacks that nonce. Two of the three failures above
  were "declared and never checked"; this is the check.
- `frame-ancestors 'none'`, `object-src 'none'`, and the static headers — HSTS, `nosniff`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` — are asserted by the same test.

**Gap.** `style-src` still allows `'unsafe-inline'`, because Next inlines critical CSS and a
style nonce would have to be threaded through every stylesheet link the framework emits.
Inline style is a much weaker vector than inline script, but it is not nothing: it permits
appearance-based deception of a reader on a compliance screen. Narrowing it is separate work.

There is also no authenticated surface yet, so CSRF, session fixation and clickjacking beyond
`frame-ancestors` are untested rather than mitigated — they arrive with authentication.

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
