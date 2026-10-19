import { describe, expect, it } from "vitest";
import { buildStatsRows, isBlankSnapshot, type CaseStatsShape } from "./statsModel";

/**
 * P3-012: the stats model carries the projection's numbers verbatim — one
 * labelled row per projection count, Arabic labels, and an honest blank-snapshot
 * detector (an empty case shows zeros, it is not hidden as if it had content).
 */

const STATS: CaseStatsShape = {
  seq: 9,
  counts: { entities: 3, nodes: 2, claims: 1, edges: 1, observations: 2, evidence: 1, merges: 1, notes: 0 },
};

describe("statsModel (P3-012)", () => {
  it("builds exactly one labelled row per projection count, values carried verbatim", () => {
    const rows = buildStatsRows(STATS);
    expect(rows.map((r) => r.key)).toEqual(["entities", "nodes", "claims", "edges", "observations", "evidence", "merges", "notes"]);
    for (const r of rows) {
      expect(r.value).toBe(STATS.counts[r.key]);
      expect(r.label.length).toBeGreaterThan(0);
    }
  });

  it("labels the counts in Arabic", () => {
    const rows = buildStatsRows(STATS);
    const labels = Object.fromEntries(rows.map((r) => [r.key, r.label]));
    expect(labels.entities).toBe("الكيانات");
    expect(labels.nodes).toBe("العقد في الرسم");
    expect(labels.claims).toBe("الادعاءات");
    expect(labels.edges).toBe("الحواف");
    expect(labels.observations).toBe("المشاهدات");
    expect(labels.evidence).toBe("الأدلة");
    expect(labels.merges).toBe("عمليات الدمج");
    expect(labels.notes).toBe("الملاحظات");
  });

  it("detects a blank snapshot: every count zero — an empty case is not dressed up as content", () => {
    const blank: CaseStatsShape = {
      seq: 0,
      counts: { entities: 0, nodes: 0, claims: 0, edges: 0, observations: 0, evidence: 0, merges: 0, notes: 0 },
    };
    expect(isBlankSnapshot(blank)).toBe(true);
    expect(isBlankSnapshot(STATS)).toBe(false);
  });
});
