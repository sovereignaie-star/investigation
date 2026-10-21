/**
 * P4-004 (ROADMAP 5.14 / D9) — entity resolution: blocking, comparison, weights.
 * Suggestion engine ONLY — no automatic merge (D9/GA: human confirmation, P4-005).
 */
export { erComparisonKey, jaroWinkler } from "./compare.ts";
export { blockKeys } from "./blocking.ts";
export { estimateWeights, scorePair, STRONG_THRESHOLD, REVIEW_THRESHOLD, IDENTIFIER_WEIGHT } from "./fellegi-sunter.ts";
export { resolveEntities } from "./resolve.ts";
export { generateReferenceSet } from "./reference-set.ts";
export type {
  ErRecord,
  FsWeights,
  MatchReason,
  MatchSuggestion,
  ErDecision,
  ReferencePair,
  ReferenceSet,
  ReferenceSplit,
} from "./types.ts";
