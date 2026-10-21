/**
 * P2-012 — TR-036: phone number analysis, LOCAL ONLY (no network).
 *
 * ROADMAP: «رقم ← دولة، نوع، صيغة E.164». The input is a phone number in
 * international form (catalog type `phone_intl`); the transform derives, using
 * libphonenumber-js with the FULL `max` metadata (owner decision 2026-10-16:
 * the max flavor is required so `getType()` works; catalog TL-97e7d609, LC-A):
 *
 * - the country (ISO 3166-1 alpha-2) — only when the metadata pins the number
 *   to exactly one country;
 * - the number class (mobile / fixed_line / …) — only when the metadata
 *   determines it (a valid number with an undetermined class simply has no
 *   class finding — nothing is guessed);
 * - the canonical E.164 format.
 *
 * Every finding cites `derivedFrom: "input"`: the analysis is computed from the
 * input alone, and a run that made no request must not cite request evidence
 * (P2-036 evidence contract). The run makes ZERO requests — not one leaves the
 * transform. An invalid number fails the run closed (it is never "no result").
 *
 * Sensitivity is `natural_person_gate` (ROADMAP: بوابة الأشخاص): a phone number
 * may identify a person, so the engine requires a purpose confirmation first.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export const phoneAnalysis = defineTransform<{ phone: string }>(
  {
    id: "TR-036",
    version: "1.0.0",
    inputs: ["phone_intl"],
    outputs: ["country_code", "line_type", "phone_intl"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 1_000, maxBytes: 1_000 },
    sensitivity: "natural_person_gate",
    license: "LC-A",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "B",
      credibility: 2,
      rationale: "تحليل محلي بمكتبة libphonenumber وبيانات Google الكاملة — اشتقاق بنيوي حتمي (دولة/نوع/E.164) من الرقم نفسه",
    },
  },
  async (input) => {
    const raw = input?.phone?.trim() ?? "";
    if (!/^\+[1-9]\d{6,14}$/.test(raw)) {
      throw new Error("TR-036: the input must be a phone number in international E.164 form (e.g. +966501234567)");
    }
    const parsed = parsePhoneNumberFromString(raw);
    if (parsed === undefined || !parsed.isValid()) {
      throw new Error(`TR-036: "${raw}" is not a valid phone number`);
    }

    const findings: TransformFinding[] = [
      {
        predicate: "formatted_e164",
        derivedFrom: "input",
        objectType: "phone_intl",
        objectValue: parsed.number,
        confidence: 1,
        explanation: `canonical E.164 form of "${raw}" (local libphonenumber analysis, no network)`,
      },
    ];
    if (parsed.country !== undefined) {
      findings.push({
        predicate: "has_country_code",
        derivedFrom: "input",
        objectType: "country_code",
        objectValue: parsed.country,
        confidence: 1,
        explanation: `country ${parsed.country} inferred from the number itself (libphonenumber metadata)`,
      });
    }
    const type = parsed.getType();
    if (type !== undefined) {
      findings.push({
        predicate: "has_phone_class",
        derivedFrom: "input",
        objectType: "line_type",
        objectValue: type.toLowerCase(),
        confidence: 1,
        explanation: `number class ${type.toLowerCase()} per libphonenumber metadata (local, no network)`,
      });
    }
    return { findings };
  },
);
