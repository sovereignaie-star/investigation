import { canonicalize } from "../jcs.ts";
import type { Entry } from "../ledger.ts";
import { sha256Hex } from "../ledger.ts";
import { type Issue, Projector } from "./state.ts";
import { type Coverage, coverageView, type Graph, graphView, type TableRow, tableView } from "./views.ts";

export { Projector, type Issue } from "./state.ts";
export * from "./views.ts";

/** All views of a case at one point of its chain (P1-016). */
export interface Projection {
  /** Last seq included (-1 for an empty chain). */
  seq: number;
  graph: Graph;
  table: TableRow[];
  coverage: Coverage;
  issues: Issue[];
  counts: {
    entities: number;
    nodes: number;
    claims: number;
    edges: number;
    observations: number;
    evidence: number;
    merges: number;
    notes: number;
  };
}

export function view(p: Projector): Projection {
  const graph = graphView(p);
  return {
    seq: p.seq,
    graph,
    table: tableView(p, graph),
    coverage: coverageView(p, graph),
    issues: [...p.issues],
    counts: {
      entities: p.entities.size,
      nodes: graph.nodes.length,
      claims: p.claims.size,
      edges: graph.edges.length,
      observations: p.observations.length,
      evidence: p.evidence.size,
      merges: [...p.merges.values()].filter((m) => !m.reverted).length,
      notes: p.notes,
    },
  };
}

/** Rebuilds every view from entries with readable payloads; `upTo` gives the snapshot at that seq (5.15). */
export function project(entries: Iterable<Entry>, opts: { upTo?: number } = {}): Projection {
  const p = new Projector();
  for (const e of entries) {
    if (opts.upTo !== undefined && e.seq > opts.upTo) break;
    p.apply(e);
  }
  return view(p);
}

/** SHA-256 of the JCS form: two projections are the same exactly when their hashes are (T-LED-020 with P2-018). */
export const projectionHash = (p: Projection): string => sha256Hex(canonicalize(p));
