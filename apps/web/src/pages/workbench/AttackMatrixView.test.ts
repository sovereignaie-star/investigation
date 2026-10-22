import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildMatrixFromGraph, AttackMatrixView } from "./AttackMatrixView";
import type { Graph } from "@ir/ledger/projections";

/**
 * P4-020 — مصفوفة ATT&CK للقضية. The view reads the opened case's OWN graph
 * (the `uses_technique` attributes) joined with the frozen local STIX knowledge
 * (imported, bundled — offline by construction, zero network). Acceptance:
 * "كل وسم تقنية يحيل إلى الملاحظة التي اقتضته" — every technique entry shows
 * its claim and that claim's evidence ids; unknown technique ids are reported
 * (fail-closed, no invention); no technique claims ⇒ an honest empty state.
 */

const graphWith = (attributes: { claimId: string; predicate: string; value: unknown; evidenceIds: string[] }[]): Graph =>
  ({
    nodes: [
      {
        id: "01EXAMPLE00000000000000000",
        type: "domain",
        label: "example.com",
        attributes: attributes.map((a) => ({ ...a, confidence: 0.8, observations: [] })),
      },
    ],
    edges: [],
  }) as unknown as Graph;

describe("P4-020 — AttackMatrixView (عرض مصفوفة ATT&CK للقضية)", () => {
  it("renders the matrix rows: tactic → technique, each entry carrying its claim and evidence", () => {
    const graph = graphWith([
      { claimId: "c-phish", predicate: "uses_technique", value: "T1566", evidenceIds: ["01EVPHISH0000000000000000"] },
      { claimId: "c-dns", predicate: "uses_technique", value: "T1071.004", evidenceIds: ["01EVDNS00000000000000000"] },
      { claimId: "c-other", predicate: "resolved", value: "x", evidenceIds: ["01EVX00000000000000000000"] },
    ]);
    const html = renderToStaticMarkup(React.createElement(AttackMatrixView, { graph }));
    expect(html).toContain('data-testid="attack-matrix"');
    expect((html.match(/data-testid="attack-matrix-row"/g) ?? []).length).toBe(2); // initial-access + command-and-control
    expect(html).toContain("T1566");
    expect(html).toContain("T1071.004");
    // الوسم يحيل إلى الملاحظة: الادعاء وأدلته معروضة
    expect(html).toContain("01EVPHISH0000000000000000");
    expect(html).toContain("01EVDNS00000000000000000");
    // وسم ليس تقنية لا يدخل المصفوفة
    expect(html).not.toContain("c-other");
  });

  it("unknown technique ids are reported — fail-closed, never silently dropped", () => {
    const graph = graphWith([{ claimId: "c-x", predicate: "uses_technique", value: "T9999", evidenceIds: [] }]);
    const html = renderToStaticMarkup(React.createElement(AttackMatrixView, { graph }));
    expect(html).toContain('data-testid="attack-matrix-unknown"');
    expect(html).toContain("T9999");
  });

  it("a case with no technique claims shows the honest empty state — no invented rows", () => {
    const html = renderToStaticMarkup(React.createElement(AttackMatrixView, { graph: graphWith([]) }));
    expect(html).toContain('data-testid="attack-matrix-empty"');
    expect(html).not.toContain('data-testid="attack-matrix-row"');
  });

  it("CAPEC and D3FEND tags render in their own sections (no invented tactics for them)", () => {
    const graph = graphWith([
      { claimId: "c-brute", predicate: "uses_technique", value: "CAPEC-112", evidenceIds: ["01EVBRUTE0000000000000"] },
      { claimId: "c-def", predicate: "uses_technique", value: "D3-AM", evidenceIds: ["01EVDEF000000000000000"] },
    ]);
    const html = renderToStaticMarkup(React.createElement(AttackMatrixView, { graph }));
    expect(html).toContain("CAPEC-112");
    expect(html).toContain("D3-AM");
    expect(html).toContain("01EVBRUTE0000000000000");
    expect(html).toContain("01EVDEF000000000000000");
  });

  it("buildMatrixFromGraph extracts only uses_technique attributes", () => {
    const graph = graphWith([
      { claimId: "c-1", predicate: "uses_technique", value: "T1566", evidenceIds: ["ev"] },
      { claimId: "c-2", predicate: "other", value: "T1566", evidenceIds: ["ev"] },
    ]);
    const matrix = buildMatrixFromGraph(graph);
    expect(matrix.tactics).toHaveLength(1);
    expect(matrix.tactics[0]?.techniques[0]?.claims).toEqual([{ claimId: "c-1", evidenceIds: ["ev"] }]);
  });
});
