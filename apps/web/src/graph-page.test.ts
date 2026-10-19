import * as React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { Graph as ProjectionGraph, GraphEdge, GraphNode } from "@ir/ledger/projections";

import { InvestigationGraph } from "./pages/workbench/InvestigationGraph";
import { GraphBenchPage } from "./pages/workbench/GraphBenchPage";
import { generateBenchGraph, toGraphologyGraph, typeColorOf } from "./pages/workbench/graphModel";

/**
 * P3-005 acceptance: `InvestigationGraph` (Sigma.js + graphology, WebGL). The roadmap criterion
 * "10,000 عقدة ≥ 30 إطاراً/ث على جهاز مرجعي" is a reference-device measurement — it cannot be
 * measured in a headless node environment and stays explicitly open in STATUS until the owner
 * defines the reference device and measures it with the #/graph-bench harness. What CAN be
 * verified headlessly is verified here, red-first: the graph adapter (claims are never merged —
 * parallel edges survive), the deterministic bench generator, and the component's static markup.
 */

function node(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    type: "domain",
    canonicalKey: id,
    labels: { ar: "اسم النطاق", en: "Domain" },
    props: {},
    aliases: [],
    attributes: [],
    observations: { positive: 0, negative: 0, error: 0 },
    evidenceIds: [],
    ...over,
  };
}

function edge(over: Partial<GraphEdge> & { id: string; source: string; target: string }): GraphEdge {
  return {
    predicate: "resolves_to",
    confidence: 0.8,
    validFrom: null,
    validTo: null,
    explanation: "test-claim",
    evidenceIds: [],
    ...over,
  };
}

const TWO_CLAIMS: ProjectionGraph = {
  nodes: [node("a"), node("b")],
  edges: [
    edge({ id: "e1", source: "a", target: "b", predicate: "resolves_to", confidence: 0.9 }),
    edge({ id: "e2", source: "a", target: "b", predicate: "shares_registrant", confidence: 0.4 }),
    // defensive: an edge pointing at a missing node must not throw
    edge({ id: "e3", source: "a", target: "missing", predicate: "dangling", confidence: 0.5 }),
  ],
};

describe("P3-005 graph adapter: projection → graphology (claims are never merged)", () => {
  it("keeps parallel edges between the same endpoints as distinct claims (multi-graph)", () => {
    const g = toGraphologyGraph(TWO_CLAIMS);
    expect(g.nodes()).toEqual(["a", "b"]);
    expect(g.edges()).toEqual(["e1", "e2", "e3"].filter((id) => g.hasEdge(id)));
    // the dangling edge is skipped, the two parallel claims survive
    expect(g.hasEdge("e1")).toBe(true);
    expect(g.hasEdge("e2")).toBe(true);
    expect(g.hasEdge("e3")).toBe(false);
  });

  it("maps node labels ar→en→id and colors deterministically by type", () => {
    const g = toGraphologyGraph({
      nodes: [
        node("ar-first", { labels: { ar: "عربي", en: "english" } }),
        node("en-only", { labels: { en: "english-only" } }),
        node("none", { labels: {} }),
      ],
      edges: [],
    });
    expect(g.getNodeAttribute("ar-first", "label")).toBe("عربي");
    expect(g.getNodeAttribute("en-only", "label")).toBe("english-only");
    expect(g.getNodeAttribute("none", "label")).toBe("none");
    expect(typeColorOf("domain")).toBe(typeColorOf("domain"));
    expect(g.getNodeAttribute("ar-first", "color")).toBe(typeColorOf("domain"));
  });

  it("gives every node deterministic circular initial positions (layout itself is P3-007)", () => {
    const a = toGraphologyGraph(TWO_CLAIMS);
    const b = toGraphologyGraph(TWO_CLAIMS);
    expect(a.getNodeAttribute("a", "x")).toBe(b.getNodeAttribute("a", "x"));
    expect(a.getNodeAttribute("a", "y")).toBe(b.getNodeAttribute("a", "y"));
    // distinct nodes get distinct positions once there is more than one
    expect(a.getNodeAttribute("a", "x")).not.toBe(a.getNodeAttribute("b", "x"));
  });

  it("sizes edges from claim confidence", () => {
    const g = toGraphologyGraph(TWO_CLAIMS);
    expect(g.getEdgeAttribute("e1", "size")).toBeGreaterThan(g.getEdgeAttribute("e2", "size"));
  });
});

describe("P3-005 bench generator: 10,000 nodes / 20,000 edges, deterministic", () => {
  it("generates exactly the requested counts with valid endpoints", () => {
    const g = generateBenchGraph(10_000, 20_000);
    expect(g.nodes).toHaveLength(10_000);
    expect(g.edges).toHaveLength(20_000);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
      expect(e.source).not.toBe(e.target);
    }
  });

  it("is deterministic for a fixed seed (reproducible measurement input)", () => {
    const a = generateBenchGraph(500, 1_000, 7);
    const b = generateBenchGraph(500, 1_000, 7);
    expect(a.nodes[123]).toEqual(b.nodes[123]);
    expect(a.edges[456]).toEqual(b.edges[456]);
  });
});

describe("P3-005 InvestigationGraph static render (effects/canvas are browser-only)", () => {
  it("renders a labelled non-empty container; the WebGL canvas is created only in the effect", () => {
    const html = renderToStaticMarkup(React.createElement(InvestigationGraph, { graph: TWO_CLAIMS }));
    expect(html).toContain('data-testid="investigation-graph"');
    expect(html).toContain("لوحة رسم التحقيق");
    expect(html).not.toContain("<canvas"); // created by Sigma inside the effect, never statically
  });

  it("shows the empty state for a graph with no nodes", () => {
    const html = renderToStaticMarkup(React.createElement(InvestigationGraph, { graph: { nodes: [], edges: [] } }));
    expect(html).toContain("لا عقد بعد");
  });

  it("bench page renders the harness summary with the reference workload", () => {
    const html = renderToStaticMarkup(React.createElement(GraphBenchPage));
    expect(html).toContain('data-testid="graph-bench"');
    expect(html).toContain("10,000");
    expect(html).toContain("20,000");
  });
});
