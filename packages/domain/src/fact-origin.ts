/**
 * Who is entitled to assert a fact.
 *
 * Spec: Master Technical Buildout sections 10 and 37. CLAUDE.md invariants 1 and 3.
 *
 * Classification answers *how sensitive is this*. Origin answers a different and, for a
 * compliance platform, equally load-bearing question: *whose statement is this?* The two are
 * independent. A district's expenditure total and the platform's own prior determination about
 * that district are both CONFIDENTIAL, and only one of them may arrive in a spreadsheet the
 * district uploads.
 *
 * ## The gap this closes
 *
 * A `MappingTemplate` may target any canonical field name — nothing constrained it but
 * uniqueness — and a projected fact bag is flat, so the engine could not tell a figure the
 * district reported from a determination the platform had made. That let an uploaded export
 * supply `comparison_year_moe_status`, `comparison_year_methods_met` and
 * `comparison_required_level_*`: a district could declare its own prior year compliant and set
 * the level carried forward to any number it liked.
 *
 * That is not a rounding error. 34 CFR 300.203(c) exists precisely to stop a failing year from
 * lowering the following year's bar, and those inputs are the mechanism by which the platform
 * applies it. A finding computed from them would carry a complete, correct-looking provenance
 * chain — pointing at the district's own spreadsheet cell.
 *
 * Threat 4 in the threat model covered import *poisoning*: coercion, ragged rows, conflicting
 * values, silent discards. Every mitigation there is about data arriving mangled. None of them
 * is about a perfectly well-formed value in a field the district has no standing to write.
 */

/**
 * Where a canonical fact came from, in descending order of how freely it may be asserted.
 *
 * The order is not a trust ranking to compare against — an SEA determination is not "more
 * trusted" than reference data in a way any code should reason about numerically. Permission
 * is an explicit set per field, never a threshold.
 */
export const FACT_ORIGINS = [
  /** A file the district uploaded. The overwhelming majority of facts, and the least
   *  privileged: a district may report what it spent, not what the platform concluded. */
  'DISTRICT_EXPORT',
  /** A district officer asserted it in the product — an attestation, a claimed exception.
   *  Still the district speaking, but on the record and attributable to a person. */
  'DISTRICT_ATTESTATION',
  /** A prior finalized run of this platform. The only legitimate source of a prior-year
   *  compliance determination. */
  'PLATFORM_DETERMINATION',
  /** A determination of record from the State education agency — an SEA prohibition, an
   *  approved exceptionally-costly-programme finding. */
  'SEA_DETERMINATION',
  /** Reference data the platform maintains: allocation tables, published rates. Not about any
   *  one district. */
  'PLATFORM_REFERENCE',
] as const;

export type FactOrigin = (typeof FACT_ORIGINS)[number];

export function isFactOrigin(value: unknown): value is FactOrigin {
  return typeof value === 'string' && (FACT_ORIGINS as readonly string[]).includes(value);
}

/**
 * Which origins may supply a canonical field, and why.
 *
 * `why` is not decoration. A reviewer asking "should a district be able to state this?" needs
 * the reasoning, and the answer for a field like `federal_funds_excluded` — yes, because it is
 * exactly the district's attestation and nobody else can make it — is not obvious from the
 * name.
 */
export interface FieldAuthority {
  readonly field: string;
  readonly permittedOrigins: readonly FactOrigin[];
  readonly why: string;
}

/** What a field permits when nobody has registered one. See `authorityFor`. */
const UNREGISTERED: readonly FactOrigin[] = ['DISTRICT_EXPORT', 'DISTRICT_ATTESTATION'];

/**
 * Fields whose authority is not the district's.
 *
 * Only the exceptions need registering: an unregistered field defaults to what a district may
 * say, which is the ordinary case and the conservative one for ordinary data. The danger is
 * the reverse — a platform-owned field left unregistered and therefore assertable — so
 * `fact-origin.test.ts` requires every input any implemented calculator declares to appear
 * here. Forgetting is a failing test, not a silent hole.
 */
const AUTHORITIES: readonly FieldAuthority[] = [
  {
    field: 'comparison_year_moe_status',
    permittedOrigins: ['PLATFORM_DETERMINATION', 'SEA_DETERMINATION'],
    why: 'Whether the comparison year met the standard is a determination, not district data. A district that could assert it could declare its own failing year compliant and measure the next year against the level it actually reached — the ratchet-down 34 CFR 300.203(c) exists to prevent.',
  },
  {
    field: 'most_recent_available_year_moe_status',
    permittedOrigins: ['PLATFORM_DETERMINATION', 'SEA_DETERMINATION'],
    why: 'The eligibility side of the same determination, with the same consequence.',
  },
  {
    field: 'comparison_year_methods_met',
    permittedOrigins: ['PLATFORM_DETERMINATION', 'SEA_DETERMINATION'],
    why: 'Which measures the comparison year was met under decides whether the subsequent-years rule is disputed for a measure, and so whether the calculator refuses or answers.',
  },
  {
    field: 'moe_status_source_run_id',
    permittedOrigins: ['PLATFORM_DETERMINATION', 'SEA_DETERMINATION'],
    why: 'The provenance of the prior-year status. A district-supplied value would let the chain point wherever the district chose, which is worse than no chain at all.',
  },
  {
    field: 'comparison_required_level_local',
    permittedOrigins: ['PLATFORM_DETERMINATION', 'SEA_DETERMINATION'],
    why: 'The level that would have been required absent a prior failure is reconstructed from finalized runs. It is the bar the LEA must clear, so an LEA that could state it could set its own.',
  },
  {
    field: 'comparison_required_level_state_local',
    permittedOrigins: ['PLATFORM_DETERMINATION', 'SEA_DETERMINATION'],
    why: 'The combined-measure half of the same carried-forward bar. Registering only the local one would leave the State-and-local measure assertable, and satisfying any single measure satisfies the whole standard — so the unregistered half would be the one an LEA used.',
  },
  {
    field: 'comparison_required_level_child_count',
    permittedOrigins: ['PLATFORM_DETERMINATION', 'SEA_DETERMINATION'],
    why: 'Pairs with the carried-forward level and sits in the denominator of both per-capita measures, so it moves the bar the same way the level does.',
  },
  {
    field: 'sea_prohibition_300_205_ground',
    permittedOrigins: ['SEA_DETERMINATION', 'PLATFORM_DETERMINATION'],
    why: 'A prohibition on the 34 CFR 300.205 adjustment is the State agency acting. It runs against the LEA, so the LEA is not the one who declares it — but neither may an LEA suppress it, which is why it is not district-assertable in either direction.',
  },
  {
    field: 'sea_prohibition_300_205_evidence_ref',
    permittedOrigins: ['SEA_DETERMINATION', 'PLATFORM_DETERMINATION'],
    why: 'The record behind that determination travels with it.',
  },
  {
    field: 'part_b_611_allocation_current',
    permittedOrigins: ['PLATFORM_REFERENCE', 'SEA_DETERMINATION', 'DISTRICT_EXPORT'],
    why: 'A section 611 allocation is a published figure. A district export may carry it for convenience, and a mismatch against the reference table is a reconciliation problem rather than an authority one — but the platform holds the authoritative copy.',
  },
  {
    field: 'part_b_611_allocation_prior',
    permittedOrigins: ['PLATFORM_REFERENCE', 'SEA_DETERMINATION', 'DISTRICT_EXPORT'],
    why: 'The prior-year allocation is the base of the 34 CFR 300.205 ceiling, so moving it moves how much reduction an LEA may claim. Same published-figure reasoning as the current-year allocation.',
  },
  {
    field: 'lea_part_b_subgrant_amount',
    permittedOrigins: ['PLATFORM_REFERENCE', 'SEA_DETERMINATION', 'DISTRICT_EXPORT'],
    why: 'The subgrant caps a repayment, so it runs in the LEA’s favour. A district-supplied figure is accepted but is a reconciliation candidate against the SEA’s record.',
  },
];

const BY_FIELD: ReadonlyMap<string, FieldAuthority> = new Map(
  AUTHORITIES.map((authority) => [authority.field, authority]),
);

/** Every field whose authority has been stated. Ordered, for stable reporting. */
export const REGISTERED_AUTHORITY_FIELDS: readonly string[] = AUTHORITIES.map(
  (authority) => authority.field,
);

export function authorityFor(field: string): FieldAuthority | undefined {
  return BY_FIELD.get(field);
}

/** The origins a field accepts, registered or by default. */
export function permittedOrigins(field: string): readonly FactOrigin[] {
  return BY_FIELD.get(field)?.permittedOrigins ?? UNREGISTERED;
}

export function mayOriginate(field: string, origin: FactOrigin): boolean {
  return permittedOrigins(field).includes(origin);
}

/**
 * Why a fact was refused, in words a reviewer can act on.
 *
 * Returns undefined when the fact is permitted, so a caller reads it as the check itself.
 */
export function originRefusal(field: string, origin: FactOrigin): string | undefined {
  if (mayOriginate(field, origin)) return undefined;
  const authority = BY_FIELD.get(field);
  const allowed = permittedOrigins(field).join(', ');
  const because = authority === undefined ? '' : ` ${authority.why}`;
  return `"${field}" cannot be supplied by ${origin}; it may come only from ${allowed}.${because}`;
}
