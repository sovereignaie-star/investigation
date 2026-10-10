import { normalize } from "../normalize.ts";
import { validate } from "../validators/index.ts";
import { IDENTIFIER_SPECS } from "./catalog.ts";
import type { IdentifierSpecData } from "./types.ts";

/**
 * Identifier catalog (5.6, P1-003): data in packages/core/identifiers/*.yaml, compiled into catalog.ts by
 * `pnpm --filter @ir/core run gen:data`. `matchesSpec` is the per-type check used by tests and by the detection
 * engine (P1-006): a pattern match on the raw text, then the structural validator on the normalized value.
 */
export { IDENTIFIER_SPECS };
export type { IdentifierSpecData };

const CASE_SENSITIVE = new Set(["eip55"]);
const byId = new Map(IDENTIFIER_SPECS.map((s) => [s.id, s]));
const compiled = new Map<string, RegExp[]>();

export const specById = (id: string): IdentifierSpecData | undefined => byId.get(id);

export function patternsOf(spec: IdentifierSpecData): RegExp[] {
  let r = compiled.get(spec.id);
  if (!r) {
    r = spec.patterns.map((p) => new RegExp(p, spec.flags ?? ""));
    compiled.set(spec.id, r);
  }
  return r;
}

/** Expands `{{N:c}}` (N copies of c): secret-shaped examples exist only in memory, never as literals in the repo. */
export const expandExample = (s: string): string => s.replace(/\{\{(\d{1,3}):(.)\}\}/gu, (_m, n: string, c: string) => c.repeat(Number(n)));

export function matchesSpec(spec: IdentifierSpecData, raw: string): { pattern: boolean; valid: boolean | null } {
  const text = raw.trim();
  const pattern = patternsOf(spec).some((re) => re.test(text));
  if (!pattern || !spec.validator) return { pattern, valid: null };
  let normalized: string;
  try {
    normalized = normalize(spec.id, text);
  } catch {
    return { pattern, valid: false }; // e.g. an address offered to the hostname type: not normalizable, so not valid
  }
  // case carries the checksum (EIP-55): validate what was written, since the normalized form is lowercased
  const v = validate(spec.id, spec.validator && CASE_SENSITIVE.has(spec.validator) ? text : normalized);
  return { pattern, valid: v ? v.valid : null };
}

export const accepts = (spec: IdentifierSpecData, raw: string): boolean => {
  const m = matchesSpec(spec, raw);
  return m.pattern && m.valid !== false;
};
export { detect, detectBest, type Candidate, type DetectOptions } from "./detect.ts";
export { extract, type Extracted, type ExtractOptions } from "./extract.ts";
