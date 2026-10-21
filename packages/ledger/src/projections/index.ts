import { canonicalize } from "../jcs.ts";
import type { Entry } from "../ledger.ts";
import { sha256Hex } from "../ledger.ts";
import { type Issue, Projector, type StoredNote } from "./state.ts";
import { type Coverage, coverageView, type Graph, graphView, type NetworkLog, networkLogView, type TableRow, tableView } from "./views.ts";

export { Projector, type Issue } from "./state.ts";
export type { StoredNote } from "./state.ts";
export * from "./views.ts";
export { diffProjections } from "./diff.ts";
export type { CaseDiff, ClaimChange, DiffClaim, EntityChange } from "./diff.ts";

/** All views of a case at one point of its chain (P1-016). */
export interface Projection {
  /** Last seq included (-1 for an empty chain). */
  seq: number;
  graph: Graph;
  table: TableRow[];
  coverage: Coverage;
  /** P2-014 (E-06/T-ETH-006): every external request the case made — gateway decisions and stored responses. */
  networkLog: NetworkLog;
  /** P3-021: readable analyst notes in ledger order (unreadable payloads count but do not list). */
  notes: StoredNote[];
  /**
   * P4-005: the durable merge log — every `merge.decided` entry whose payload parses,
   * in ledger order, with its `merge.reverted` state. The review UI serves the revert
   * action from THIS list (the id it posts is the merge's own id); unreadable payloads
   * still count in `counts.merges` but list no entry — the counter's meaning never changes.
   */
  mergeDecisions: StoredMerge[];
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

/** P4-005: one durable merge decision as the projection serves it. */
export interface StoredMerge {
  seq: number;
  id: string;
  entityIds: string[];
  survivorId: string;
  reasons: string[];
  decidedBy: string;
  decidedAt: string;
  reverted: boolean;
}

export function view(p: Projector): Projection {
  const graph = graphView(p);
  return {
    seq: p.seq,
    graph,
    table: tableView(p, graph),
    coverage: coverageView(p, graph),
    networkLog: networkLogView(p),
    notes: [...p.noteViews],
    mergeDecisions: [...p.merges.values()].map((m) => ({
      seq: m.seq,
      id: m.id,
      entityIds: [...m.entityIds],
      survivorId: m.survivorId,
      reasons: [...m.reasons],
      decidedBy: m.decidedBy,
      decidedAt: m.decidedAt,
      reverted: m.reverted === true,
    })),
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
