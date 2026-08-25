# 0006. A rule may not evaluate district data on an unverified citation

- **Status:** Accepted
- **Date:** 2026-08-25

## Context

Every rule in this platform carries a citation. Until now, nothing checked that the citation
had ever been read.

That gap is the threat model's "stale regulation" row (§37) and it is quiet in a way the
other rows are not. A cross-tenant leak is discovered. A malformed import is rejected. A rule
implementing a regulation as the author remembered it, or as it stood before an amendment,
produces confident findings with a citation attached, a full provenance chain, and a
reproducible hash — and every one of those findings can be wrong. The provenance chain proves
the finding follows from the rule. It says nothing about whether the rule follows from the law.

§9 of the buildout already asks for a source-document hash and a retrieved date on every
regulatory source, and §41 repeats the requirement for the whole source library. Neither was
wired to anything.

This became concrete rather than theoretical during the first build: the environment the
initial rule content was authored in has no network route to ecfr.gov — outbound requests are
refused by the egress policy. The choice at that moment was to transcribe regulatory text from
memory and let it look authoritative, or to make "nobody has checked this" a state the system
can represent and enforce.

## Decision

`retrieval` on a regulatory source is nullable, and null means nobody has fetched, hashed and
archived the official text.

A rule may cite an unverified source while it is being authored and reviewed — `DRAFT`,
`DOMAIN_REVIEWED`, `LEGAL_REVIEWED`, `QA_APPROVED`. From `STAGED` onward the rule is applied to
real district data (`SHADOW` runs it silently, `ACTIVE` reports its findings), and at those
stages an unverified citation fails validation. `assertRuleSourcesVerified` enforces this and
the rule-pack test suite calls it, so it runs on every pull request.

Verification means: fetch the document at its official URL, archive the exact bytes, record
the SHA-256, the retrieval date, the archive reference and who did it.

## Consequences

**The federal rule corpus ships at `DRAFT`.** That is the honest state, and the platform now
says so out loud instead of implying otherwise through a green test suite. Advancing the corpus
is a specific, small, checkable task — retrieve thirteen documents — rather than an act of
faith.

**Retrieval and correctness are separate gates, and both are required.** The retrieval record
proves the text was obtained. A domain reviewer's approval is what proves the rule implements
it. §35's definition of done requires both, and neither substitutes for the other. It would be
easy to read a green source-verification check as "the rules are right"; it means "the rules
cite documents somebody actually read".

**Re-fetching detects amendment.** Because the hash is over the document bytes, a scheduled
re-fetch that produces a different hash is the §9 "source change detected" trigger, arriving
without anyone having to notice a Federal Register notice.

**A dishonest hash is possible.** Nothing stops someone pasting sixty-four hex characters into
the field. The control is the archive reference: the hash is checkable against archived bytes,
so the lie is discoverable rather than invisible. This is a deterrent, not a proof.

## What would reverse this

Nothing about the gate itself. The specific boundary — `STAGED` rather than `ACTIVE` — is
worth revisiting if shadow evaluation against unverified rules turns out to be a useful
authoring tool. It probably is not: a shadow run's whole purpose is to predict what an active
rule would do, and predicting the behaviour of a rule nobody has checked against its source
answers a question no one asked.
