import type { CaseSummary } from "@workspace/api-client-react";
import type { Graph as ProjectionGraph } from "@ir/ledger/projections";

/**
 * P3-015: the saved-investigations model — «فتح قضية بعد إعادة التشغيل». The
 * workbench keeps NO browser storage (D-033): after a restart the case is
 * re-opened from the server, and the graph the workbench renders is the case's
 * own projection snapshot fetched over the API — never a browser rebuild. The
 * parse below is fail-closed: a malformed projection response is an honest
 * error, never a fabricated empty case dressed up as an opened one.
 */

/** The validated core of the served snapshot — what the workbench actually renders. */
export interface ProjectionSnapshot {
  seq: number;
  sha256: string;
  graph: ProjectionGraph;
}

/** A case opened into the workbench: its identity plus its own graph. */
export interface OpenedCase {
  id: string;
  title: string | null;
  seq: number;
  sha256: string;
  graph: ProjectionGraph;
}

/**
 * Only an active case is openable. A locked case (J-17) is listed as an
 * identifier-only row — never silently filtered, never openable — and an
 * archived case is not a workbench target (J-16: the lifecycle screen owns it).
 */
export function canOpenCase(c: CaseSummary): boolean {
  return c.status === "active";
}

const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Validates the served snapshot's load-bearing fields (fail-closed): an
 * integer seq (>= -1), a 64-hex sha256, and a graph with nodes/edges arrays.
 * Anything else is rejected with null — the caller surfaces an honest error
 * instead of rendering a fabricated case.
 */
export function parseProjection(body: unknown): ProjectionSnapshot | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.seq !== "number" || !Number.isInteger(b.seq) || b.seq < -1) return null;
  if (typeof b.sha256 !== "string" || !SHA256_RE.test(b.sha256)) return null;
  const g = b.graph;
  if (typeof g !== "object" || g === null) return null;
  const graph = g as Record<string, unknown>;
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
  return {
    seq: b.seq,
    sha256: b.sha256,
    graph: { nodes: graph.nodes as ProjectionGraph["nodes"], edges: graph.edges as ProjectionGraph["edges"] },
  };
}

/** Builds the opened case from the listing row (its identity) and the validated snapshot. */
export function toOpenedCase(row: Pick<CaseSummary, "id" | "title">, snapshot: ProjectionSnapshot): OpenedCase {
  return { id: row.id, title: row.title, ...snapshot };
}
