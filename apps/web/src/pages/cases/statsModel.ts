import type { CaseStats } from "@workspace/api-client-react";

/**
 * P3-012 («أحصاءات القضية»): the model behind the InvestigationStats panel.
 * The numbers are the case's own projection counts, carried verbatim — this
 * model never recounts anything; it only labels and shapes what the stats
 * route (which serves Case.projection()) sent.
 */

/** The wire shape of the stats route response (generated from the OpenAPI contract). */
export type CaseStatsShape = CaseStats;

/** The eight projection counts, keyed as the projection defines them. */
export type StatsCountKey = "entities" | "nodes" | "claims" | "edges" | "observations" | "evidence" | "merges" | "notes";

const LABELS: Record<StatsCountKey, string> = {
  entities: "الكيانات",
  nodes: "العقد في الرسم",
  claims: "الادعاءات",
  edges: "الحواف",
  observations: "المشاهدات",
  evidence: "الأدلة",
  merges: "عمليات الدمج",
  notes: "الملاحظات",
};

const KEYS: readonly StatsCountKey[] = ["entities", "nodes", "claims", "edges", "observations", "evidence", "merges", "notes"];

export interface StatsRow {
  readonly key: StatsCountKey;
  readonly label: string;
  readonly value: number;
}

/** One labelled row per projection count, in the projection's own order. */
export function buildStatsRows(stats: CaseStatsShape): StatsRow[] {
  return KEYS.map((key) => ({ key, label: LABELS[key], value: stats.counts[key] }));
}

/** True when every count is zero — an empty chain, shown honestly, not hidden. */
export function isBlankSnapshot(stats: CaseStatsShape): boolean {
  return KEYS.every((key) => stats.counts[key] === 0);
}

/**
 * The panel's honest states: loading and error never carry numbers — the
 * previous case's counts must not survive a case switch, and an error is never
 * zeros dressed up as statistics.
 */
export type InvestigationStatsState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; stats: CaseStatsShape };
