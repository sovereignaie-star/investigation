/**
 * P4-004 (ROADMAP 5.14 / D9) — entity resolution types.
 *
 * `core/er` is a PURE engine: it reads records and returns SUGGESTIONS. It
 * never merges, never mutates (D9: no automatic merge in GA without human
 * confirmation — the review UI is P4-005).
 */

/** One entity record to resolve — the fields 5.14 compares. */
export interface ErRecord {
  /** Stable record id (the suggestion names pairs by id). */
  id: string;
  /** Display/compare name (person or company). */
  name: string;
  /** ISO 3166 alpha-2 country code, if known. */
  country?: string;
  /** Birth/founding date — ISO 8601, or a bare year, or DD/MM/YYYY. */
  birthDate?: string;
  /** Known addresses (any format). */
  addresses?: string[];
  /** Normalized canonical identifiers `<type>:<value>` (P1-007 keys). */
  identifiers?: string[];
}

/** The Fellegi-Sunter log-odds weights — one per (feature, level) (5.14 الأوزان). */
export interface FsWeights {
  /** Full name agreement: ln(m/u). */
  name: number;
  /** Partial name agreement: ln(m/u). */
  namePartial: number;
  /** Name disagreement: ln(m/u) — negative when disagreement favors non-match. */
  nameDisagree: number;
  /** Full date agreement: ln(m/u). */
  date: number;
  /** Partial date agreement (same year): ln(m/u). */
  datePartial: number;
  /** Date disagreement: ln(m/u). */
  dateDisagree: number;
  /** Address agreement: ln(m/u). */
  address: number;
  /** Address disagreement: ln(m/u). */
  addressDisagree: number;
}

/** One explainable reason inside a suggestion (D9 التفسير: قائمة أسباب بأوزانها). */
export interface MatchReason {
  /** The feature that fired (identifier, name, namePartial, date, datePartial, address, or a disagreement term). */
  feature: string;
  /** The reason's weight — the suggestion's score is EXACTLY the sum of weights. */
  weight: number;
  /** Human-readable detail (Arabic). */
  detail: string;
}

/** A resolution decision — thresholds are declared constants (see fellegi-sunter.ts). */
export type ErDecision = "strong" | "review" | "none";

/** One scored candidate pair. */
export interface MatchSuggestion {
  aId: string;
  bId: string;
  /** Σ reason weights (log-odds). */
  score: number;
  decision: ErDecision;
  /** The explanation: reasons with weights (D9). */
  reasons: MatchReason[];
}

/** The deterministic reference set — labeled train/eval splits (see reference-set.ts). */
export interface ReferencePair {
  a: ErRecord;
  b: ErRecord;
}
export interface ReferenceSplit {
  records: ErRecord[];
  duplicatePairs: ReferencePair[];
}
export interface ReferenceSet {
  train: ReferenceSplit;
  eval: ReferenceSplit;
}
