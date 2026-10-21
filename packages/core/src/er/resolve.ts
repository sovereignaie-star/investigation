/**
 * P4-004 (ROADMAP 5.14 / D9) — end-to-end resolution.
 *
 * Blocks the records, scores every candidate pair, and returns the suggestions
 * (decision ≠ "none"), strongest first. PURE: never mutates the input — D9
 * forbids automatic merging in GA without human confirmation (the review UI
 * that turns suggestions into MergeDecisions is P4-005).
 */
import { blockKeys } from "./blocking.ts";
import { scorePair } from "./fellegi-sunter.ts";
import type { ErRecord, FsWeights, MatchSuggestion } from "./types.ts";

export function resolveEntities(records: ErRecord[], weights: FsWeights): MatchSuggestion[] {
  const blocks = new Map<string, ErRecord[]>();
  for (const r of records) {
    for (const k of blockKeys(r)) {
      const list = blocks.get(k) ?? [];
      list.push(r);
      blocks.set(k, list);
    }
  }
  const seen = new Set<string>();
  const suggestions: MatchSuggestion[] = [];
  for (const key of [...blocks.keys()].sort()) {
    const list = blocks.get(key) as ErRecord[];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [x, y] = [list[i], list[j]].sort((r1, r2) => (r1.id < r2.id ? -1 : 1));
        const pk = `${x.id}|${y.id}`;
        if (seen.has(pk)) continue;
        seen.add(pk);
        const s = scorePair(x, y, weights);
        if (s.decision !== "none") suggestions.push(s);
      }
    }
  }
  suggestions.sort((a, b) => b.score - a.score || (a.aId < b.aId ? -1 : 1));
  return suggestions;
}
