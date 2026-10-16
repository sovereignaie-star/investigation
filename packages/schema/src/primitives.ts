import { z } from "zod/v4";

/** ULID: 26 chars of Crockford base32, first char 0-7 (48-bit time). */
export const Ulid = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/, "ULID");
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "lowercase hex SHA-256");
export const Timestamp = z.iso.datetime({ offset: true });
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
