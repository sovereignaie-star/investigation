import type { CaseSummary } from "@workspace/api-client-react";
import type { Coverage, Graph as ProjectionGraph } from "@ir/ledger/projections";

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
  /** P3-021: the readable analyst notes carried by the projection (ledger order). */
  notes: StoredNote[];
  /**
   * P4-010 (UC-21): the case's coverage map as the served projection carries it
   * (P2-017 — cells/transforms/untouched + notRun, advisor round). `null` means the coverage is NOT
   * available: the field was absent (an older server) or failed validation — the
   * view says so honestly instead of fabricating an empty map. A VALID empty
   * coverage (no cells at all) is a Coverage object, distinct from `null`.
   */
  coverage: Coverage | null;
}

/** A case opened into the workbench: its identity plus its own graph. */
export interface OpenedCase {
  id: string;
  title: string | null;
  seq: number;
  sha256: string;
  graph: ProjectionGraph;
  notes: StoredNote[];
  /** P4-010: the coverage map of the opened case — `null` = unavailable, never a fabricated empty map. */
  coverage: Coverage | null;
}

/** P3-021: a readable note as the case's projection carries it (see @ir/ledger). */
export interface StoredNote {
  seq: number;
  nodeId: string;
  text: string;
  at: string;
  actor: string;
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

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** One cell — strict: anything malformed rejects the cell (and with it the whole field). */
function parseCoverageCell(raw: unknown): Coverage["cells"][number] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.entityId !== "string" || typeof b.transformId !== "string") return null;
  if (!isCount(b.positive) || !isCount(b.negative) || !isCount(b.error)) return null;
  if (b.last !== "positive" && b.last !== "negative" && b.last !== "error") return null;
  if (typeof b.lastAt !== "string") return null;
  return {
    entityId: b.entityId,
    transformId: b.transformId,
    positive: b.positive,
    negative: b.negative,
    error: b.error,
    last: b.last,
    lastAt: b.lastAt,
  };
}

/** One never-run record — the projection's `investigate.not_run` audit row (advisor round). */
function parseNotRunCell(raw: unknown): Coverage["notRun"][number] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.key !== "string" || typeof b.transformId !== "string" || typeof b.reason !== "string" || typeof b.at !== "string") {
    return null;
  }
  // the reason is taken VERBATIM — never trimmed or paraphrased; empty reasons
  // are still records (the projection filters them, but a nonempty check here
  // would silently drop a legitimate record on a stricter server)
  return { key: b.key, transformId: b.transformId, reason: b.reason, at: b.at };
}

/**
 * P4-010 (UC-21): strict validation of the served coverage map. The whole field
 * is taken or rejected as one — a partially corrupt map is NEVER shown as a
 * complete coverage picture (that would hide unchecked entities behind a green
 * facade). `null` means "unavailable", which the view states honestly; a valid
 * empty map (zero cells) is a Coverage object, not `null`.
 */
function parseCoverage(raw: unknown): Coverage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (!Array.isArray(c.cells) || !isStringArray(c.transforms) || !isStringArray(c.untouched)) return null;
  // the not_run records are part of the same taken-or-rejected whole: a corrupt
  // record is a corrupt map, not a map without its blocked pairs (that would
  // present policy-blocked entities as merely unchecked — a fabricated honesty)
  if (!Array.isArray(c.notRun)) return null;
  const cells: Coverage["cells"] = [];
  for (const cell of c.cells) {
    const parsed = parseCoverageCell(cell);
    if (parsed === null) return null;
    cells.push(parsed);
  }
  const notRun: Coverage["notRun"] = [];
  for (const record of c.notRun) {
    const parsed = parseNotRunCell(record);
    if (parsed === null) return null;
    notRun.push(parsed);
  }
  return { cells, transforms: [...c.transforms], untouched: [...c.untouched], notRun };
}

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
  // P3-021: the projection now carries the readable analyst notes; a body without
  // them (an older server) reads as zero notes — the notes feature degrades to
  // "unavailable", never to a broken workbench.
  const notes = Array.isArray(b.notes)
    ? (b.notes as unknown[]).filter(
        (n): n is { seq: number; nodeId: string; text: string; at: string; actor: string } =>
          typeof n === "object" &&
          n !== null &&
          typeof (n as { nodeId?: unknown }).nodeId === "string" &&
          typeof (n as { text?: unknown }).text === "string",
      )
    : [];
  return {
    seq: b.seq,
    sha256: b.sha256,
    graph: { nodes: graph.nodes as ProjectionGraph["nodes"], edges: graph.edges as ProjectionGraph["edges"] },
    notes,
    // P4-010: the coverage map rides along or the view states "unavailable" — a
    // corrupt field never becomes a fabricated empty map (fail-closed, like notes).
    coverage: parseCoverage(b.coverage),
  };
}

/** Builds the opened case from the listing row (its identity) and the validated snapshot. */
export function toOpenedCase(row: Pick<CaseSummary, "id" | "title">, snapshot: ProjectionSnapshot): OpenedCase {
  return { id: row.id, title: row.title, ...snapshot };
}
