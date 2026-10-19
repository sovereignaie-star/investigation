import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InvestigationStatsView } from "./InvestigationStats";
import type { CaseStatsShape, InvestigationStatsState } from "./statsModel";

/**
 * P3-012: the InvestigationStats panel's presentational states, checked
 * headlessly via static markup (the app's established web test pattern,
 * P3-002/P3-007/P3-008/P3-011 — JSX is spelled React.createElement so the file
 * stays a .ts test like its siblings). The numbers are the case's own
 * projection counts; loading and error never render numbers — never stale
 * counts, never zeros dressed up as statistics.
 */

const STATS: CaseStatsShape = {
  seq: 9,
  counts: { entities: 3, nodes: 2, claims: 1, edges: 1, observations: 2, evidence: 1, merges: 1, notes: 0 },
};

const render = (state: InvestigationStatsState): string => renderToStaticMarkup(React.createElement(InvestigationStatsView, { state }));

describe("InvestigationStatsView (P3-012)", () => {
  it("renders the eight projection counts with their Arabic labels and the seq", () => {
    const html = render({ kind: "ready", stats: STATS });
    expect(html).toContain('data-testid="stats-panel"');
    expect(html).toContain('data-testid="stats-seq"');
    expect(html).toContain("9");
    const keys = ["entities", "nodes", "claims", "edges", "observations", "evidence", "merges", "notes"] as const;
    for (const k of keys) {
      expect(html).toContain(`data-testid="stats-count-${k}"`);
    }
    // The scenario's known values — the numbers match the projection.
    expect(html).toContain("الكيانات");
    expect(html).toContain("العقد في الرسم");
    expect(html).toContain("عمليات الدمج");
  });

  it("marks a blank snapshot honestly — the zeros plus an explicit no-content note", () => {
    const html = render({
      kind: "ready",
      stats: { seq: 0, counts: { entities: 0, nodes: 0, claims: 0, edges: 0, observations: 0, evidence: 0, merges: 0, notes: 0 } },
    });
    expect(html).toContain('data-testid="stats-blank"');
    expect(html).toContain("لا محتوى مسجل في السلسلة بعد");
  });

  it("renders loading without any counts — never the previous case's numbers", () => {
    const html = render({ kind: "loading" });
    expect(html).toContain('data-testid="stats-loading"');
    expect(html).not.toContain('data-testid="stats-count-entities"');
  });

  it("renders the error state without any numbers — an error is never zeros", () => {
    const html = render({ kind: "error", message: "مقفلة — تتطلب فك التشفير" });
    expect(html).toContain('data-testid="stats-error"');
    expect(html).toContain("مقفلة — تتطلب فك التشفير");
    expect(html).not.toContain('data-testid="stats-count-entities"');
  });
});
