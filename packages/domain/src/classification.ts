/**
 * Data classification and module data contracts.
 *
 * Spec: Master Technical Buildout sections 2.6 and 20. CLAUDE.md invariant 10.
 *
 * Every canonical field declares a classification. Every module declares the highest
 * classification it is permitted to read. IDEA Fiscal is designed to run with no student
 * PII at all, and the point of putting that in code rather than in a design document is
 * that a later change which quietly introduces a student identifier into the fiscal module
 * fails a test instead of shipping.
 */

/** Section 20 — ordered from least to most sensitive. Order is meaningful. */
export const DATA_CLASSIFICATIONS = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'STUDENT_PII',
  'HIGHLY_SENSITIVE',
] as const;

export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

const RANK: ReadonlyMap<DataClassification, number> = new Map(
  DATA_CLASSIFICATIONS.map((classification, index) => [classification, index]),
);

function rank(classification: DataClassification): number {
  return RANK.get(classification) ?? DATA_CLASSIFICATIONS.length;
}

/** True when `a` is at least as sensitive as `b`. */
export function atLeastAsSensitive(a: DataClassification, b: DataClassification): boolean {
  return rank(a) >= rank(b);
}

/** The most sensitive classification in a set. An empty set is PUBLIC. */
export function highestClassification(
  classifications: readonly DataClassification[],
): DataClassification {
  return classifications.reduce<DataClassification>(
    (highest, candidate) => (atLeastAsSensitive(candidate, highest) ? candidate : highest),
    'PUBLIC',
  );
}

/**
 * A module's minimum data contract (section 2.6).
 *
 * `maximumClassification` is a ceiling, not a target: the module may read nothing more
 * sensitive than this. A module that does not need identity cannot be handed it.
 */
export interface ModuleDataContract {
  readonly moduleId: string;
  readonly title: string;
  readonly maximumClassification: DataClassification;
  /** Why this ceiling is where it is. Read by a district's privacy reviewer. */
  readonly rationale: string;
}

export const MODULE_DATA_CONTRACTS: readonly ModuleDataContract[] = [
  {
    moduleId: 'IDEA_FISCAL',
    title: 'IDEA Part B fiscal assurance',
    maximumClassification: 'CONFIDENTIAL',
    rationale:
      'Operates on district-level budget and expenditure aggregates and on child counts. ' +
      'No student-level record is required to compute maintenance of effort, excess cost, ' +
      'proportionate share or CEIS reservation, so none is accepted.',
  },
  {
    moduleId: 'DISPROPORTIONALITY',
    title: 'Significant disproportionality',
    maximumClassification: 'STUDENT_PII',
    rationale:
      'Runs on aggregate counts by default. Pseudonymous student rows are supported for ' +
      'districts that cannot produce reliable aggregates, and identifiable rows only where ' +
      'a district explicitly needs a drill-down action list.',
  },
  {
    moduleId: 'SPED_PROGRAMMATIC',
    title: 'Special education programmatic monitoring',
    maximumClassification: 'STUDENT_PII',
    rationale:
      'Timeline compliance is a per-child question and cannot be answered from aggregates. ' +
      'Direct identifiers are held separately from the analytic case record so that a rule ' +
      'evaluating a Child Find deadline never reads a student name.',
  },
];

const CONTRACTS_BY_ID: ReadonlyMap<string, ModuleDataContract> = new Map(
  MODULE_DATA_CONTRACTS.map((contract) => [contract.moduleId, contract]),
);

export function moduleDataContract(moduleId: string): ModuleDataContract | undefined {
  return CONTRACTS_BY_ID.get(moduleId);
}

/**
 * Whether a module may read a field of the given classification.
 *
 * An unknown module id is denied. Failing closed matters more here than a helpful error:
 * a typo in a module name must not open a path to student data.
 */
export function moduleMayRead(moduleId: string, classification: DataClassification): boolean {
  const contract = CONTRACTS_BY_ID.get(moduleId);
  if (contract === undefined) return false;
  return atLeastAsSensitive(contract.maximumClassification, classification);
}
