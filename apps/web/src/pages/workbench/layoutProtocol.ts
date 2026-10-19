import type { Graph as ProjectionGraph } from "@ir/ledger/projections";

import { computeForceAtlas2Layout, type LayoutPositions } from "./layout";

/**
 * P3-007: the Web Worker message protocol, kept pure (node-testable) — the worker shell
 * (`layout.worker.ts`) only wires it to `self.onmessage`.
 *
 * Protocol: post { type: "layout", graph, seed, iterations } → receive
 * { type: "layout-result", positions } or { type: "layout-error", message }.
 */

export interface LayoutRequest {
  type: "layout";
  graph: ProjectionGraph;
  seed: number;
  iterations: number;
}

export interface LayoutResult {
  type: "layout-result";
  positions: LayoutPositions;
}

export interface LayoutError {
  type: "layout-error";
  message: string;
}

export function handleLayoutRequest(request: LayoutRequest): LayoutResult {
  return {
    type: "layout-result",
    positions: computeForceAtlas2Layout(request.graph, {
      seed: request.seed,
      iterations: request.iterations,
    }),
  };
}
