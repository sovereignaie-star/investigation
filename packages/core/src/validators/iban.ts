import { IBAN_REGISTRY } from "./iban-registry.ts";

export type IbanResult = { valid: boolean; country?: string; reason?: "format" | "country" | "length" | "bban" | "checksum" };

/** ISO 13616 mod-97-10 over the rearranged IBAN (country + check digits moved to the end, letters A=10..Z=35). */
export function ibanMod97(iban: string): number {
  const s = iban.slice(4) + iban.slice(0, 4);
  let r = 0;
  for (const ch of s) {
    const v = ch >= "A" ? ch.charCodeAt(0) - 55 : ch.charCodeAt(0) - 48;
    r = v > 9 ? (r * 100 + v) % 97 : (r * 10 + v) % 97;
  }
  return r;
}

/** Validates an IBAN (spaces allowed, any case) against the SWIFT registry: country, length, BBAN structure, mod-97. */
export function checkIban(input: string): IbanResult {
  const s = input.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[0-9A-Z]{1,30}$/.test(s)) return { valid: false, reason: "format" };
  const country = s.slice(0, 2);
  const entry = IBAN_REGISTRY[country];
  if (!entry) return { valid: false, country, reason: "country" };
  if (s.length !== entry[0]) return { valid: false, country, reason: "length" };
  if (!new RegExp(`^${entry[1]}$`).test(s.slice(4))) return { valid: false, country, reason: "bban" };
  if (ibanMod97(s) !== 1) return { valid: false, country, reason: "checksum" };
  return { valid: true, country };
}
