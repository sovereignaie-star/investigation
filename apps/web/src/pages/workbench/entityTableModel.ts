import type { GraphNode } from "@ir/ledger/projections";

/**
 * P3-009: the entity table model — pure functions only (testable without a DOM).
 * The table shows the projection's entities with default sorting and filtering,
 * rendered through a virtualized window (100,000 rows must not freeze the UI).
 */

export interface EntityRow {
  id: string;
  type: string;
  label: string;
  canonicalKey: string;
  /** Number of attribute claims on the entity. */
  claims: number;
  /** Number of distinct evidence items backing those claims. */
  evidence: number;
  positive: number;
  negative: number;
}

export type SortKey = "type" | "label" | "canonicalKey" | "claims" | "evidence";
export type SortDir = "asc" | "desc";
export interface SortSpec {
  key: SortKey;
  dir: SortDir;
}

/** The default sort (P3-009 «فرز افتراضية»): type asc, then canonical key asc. */
export const DEFAULT_SORT: SortSpec = { key: "type", dir: "asc" };

function nodeLabel(n: GraphNode): string {
  return n.labels.ar ?? n.labels.en ?? n.canonicalKey;
}

function rowOf(n: GraphNode): EntityRow {
  return {
    id: n.id,
    type: n.type,
    label: nodeLabel(n),
    canonicalKey: n.canonicalKey,
    claims: n.attributes.length,
    evidence: n.evidenceIds.length,
    positive: n.observations.positive,
    negative: n.observations.negative,
  };
}

const DIR_SIGN: Record<SortDir, 1 | -1> = { asc: 1, desc: -1 };

function compare(a: EntityRow, b: EntityRow, key: SortKey, sign: 1 | -1): number {
  switch (key) {
    case "type":
    case "label":
    case "canonicalKey": {
      const av = a[key];
      const bv = b[key];
      if (av < bv) return -1 * sign;
      if (av > bv) return 1 * sign;
      return 0;
    }
    case "claims":
    case "evidence": {
      const d = a[key] - b[key];
      return d * sign;
    }
  }
}

/** Build rows from graph nodes, already in the default sort order. */
export function buildEntityRows(nodes: readonly GraphNode[]): EntityRow[] {
  const rows = nodes.map(rowOf);
  const sign = DIR_SIGN[DEFAULT_SORT.dir];
  return rows.sort(
    (a, b) => compare(a, b, DEFAULT_SORT.key, sign) || a.canonicalKey.localeCompare(b.canonicalKey) || a.id.localeCompare(b.id),
  );
}

/**
 * Sort by the chosen column and direction. Equal keys keep a deterministic order
 * (canonical key, then id) — the sort is stable regardless of input order.
 */
export function sortEntityRows(rows: readonly EntityRow[], spec: SortSpec): EntityRow[] {
  const sign = DIR_SIGN[spec.dir];
  return [...rows].sort(
    (a, b) => compare(a, b, spec.key, sign) || a.canonicalKey.localeCompare(b.canonicalKey) || a.id.localeCompare(b.id),
  );
}

/**
 * Case-insensitive substring filter across type, label and canonical key.
 * An empty (or whitespace-only) query returns all rows unchanged.
 */
export function filterEntityRows(rows: readonly EntityRow[], query: string): EntityRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter(
    (r) => r.type.toLowerCase().includes(q) || r.label.toLowerCase().includes(q) || r.canonicalKey.toLowerCase().includes(q),
  );
}

/**
 * P3-009 virtualization: the visible row window for a fixed-height list.
 * Pure math — the component feeds it live scroll state, tests prove the clamping.
 * Returns an inclusive {start, end}; an empty list yields end = -1.
 */
export function visibleWindow(args: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  totalRows: number;
  overscan: number;
}): { start: number; end: number } {
  const { scrollTop, viewportHeight, rowHeight, totalRows, overscan } = args;
  if (totalRows <= 0) return { start: 0, end: -1 };
  const safeRowHeight = rowHeight > 0 ? rowHeight : 1;
  const top = Math.max(0, scrollTop);
  const firstVisible = Math.floor(top / safeRowHeight);
  const visibleCount = Math.max(0, Math.ceil(Math.max(0, viewportHeight) / safeRowHeight));
  const start = Math.max(0, Math.min(totalRows - 1, firstVisible - overscan));
  const last = Math.min(totalRows - 1, firstVisible + visibleCount + overscan - 1);
  return { start, end: Math.max(start - 1, last) };
}
