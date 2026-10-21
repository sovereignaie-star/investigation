// P4-024 (ADR-32): the shape of an organ (جهاز) — a named mandate inside the project,
// linked to the workspace packages that carry its work and bound by the ethics rules.

export type OrganId = "prevention" | "investigation" | "countermeasures";

/**
 * `charter`: the organ is defined (mission, boundaries, links) but no operational logic
 * exists yet. Later tasks raise this level only with code and tests behind it.
 */
export type OrganMaturity = "charter";

/** Capabilities no organ may ever have (E-01..E-10; the countermeasures organ names them explicitly). */
export type ForbiddenCapability = "offensive-action" | "unauthorized-access" | "surveillance-of-natural-persons";

export interface Organ {
  id: OrganId;
  nameAr: string;
  nameEn: string;
  /** The organ's purpose, in Arabic (the project's primary language). */
  mission: string;
  responsibilities: readonly string[];
  /** Workspace packages (exact `name` in their package.json) that carry this organ's work. */
  linkedPackages: readonly string[];
  /** ROADMAP task ids that will grow this organ. Every id must exist in docs/ROADMAP.md. */
  plannedTasks: readonly string[];
  /** The ethics rules (ROADMAP 3.5) that bind this organ. */
  ethics: readonly string[];
  /** Always false: no organ performs offensive actions (E-04). */
  offensive: false;
  forbidden: readonly ForbiddenCapability[];
  maturity: OrganMaturity;
}

export const ETHICS_BASELINE = ["E-01", "E-02", "E-03", "E-04", "E-05", "E-06", "E-10"] as const;
export const FORBIDDEN_BASELINE: readonly ForbiddenCapability[] = [
  "offensive-action",
  "unauthorized-access",
  "surveillance-of-natural-persons",
];
