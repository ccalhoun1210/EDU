# 0002. Deploy on Vercel rather than AWS

- **Status:** Accepted
- **Date:** 2026-08-25

## Context

The master technical buildout (§3) specifies AWS: ECS/Fargate, RDS Multi-AZ, S3, SQS, Step
Functions, KMS, Terraform. That is the right architecture for a funded team with a platform
engineer. This project is being built by a very small team, and the scarce resource is
builder hours, not infrastructure spend. A Terraform foundation, an AWS Organization, ECS
task definitions, and a VPC are weeks of work that produce no regulatory logic.

The architecture in the buildout is not actually AWS-dependent. Multi-tenancy, rule
versioning, provenance, immutability, and reproducibility are database and application
concerns. What AWS supplies is compute, storage, queueing, and a security posture that
public-sector procurement recognizes.

## Decision

Deploy on Vercel with Neon Postgres, Inngest for durable background work, and Vercel Blob
for object storage; keep every one of those behind an interface so the storage and queue
layers can move without touching domain code.

| Buildout (AWS)          | Here                                                              |
| ----------------------- | ----------------------------------------------------------------- |
| ECS/Fargate + ALB       | Vercel (Next.js app + route handlers)                             |
| RDS PostgreSQL Multi-AZ | Neon Postgres — pooled URL for the app, direct URL for migrations |
| SQS + Step Functions    | Inngest — durable multi-step functions with retries and replay    |
| S3                      | Vercel Blob (see the open question below)                         |
| EventBridge schedules   | Vercel Cron + Inngest schedules                                   |
| Terraform               | Vercel project config + `vercel.json`                             |
| CloudFront + WAF        | Vercel edge network + platform firewall                           |

Postgres Row Level Security, forced on the application role, is unchanged — it is a
Postgres feature and works identically on Neon.

## Consequences

**What this buys.** Preview deployments per pull request, which the buildout's CI pipeline
(§27) asks for and which would otherwise be its own project on AWS. Neon database branching
pairs with those previews so a migration can be exercised against a real branch of the
schema before merge. No VPC, no cluster, no Terraform state to manage. Realistically weeks
of Phase 0/1 time returned to regulatory work.

**What it costs.**

1. **Public-sector procurement posture is weaker.** State agencies and larger districts run
   security reviews, and some ask for StateRAMP or FedRAMP authorization. AWS has an answer
   there; a Vercel + Neon + Inngest stack has more vendors to document and, as far as
   this decision is aware, no FedRAMP path. FERPA itself imposes contractual obligations
   rather than a certification, so this is a sales-friction problem, not a legal blocker —
   but it is the single most likely reason this decision gets revisited.
2. **No WORM storage for evidence or the audit log.** The buildout requires a
   tamper-evident audit log (§21) and an evidence vault whose contents can support a
   finding under audit. S3 Object Lock provides write-once retention that a Blob store does
   not. Until that gap is closed, tamper evidence has to come from hash chaining in the
   database rather than from the storage layer refusing to overwrite.
3. **No customer-managed encryption keys.** KMS-style key control is a common line item in
   district security questionnaires.
4. **Bounded function duration.** Long import and evaluation runs cannot be one request.
   This is why Inngest is in the stack rather than optional — work is decomposed into
   durable steps from the start, not retrofitted when a large district's file times out.
5. **Three vendors instead of one** for the security documentation package (§30).

**Not affected.** Every architectural invariant in `CLAUDE.md`. Determinism, versioned rule
packs, the provenance chain, run immutability, tenant isolation via RLS, and decimal money
arithmetic are all application and database properties that survive the move intact.

## Open questions to close before the first district contract

These bear on procurement and have **not** been verified as part of this decision. They are
listed here so they are answered deliberately rather than discovered during a security
review.

- Current SOC 2 / StateRAMP / FedRAMP status for Vercel, Neon, and Inngest.
- Whether each vendor will sign the data protection terms a district or SEA requires, and
  whether any of them are willing to be named as a school official under FERPA's
  contractor exception.
- Data residency guarantees and region pinning for each vendor.
- Whether the evidence vault must be on WORM storage at contract signature, or whether
  database hash chaining is accepted.

## What would reverse this

Any of: a state agency contract that requires StateRAMP; an auditor rejecting hash-chained
tamper evidence in favour of WORM storage; or import volumes where per-request compute cost
on Vercel exceeds what a small ECS service would cost. The most likely partial reversal is
narrow — the evidence vault and audit archive moving to S3 with Object Lock while the
application stays on Vercel. Keeping storage behind an interface is what makes that a
week's work instead of a migration.
