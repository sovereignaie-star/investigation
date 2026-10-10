/** Runtime shape of a catalog entry; the authoritative schema is IdentifierSpec in @ir/schema (checked in tests). */
export interface IdentifierSpecData {
  id: string;
  category: string;
  labels: { en: string; ar: string };
  description: string;
  icon?: string;
  color?: string;
  patterns: string[];
  flags?: string;
  validator: string | null;
  context?: { keywords: string[]; required: boolean };
  examples: { positive: string[]; negative: string[] };
  sensitivity: "normal" | "natural_person_gate" | "minor";
  transforms?: string[];
}
