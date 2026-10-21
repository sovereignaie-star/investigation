import { canonicalize } from "../jcs.ts";
import type { Entry } from "../ledger.ts";
import { sha256Hex } from "../ledger.ts";
import { type Issue, Projector, type StoredNote } from "./state.ts";
import {
  type Coverage,
  coverageView,
  type Graph,
  graphView,
  type NetworkLog,
  networkLogView,
  type ServedClaim,
  type TableRow,
  tableView,
} from "./views.ts";

export { Projector, type Issue } from "./state.ts";
export type { ServedClaim } from "./views.ts";
export type { StoredNote } from "./state.ts";
export * from "./views.ts";
export { diffProjections } from "./diff.ts";
export type { CaseDiff, ClaimChange, EntityChange } from "./diff.ts";

/** All views of a case at one point of its chain (P1-016). */
export interface Projection {
  /** Last seq included (-1 for an empty chain). */
  seq: number;
  graph: Graph;
  table: TableRow[];
  coverage: Coverage;
  /** P2-014 (E-06/T-ETH-006): every external request the case made — gateway decisions and stored responses. */
  networkLog: NetworkLog;
  /**
   * P4-008 (UC-09): the case's claim inventory — EVERY claim whose entities are known,
   * with its content and its subject/target resolved through merges. Unlike the graph,
   * this includes relation claims whose two ends merged into one node (self-loops are
   * excluded from the graph by design, but the claim stays in the case — it is served
   * here, so a case diff never reports a surviving claim as removed).
   */
  claims: ServedClaim[];
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

/**
 * P4-008 (UC-09): every claim whose entities are known, resolved through merges — the
 * case's claim inventory. Evidence accrual (observations/evidenceIds) is deliberately
 * NOT served here: the diff compares claim CONTENT, and accruing evidence is not a
 * content change. Relation claims that became self-loops after a merge ARE included —
 * the claim survives in the case; only its served representation changed.
 */
export function claimInventory(p: Projector): ServedClaim[] {
  const keyOf = (id: string): string => {
    const resolved = p.entities.get(p.resolve(id));
    return resolved?.canonicalKey ?? "";
  };
  const out: ServedClaim[] = [];
  for (const c of p.claims.values()) {
    if (!p.entities.has(c.subjectId)) continue;
    if (c.objectId !== undefined && !p.entities.has(c.objectId)) continue;
    out.push({
      claimId: c.id,
      predicate: c.predicate,
      subjectKey: keyOf(c.subjectId),
      targetKey: c.objectId === undefined ? null : keyOf(c.objectId),
      value: c.value ?? null,
      validFrom: c.validFrom ?? null,
      validTo: c.validTo ?? null,
      occurredFrom: c.occurredFrom ?? null,
      occurredTo: c.occurredTo ?? null,
      confidence: c.confidence,
    });
  }
  return out.sort((a, b) => a.claimId.localeCompare(b.claimId));
}

export function view(p: Projector): Projection {
  const graph = graphView(p);
  return {
    seq: p.seq,
    graph,
    claims: claimInventory(p),
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
