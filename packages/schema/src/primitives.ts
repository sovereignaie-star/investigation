import { z } from "zod/v4";

/** ULID: 26 chars of Crockford base32, first char 0-7 (48-bit time). */
export const Ulid = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/, "ULID");
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "lowercase hex SHA-256");
export const Timestamp = z.iso.datetime({ offset: true });

/**
 * ADR-33: the single full-precision moment comparator — pure (regex + Date.parse only),
 * browser-safe, shared by the schema's refines, the ledger's projections and the web's
 * timeline (never duplicated). The schema accepts fractional seconds of ANY length
 * (verified: 20 digits pass `z.iso.datetime({ offset: true })`, which also accepts a
 * missing-seconds `T00:00Z` form), which Date.parse collapses — so the whole-second
 * instant is compared via Date.parse and the fraction as FULL DECIMAL TEXT
 * (right-padded to the longer fraction, never truncated, never a number):
 * `.1` equals `.10`, `.01` sorts before both, every accepted precision is preserved.
 */
const ISO_MOMENT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
export function compareTimestamps(a: string, b: string): number {
  const ka = ISO_MOMENT.exec(a);
  const kb = ISO_MOMENT.exec(b);
  if (!ka || !kb) {
    // defensive only: every form the schema accepts matches ISO_MOMENT (zod source audit,
    // v4/core/regexes.js — dateSource/timeSource/datetime)
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const msA = Date.parse(`${ka[1]}T${ka[2]}${ka[4]}`);
  const msB = Date.parse(`${kb[1]}T${kb[2]}${kb[4]}`);
  if (msA !== msB) return msA - msB;
  const n = Math.max(ka[3]?.length ?? 0, kb[3]?.length ?? 0);
  const fa = (ka[3] ?? "").padEnd(n, "0");
  const fb = (kb[3] ?? "").padEnd(n, "0");
  return fa < fb ? -1 : fa > fb ? 1 : 0;
}
export const Confidence = z.number().min(0).max(1);

/** Admiralty code (D2): source reliability A-F, information credibility 1-6. */
export const Admiralty = z.object({
  reliability: z.enum(["A", "B", "C", "D", "E", "F"]),
  credibility: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
});

/** Per-type sensitivity: "natural_person_gate" requires purpose confirmation (E-02); "minor" stops auto-expansion (E-08). */
export const Sensitivity = z.enum(["normal", "natural_person_gate", "minor"]);

/** Transform license class (ROADMAP 7.3): A local, B public no key, C free user key, D paid user key, E usage-restricted (non-commercial / attribution). */
export const LicenseClass = z.enum(["LC-A", "LC-B", "LC-C", "LC-D", "LC-E"]);

export const LocalizedLabel = z
  .object({ ar: z.string().min(1).optional(), en: z.string().min(1).optional() })
  .refine((l) => l.ar !== undefined || l.en !== undefined, "at least one of ar/en");

/** Machine identifier: lowercase snake/kebab with optional dots (e.g. "email", "crypto.btc", "tr-001"). */
export const Slug = z.string().regex(/^[a-z][a-z0-9_.-]*$/);
