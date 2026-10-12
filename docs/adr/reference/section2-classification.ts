/**
 * Pure reference model for ADR-08 Section 2 classification decisions.
 *
 * This is NOT the egress gateway. It is a pure function that the future
 * `@ir/egress` package must match once ADR-08 is adopted. Its tests prove the
 * reference rules only — not an operational gateway, not actual transport
 * prevention.
 */

/** Closed enum from packages/schema/src/primitives.ts (data-type sensitivity). */
export const DATA_SENSITIVITY = ["normal", "natural_person_gate", "minor"] as const;
export type DataSensitivity = (typeof DATA_SENSITIVITY)[number];

/** Closed enum from packages/schema/src/case.ts (case sensitivity). */
export const CASE_SENSITIVITY = ["standard", "sensitive", "restricted"] as const;
export type CaseSensitivity = (typeof CASE_SENSITIVITY)[number];

/** The decision of the reference model. */
export type Section2Decision = { decision: "allow" | "deny"; reason: string };

/** What the request actually carries, itemized by surface. */
export type RequestInventory = {
  urlQuery?: string[];
  headers?: string[];
  body?: string[];
  pathParams?: string[];
};

/** The inputs the reference model needs to decide. */
export type Section2Input = {
  caseId?: string;
  purposeRef?: string;
  /** Data-type sensitivity claimed for the request. */
  sensitivity?: string;
  /** Case sensitivity (from CaseSensitivity), when a case is bound. */
  caseSensitivity?: string;
  /** The manifest's declared `sends` (data-kind ids). Undefined = manifest missing the field. */
  sends?: string[] | undefined;
  /** The actual data kinds present in the request, by surface. */
  inventory: RequestInventory;
  /** Whether the P2-013 natural-person policy has been adopted (false until then). */
  naturalPersonPolicyAdopted?: boolean;
};

const REASONS = {
  missingCase: "missing_case",
  missingManifest: "missing_manifest",
  unclassifiedData: "unclassified_data",
  unclassifiable: "unclassifiable",
  naturalPerson: "natural_person",
  undeclaredData: "undeclared_data",
} as const;

/** All data kinds actually present in the request, deduplicated. */
function allDataKinds(inventory: RequestInventory): string[] {
  const all = [
    ...(inventory.urlQuery ?? []),
    ...(inventory.headers ?? []),
    ...(inventory.body ?? []),
    ...(inventory.pathParams ?? []),
  ];
  return [...new Set(all)];
}

/**
 * The pure reference decision function. Every check returns the FIRST denial;
 * order matters and is documented in SECTION2-CLASSIFICATION.md.
 */
export function classifySection2(input: Section2Input): Section2Decision {
  // 1. A request without a case and purpose is denied before anything else.
  if (!input.caseId || !input.purposeRef) {
    return { decision: "deny", reason: REASONS.missingCase };
  }

  // 2. Missing or unknown classification NEVER becomes an implicit allow.
  //    `sensitivity` must be present AND a member of the closed enum.
  if (input.sensitivity === undefined || input.sensitivity === null) {
    return { decision: "deny", reason: REASONS.unclassifiedData };
  }
  if (!DATA_SENSITIVITY.includes(input.sensitivity as DataSensitivity)) {
    return { decision: "deny", reason: REASONS.unclassifiedData };
  }
  if (
    input.caseSensitivity !== undefined &&
    !CASE_SENSITIVITY.includes(input.caseSensitivity as CaseSensitivity)
  ) {
    return { decision: "deny", reason: REASONS.unclassifiedData };
  }

  // 3. Natural-person gate: denied by default until P2-013 is adopted.
  if (
    input.sensitivity === "natural_person_gate" ||
    input.caseSensitivity === "sensitive" ||
    input.caseSensitivity === "restricted"
  ) {
    if (!input.naturalPersonPolicyAdopted) {
      return { decision: "deny", reason: REASONS.naturalPerson };
    }
  }

  // 4. `sends` must be declared in the manifest. Missing field = manifest error.
  //    An EMPTY list is valid: it allows no case data at all.
  if (input.sends === undefined) {
    return { decision: "deny", reason: REASONS.missingManifest };
  }

  // 5. Every data kind in the request must be declared in `sends`.
  const declared = new Set(input.sends);
  for (const kind of allDataKinds(input.inventory)) {
    if (!declared.has(kind)) {
      return { decision: "deny", reason: REASONS.undeclaredData };
    }
  }

  // 6. `minor` stops auto-expansion (E-08) but is not a denial per se.
  //    (The reference model records it in the reason for auditability.)
  if (input.sensitivity === "minor") {
    return { decision: "allow", reason: "minor_no_auto_expansion" };
  }

  return { decision: "allow", reason: "ok" };
}

/**
 * Classifies a single data kind against the trusted registry. The transform
 * CANNOT downgrade: the classification comes from the registry, not from the
 * request's own claim.
 */
export function classifyDataKind(kind: string, registrySensitivity: string): Section2Decision {
  if (!DATA_SENSITIVITY.includes(registrySensitivity as DataSensitivity)) {
    return { decision: "deny", reason: REASONS.unclassifiedData };
  }
  if (registrySensitivity === "natural_person_gate") {
    return { decision: "deny", reason: REASONS.naturalPerson };
  }
  if (registrySensitivity === "minor") {
    return { decision: "allow", reason: "minor_no_auto_expansion" };
  }
  void kind;
  return { decision: "allow", reason: "ok" };
}
