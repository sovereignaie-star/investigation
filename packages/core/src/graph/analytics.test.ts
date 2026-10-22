/**
 * P4-011 — graph analytics: centrality, communities, shortest path.
 *
 * Acceptance (ROADMAP 6 / P4-011): "results match NetworkX on a reference".
 * The reference of record is `fixtures/graph/networkx-reference.json`, generated
 * by `tools/graph/networkx_reference.py` with NetworkX 3.7 (deterministic LCG
 * seed 20261022). Regeneration is a documented manual step, NOT a CI test: CI
 * runs Node only, so the suite pins the committed fixture's values; the
 * generator's `--check` mode exists for local verification.
 *
 * Hand-derived unit tests below document the semantics independently of the
 * fixture; their expected values were cross-checked against NetworkX 3.7
 * during development (evidence in WORKLOG, P4-011 entry).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { GraphAnalyticsInput } from "./analytics.ts";
import {
  allPaths,
  articulationPoints,
  betweennessCentrality,
  bridges,
  closenessCentrality,
  degreeCentrality,
  groupEdgesByPeriod,
  groupEdgesBySource,
  groupNodesByType,
  labelPropagationCommunities,
  pageRank,
  shortestPath,
  shortestPathLengths,
} from "./analytics.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const reference = JSON.parse(readFileSync(join(root, "fixtures", "graph", "networkx-reference.json"), "utf8")) as {
  nodes: string[];
  edges: [string, string][];
  expected: {
    degreeCentrality: Record<string, number>;
    betweennessCentrality: Record<string, number>;
    closenessCentrality: Record<string, number>;
    pageRank: Record<string, number>;
    communities: string[][];
    shortestPathLengths: Record<string, Record<string, number>>;
    shortestPaths: { source: string; target: string; path: string[] | null }[];
    allSimplePaths: { source: string; target: string; cutoff: number; paths: string[][] }[];
  };
  p4018: {
    nodes: string[];
    edges: [string, string][];
    expected: {
      articulationPoints: string[];
      bridges: [string, string][];
      allSimplePaths: { source: string; target: string; cutoff: number; paths: string[][] }[];
    };
  };
};

/** The module's numeric tolerance per analytic — measured, not guessed: the
 *  maximum absolute deviation of this module from the committed NetworkX
 *  reference is 2.8e-17 (degree), 1.8e-18 (betweenness), 0 (closeness) and
 *  2.1e-17 (PageRank) — machine epsilon; the test tolerances below (1e-12 and
 *  1e-6) are deliberately looser so a different summation order cannot fail
 *  the reference comparison. */
const EXACT = 12;
const PAGERANK_DIGITS = 6;

function fixtureGraph(): GraphAnalyticsInput {
  return {
    nodes: reference.nodes.map((id) => ({ id })),
    edges: reference.edges.map(([source, target]) => ({ source, target })),
  };
}

function cleanAdjacency(edges: [string, string][]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const [a, b] of edges) {
    if (a === b) continue;
    const aSet = adj.get(a) ?? new Set<string>();
    const bSet = adj.get(b) ?? new Set<string>();
    aSet.add(b);
    bSet.add(a);
    adj.set(a, aSet);
    adj.set(b, bSet);
  }
  return adj;
}

describe("P4-011 — degree centrality", () => {
  it("matches NetworkX on the reference graph (exact)", () => {
    const got = degreeCentrality(fixtureGraph());
    expect(got.size).toBe(reference.nodes.length);
    for (const [id, expected] of Object.entries(reference.expected.degreeCentrality)) {
      expect(got.get(id)).toBeCloseTo(expected, EXACT);
    }
  });

  it("empty graph yields an empty map", () => {
    expect(degreeCentrality({ nodes: [], edges: [] }).size).toBe(0);
  });

  it("single node: NetworkX convention — 1 for n ≤ 1", () => {
    expect(degreeCentrality({ nodes: [{ id: "a" }], edges: [] }).get("a")).toBe(1);
  });

  it("path a-b-c-d: degrees 1/3, 2/3, 2/3, 1/3", () => {
    const g: GraphAnalyticsInput = {
      nodes: ["a", "b", "c", "d"].map((id) => ({ id })),
      edges: [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
        { source: "c", target: "d" },
      ],
    };
    const got = degreeCentrality(g);
    expect(got.get("a")).toBeCloseTo(1 / 3, EXACT);
    expect(got.get("b")).toBeCloseTo(2 / 3, EXACT);
    expect(got.get("c")).toBeCloseTo(2 / 3, EXACT);
    expect(got.get("d")).toBeCloseTo(1 / 3, EXACT);
  });
});

describe("P4-011 — betweenness centrality (Brandes, undirected, normalized)", () => {
  it("matches NetworkX on the reference graph", () => {
    const got = betweennessCentrality(fixtureGraph());
    for (const [id, expected] of Object.entries(reference.expected.betweennessCentrality)) {
      expect(got.get(id)).toBeCloseTo(expected, EXACT);
    }
  });

  it("path a-b-c-d: 0, 2/3, 2/3, 0 (two pairs pass through each middle node)", () => {
    const g: GraphAnalyticsInput = {
      nodes: ["a", "b", "c", "d"].map((id) => ({ id })),
      edges: [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
        { source: "c", target: "d" },
      ],
    };
    const got = betweennessCentrality(g);
    expect(got.get("a")).toBe(0);
    expect(got.get("b")).toBeCloseTo(2 / 3, EXACT);
    expect(got.get("c")).toBeCloseTo(2 / 3, EXACT);
    expect(got.get("d")).toBe(0);
  });

  it("star K1,4: center 1, leaves 0", () => {
    const g: GraphAnalyticsInput = {
      nodes: ["center", "l1", "l2", "l3", "l4"].map((id) => ({ id })),
      edges: ["l1", "l2", "l3", "l4"].map((leaf) => ({ source: "center", target: leaf })),
    };
    const got = betweennessCentrality(g);
    expect(got.get("center")).toBeCloseTo(1, EXACT);
    for (const leaf of ["l1", "l2", "l3", "l4"]) {
      expect(got.get(leaf)).toBe(0);
    }
  });

  it("two nodes: both 0 (no intermediate node exists)", () => {
    const g: GraphAnalyticsInput = {
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ source: "a", target: "b" }],
    };
    const got = betweennessCentrality(g);
    expect(got.get("a")).toBe(0);
    expect(got.get("b")).toBe(0);
  });
});

describe("P4-011 — closeness centrality (Wasserman–Faust improved)", () => {
  it("matches NetworkX on the reference graph", () => {
    const got = closenessCentrality(fixtureGraph());
    for (const [id, expected] of Object.entries(reference.expected.closenessCentrality)) {
      expect(got.get(id)).toBeCloseTo(expected, EXACT);
    }
  });

  it("star K1,4: center 1, leaf (count-1)/totsp = 4/7", () => {
    const g: GraphAnalyticsInput = {
      nodes: ["center", "l1", "l2", "l3", "l4"].map((id) => ({ id })),
      edges: ["l1", "l2", "l3", "l4"].map((leaf) => ({ source: "center", target: leaf })),
    };
    const got = closenessCentrality(g);
    expect(got.get("center")).toBeCloseTo(1, EXACT);
    // Leaf reaches 5 nodes incl. itself: totsp = 1 (center) + 3×2 (other leaves).
    expect(got.get("l1")).toBeCloseTo(4 / 7, EXACT);
  });

  it("disconnected a-b | c-d: reachable-component closeness scaled by (r-1)/(n-1) = 1/3", () => {
    const g: GraphAnalyticsInput = {
      nodes: ["a", "b", "c", "d"].map((id) => ({ id })),
      edges: [
        { source: "a", target: "b" },
        { source: "c", target: "d" },
      ],
    };
    const got = closenessCentrality(g);
    expect(got.get("a")).toBeCloseTo(1 / 3, EXACT);
    expect(got.get("c")).toBeCloseTo(1 / 3, EXACT);
  });

  it("isolated node: 0", () => {
    const got = closenessCentrality(fixtureGraph());
    expect(got.get("n45")).toBe(0);
  });
});

describe("P4-011 — PageRank", () => {
  it("matches NetworkX on the reference graph (power iteration, same L1 stopping rule)", () => {
    const got = pageRank(fixtureGraph());
    expect(got.size).toBe(reference.nodes.length);
    for (const [id, expected] of Object.entries(reference.expected.pageRank)) {
      expect(got.get(id)).toBeCloseTo(expected, PAGERANK_DIGITS);
    }
  });

  it("star K1,4: center ranks above every leaf; leaves tie exactly", () => {
    const g: GraphAnalyticsInput = {
      nodes: ["center", "l1", "l2", "l3", "l4"].map((id) => ({ id })),
      edges: ["l1", "l2", "l3", "l4"].map((leaf) => ({ source: "center", target: leaf })),
    };
    const got = pageRank(g);
    const center = got.get("center");
    const l1 = got.get("l1");
    if (center === undefined || l1 === undefined) throw new Error("missing pagerank entry");
    for (const leaf of ["l1", "l2", "l3", "l4"]) {
      const v = got.get(leaf);
      if (v === undefined) throw new Error(`missing pagerank entry for ${leaf}`);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(center);
      expect(v).toBeCloseTo(l1, EXACT);
    }
  });

  it("sums to 1 (dangling node redistributes its mass)", () => {
    const got = pageRank(fixtureGraph());
    let sum = 0;
    for (const v of got.values()) sum += v;
    expect(sum).toBeCloseTo(1, EXACT);
  });

  it("empty graph yields an empty map", () => {
    expect(pageRank({ nodes: [], edges: [] }).size).toBe(0);
  });
});

describe("P4-011 — communities (semi-synchronous label propagation)", () => {
  it("matches NetworkX on the reference graph: the three planted blocks and the isolated node", () => {
    const got = labelPropagationCommunities(fixtureGraph());
    expect([...got].sort((a, b) => a[0].localeCompare(b[0]))).toEqual(
      [...reference.expected.communities].sort((a, b) => a[0].localeCompare(b[0])),
    );
  });

  it("two triangles joined by a single bridge edge stay two communities", () => {
    const g: GraphAnalyticsInput = {
      nodes: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id })),
      edges: [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
        { source: "a", target: "c" },
        { source: "d", target: "e" },
        { source: "e", target: "f" },
        { source: "d", target: "f" },
        { source: "c", target: "d" },
      ],
    };
    const got = labelPropagationCommunities(g);
    expect(got).toHaveLength(2);
    expect(got.find((c) => c.includes("a"))?.sort()).toEqual(["a", "b", "c"]);
    expect(got.find((c) => c.includes("f"))?.sort()).toEqual(["d", "e", "f"]);
  });

  it("isolated node forms its own single-node community", () => {
    const g: GraphAnalyticsInput = {
      nodes: [{ id: "a" }, { id: "b" }, { id: "solo" }],
      edges: [{ source: "a", target: "b" }],
    };
    const got = labelPropagationCommunities(g);
    expect(got).toHaveLength(2);
    expect(got.find((c) => c.length === 1)).toEqual(["solo"]);
  });

  it("empty graph yields no communities", () => {
    expect(labelPropagationCommunities({ nodes: [], edges: [] })).toEqual([]);
  });
});

describe("P4-011 — shortest paths (undirected BFS)", () => {
  it("matches NetworkX shortest-path lengths from every probed source", () => {
    const g = fixtureGraph();
    for (const [source, expected] of Object.entries(reference.expected.shortestPathLengths)) {
      const got = shortestPathLengths(g, source);
      expect(got.size).toBe(Object.keys(expected).length);
      for (const [id, len] of Object.entries(expected)) {
        expect(got.get(id)).toBe(len);
      }
    }
  });

  it("returns a valid shortest path for every probed pair (length equal to NetworkX)", () => {
    const g = fixtureGraph();
    const adj = cleanAdjacency(reference.edges);
    for (const { source, target, path } of reference.expected.shortestPaths) {
      const got = shortestPath(g, source, target);
      if (path === null) {
        expect(got).toBeNull();
        continue;
      }
      if (got === null) throw new Error("NetworkX found a path but the module did not");
      // A valid walk: consecutive distinct nodes joined by real edges.
      expect(got[0]).toBe(source);
      expect(got[got.length - 1]).toBe(target);
      expect(new Set(got).size).toBe(got.length);
      for (let i = 0; i + 1 < got.length; i++) {
        expect(adj.get(got[i])?.has(got[i + 1])).toBe(true);
      }
      // Same length as the NetworkX path — tie-breaking among equally short
      // paths is implementation-defined (declared limit, DECLARED_LIMITS).
      expect(got.length).toBe(path.length);
    }
  });

  it("unreachable target returns null; unknown node throws (fail-closed)", () => {
    const g = fixtureGraph();
    expect(shortestPath(g, "n02", "n45")).toBeNull();
    expect(() => shortestPath(g, "missing", "n00")).toThrow();
    expect(() => shortestPath(g, "n00", "missing")).toThrow();
  });

  it("source equals target returns [source]", () => {
    const g = fixtureGraph();
    expect(shortestPath(g, "n00", "n00")).toEqual(["n00"]);
  });
});

describe("P4-011 — input normalization (self-loops, duplicates, unknown endpoints)", () => {
  it("the polluted fixture input equals its cleaned form for every analytic", () => {
    const polluted = fixtureGraph();
    const seen = new Set<string>();
    const cleanEdges: { source: string; target: string }[] = [];
    for (const e of polluted.edges) {
      if (e.source === e.target) continue; // self-loop
      const key = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;
      if (seen.has(key)) continue; // duplicate
      seen.add(key);
      cleanEdges.push(e);
    }
    const clean: GraphAnalyticsInput = { nodes: polluted.nodes, edges: cleanEdges };
    expect(degreeCentrality(polluted)).toEqual(degreeCentrality(clean));
    expect(betweennessCentrality(polluted)).toEqual(betweennessCentrality(clean));
    expect(closenessCentrality(polluted)).toEqual(closenessCentrality(clean));
    expect(labelPropagationCommunities(polluted)).toEqual(labelPropagationCommunities(clean));
  });

  it("edges referencing nodes absent from the node list are ignored", () => {
    const g: GraphAnalyticsInput = {
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [
        { source: "a", target: "b" },
        { source: "a", target: "ghost" },
      ],
    };
    const got = degreeCentrality(g);
    expect(got.get("a")).toBe(1);
    expect(got.has("ghost")).toBe(false);
  });
});

describe("P4-018 — cut vertices, bridges, bounded all-paths and grouping", () => {
  // The P4-018 section of the reference: a deterministic graph built to HAVE cut
  // vertices and bridges (two K5 cliques joined by one bridge, a hanging chain,
  // an isolated node), plus the main dense graph's bounded all-simple-paths.
  const p18 = reference.p4018 as {
    nodes: string[];
    edges: [string, string][];
    expected: {
      articulationPoints: string[];
      bridges: [string, string][];
      allSimplePaths: { source: string; target: string; cutoff: number; paths: string[][] }[];
    };
  };
  const main = {
    nodes: reference.nodes.map((id) => ({ id })),
    edges: reference.edges.map(([source, target]) => ({ source, target })),
  } as GraphAnalyticsInput;

  const p18input = { nodes: p18.nodes.map((id) => ({ id })), edges: p18.edges.map(([source, target]) => ({ source, target })) };
  it("articulation points match NetworkX on the dedicated reference (and none on the dense graph)", () => {
    expect(articulationPoints(p18input)).toEqual(p18.expected.articulationPoints);
    expect(articulationPoints(main)).toEqual([]);
  });

  it("bridges match NetworkX on the dedicated reference (and none on the dense graph)", () => {
    expect(bridges(p18input)).toEqual(p18.expected.bridges);
    expect(bridges(main)).toEqual([]);
  });

  it("all bounded simple paths match NetworkX on both graphs, in the same sorted order", () => {
    for (const spec of p18.expected.allSimplePaths) {
      const got = allPaths(p18input, spec.source, spec.target, spec.cutoff);
      expect(got).toEqual(spec.paths);
    }
    const mainPairs = (reference.expected as { allSimplePaths: typeof p18.expected.allSimplePaths }).allSimplePaths;
    for (const spec of mainPairs) {
      const got = allPaths(main, spec.source, spec.target, spec.cutoff);
      expect(got).toEqual(spec.paths);
    }
  });

  it("allPaths respects the length bound and the normalization contract (self-loops, duplicates, unknown endpoints)", () => {
    const g: GraphAnalyticsInput = {
      nodes: [{ id: "x" }, { id: "y" }, { id: "z" }],
      edges: [
        { source: "x", target: "y" },
        { source: "y", target: "z" },
        { source: "x", target: "y" }, // duplicate
        { source: "x", target: "x" }, // self-loop
        { source: "x", target: "ghost" }, // unknown endpoint
      ],
    };
    expect(allPaths(g, "x", "z", 1)).toEqual([]); // الحد يمنع المسار الوحيد طوله 2
    expect(allPaths(g, "x", "z", 2)).toEqual([["x", "y", "z"]]);
    expect(allPaths(g, "x", "ghost", 3)).toEqual([]);
  });

  it("allPaths with cutoff 0 returns [from] only when from === to, else nothing", () => {
    const g: GraphAnalyticsInput = { nodes: [{ id: "a" }, { id: "b" }], edges: [{ source: "a", target: "b" }] };
    expect(allPaths(g, "a", "a", 0)).toEqual([["a"]]);
    expect(allPaths(g, "a", "b", 0)).toEqual([]);
  });

  it("grouping by node type, by source transform and by period — deterministic aggregation with an honest unknown bucket", () => {
    const nodes = [
      { id: "e1", type: "domain" },
      { id: "e2", type: "domain" },
      { id: "e3", type: "person" },
    ];
    const edges = [
      { source: "e1", target: "e2", transformId: "tr-whois", at: "2026-10-01T10:00:00.000Z" },
      { source: "e1", target: "e3", transformId: "tr-dns", at: "2026-10-22T11:00:00.000Z" },
      { source: "e2", target: "e3", transformId: "tr-whois", at: "2026-11-02T12:00:00.000Z" },
      { source: "e3", target: "e2" }, // بلا مصدر ولا زمن — «unknown» صادقة لا إسقاط
    ];
    expect(groupNodesByType(nodes)).toEqual(
      new Map([
        ["domain", 2],
        ["person", 1],
      ]),
    );
    expect(groupEdgesBySource(edges)).toEqual(
      new Map([
        ["tr-whois", 2],
        ["tr-dns", 1],
        ["unknown", 1],
      ]),
    );
    expect(groupEdgesByPeriod(edges, "month")).toEqual(
      new Map([
        ["2026-10", 2],
        ["2026-11", 1],
        ["unknown", 1],
      ]),
    );
    expect(groupEdgesByPeriod(edges, "day")).toEqual(
      new Map([
        ["2026-10-01", 1],
        ["2026-10-22", 1],
        ["2026-11-02", 1],
        ["unknown", 1],
      ]),
    );
  });
});
