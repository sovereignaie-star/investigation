/**
 * P2-012 — TR-037: IBAN and BIC validation (local, LC-A).
 *
 * No source, no key, no network: the SWIFT IBAN registry shipped in @ir/core
 * (P1-005, `checkIban`) validates country, length, BBAN structure and the
 * ISO 13616 mod-97 checksum. BIC validity is structural (ISO 9362: 4-letter bank
 * code, 2-letter ISO 3166-1 alpha-2 country, 2 alnum location, optional 3 alnum
 * branch). Findings are derived from the input alone (`derivedFrom: "input"`,
 * P2-036) — no evidence request exists to cite.
 *
 * A natural-person gate does not apply: nothing about a person is expanded here;
 * the transform only checks a number's structure (same class as TR-089, local).
 */
import { defineTransform } from "../manifest.ts";
import { checkIban } from "@ir/core";
import type { TransformFinding } from "../output.ts";

const BIC_PATTERN = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

function ibanFinding(iban: string, country: string, confidence: number, explanation: string): TransformFinding {
  return {
    predicate: "is_valid_iban",
    objectType: "iban",
    objectValue: iban,
    confidence,
    explanation,
    derivedFrom: "input",
  };
}

function bicFinding(bic: string, confidence: number, explanation: string): TransformFinding {
  return {
    predicate: "is_valid_swift_bic",
    objectType: "swift_bic",
    objectValue: bic,
    confidence,
    explanation,
    derivedFrom: "input",
  };
}

export const ibanBic = defineTransform<{ iban?: string; bic?: string }>(
  {
    id: "TR-037",
    version: "1.0.0",
    inputs: ["iban", "swift_bic"],
    outputs: ["iban", "swift_bic"],
    // Local transform: no network. `public` with an empty allow list is the
    // only valid declaration for a transform that never calls ctx.http.
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-A",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "A",
      credibility: 1,
      rationale: "تحقق بنيوي محلي ضد سجل SWIFT IBAN المشمول في النواة — تحقق ISO 13616 mod-97 حتمي لا اجتهاد فيه",
    },
  },
  (input, _ctx) => {
    const findings: TransformFinding[] = [];

    if (input.iban !== undefined) {
      const normalized = input.iban.replace(/\s+/g, "").toUpperCase();
      const result = checkIban(normalized);
      if (!result.valid) {
        throw new Error(`TR-037: invalid IBAN "${normalized}" (${result.reason ?? "unknown"} reason)`);
      }
      findings.push(
        ibanFinding(
          normalized,
          result.country ?? "",
          1,
          `IBAN ${normalized} is valid (SWIFT registry: country ${result.country}, length ${normalized.length}, BBAN structure, ISO 13616 mod-97)`,
        ),
      );
    }

    if (input.bic !== undefined) {
      const normalized = input.bic.replace(/\s+/g, "").toUpperCase();
      if (!BIC_PATTERN.test(normalized)) {
        throw new Error(`TR-037: invalid BIC "${input.bic}" (ISO 9362 structure)`);
      }
      const bank = normalized.slice(0, 4);
      const country = normalized.slice(4, 6);
      const location = normalized.slice(6, 8);
      const branch = normalized.length === 11 ? normalized.slice(8) : "";
      findings.push(
        bicFinding(
          normalized,
          1,
          `BIC ${normalized} is structurally valid (ISO 9362): bank code ${bank}, country ${country}, location ${location}${branch ? `, branch ${branch}` : ""}`,
        ),
      );
    }

    if (findings.length === 0) {
      throw new Error("TR-037: an IBAN or BIC is required");
    }
    return Promise.resolve({ findings });
  },
);
