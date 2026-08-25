# ComplianceOS EDU — Master Technical Buildout

**Version:** 0.1 Architecture Blueprint  
**Date:** August 25, 2026  
**Purpose:** Production-grade technical plan for a multi-tenant K-12 compliance assurance platform beginning with IDEA fiscal compliance, special-education monitoring readiness, disproportionality, evidence management, and corrective-action workflows.

---

## 1. Product Definition

ComplianceOS EDU is a **compliance assurance layer**, not a replacement SIS, IEP platform, ERP, or document repository. The product ingests data from systems districts already use, normalizes that data into a canonical model, evaluates versioned regulatory rules, explains every result, links results to evidence, and manages remediation.

The core question the platform must answer is:

> **If this district were monitored or audited today, what requirements appear satisfied, what is at risk, what evidence supports the conclusion, and what needs to happen next?**

The platform should support four major operating modes:

1. **Fiscal assurance** — IDEA MOE, excess cost, proportionate share, CEIS/CCEIS and related federal-funds checks.
2. **Programmatic assurance** — Child Find/evaluation timelines, annual and reevaluation timelines, transition, procedural documentation, and other state/federal monitoring checks.
3. **Monitoring readiness** — mock review protocols, evidence requirements, findings, corrective actions, attestations, and report packages.
4. **Regulatory intelligence** — state/federal rule packs, source citations, effective dates, rule changes, and internal rule publishing.

The long-term platform should extend beyond IDEA into Title I/federal programs, Part C early intervention, Head Start, subrecipient monitoring, Section 504, grant compliance, and other publicly funded compliance domains without changing the core architecture.

---

## 2. Architectural Principles

### 2.1 System of assurance, not system of record

The district's SIS, IEP system, ERP, and HR systems remain systems of record. ComplianceOS ingests and evaluates their data. Initial releases should be **read-only** with no write-back into SIS/IEP/ERP systems.

### 2.2 Deterministic rules own compliance decisions

AI must never be the final compliance decision-maker. Rule outcomes must come from deterministic, versioned logic that can be reproduced later from the same input snapshot and rule-pack version.

AI may classify documents, extract candidate facts, explain results, suggest evidence, summarize monitoring packets, and draft remediation text. Those outputs are advisory and must be validated before becoming authoritative facts.

### 2.3 Every result requires provenance

A reviewer must be able to move from:

`Finding -> Rule -> Rule version -> Regulatory authority -> Input fact -> Source record/file -> Transformation -> Data snapshot`

No finding should exist without this chain.

### 2.4 Regulatory logic is versioned content

Federal, state, and local policy logic must not be hard-coded directly into page components or arbitrary application conditionals. A rule registry and versioned rule-pack system should isolate regulatory content from product code.

### 2.5 Historical reproducibility is mandatory

A finalized assessment is immutable. If data or rules change, create a new run. Never rewrite prior results.

The platform must be able to answer:

> “What did ComplianceOS conclude on October 15, 2027 using the rule pack and district data that existed on that date?”

### 2.6 Minimize student PII

Each module declares its minimum data contract. IDEA Fiscal should operate almost entirely without student PII. Disproportionality should accept aggregate or pseudonymous data where possible. Programmatic SPED modules may require identifiable student records but should collect only necessary fields.

---

## 3. Reference Architecture

```text
                         +---------------------------+
                         |       District User       |
                         +-------------+-------------+
                                       |
                                  HTTPS / SSO
                                       |
                     +-----------------v-----------------+
                     | CloudFront + AWS WAF + Rate Limit |
                     +-----------------+-----------------+
                                       |
                      +----------------v---------------+
                      | Web Application / API Gateway   |
                      | Next.js + TypeScript API        |
                      +----------------+---------------+
                                       |
         +-----------------------------+-----------------------------+
         |                             |                             |
+--------v---------+         +---------v----------+        +---------v---------+
| Domain Services  |         | Integration/Import |        |  Reporting Layer  |
| Modular Monolith |         |     Workers        |        | PDF/XLSX/Packets  |
+--------+---------+         +---------+----------+        +---------+---------+
         |                             |                             |
         |                    +--------v---------+                   |
         |                    | SQS / Step Funcs |                   |
         |                    +--------+---------+                   |
         |                             |                             |
 +-------v--------+         +----------v-----------+       +---------v---------+
 | PostgreSQL     |         | Canonical Data /     |       | S3 Evidence Vault |
 | RDS Multi-AZ   |         | Fact Projections     |       | + Source Files     |
 +-------+--------+         +----------+-----------+       +---------+---------+
         |                             |                             |
         +------------------+----------+-----------------------------+
                            |
                  +---------v-----------+
                  | Compliance Engine    |
                  | Rules + Calculators  |
                  +---------+-----------+
                            |
                  +---------v-----------+
                  | Findings / Controls  |
                  | Evidence / Actions   |
                  +---------+-----------+
                            |
                  +---------v-----------+
                  | Optional AI Gateway  |
                  | extraction / RAG /   |
                  | explanations only    |
                  +----------------------+
```

### AWS deployment

Use AWS as the primary production environment to reduce infrastructure fragmentation and make security documentation easier.

Recommended AWS services:

- Route 53 for DNS.
- CloudFront for edge delivery.
- AWS WAF for request filtering and managed protections.
- ECS/Fargate for web, API, and worker containers.
- Application Load Balancer for application routing.
- RDS PostgreSQL Multi-AZ for transactional data.
- S3 for source files, evidence, generated reports, source snapshots, and import manifests.
- SQS for asynchronous work queues.
- Step Functions for durable multi-step import/report pipelines where state is useful.
- EventBridge for schedules and domain-event routing.
- ElastiCache Redis only when caching/rate-limit requirements justify it.
- KMS for encryption keys.
- Secrets Manager for connector secrets.
- SES for system email.
- CloudTrail, GuardDuty, Security Hub, AWS Config, and centralized logging for security operations.
- AWS Backup for backup policy management.

Do **not** introduce Kubernetes/EKS at the beginning. ECS/Fargate is sufficient for this workload and substantially reduces operational burden.

---

## 4. Technology Stack

### Application stack

| Layer              | Recommendation                                               |
| ------------------ | ------------------------------------------------------------ |
| Language           | TypeScript throughout primary application                    |
| Web                | Next.js + React                                              |
| UI                 | Tailwind CSS + accessible component primitives               |
| Data fetching      | TanStack Query                                               |
| Forms              | React Hook Form + Zod                                        |
| API                | NestJS with Fastify adapter, or a strict Fastify modular API |
| API contract       | OpenAPI 3.x, generated client SDK                            |
| Database           | PostgreSQL                                                   |
| SQL layer          | Drizzle or Kysely; retain direct SQL control                 |
| Background workers | Node/TypeScript worker services                              |
| Object storage     | AWS S3                                                       |
| Queues             | SQS                                                          |
| Durable workflow   | Step Functions where needed                                  |
| IaC                | Terraform                                                    |
| CI/CD              | GitHub Actions using OIDC to AWS                             |
| Unit tests         | Vitest/Jest                                                  |
| Browser tests      | Playwright                                                   |
| Load tests         | k6                                                           |
| Observability      | OpenTelemetry + CloudWatch/Sentry or equivalent              |

Use exact decimal arithmetic for money and ratios. Never use JavaScript floating-point arithmetic for fiscal compliance calculations. Store money as PostgreSQL `NUMERIC` or fixed integer cents where appropriate and use a decimal library in application code.

Use SQL `DATE` values for regulatory dates whenever time-of-day is irrelevant. Avoid converting regulatory deadlines into UTC timestamps and back unnecessarily.

---

## 5. Repository Structure

```text
compliance-os/
  apps/
    web/                 # Customer application
    api/                 # REST API / domain application
    worker/              # Imports, evaluations, reports, notifications
    rules-admin/         # Internal regulatory-content application

  packages/
    domain/              # Core entities and domain services
    db/                  # schema, migrations, data access
    data-contracts/      # canonical import schemas
    rules-engine/        # AST/compiler/runtime
    calculators/         # audited complex regulatory calculations
    rulepack-sdk/        # schemas and publishing tools
    integrations/        # connector abstractions
    documents/           # evidence/document processing
    reporting/           # report templates and exporters
    auth/                # identity, RBAC, ABAC helpers
    ui/                  # shared design system
    observability/       # logs/traces/metrics
    security/            # encryption, redaction, audit helpers

  rulepacks/
    federal/
      idea-b/
      uniform-guidance/
    states/
      alabama/
        idea-b/
        federal-programs/

  infra/
    terraform/
      modules/
      environments/

  docs/
    architecture/
    adrs/
    threat-model/
    data-dictionary/
    api/
    runbooks/
    regulatory-methodology/
```

Use a monorepo and a modular monolith for the primary application. Extract services only when scale, security boundaries, or deployment independence clearly requires them.

---

## 6. Core Domain Model

The platform should model compliance in generic GRC-like concepts while keeping domain-specific financial/student data in typed relational tables.

### Core organization entities

- `organizations`
- `organization_relationships`
- `schools_sites`
- `users`
- `memberships`
- `access_scopes`
- `tenant_settings`
- `academic_years`
- `fiscal_years`
- `calendars`

Organization types should include at least:

- State agency
- LEA/district
- School
- Early-intervention program
- Other monitored entity

Parent/child organization relationships **must not automatically grant data access**. Access is explicit.

### Compliance entities

- `regulatory_sources`
- `requirements`
- `requirement_versions`
- `rule_packs`
- `rule_pack_versions`
- `rules`
- `rule_versions`
- `controls`
- `control_tests`
- `assessment_runs`
- `evaluation_results`
- `findings`
- `finding_dispositions`
- `evidence_items`
- `evidence_links`
- `corrective_actions`
- `action_updates`
- `attestations`
- `report_runs`
- `audit_events`

### Data-ingestion entities

- `source_systems`
- `connector_instances`
- `import_jobs`
- `import_files`
- `import_manifests`
- `raw_records`
- `mapping_templates`
- `mapping_versions`
- `validation_issues`
- `canonical_entities`
- `canonical_facts`
- `fact_provenance`
- `data_snapshots`

### Domain-specific fiscal entities

- `federal_awards`
- `idea_allocations`
- `funding_sources`
- `fiscal_periods`
- `expenditure_categories`
- `expenditure_facts`
- `budget_facts`
- `enrollment_counts`
- `special_ed_counts`
- `moe_adjustments`
- `moe_exceptions`
- `excess_cost_inputs`
- `proportionate_share_inputs`
- `ceis_cceis_inputs`

### Domain-specific student/program entities

Only add these when programmatic SPED modules begin:

- `student_subjects`
- `student_external_ids`
- `student_demographics`
- `special_ed_cases`
- `case_events`
- `referrals`
- `consents`
- `evaluations`
- `eligibility_events`
- `iep_events`
- `service_events`
- `transition_events`
- `discipline_events`

Names and direct identifiers should be separated from analytic/compliance records so modules that do not need identity cannot access them.

---

## 7. Multi-Tenancy and Isolation

Use a pooled multi-tenant database initially, but make isolation a first-class architectural requirement.

Every tenant-owned table must include `tenant_id`.

For sensitive tables:

- Use PostgreSQL Row Level Security.
- Force RLS on application roles.
- Never use the schema-owner role from the application.
- Set tenant context server-side from the authenticated session.
- Never accept arbitrary `tenant_id` values from browser requests.
- Use composite keys/foreign keys containing `tenant_id` where feasible so cross-tenant relationships cannot be created accidentally.

Example concept:

```sql
PRIMARY KEY (tenant_id, id)
FOREIGN KEY (tenant_id, finding_id)
  REFERENCES findings(tenant_id, id)
```

At larger scale, introduce an isolation tier where state agencies or large districts can receive a dedicated database or deployment without changing the domain API. Keep tenant storage routing behind a repository abstraction.

---

## 8. Rule-Pack Architecture

### 8.1 Pack hierarchy

The rule resolver should support layered packs:

```text
Federal baseline
      ↓
State overlay
      ↓
District/local control overlay
```

Examples:

```text
US-FED-IDEA-B-2026
AL-IDEA-B-2026
AL-DISTRICT-LOCAL-2026
```

A state pack may:

- add a requirement;
- define a state timeline;
- define state thresholds;
- add evidence requirements;
- supersede a parameter when legally appropriate;
- add stricter state requirements.

A local policy pack may define internal controls and earlier warning thresholds, but should not silently rewrite the statutory/legal requirement.

### 8.2 Rule version lifecycle

```text
DRAFT
  -> DOMAIN_REVIEWED
  -> LEGAL_REVIEWED
  -> QA_APPROVED
  -> STAGED
  -> SHADOW
  -> ACTIVE
  -> SUPERSEDED
```

Never mutate an active rule version. Publish a new version.

### 8.3 Rule schema

Representative structure:

```yaml
rule_id: IDEA-MOE-ELIGIBILITY-001
pack: US-FED-IDEA-B
jurisdiction: US-FED
program: IDEA_PART_B
subject_type: LEA_FISCAL_YEAR

authority:
  citation: '34 CFR 300.203(a)'
  source_id: REG-US-IDEA-300-203

effective:
  start: 2015-07-01
  end: null

inputs:
  - current_budget_local
  - current_budget_state_local
  - comparison_actual_local
  - comparison_actual_state_local
  - current_child_count
  - comparison_child_count

calculator: idea_moe_eligibility_v1

output_schema:
  status: enum
  qualifying_methods: array
  margin_by_method: object
  missing_inputs: array

severity_on_failure: CRITICAL

explanation_template: moe_eligibility_v1
```

### 8.4 Restricted rule DSL

Do not allow arbitrary JavaScript execution inside rules.

Implement a small declarative AST with operators such as:

- `all`
- `any`
- `not`
- `exists`
- `eq`
- `neq`
- `gt`
- `gte`
- `lt`
- `lte`
- `in`
- `date_add`
- `date_diff`
- `within`
- `calculator`

Compile and validate rules before publication. Complex statutory calculations should call allow-listed, versioned calculator functions.

### 8.5 Calculator registry

Examples:

```text
idea_moe_eligibility_v1
idea_moe_compliance_v1
idea_excess_cost_v1
idea_proportionate_share_v1
idea_cceis_v1
risk_ratio_v1
alternate_risk_ratio_v1
state_child_find_deadline_al_v1
```

Calculator functions must be pure and deterministic. No network calls. No database calls. Input object in, output object out.

### 8.6 Evaluation statuses

Use more nuance than pass/fail:

- `PASS`
- `FAIL`
- `RISK`
- `INDETERMINATE`
- `MANUAL_REVIEW`
- `NOT_APPLICABLE`

Missing required data should usually produce `INDETERMINATE`, not an artificial pass or fail.

### 8.7 Evaluation result

Each result stores:

- tenant
- subject
- assessment run
- rule version
- engine version
- input snapshot ID
- computed input values
- result status
- output JSON
- deterministic explanation
- authority references
- evaluated timestamp
- evaluation hash

The result must be reproducible.

---

## 9. Regulatory Content Pipeline

Create a separate internal regulatory-content workflow.

### Regulatory source record

Store:

- authority/jurisdiction
- source title
- citation
- publishing body
- official source URL
- publication date
- effective date
- source-document hash
- retrieved date
- applicable programs
- superseded source relationship

### Change workflow

```text
Source change detected
 -> Regulatory analyst reviews source
 -> Requirement diff created
 -> Rule change drafted
 -> Domain review
 -> Legal/compliance review
 -> Golden test update
 -> CI validation
 -> Shadow evaluation
 -> Impact report
 -> Publish
```

The system should produce a rule-change impact report:

> “Rule AL-SPED-11.4 changes deadline calculation for X requirement. 17 tenant configurations use this pack. Shadow evaluation changes 64 assessment results: 51 unchanged pass, 8 pass->risk, 5 risk->fail.”

This turns regulatory maintenance into an auditable software-release discipline.

---

## 10. Data Ingestion Architecture

### 10.1 Order of integration support

Build connectors in this sequence:

1. Secure CSV/XLSX upload.
2. Scheduled SFTP imports.
3. OneRoster CSV/REST for organization, enrollment, and roster identity where useful.
4. Ed-Fi API/ODS connectors.
5. Vendor-specific SIS/IEP/ERP connectors.
6. Generic customer API/SFTP adapters.

Do not make the initial product dependent on vendor APIs. Districts should be able to start from exports.

### 10.2 Import pipeline

```text
UPLOAD/CONNECT
 -> QUARANTINE
 -> MALWARE SCAN
 -> HASH / MANIFEST
 -> PARSE
 -> SCHEMA DETECTION
 -> FIELD MAPPING
 -> VALIDATION
 -> NORMALIZATION
 -> RECONCILIATION
 -> CANONICAL FACT PROJECTION
 -> DATA SNAPSHOT
 -> RULE EVALUATION
```

### 10.3 Raw zone

Preserve the exact source artifact and its cryptographic hash. Source artifacts are immutable except for retention/deletion requirements.

### 10.4 Mapping engine

District administrators should be able to map source columns to canonical fields using a visual mapping UI.

Mapping capabilities:

- date parsing
- currency parsing
- enumeration mapping
- boolean normalization
- string trimming/casing
- code crosswalk
- split/merge fields
- default values
- conditional mapping
- calculated fields

Mapping templates are versioned and reusable by tenant/source system.

### 10.5 Validation and reconciliation

Never silently discard records.

Every import ends with a reconciliation summary such as:

```text
Rows received:        14,281
Rows accepted:        14,246
Rows quarantined:         35
Warnings:                112
Duplicate candidates:      7
Missing required fields:  18
```

The district can fix the source or resolve a mapping. Manual corrections should be explicit overrides with reason, actor, timestamp, and source relationship.

### 10.6 Data lineage

Each canonical fact stores provenance:

```text
source_file_id
source_record_id / row
source_field
mapping_version
transformation
import_job_id
source_hash
```

A finding must be able to show the exact underlying source data.

---

## 11. Data Snapshots and Assessment Runs

A compliance assessment should never execute against a moving target.

Create a `data_snapshot` that references the normalized fact versions used for a run.

An `assessment_run` binds:

```text
tenant
organization
module
scope
fiscal/academic year
rule-pack version
engine version
data snapshot
run timestamp
requested by
```

Finalized runs become immutable.

If a user uploads corrected data, run a **new assessment** and compare:

```text
Previous: 11 findings
Current:   6 findings
Resolved:  7
New:       2
Unchanged: 4
```

---

## 12. IDEA Fiscal Module

This should be the first production module because it is high-value, formula-driven, and can minimize student PII.

### 12.1 Maintenance of Effort

Implement separate workflows for eligibility and compliance calculations and support the four federal methods:

- Local funds only
- State and local funds
- Local funds only per capita
- State and local funds per capita

The calculation engine must preserve historical comparison data and encode applicable exception/adjustment logic through versioned domain calculators.

UI should show all methods, not simply one result.

Example:

```text
IDEA MOE — FY2028

Local only                  PASS     +$84,231
State + local               PASS     +$146,002
Local per capita            RISK     +$7.12/student
State + local per capita    FAIL     -$2.42/student

Qualifying methods: 2
Projected year-end status: AT RISK
```

### 12.2 Scenario modeling

Users should be able to clone the current data snapshot into a scenario and adjust:

- planned local expenditures
- planned state expenditures
- child count
- allowable exception amounts
- grant allocation

Scenario results are never mixed with actual compliance results.

### 12.3 Excess cost

Implement elementary and secondary calculations separately. Show every component and excluded amount.

Output:

- average annual per-student expenditure
- minimum non-IDEA spending requirement
- actual non-IDEA spending
- margin/shortfall
- elementary and secondary status

### 12.4 Proportionate share

Add a calculation workspace that records counts, allocations, calculation year, carryover, expenditures, and required consultation/evidence artifacts.

### 12.5 CEIS / CCEIS

Track permitted/required reserves, expenditure progress, service population, year-to-date spend, and relationship to disproportionality decisions.

### 12.6 Fiscal report pack

Generate:

- calculation summary
- methodology
- source-data summary
- assumptions
- exception documentation
- calculation steps
- citations
- reviewer attestation
- data snapshot and rule-pack IDs

---

## 13. Significant Disproportionality Module

This module should be state-parameter driven.

### Required state-pack parameters

- risk-ratio threshold
- alternate-risk-ratio methodology
- minimum cell size
- minimum n-size
- number of years required
- reasonable-progress rules
- applicable categories
- placement categories
- discipline measures
- race/ethnicity group mapping
- suppression rules

### Data modes

Support three privacy modes:

1. **Aggregate** — district uploads counts only.
2. **Pseudonymous** — student-level rows with no names/direct identifiers.
3. **Identifiable** — only when drill-down action lists are required.

### Outputs

- current ratio
- prior-year ratio
- trend
- distance from threshold
- state determination logic
- projected exposure under scenarios
- contributing sites/categories
- data sufficiency warnings

Never use AI to determine the ratio or state threshold outcome.

---

## 14. SPED Programmatic Monitoring Module

### 14.1 Timeline engine

Build a reusable timeline service that supports:

- calendar days
- business days
- school days
- state holidays
- district calendar
- pauses/exceptions
- event-triggered deadlines
- state-specific rules

Rules reference timeline functions rather than implementing date math themselves.

### 14.2 Event model

Special-education case state should be derived from events rather than one giant mutable row.

Representative events:

- referral received
- parent notice
- consent requested
- consent received
- evaluation scheduled
- evaluation completed
- eligibility meeting
- eligibility determination
- IEP meeting
- service start
- reevaluation initiated
- transition assessment
- student invitation
- agency invitation/consent

### 14.3 Risk queue

The work queue should prioritize actionability:

```text
CRITICAL — 2 days remaining; evaluation component incomplete
HIGH     — 9 days remaining; assigned evaluator missing
MEDIUM   — required evidence artifact not found
LOW      — local control recommends review
```

### 14.4 Monitoring simulator

State protocol definitions should describe:

- population
- required checks
- strata
- sample size
- sampling rules
- evidence requirements
- scoring/monitoring categories

Store the random seed and selection criteria for reproducibility.

Never claim the sample is the exact state sample unless the state publishes and the product implements the exact methodology. Label it as a mock/pre-monitoring review.

---

## 15. Evidence Vault

Evidence is a core product, not a file attachment afterthought.

### Evidence metadata

- tenant
- organization
- program
- academic/fiscal year
- source
- document classification
- sensitivity class
- SHA-256 hash
- original filename
- MIME type
- uploaded by
- uploaded at
- retention class
- legal/audit hold
- malware-scan status
- extracted-text status

### Evidence relationships

One evidence object may support multiple requirements, controls, findings, or corrective actions.

Store reviewer disposition:

- candidate
- accepted
- rejected
- superseded

If AI suggests evidence, record model/extractor version and confidence, but a human can accept or reject.

### Document processing

Suggested pipeline:

```text
S3 upload
 -> malware scan
 -> type validation
 -> text extraction/OCR if required
 -> metadata extraction
 -> PII classification/redaction service
 -> optional AI classification
 -> searchable index
```

Do not embed every raw document into a vector database by default.

---

## 16. Corrective Action Management

Model corrective action as a state machine:

```text
DRAFT
 -> ASSIGNED
 -> IN_PROGRESS
 -> EVIDENCE_SUBMITTED
 -> REVIEW
 -> VERIFIED
 -> CLOSED
```

A finding can have one or more actions.

Actions contain:

- owner
- due date
- requirement/finding
- requested evidence
- action plan
- progress notes
- submitted evidence
- reviewer
- verification result
- closure date

Support both child-specific and systemic remediation where the compliance domain requires it.

Provide dashboards such as:

```text
Open findings: 14
Critical: 3
Due within 30 days: 6
Awaiting verification: 4
Past due: 2
```

---

## 17. AI Architecture

### 17.1 LLM gateway

All AI traffic goes through one internal `AI Gateway` service/module.

Responsibilities:

- tenant-level AI enable/disable
- approved-provider selection
- model allow-list
- redaction policy
- prompt template/version management
- structured-output validation
- rate/cost controls
- audit metadata
- safety/prompt-injection controls

### 17.2 Approved AI jobs

Good uses:

- document classification
- extraction of candidate dates/amounts/identifiers from evidence
- evidence-to-requirement matching
- plain-language explanation of deterministic findings
- monitoring-packet summaries
- draft corrective-action text
- regulatory Q&A grounded only in approved official-source corpus

Bad uses:

- deciding disability eligibility
- determining whether a student should receive a service
- final compliance status
- direct autonomous write-back to SIS/IEP systems
- direct model access to transactional Ed-Fi/SIS APIs

### 17.3 Prompt-injection boundary

Treat all imported documents and source-system text as untrusted content.

The LLM must not gain tool permissions from instructions found in documents.

Architecture:

```text
Operational source
 -> normalized data / approved evidence
 -> scoped semantic read model
 -> redaction
 -> model
 -> structured candidate output
 -> validator
 -> human or deterministic rule
```

### 17.4 Regulatory RAG

Build a separate approved regulatory corpus from official sources.

Each chunk includes:

- source ID
- jurisdiction
- citation
- effective dates
- source URL
- source hash
- rule-pack associations

Answers should require citations and indicate the applicable rule-pack version.

### 17.5 No customer-data training by default

Do not use district data to train or fine-tune shared models without explicit contractual permission. Product analytics and model-improvement telemetry must remove student PII.

---

## 18. Identity, RBAC, and ABAC

### Authentication

Support:

- email/password for early pilots if necessary
- mandatory MFA for vendor/admin staff
- SAML 2.0 and OIDC SSO for districts
- SCIM provisioning later

Use a B2B identity provider such as WorkOS/Auth0 or an abstraction that permits replacement.

### Authorization

Combine role-based and attribute-based access.

Representative roles:

- District Administrator
- Special Education Director
- Federal Programs Director
- Fiscal Officer/CSFO
- Compliance Reviewer
- School Administrator
- Evidence Contributor
- Read Only
- State Reviewer (future)

Representative scopes:

- district
- school
- program
- module
- fiscal/academic year
- student-identity access
- export permission
- configuration permission

Access checks must occur server-side and at the database isolation layer.

---

## 19. Security Architecture

### Infrastructure

- Multi-account AWS organization.
- Separate production and non-production accounts.
- Central security/log archive account.
- Private database subnets.
- No publicly reachable RDS instances.
- S3 Block Public Access enabled.
- TLS for all external traffic.
- KMS encryption for RDS, S3, queues, and secrets.
- Secrets Manager for API credentials.
- Stable outbound egress addresses for district allow-listing.
- VPC endpoints where practical.
- WAF managed rule sets and application rate limiting.

### Application security

- parameterized SQL only
- strict schema validation
- CSRF protection where applicable
- secure cookies
- content security policy
- idempotency keys for mutation APIs
- anti-malware file pipeline
- file size/type restrictions
- SSRF protections
- signed webhooks
- connector secret rotation
- no production PII in developer logs

### Supply-chain security

- Dependabot/Renovate
- CodeQL/Semgrep
- secret scanning
- container scanning with Trivy/ECR scanning
- SBOM generation
- signed build artifacts where practical
- branch protection and required reviews
- protected production deployment environment

### Internal access

Vendor support access to customer data should be disabled by default.

Use just-in-time elevation with:

- customer/support reason
- limited scope
- expiration
- audit event
- PII access flag

Do not provide unrestricted “impersonate customer” functionality.

---

## 20. Privacy and Data Governance

### Data classification

At minimum:

```text
PUBLIC
INTERNAL
CONFIDENTIAL
STUDENT_PII
HIGHLY_SENSITIVE
```

Each canonical field should declare a classification.

### Retention engine

Do not hard-code one retention period.

Retention policy is determined by:

- record type
- federal/state program
- tenant policy
- contract
- audit/legal hold
- source-system requirements

The system should calculate a `retain_until` value and prevent automated deletion while a legal/audit hold exists.

### Deletion workflow

Support district-authorized deletion:

```text
Request
 -> authorization
 -> scope preview
 -> hold check
 -> production delete/tombstone
 -> object deletion
 -> search-index removal
 -> backup-expiration tracking
 -> deletion certificate
```

### Lower environments

Only synthetic or irreversibly de-identified datasets should be used in local/dev/staging environments.

---

## 21. Tamper-Evident Audit Log

Do more than normal activity logging.

`audit_events` should include:

- tenant
- actor
- actor type
- action
- object type/ID
- before/after metadata where appropriate
- timestamp
- IP/session
- request ID
- support-access context
- previous event hash
- event hash

Use a per-tenant or partition hash chain so modification/deletion is detectable.

Periodically seal digest roots into a protected archive location.

Audit events should be append-only from the application perspective.

---

## 22. Reporting Architecture

Reports are derived from finalized assessment runs.

Never build a report directly from live mutable tables.

Report formats:

- HTML interactive report
- PDF
- XLSX
- CSV detail
- evidence package ZIP

Every official report includes:

- organization
- review scope
- data snapshot ID
- rule-pack version
- engine version
- generation timestamp
- findings summary
- calculation detail
- source/citation references
- reviewer attestations
- report checksum/ID

Use versioned report templates.

---

## 23. API Design

Prefer a versioned REST API.

Representative endpoints:

```text
POST   /v1/imports
GET    /v1/imports/{id}
POST   /v1/imports/{id}/mapping
POST   /v1/imports/{id}/finalize

GET    /v1/rule-packs
GET    /v1/rule-packs/{id}

POST   /v1/assessments
GET    /v1/assessments/{id}
GET    /v1/assessments/{id}/results
POST   /v1/assessments/{id}/finalize

GET    /v1/findings
GET    /v1/findings/{id}
POST   /v1/findings/{id}/disposition

POST   /v1/evidence
POST   /v1/findings/{id}/evidence

POST   /v1/corrective-actions
PATCH  /v1/corrective-actions/{id}

POST   /v1/reports
GET    /v1/reports/{id}

GET    /v1/integrations
POST   /v1/integrations
POST   /v1/integrations/{id}/sync
```

The API derives tenant context from authentication. Do not expose tenant switching through arbitrary request parameters.

Use:

- cursor pagination
- request IDs
- idempotency keys
- OpenAPI schemas
- consistent error envelopes
- signed outbound webhooks

---

## 24. Front-End Product Architecture

### Main navigation

```text
Overview
Assessments
Risks & Findings
Fiscal
Monitoring
Evidence
Corrective Actions
Reports
Data Sources
Rule Library
Administration
```

### Core dashboard

Show:

- current assurance score by module
- critical/high risks
- deadlines
- unresolved data-quality problems
- upcoming regulatory actions
- current rule-pack version
- last successful import
- last finalized assessment

### Finding detail page

This is one of the most important screens.

It should answer:

1. What failed or is at risk?
2. Why?
3. What rule was applied?
4. What data values drove the result?
5. Where did each value come from?
6. What evidence is required?
7. What should the district do next?
8. Who owns remediation?

The screen should separate:

- **System result**
- **Human disposition**

Example:

```text
System result: FAIL
Human disposition: ACCEPTED EXCEPTION
Reviewer: Jane Smith
Reason: Exception under approved personnel-departure provision
Evidence: 3 documents
```

---

## 25. Internal Rules-Admin Application

This should be a separate product surface for regulatory analysts and authorized internal staff.

Features:

- regulatory source library
- requirement editor
- rule editor
- rule schema validation
- calculator registry browser
- test-case editor
- source/citation linking
- effective-date management
- state-pack inheritance view
- rule diff
- dependency graph
- review/approval workflow
- shadow-run impact analysis
- publication/release notes

Rule publication should create a signed immutable rule-pack artifact.

---

## 26. Testing Strategy

### 26.1 Regulatory golden tests

This is the most important test suite in the company.

Every rule/calculator has:

- passing example
- failing example
- exact boundary example
- missing-data example
- exception example
- historical/effective-date example
- state-overlay example where applicable

Test case structure:

```yaml
case: local-only-moe-pass
rule: IDEA-MOE-ELIGIBILITY-001
inputs:
  current_budget_local: 5250000
  comparison_actual_local: 5100000
expected:
  status: PASS
  qualifying_methods:
    - LOCAL_ONLY
```

### 26.2 Calculator tests

Use exact expected amounts and intermediate steps. Include historical federal examples and state examples where available.

### 26.3 Property-based testing

Use property tests for safe invariants such as amount conservation, ratio bounds, deterministic repeatability, and date-boundary behavior.

### 26.4 Tenant-isolation tests

Automated security tests must try to:

- access another tenant by ID
- attach evidence across tenants
- reuse another tenant's signed upload URL
- query foreign records through filters
- exploit bulk export endpoints

These tests run in CI.

### 26.5 Integration tests

Maintain synthetic connector fixtures for:

- CSV/XLSX
- OneRoster
- Ed-Fi
- SFTP
- vendor-specific APIs

### 26.6 Security tests

- SAST
- dependency scan
- secret scan
- container scan
- DAST
- annual independent penetration test
- prompt-injection test corpus
- malicious-file test corpus

### 26.7 Accessibility

Target WCAG 2.2 AA and prepare a VPAT/ACR before broad district procurement.

---

## 27. CI/CD and Release Engineering

### Branch/release model

Use trunk-based development with short-lived branches and required PR review.

Pipeline:

```text
PR
 -> lint/typecheck
 -> unit tests
 -> rules tests
 -> migration checks
 -> security scans
 -> build containers
 -> integration tests
 -> preview environment
 -> review
 -> merge
 -> staging
 -> smoke tests
 -> production approval
 -> canary/controlled rollout
```

Use GitHub Actions OIDC; no long-lived AWS keys in CI.

### Database changes

Use expand/contract migrations:

1. deploy additive schema
2. deploy compatible application
3. backfill asynchronously
4. switch reads/writes
5. remove obsolete fields in later release

Never couple a destructive migration to the same deployment that changes the application contract.

### Feature flags

Use tenant-aware feature flags for:

- beta modules
- AI features
- new rule-pack versions
- connector rollouts
- state previews

---

## 28. Observability and Operations

Track three layers:

### Application health

- request volume/errors
- API latency
- DB health
- queue depth
- worker failures
- report failures

### Product workflow health

- import success rate
- mapping errors
- assessment-run duration
- number of indeterminate results
- report generation time
- connector freshness

### Security health

- failed login anomalies
- privilege changes
- support-access events
- unusual exports
- blocked WAF requests
- malware detections
- suspicious connector behavior

Never send raw student PII into third-party logging or product-analytics tools.

---

## 29. Disaster Recovery

Initial production targets:

- Multi-AZ production database.
- Continuous/PITR database backups.
- S3 versioning.
- Infrastructure recreated from Terraform.
- Encrypted backup copies.
- Documented restore procedure.
- Quarterly restore test.

Reasonable initial goals:

- RPO: 15 minutes or better for core transactional data.
- RTO: 4 hours for district SaaS.

Large/state customers may later require stronger targets and cross-region standby.

Do not claim an RTO/RPO contractually until it has been repeatedly tested.

---

## 30. Security/Procurement Readiness Package

Create these artifacts before broad district sales:

- security whitepaper
- architecture/data-flow diagram
- privacy policy
- terms of service
- district DPA template
- subprocessor list
- data-element inventory
- retention/deletion policy
- incident-response plan
- business-continuity/disaster-recovery plan
- penetration-test executive summary
- vulnerability-management policy
- secure-development policy
- access-control policy
- encryption standard
- change-management policy
- support-access policy
- cyber liability insurance certificate
- VPAT/ACR
- SOC 2 roadmap

Align contract templates with common K-12 privacy-agreement expectations, including the Student Data Privacy Consortium National Data Privacy Agreement model when relevant.

Do not market the product as “FERPA certified.” Build contractual and technical controls that support districts' FERPA obligations.

---

## 31. Product Analytics

Collect product analytics without student PII.

Core metrics:

- time from tenant creation to first valid data snapshot
- time from upload to first assessment
- percentage of rows mapped automatically
- percentage of findings with accepted evidence
- findings resolved per cycle
- repeat-assessment frequency
- report exports
- module adoption
- support hours per district

Primary product target:

> A repeat district should be able to upload/sync data and get a valid assessment with minimal vendor assistance.

---

## 32. Development Roadmap

### Phase 0 — Domain and architecture foundation (Weeks 1–4)

Deliverables:

- complete federal IDEA Fiscal requirement matrix
- Alabama overlay matrix
- rule-pack schema v1
- canonical fiscal data dictionary
- golden test corpus
- threat model
- system architecture ADRs
- repository and CI baseline

Do not start UI-heavy work until the first rule corpus and calculation test set exist.

### Phase 1 — Platform core (Weeks 5–10)

Build:

- organizations/tenancy
- auth/RBAC
- RLS
- audit log
- source-file upload
- import manifests
- mapping engine
- canonical data store
- data snapshots
- rules runtime
- evaluation-result model
- baseline dashboard shell

### Phase 2 — IDEA Fiscal production alpha (Weeks 11–16)

Build:

- MOE engine
- excess-cost engine
- scenario modeling
- findings UI
- calculation explanation
- fiscal report export
- first Alabama/federal rule pack
- regulatory test suite

Goal: run real district exports against the engine with domain review.

### Phase 3 — Pilot hardening (Weeks 17–24)

Build:

- SFTP scheduled import
- robust mapping templates
- evidence vault
- remediation workflow
- report-pack builder
- data-quality dashboard
- vendor admin tooling
- backup/restore runbook
- security baseline
- DPA/security documentation

Run controlled pilots with a small advisory group.

### Phase 4 — Programmatic SPED module (Months 7–9)

Build:

- student identity vault
- event/timeline engine
- state calendars
- Child Find/evaluation rules
- risk queue
- monitoring simulator
- student-level evidence
- corrective-action expansion

### Phase 5 — Disproportionality and integration platform (Months 9–11)

Build:

- aggregate/pseudonymous import modes
- risk/alternate-risk calculations
- state parameter packs
- trend forecasting/scenario model
- OneRoster integration
- Ed-Fi integration
- outbound webhooks

### Phase 6 — Enterprise readiness (Months 11–12+)

Build/harden:

- SAML/OIDC enterprise SSO
- optional SCIM
- audit export
- advanced support controls
- penetration test remediation
- accessibility remediation/VPAT
- SOC 2 Type I readiness
- SLA monitoring
- enterprise connector framework

### Phase 7 — Multi-state and federal-program expansion (Year 2)

Add:

- second and third state packs
- federal-program monitoring engine
- uniform-guidance controls
- Part C
- Head Start
- state-agency hierarchy/monitoring edition

---

## 33. First 90 Days — Detailed Execution

### Days 1–15

- establish product glossary
- create authoritative regulatory source library
- model IDEA Fiscal requirements
- create calculator test cases before implementation
- establish architecture decision records
- create AWS organization/accounts
- build Terraform foundation
- create monorepo and CI

### Days 16–30

- tenant/org/user schema
- WorkOS/Auth0 integration abstraction
- RBAC + tenant context
- PostgreSQL RLS
- audit-event pipeline
- S3 upload/quarantine
- import manifest and checksum service
- mapping-schema design

### Days 31–45

- CSV/XLSX parser
- mapping UI
- transformation functions
- validation engine
- canonical fiscal facts
- provenance records
- data snapshots

### Days 46–60

- rules AST/compiler
- rule registry
- rule-pack resolver
- calculator registry
- evaluation worker
- deterministic explanation engine
- rule testing CI

### Days 61–75

- MOE calculator
- MOE dashboard
- scenario snapshots
- calculation breakdown UI
- findings model
- reviewer disposition workflow

### Days 76–90

- excess-cost calculator
- report generation
- evidence attachment
- assessment comparison
- pilot import workflow
- security baseline review
- first domain-expert validation session

At Day 90, the objective is not a massive SaaS suite. It is a **credible, auditable IDEA Fiscal assurance product** with enterprise-grade foundations.

---

## 34. Team Structure

A serious first-year team could be:

| Role                              | Responsibility                                                            |
| --------------------------------- | ------------------------------------------------------------------------- |
| Founder/Product/Systems Lead      | product architecture, domain workflow, customer discovery, prioritization |
| Senior Platform Engineer          | backend, rules engine, tenancy, security architecture                     |
| Product/Frontend Engineer         | workbench UX, imports, reporting, accessibility                           |
| Data/Integration Engineer         | canonical model, connectors, mapping, data quality                        |
| Compliance Content Lead           | IDEA/federal/state rule analysis and rule packs                           |
| Security/DevOps Engineer          | infrastructure, incident response, SOC 2 readiness                        |
| Education/IDEA Counsel or Advisor | legal/regulatory interpretation review                                    |

For a founder-led build, security, compliance-content review, and legal review should be brought in as contracted specialists even if engineering remains founder-heavy.

---

## 35. Definition of Done for a Regulatory Rule

A rule is not done because code compiles.

A production regulatory rule requires:

```text
[ ] authoritative source identified
[ ] exact citation stored
[ ] jurisdiction identified
[ ] effective dates identified
[ ] human-language requirement written
[ ] required inputs defined
[ ] missing-data behavior defined
[ ] deterministic logic implemented
[ ] calculation intermediates exposed
[ ] evidence requirements defined
[ ] pass case tested
[ ] fail case tested
[ ] boundary case tested
[ ] exception case tested
[ ] prior-version interaction tested
[ ] domain reviewer approved
[ ] legal/compliance reviewer approved where required
[ ] shadow impact reviewed
[ ] release note written
```

---

## 36. Definition of Done for a Customer Assessment

A finalized assessment should require:

```text
[ ] data import completed
[ ] reconciliation accepted
[ ] required-data quality threshold met
[ ] data snapshot locked
[ ] rule-pack version locked
[ ] assessment run completed
[ ] indeterminate results reviewed
[ ] major findings dispositioned or acknowledged
[ ] evidence linked where available
[ ] reviewer attestation completed
[ ] report generated from immutable run
[ ] report checksum stored
```

---

## 37. Threat Model

| Threat                     | Primary Mitigation                                                        |
| -------------------------- | ------------------------------------------------------------------------- |
| Cross-tenant data leak     | RLS, composite tenant FKs, server-derived tenant context, isolation tests |
| Compromised support user   | JIT support access, MFA, audit, least privilege                           |
| Malicious file             | quarantine, malware scan, content validation                              |
| Import poisoning           | schema validation, provenance, reconciliation, no silent coercion         |
| Prompt injection           | untrusted-document boundary, no LLM tool authority, structured outputs    |
| Rule tampering             | signed immutable rule packs, approval workflow, audit                     |
| Stale regulation           | regulatory source monitor, effective dates, rule release process          |
| Incorrect formula          | golden tests, exact decimals, independent domain review                   |
| Audit-log manipulation     | append-only permissions, hash chain, sealed digests                       |
| Connector credential theft | Secrets Manager/KMS, rotation, scoped access                              |
| Excessive export           | authorization, step-up auth, audit, rate limits                           |
| PII in logs                | centralized redaction and logging schema                                  |
| Deleted required evidence  | retention engine and holds                                                |

---

## 38. What Not to Build Initially

Do not build:

- another IEP authoring platform
- another full SIS
- another ERP
- teacher lesson-plan AI
- student-facing chatbot
- Medicaid billing engine
- gradebook
- scheduling
- large generalized workflow builder
- live autonomous write-back into SIS/IEP platforms
- dozens of custom district forks
- microservice architecture for its own sake
- Kubernetes before operational need exists
- AI that issues final compliance determinations

These create support burden and destroy the narrow product advantage.

---

## 39. Long-Term Moat

The defensible asset is not the dashboard and not the language model.

It is the combination of:

1. **Versioned regulatory graph** — federal/state requirements with effective dates and source provenance.
2. **Audited calculator library** — correct, tested fiscal/programmatic computations.
3. **State rule packs** — reusable jurisdiction knowledge.
4. **Canonical K-12 compliance model** — adapters turn many vendor schemas into one compliance ontology.
5. **Evidence graph** — proof mapped to requirements/findings/actions.
6. **Historical reproducibility** — exact reconstruction of prior assessment outcomes.
7. **Integration library** — repeatable SIS/ERP/IEP connectors.
8. **Customer outcome data** — de-identified understanding of which checks generate real findings and which workflows resolve them.

---

## 40. Core Product Principle

The product should never force a school administrator to trust a black box.

Every material conclusion should have a **Why** button.

A good result looks like this:

```text
STATUS: AT RISK

Requirement:
IDEA Part B — LEA Maintenance of Effort

Authority:
34 CFR §300.203

Rule Pack:
US-FED-IDEA-B-2028.2

Data Snapshot:
DS-01JXYZ...

Why:
Current projected state+local expenditure is $21,640 below the
required comparison level under this method.

Inputs:
Current projection      $4,823,114
Required level          $4,844,754
Difference               -$21,640

Source:
FY2028 Budget Export.xlsx
Rows/fields: ...

Other methods:
2 of 4 currently pass.

Recommended next step:
Review qualifying methods and documented exceptions before fiscal close.
```

That degree of transparency is what will allow ComplianceOS EDU to sell as **assurance infrastructure** rather than another generic dashboard.

---

## 41. External Standards and Regulatory Anchors

The build should maintain a verified source library including, at minimum:

- FERPA and U.S. Department of Education student-privacy guidance, including the school-official/contractor requirements.
- 34 CFR Part 300 (IDEA Part B), including maintenance of effort and the federal appendices for excess-cost and other calculations.
- OSEP general-supervision and SPP/APR guidance.
- 2 CFR Part 200 Uniform Guidance, including internal controls, cybersecurity, monitoring, and record retention.
- State education-agency monitoring manuals, protocols, calculators, and administrative-code sources.
- 1EdTech OneRoster specifications for applicable roster/interoperability exchange.
- Ed-Fi Data Standard/API documentation for K-12 data integration.
- Student Data Privacy Consortium National Data Privacy Agreement materials for procurement/privacy alignment where applicable.
- NIST Zero Trust Architecture and secure-development guidance as security references.

Every source must have retrieval metadata, effective dates where available, and a checksum/snapshot reference.

---

# Recommended Build Decision

Build **one platform with one compliance engine**, beginning with **IDEA Fiscal Assurance** as the first paid module.

The first architectural milestone is not a pretty dashboard. It is a deterministic, tested, source-cited compliance engine capable of ingesting a district export and reproducing an IDEA Fiscal assessment from an immutable snapshot.

Then add evidence/remediation, programmatic SPED monitoring, disproportionality, and additional state/federal rule packs on top of the same core.

That path creates a product that can move from a district-side assurance tool to a multi-state compliance platform—and eventually to state-agency monitoring—without replacing its core architecture.
