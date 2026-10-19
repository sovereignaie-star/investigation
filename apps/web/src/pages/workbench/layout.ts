import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { Graph as ProjectionGraph, GraphNode } from "@ir/ledger/projections";

/**
 * P3-007: deterministic ForceAtlas2 layout, seeded (acceptance: "تخطيط حتمي بالبذرة").
 *
 * D-026 (the old mockup): `position` came from the global random generator — the layout was
 * neither deterministic nor saved. Here the initial positions are derived from a seeded hash of
 * the node ids (no global randomness anywhere — guarded by a source test), ForceAtlas2 itself is deterministic, and
 * the resulting positions are saved in the ViewState store by the caller.
 *
 * The heavy computation runs inside a Web Worker (`layout.worker.ts` imports this module);
 * this file stays pure and node-testable.
 */

export interface LayoutPositions {
  [nodeId: string]: { x: number; y: number };
}

/** FNV-1a — small deterministic string hash. */
function fnv1a(text: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic pseudo-random in [0,1) for a (seed, id) pair. */
function seededUnit(id: string, seed: number): number {
  return fnv1a(id, seed) / 0xffffffff;
}

/**
 * Deterministic initial positions on a jittered unit circle — the seed spreads each node's
 * angle and radius so the layout is reproducible and differs across seeds.
 */
export function seededInitialPositions(ids: readonly string[], seed: number): LayoutPositions {
  // Object.create(null): node ids are extracted from user input, so the map must have no
  // prototype — a crafted id (e.g. "__proto__") cannot pollute it (CodeQL: property injection).
  const out: LayoutPositions = Object.create(null);
  const n = ids.length;
  for (let i = 0; i < n; i += 1) {
    const id = ids[i];
    const angle = (2 * Math.PI * (i + seededUnit(id, seed))) / Math.max(1, n);
    const radius = 0.5 + 0.5 * seededUnit(`${id}:r`, seed);
    out[id] = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }
  return out;
}

/** A stable key for a graph's identity (sorted node ids hashed) — the ViewState slot. */
export function positionsKey(graph: ProjectionGraph): string {
  const ids = graph.nodes.map((n) => n.id).sort();
  return `g:${fnv1a(ids.join(","), 0).toString(36)}:${ids.length}`;
}

/** The pure ForceAtlas2 computation: seeded initial positions, then FA2 iterations. */
export function computeForceAtlas2Layout(graph: ProjectionGraph, options: { seed: number; iterations: number }): LayoutPositions {
  const ids = graph.nodes.map((n: GraphNode) => n.id);
  const initial = seededInitialPositions(ids, options.seed);

  const g = new Graph({ multi: true });
  for (const node of graph.nodes) {
    const p = initial[node.id] ?? { x: 0, y: 0 };
    g.addNode(node.id, { x: p.x, y: p.y, size: 5 });
  }
  for (const e of graph.edges) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    g.addEdgeWithKey(e.id, e.source, e.target, { size: 1 });
  }

  forceAtlas2.assign(g, {
    iterations: options.iterations,
    settings: {
      gravity: 1,
      scalingRatio: 10,
      slowDown: 1,
      barnesHutOptimize: g.order > 1000,
    },
  });

  const out: LayoutPositions = Object.create(null);
  g.forEachNode((id, attrs) => {
    out[id] = { x: attrs.x, y: attrs.y };
  });
  return out;
}
