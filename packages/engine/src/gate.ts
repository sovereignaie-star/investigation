/**
 * P2-013 — natural persons gate (E-02, T-ETH-002).
 *
 * Any identifier tagged `natural_person_gate` requires a purpose confirmation before every
 * expansion. The engine is the enforcement point: a run whose input carries
 * `sensitivity: "natural_person_gate"` is refused unless the caller supplies a purpose
 * confirmation for that specific expansion. This is fail-closed — no confirmation, no run —
 * and it is deliberately not bypassable by an env var or option (mirroring the egress
 * gateway's `natural_person` refusal, T-SEC-SSRF-040).
 *
 * The gate is a pure decision function: it takes the input's sensitivity and the caller's
 * purpose confirmation and returns a typed refusal or an allow. The engine's run loop calls it
 * before a run is submitted; a refusal is recorded (audit) and the run never reaches the
 * transport (zero transport attempts).
 */
import type { RunInput } from "./run.ts";

/** The sensitivity classes the engine understands (mirrors @ir/schema Sensitivity). */
export type EngineSensitivity = "normal" | "natural_person_gate" | "minor";

/** A purpose confirmation for one expansion of a natural-person identifier. */
export interface PurposeConfirmation {
  /** The stated purpose (must be non-empty; E-01: no investigation without a documented purpose). */
  readonly purpose: string;
  /** Who confirmed it (the investigator). */
  readonly confirmedBy: string;
}

/** The result of the gate: allow, or a typed refusal. */
export type GateResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "natural_person" | "unclassified_data" | "minor"; readonly message: string };

/**
 * The natural persons gate. Fail-closed for the cases the engine owns:
 *   - `natural_person_gate` without a purpose confirmation is refused (`natural_person`);
 *   - `minor` is refused (E-08: any sign of a minor stops auto-expansion);
 *   - a missing sensitivity is allowed at the engine level — the egress gateway is the
 *     enforcement point for `unclassified_data` (T-SEC-SSRF-028), so the engine does not
 *     duplicate that refusal and does not break runs that carry no sensitivity tag.
 *   - `normal` is allowed.
 */
export function naturalPersonGate(input: Pick<RunInput, "sensitivity">, confirmation?: PurposeConfirmation): GateResult {
  const sensitivity = input.sensitivity;
  if (sensitivity === "natural_person_gate") {
    if (confirmation === undefined || confirmation.purpose.trim().length === 0 || confirmation.confirmedBy.trim().length === 0) {
      return {
        allowed: false,
        reason: "natural_person",
        message: "natural-person expansion requires a purpose confirmation (E-02)",
      };
    }
    return { allowed: true };
  }
  if (sensitivity === "minor") {
    return { allowed: false, reason: "minor", message: "minor identifiers stop auto-expansion (E-08)" };
  }
  return { allowed: true };
}
