import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import type { Graph as ProjectionGraph, GraphNode } from "@ir/ledger/projections";

import { computeForceAtlas2Layout, positionsKey, seededInitialPositions } from "./pages/workbench/layout";
import { handleLayoutRequest } from "./pages/workbench/layoutProtocol";
import { useViewState } from "./store/viewStateStore";

/**
 * P3-007 acceptance (ROADMAP 6.4, literal): "تخطيط حتمي بالبذرة" — deterministic layout by
 * seed, computed by ForceAtlas2 in a Web Worker, with positions saved in ViewState
 * (D-026: the old mockup's Math.random positions were neither deterministic nor saved).
 * The pure layout function and the ViewState store are verified headlessly here, red-first;
 * the worker wiring itself is browser-only and was verified in a real browser.
 */

function node(id: string): GraphNode {
  return {
    id,
    type: "domain",
    canonicalKey: id,
    labels: { ar: "اسم النطاق" },
    props: {},
    aliases: [],
    attributes: [],
    observations: { positive: 0, negative: 0, error: 0 },
    evidenceIds: [],
  };
}

const FIXTURE: ProjectionGraph = {
  nodes: [node("a"), node("b"), node("c"), node("d")],
  edges: [
    {
      id: "e1",
      source: "a",
      target: "b",
      predicate: "resolves_to",
      confidence: 0.9,
      validFrom: null,
      validTo: null,
      explanation: "t",
      evidenceIds: [],
    },
    {
      id: "e2",
      source: "b",
      target: "c",
      predicate: "links_to",
      confidence: 0.5,
      validFrom: null,
      validTo: null,
      explanation: "t",
      evidenceIds: [],
    },
    {
      id: "e3",
      source: "c",
      target: "d",
      predicate: "mentions",
      confidence: 0.3,
      validFrom: null,
      validTo: null,
      explanation: "t",
      evidenceIds: [],
    },
    {
      id: "e4",
      source: "a",
      target: "d",
      predicate: "shares",
      confidence: 0.7,
      validFrom: null,
      validTo: null,
      explanation: "t",
      evidenceIds: [],
    },
  ],
};

describe("P3-007 deterministic layout (ForceAtlas2, seeded — fixes D-026)", () => {
  it("the same seed produces byte-identical positions", () => {
    const a = computeForceAtlas2Layout(FIXTURE, { seed: 42, iterations: 30 });
    const b = computeForceAtlas2Layout(FIXTURE, { seed: 42, iterations: 30 });
    expect(a).toEqual(b);
  });

  it("a different seed produces a different layout", () => {
    const a = computeForceAtlas2Layout(FIXTURE, { seed: 42, iterations: 30 });
    const b = computeForceAtlas2Layout(FIXTURE, { seed: 7, iterations: 30 });
    expect(a).not.toEqual(b);
  });

  it("seeded initial positions never touch Math.random (source guard, D-026)", () => {
    const source = readFileSync(path.resolve(__dirname, "pages/workbench/layout.ts"), "utf-8");
    expect(source).not.toContain("Math.random");
  });

  it("seeded initial positions are deterministic and spread", () => {
    const a = seededInitialPositions(
      FIXTURE.nodes.map((n) => n.id),
      42,
    );
    const b = seededInitialPositions(
      FIXTURE.nodes.map((n) => n.id),
      42,
    );
    expect(a).toEqual(b);
    const xs = new Set(FIXTURE.nodes.map((n) => a[n.id]?.x));
    expect(xs.size).toBe(FIXTURE.nodes.length);
  });
});

describe("P3-007 ViewState: saved positions (D-026's 'غير محفوظ')", () => {
  it("saves and reapplies a layout under its graph key", () => {
    const key = positionsKey(FIXTURE);
    const positions = computeForceAtlas2Layout(FIXTURE, { seed: 42, iterations: 30 });
    useViewState.getState().saveLayout(key, positions);
    expect(useViewState.getState().getLayout(key)).toEqual(positions);
    // a different graph gets no stale layout
    const other = positionsKey({ nodes: [node("zzz")], edges: [] });
    expect(useViewState.getState().getLayout(other)).toBeNull();
  });

  it("positionsKey is stable for the same graph and differs across graphs", () => {
    expect(positionsKey(FIXTURE)).toBe(positionsKey(FIXTURE));
    expect(positionsKey(FIXTURE)).not.toBe(positionsKey({ nodes: [node("x")], edges: [] }));
  });
});

describe("P3-007 worker protocol (handleLayoutRequest, pure)", () => {
  it("computes the same deterministic layout as the direct call", () => {
    const result = handleLayoutRequest({
      type: "layout",
      graph: FIXTURE,
      seed: 42,
      iterations: 30,
    });
    expect(result.type).toBe("layout-result");
    expect(result.positions).toEqual(computeForceAtlas2Layout(FIXTURE, { seed: 42, iterations: 30 }));
  });
});
