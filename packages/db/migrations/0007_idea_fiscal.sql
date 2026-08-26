-- ---------------------------------------------------------------------------
-- 0007_idea_fiscal.sql
--
-- Adds: the typed fiscal tables the IDEA Part B module evaluates —
-- federal_awards, idea_allocations, fiscal_periods, expenditure_facts,
-- budget_facts, enrollment_counts, special_ed_counts, moe_adjustments,
-- moe_exceptions, excess_cost_inputs, proportionate_share_inputs,
-- ceis_cceis_inputs.
--
-- Depends on: 0001, 0002 (organizations, fiscal_years, academic_years), 0005
-- (canonical_facts, for the provenance link), 0006 (evidence_items, which an
-- MOE exception must point at).
-- Depended on by: the IDEA fiscal rule pack, which reads these through the
-- canonical fact layer.
--
-- Spec: Master Technical Buildout sections 6 and 12.
-- CLAUDE.md invariants 3, 5, 6 and 10.
--
-- ## Two rules govern every column below
--
-- **Money is NUMERIC(18, 2).** Never float, never double precision, never real.
-- A district's IDEA allocation is exact to the cent and a maintenance-of-effort
-- comparison decides whether that district repays federal funds; an IEEE-754
-- rounding artifact in that comparison is a compliance defect (invariant 5).
-- 18 digits is room for a state agency's whole flowthrough, not just an LEA's.
--
-- **Regulatory dates are DATE.** Every `_on` column here is a calendar date a
-- district or a monitor will cite — a period of performance boundary, a child
-- count date, a board approval date. Only genuine system instants (`_at`) are
-- timestamptz (invariant 6).
--
-- ## And one about privacy
--
-- IDEA Fiscal is designed to run with no student PII (invariant 10, and the
-- IDEA_FISCAL module contract in packages/domain/src/classification.ts). Every
-- count in this file is an aggregate. There is no student identifier column and
-- there must not be one: the module's data contract caps it at CONFIDENTIAL, and
-- a schema change that introduced a student key here would silently break that.
-- ---------------------------------------------------------------------------

-- ----------------------------------------------------------- federal_awards --
--
-- The grant itself, as it appears on the Grant Award Notification. The period of
-- performance matters because IDEA funds carry over (the Tydings amendment gives
-- 27 months), so "which year did this expenditure belong to" is a real question
-- with a documentary answer.
CREATE TABLE federal_awards (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  program text NOT NULL CHECK (program IN (
    'IDEA_611',
    'IDEA_619',
    'IDEA_PART_C',
    'OTHER_FEDERAL'
  )),
  -- FAIN and Assistance Listing (formerly CFDA) number, as printed on the GAN.
  federal_award_identification_number text NOT NULL,
  assistance_listing_number text CHECK (assistance_listing_number ~ '^[0-9]{2}\.[0-9]{3}$'),
  federal_fiscal_year integer NOT NULL CHECK (federal_fiscal_year BETWEEN 1975 AND 2200),
  awarding_agency text NOT NULL,
  pass_through_entity text,
  award_amount numeric(18, 2) NOT NULL CHECK (award_amount >= 0),
  period_of_performance_start_on date NOT NULL,
  period_of_performance_end_on date NOT NULL,
  awarded_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  UNIQUE (tenant_id, organization_id, federal_award_identification_number),
  CHECK (period_of_performance_end_on > period_of_performance_start_on)
);

ALTER TABLE federal_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE federal_awards FORCE ROW LEVEL SECURITY;
CREATE POLICY federal_awards_isolation ON federal_awards
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON federal_awards TO complianceos_app;

-- --------------------------------------------------------- idea_allocations --
CREATE TABLE idea_allocations (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  federal_award_id uuid,
  fiscal_year_id uuid NOT NULL,
  allocation_type text NOT NULL CHECK (allocation_type IN (
    'FLOWTHROUGH_611',
    'FLOWTHROUGH_619',
    'HIGH_COST_POOL',
    'STATE_SET_ASIDE',
    'CARRYOVER'
  )),
  allocated_amount numeric(18, 2) NOT NULL CHECK (allocated_amount >= 0),
  -- Prior-year funds still available under the carryover period. Tracked
  -- separately from the current allocation because the excess cost and CEIS
  -- calculations use different bases.
  carryover_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (carryover_amount >= 0),
  obligated_amount numeric(18, 2) CHECK (obligated_amount IS NULL OR obligated_amount >= 0),
  liquidated_amount numeric(18, 2) CHECK (liquidated_amount IS NULL OR liquidated_amount >= 0),
  allocation_notified_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, federal_award_id) REFERENCES federal_awards (tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_year_id) REFERENCES fiscal_years (tenant_id, id),
  UNIQUE (tenant_id, organization_id, fiscal_year_id, allocation_type),
  CHECK (liquidated_amount IS NULL OR obligated_amount IS NULL
         OR liquidated_amount <= obligated_amount)
);

ALTER TABLE idea_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE idea_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY idea_allocations_isolation ON idea_allocations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON idea_allocations TO complianceos_app;

-- ----------------------------------------------------------- fiscal_periods --
CREATE TABLE fiscal_periods (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  label text NOT NULL,
  period_kind text NOT NULL CHECK (period_kind IN ('MONTH', 'QUARTER', 'YEAR')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  -- Whether the district's books are closed for the period. An open period is
  -- why a fiscal rule may legitimately return INDETERMINATE rather than FAIL:
  -- the numbers are not final yet, and saying so is the honest answer.
  is_closed boolean NOT NULL DEFAULT false,
  closed_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_year_id) REFERENCES fiscal_years (tenant_id, id),
  UNIQUE (tenant_id, fiscal_year_id, label),
  CHECK (ends_on >= starts_on),
  CHECK (is_closed = (closed_at IS NOT NULL))
);

ALTER TABLE fiscal_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_periods_isolation ON fiscal_periods
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON fiscal_periods TO complianceos_app;

-- -------------------------------------------------------- expenditure_facts --
--
-- The general-ledger line as the compliance model sees it.
--
-- `funding_source` distinguishing LOCAL from STATE from LOCAL_AND_STATE is not
-- fussiness: 34 CFR 300.203 lets a district meet maintenance of effort on any of
-- four bases (local only, state and local, and each of those per capita), and a
-- district that cannot separate its local share cannot use two of them.
--
-- `is_excluded_from_moe` with a mandatory reason exists because the exclusions
-- at 34 CFR 300.204 are the single most argued-about part of an MOE review. An
-- excluded dollar with no stated reason is the exact shape of an audit finding.
CREATE TABLE expenditure_facts (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  fiscal_period_id uuid,
  -- The normalized fact this row was derived from, so the fiscal detail inherits
  -- the full lineage back to the imported general-ledger row (invariant 3).
  canonical_fact_id uuid,
  funding_source text NOT NULL CHECK (funding_source IN (
    'LOCAL',
    'STATE',
    'LOCAL_AND_STATE',
    'FEDERAL_IDEA_611',
    'FEDERAL_IDEA_619',
    'OTHER_FEDERAL'
  )),
  expenditure_category text NOT NULL CHECK (expenditure_category IN (
    'INSTRUCTION',
    'RELATED_SERVICES',
    'ADMINISTRATION',
    'TRANSPORTATION',
    'CAPITAL_OUTLAY',
    'DEBT_SERVICE',
    'OTHER'
  )),
  object_code text,
  function_code text,
  program_code text,
  is_special_education boolean NOT NULL,
  is_excluded_from_moe boolean NOT NULL DEFAULT false,
  moe_exclusion_reason text CHECK (moe_exclusion_reason IS NULL OR moe_exclusion_reason IN (
    'VOLUNTARY_DEPARTURE',
    'DECREASE_IN_ENROLLMENT',
    'TERMINATION_COSTLY_PROGRAM',
    'TERMINATION_EXCEPTIONAL_COSTS',
    'ASSUMPTION_BY_HIGH_COST_FUND',
    'CAPITAL_OUTLAY',
    'DEBT_SERVICE'
  )),
  amount numeric(18, 2) NOT NULL,
  posted_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_year_id) REFERENCES fiscal_years (tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_period_id) REFERENCES fiscal_periods (tenant_id, id),
  FOREIGN KEY (tenant_id, canonical_fact_id) REFERENCES canonical_facts (tenant_id, id),
  CHECK (is_excluded_from_moe = (moe_exclusion_reason IS NOT NULL))
);

CREATE INDEX expenditure_facts_by_year
  ON expenditure_facts (tenant_id, organization_id, fiscal_year_id, funding_source);

ALTER TABLE expenditure_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenditure_facts FORCE ROW LEVEL SECURITY;
CREATE POLICY expenditure_facts_isolation ON expenditure_facts
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON expenditure_facts TO complianceos_app;

-- ------------------------------------------------------------- budget_facts --
--
-- The budgeted counterpart, which is what the section 12.1 "eligibility
-- standard" test compares: a district must BUDGET at least as much as it spent
-- (or budgeted) in the comparison year, before the year begins. Budgets are
-- versioned because an adopted budget and its amendments are different
-- assertions made on different dates.
CREATE TABLE budget_facts (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  canonical_fact_id uuid,
  funding_source text NOT NULL CHECK (funding_source IN (
    'LOCAL',
    'STATE',
    'LOCAL_AND_STATE',
    'FEDERAL_IDEA_611',
    'FEDERAL_IDEA_619',
    'OTHER_FEDERAL'
  )),
  expenditure_category text NOT NULL CHECK (expenditure_category IN (
    'INSTRUCTION',
    'RELATED_SERVICES',
    'ADMINISTRATION',
    'TRANSPORTATION',
    'CAPITAL_OUTLAY',
    'DEBT_SERVICE',
    'OTHER'
  )),
  is_special_education boolean NOT NULL,
  budgeted_amount numeric(18, 2) NOT NULL,
  budget_version integer NOT NULL DEFAULT 1 CHECK (budget_version >= 1),
  is_adopted boolean NOT NULL DEFAULT false,
  adopted_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_year_id) REFERENCES fiscal_years (tenant_id, id),
  FOREIGN KEY (tenant_id, canonical_fact_id) REFERENCES canonical_facts (tenant_id, id),
  CHECK (is_adopted = (adopted_on IS NOT NULL))
);

ALTER TABLE budget_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_facts FORCE ROW LEVEL SECURITY;
CREATE POLICY budget_facts_isolation ON budget_facts
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON budget_facts TO complianceos_app;

-- -------------------------------------------------------- enrollment_counts --
--
-- Total enrollment, used as the denominator in the per-capita MOE bases and in
-- the excess cost calculation. An aggregate: no student rows, by design.
CREATE TABLE enrollment_counts (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  count_on date NOT NULL,
  grade_span text NOT NULL DEFAULT 'ALL' CHECK (grade_span IN (
    'ALL',
    'ELEMENTARY',
    'SECONDARY',
    'PRESCHOOL'
  )),
  student_count integer NOT NULL CHECK (student_count >= 0),
  canonical_fact_id uuid,
  source_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic_years (tenant_id, id),
  FOREIGN KEY (tenant_id, canonical_fact_id) REFERENCES canonical_facts (tenant_id, id),
  UNIQUE (tenant_id, organization_id, academic_year_id, count_on, grade_span)
);

ALTER TABLE enrollment_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_counts FORCE ROW LEVEL SECURITY;
CREATE POLICY enrollment_counts_isolation ON enrollment_counts
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON enrollment_counts TO complianceos_app;

-- ------------------------------------------------------- special_ed_counts --
--
-- The IDEA child count (34 CFR 300.641), taken on a single date each year — 1
-- December in most states. `count_on` is a DATE and the whole apparatus depends
-- on it: proportionate share divides by it, and a day's drift moves a child
-- between years.
CREATE TABLE special_ed_counts (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  count_on date NOT NULL,
  age_group text NOT NULL CHECK (age_group IN ('AGE_3_5', 'AGE_6_21', 'AGE_3_21')),
  -- Children with disabilities enrolled in the district's own schools.
  child_count integer NOT NULL CHECK (child_count >= 0),
  -- Parentally placed private school children with disabilities residing in the
  -- district — the numerator of the 34 CFR 300.133 proportionate share.
  parentally_placed_private_count integer NOT NULL DEFAULT 0
    CHECK (parentally_placed_private_count >= 0),
  is_certified boolean NOT NULL DEFAULT false,
  certified_on date,
  canonical_fact_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic_years (tenant_id, id),
  FOREIGN KEY (tenant_id, canonical_fact_id) REFERENCES canonical_facts (tenant_id, id),
  UNIQUE (tenant_id, organization_id, academic_year_id, count_on, age_group),
  CHECK (is_certified = (certified_on IS NOT NULL))
);

ALTER TABLE special_ed_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE special_ed_counts FORCE ROW LEVEL SECURITY;
CREATE POLICY special_ed_counts_isolation ON special_ed_counts
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON special_ed_counts TO complianceos_app;

-- --------------------------------------------------------- moe_adjustments --
--
-- 34 CFR 300.205: a district that meets the eligibility conditions may reduce
-- its required MOE level by up to 50% of the increase in its Part B allocation
-- over the prior year, and must spend the freed local funds on activities
-- authorized under the ESEA. The two amounts are recorded separately because
-- 300.205(d) forbids taking the reduction at all in a year the district also
-- reserves funds for CCEIS under 300.226 — the interaction is the compliance
-- question, and it cannot be asked if the numbers are merged.
CREATE TABLE moe_adjustments (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  adjustment_type text NOT NULL DEFAULT 'VOLUNTARY_50_PERCENT_REDUCTION'
    CHECK (adjustment_type IN ('VOLUNTARY_50_PERCENT_REDUCTION')),
  -- Current-year Part B allocation minus prior-year, which is the base the 50%
  -- cap applies to. Stored rather than recomputed so the reduction a district
  -- actually took is auditable against the allocation it was told at the time.
  allocation_increase_amount numeric(18, 2) NOT NULL CHECK (allocation_increase_amount >= 0),
  reduction_amount numeric(18, 2) NOT NULL CHECK (reduction_amount >= 0),
  -- Local funds freed by the reduction, which must go to ESEA-authorized
  -- activities (300.205(a)).
  esea_authorized_amount numeric(18, 2) CHECK (esea_authorized_amount IS NULL
                                               OR esea_authorized_amount >= 0),
  citation text NOT NULL DEFAULT '34 CFR 300.205',
  approved_on date,
  narrative text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_year_id) REFERENCES fiscal_years (tenant_id, id),
  UNIQUE (tenant_id, organization_id, fiscal_year_id, adjustment_type),
  -- The statutory cap, checked at write time. A row that violates 300.205(a) on
  -- its face should not be storable; the RULE still evaluates the district's
  -- eligibility, but the arithmetic ceiling is not a matter of interpretation.
  CHECK (reduction_amount * 2 <= allocation_increase_amount)
);

ALTER TABLE moe_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE moe_adjustments FORCE ROW LEVEL SECURITY;
CREATE POLICY moe_adjustments_isolation ON moe_adjustments
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON moe_adjustments TO complianceos_app;

-- ----------------------------------------------------------- moe_exceptions --
--
-- The five exceptions at 34 CFR 300.204, exhaustively. They are a closed list in
-- the regulation and therefore a closed list here: a district cannot invent a
-- sixth reason for spending less than last year.
--
-- `narrative` and an evidence link are both required. An exception asserted
-- without documentation is the finding a state monitor writes.
CREATE TABLE moe_exceptions (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  exception_type text NOT NULL CHECK (exception_type IN (
    'VOLUNTARY_DEPARTURE',
    'DECREASE_IN_ENROLLMENT',
    'TERMINATION_COSTLY_PROGRAM',
    'TERMINATION_EXCEPTIONAL_COSTS',
    'ASSUMPTION_BY_HIGH_COST_FUND'
  )),
  amount numeric(18, 2) NOT NULL CHECK (amount >= 0),
  narrative text NOT NULL CHECK (length(btrim(narrative)) > 0),
  evidence_item_id uuid,
  citation text NOT NULL DEFAULT '34 CFR 300.204',
  claimed_on date NOT NULL,
  accepted_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_year_id) REFERENCES fiscal_years (tenant_id, id),
  FOREIGN KEY (tenant_id, evidence_item_id) REFERENCES evidence_items (tenant_id, id)
);

ALTER TABLE moe_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE moe_exceptions FORCE ROW LEVEL SECURITY;
CREATE POLICY moe_exceptions_isolation ON moe_exceptions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON moe_exceptions TO complianceos_app;

-- ------------------------------------------------------ excess_cost_inputs --
--
-- The 34 CFR 300.16 / Appendix A to Part 300 minimum average amount, which a
-- district must spend from state and local funds on a child with a disability
-- before it may spend Part B funds on that child.
--
-- The elementary and secondary computations are separate in the regulation and
-- separate here. The subtracted amounts — capital outlay, debt service, and
-- expenditures from Part B, Title I, Title III — are stored individually rather
-- than pre-netted so that the calculator's arithmetic is reproducible from the
-- inputs a district supplied, which is what makes the explanation credible.
CREATE TABLE excess_cost_inputs (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  grade_span text NOT NULL CHECK (grade_span IN ('ELEMENTARY', 'SECONDARY')),
  total_expenditures_amount numeric(18, 2) NOT NULL CHECK (total_expenditures_amount >= 0),
  idea_part_b_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (idea_part_b_amount >= 0),
  esea_title_i_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (esea_title_i_amount >= 0),
  esea_title_iii_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (esea_title_iii_amount >= 0),
  state_local_capital_outlay_amount numeric(18, 2) NOT NULL DEFAULT 0
    CHECK (state_local_capital_outlay_amount >= 0),
  debt_service_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (debt_service_amount >= 0),
  enrollment_count integer NOT NULL CHECK (enrollment_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_year_id) REFERENCES fiscal_years (tenant_id, id),
  UNIQUE (tenant_id, organization_id, fiscal_year_id, grade_span)
);

ALTER TABLE excess_cost_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE excess_cost_inputs FORCE ROW LEVEL SECURITY;
CREATE POLICY excess_cost_inputs_isolation ON excess_cost_inputs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON excess_cost_inputs TO complianceos_app;

-- ----------------------------------------------- proportionate_share_inputs --
--
-- 34 CFR 300.133: the share of a district's Part B allocation that must be spent
-- on parentally placed private school children with disabilities, computed from
-- the child count on a single date. 300.133(a)(2) requires the 619 (ages 3-5)
-- share to be computed on the preschool count separately, so both allocations
-- and both counts are held here rather than one blended figure.
CREATE TABLE proportionate_share_inputs (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  count_on date NOT NULL,
  public_child_count integer NOT NULL CHECK (public_child_count >= 0),
  parentally_placed_private_count integer NOT NULL CHECK (parentally_placed_private_count >= 0),
  preschool_public_child_count integer NOT NULL DEFAULT 0
    CHECK (preschool_public_child_count >= 0),
  preschool_parentally_placed_private_count integer NOT NULL DEFAULT 0
    CHECK (preschool_parentally_placed_private_count >= 0),
  section_611_allocation_amount numeric(18, 2) NOT NULL CHECK (section_611_allocation_amount >= 0),
  section_619_allocation_amount numeric(18, 2) NOT NULL DEFAULT 0
    CHECK (section_619_allocation_amount >= 0),
  -- What the district actually spent, so the rule can compare obligation with
  -- expenditure rather than only computing the obligation.
  expended_amount numeric(18, 2) CHECK (expended_amount IS NULL OR expended_amount >= 0),
  citation text NOT NULL DEFAULT '34 CFR 300.133',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_year_id) REFERENCES fiscal_years (tenant_id, id),
  UNIQUE (tenant_id, organization_id, fiscal_year_id, count_on)
);

ALTER TABLE proportionate_share_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE proportionate_share_inputs FORCE ROW LEVEL SECURITY;
CREATE POLICY proportionate_share_inputs_isolation ON proportionate_share_inputs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON proportionate_share_inputs TO complianceos_app;

-- ---------------------------------------------------------- ceis_cceis_inputs --
--
-- Coordinated Early Intervening Services. Two regimes share this table because
-- they share arithmetic and differ in obligation:
--
--   * voluntary CEIS, 34 CFR 300.226 — a district MAY reserve up to 15% of its
--     Part B allocation;
--   * mandatory CCEIS, 34 CFR 300.646(d) — a district identified with
--     significant disproportionality MUST reserve exactly 15%, and its use is
--     restricted to comprehensive services.
--
-- `is_mandatory` therefore drives both the direction of the test and its
-- interaction with 300.205, which forbids the voluntary MOE reduction in a year
-- a district reserves for CCEIS.
CREATE TABLE ceis_cceis_inputs (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  reservation_type text NOT NULL CHECK (reservation_type IN ('VOLUNTARY_CEIS', 'MANDATORY_CCEIS')),
  is_mandatory boolean NOT NULL,
  base_allocation_amount numeric(18, 2) NOT NULL CHECK (base_allocation_amount >= 0),
  reserved_amount numeric(18, 2) NOT NULL CHECK (reserved_amount >= 0),
  expended_amount numeric(18, 2) CHECK (expended_amount IS NULL OR expended_amount >= 0),
  students_served_count integer CHECK (students_served_count IS NULL OR students_served_count >= 0),
  -- Set when the SEA has identified the district under 300.646. Recorded here
  -- because it is the fact that turns a permission into an obligation.
  identified_on date,
  citation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_year_id) REFERENCES fiscal_years (tenant_id, id),
  UNIQUE (tenant_id, organization_id, fiscal_year_id, reservation_type),
  CHECK (is_mandatory = (reservation_type = 'MANDATORY_CCEIS')),
  CHECK (is_mandatory = false OR identified_on IS NOT NULL),
  -- The 15% ceiling is arithmetic, not interpretation (300.226(a), 300.646(d)).
  CHECK (reserved_amount * 100 <= base_allocation_amount * 15)
);

ALTER TABLE ceis_cceis_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ceis_cceis_inputs FORCE ROW LEVEL SECURITY;
CREATE POLICY ceis_cceis_inputs_isolation ON ceis_cceis_inputs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON ceis_cceis_inputs TO complianceos_app;
