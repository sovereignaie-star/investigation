import type { ClaimObservation, Graph, GraphEdge, GraphNode } from "@ir/ledger/projections";
import { compareTimestamps } from "@ir/schema";

/**
 * P4-007 (UC-08): the timeline's pure model — خط زمني ثنائي البعد.
 *
 * البُعد الأول: نافذة الحدوث (ADR-33 — occurredFrom/occurredTo، فترات غموض مستقلة عن
 * الصلاحية وعن وقت الرصد). البُعد الثاني: وقت رصد كل ملاحظة (P4-006 ClaimObservation).
 * العرض صادق: الفترة كما هي بلا اختراع «تقريباً»، والحدود المفتوحة «غير محددة»،
 * والطوابع خام بلا فقد دقة أو إزاحة.
 */

/** One claim (event) on the timeline — relation or literal attribute alike. */
export interface TimelineItem {
  claimId: string;
  subjectId: string;
  subjectLabel: string;
  predicate: string;
  /** The other end: a node's label for relations, the literal value for attributes. */
  objectLabel: string;
  validFrom: string | null;
  validTo: string | null;
  occurredFrom: string | null;
  occurredTo: string | null;
  observations: ClaimObservation[];
}

const labelOf = (n: GraphNode): string => n.labels.ar ?? n.labels.en ?? n.canonicalKey;

function fromAttribute(subject: GraphNode, a: GraphNode["attributes"][number]): TimelineItem {
  return {
    claimId: a.claimId,
    subjectId: subject.id,
    subjectLabel: labelOf(subject),
    predicate: a.predicate,
    objectLabel: String(a.value),
    validFrom: a.validFrom,
    validTo: a.validTo,
    occurredFrom: a.occurredFrom,
    occurredTo: a.occurredTo,
    observations: a.observations,
  };
}

function fromEdge(e: GraphEdge, nodes: Map<string, GraphNode>): TimelineItem {
  const source = nodes.get(e.source);
  const target = nodes.get(e.target);
  return {
    claimId: e.id,
    subjectId: e.source,
    subjectLabel: source ? labelOf(source) : e.source,
    predicate: e.predicate,
    objectLabel: target ? labelOf(target) : e.target,
    validFrom: e.validFrom,
    validTo: e.validTo,
    occurredFrom: e.occurredFrom,
    occurredTo: e.occurredTo,
    observations: e.observations,
  };
}

/** Collects every claim — relation edges and literal attributes — as timeline events. */
export function buildTimelineItems(graph: Graph): TimelineItem[] {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const items: TimelineItem[] = [];
  for (const n of graph.nodes) for (const a of n.attributes) items.push(fromAttribute(n, a));
  for (const e of graph.edges) items.push(fromEdge(e, nodes));
  return items;
}

/** How much of the occurrence window is known. */
export type OccurrenceShape = "point" | "closed" | "open-start" | "open-end" | "unknown";

export function occurrenceShape(item: Pick<TimelineItem, "occurredFrom" | "occurredTo">): OccurrenceShape {
  const { occurredFrom: f, occurredTo: t } = item;
  if (f === null && t === null) return "unknown";
  if (f !== null && t !== null) return compareTimestamps(f, t) === 0 ? "point" : "closed";
  return t !== null ? "open-start" : "open-end";
}

/** Deterministic DISPLAY order — a total order for rendering, not a proof of temporal precedence:
 *  dated events first (by earliest known bound, then latest known bound, then claimId —
 *  compareTimestamps full precision), undated events last (never mixed in, never treated as −∞). */
export function sortTimelineItems(items: TimelineItem[]): TimelineItem[] {
  const dated: TimelineItem[] = [];
  const undated: TimelineItem[] = [];
  for (const i of items) (occurrenceShape(i) === "unknown" ? undated : dated).push(i);
  const byKnownBounds = (a: TimelineItem, b: TimelineItem): number => {
    // dated items always carry at least one bound (shape !== unknown), so the "" default
    // never reaches the comparator — and if it ever did, the equal-"" fallback is a stable no-op.
    const aEarly = a.occurredFrom ?? a.occurredTo ?? "";
    const bEarly = b.occurredFrom ?? b.occurredTo ?? "";
    const d = compareTimestamps(aEarly, bEarly);
    if (d !== 0) return d;
    const aLate = a.occurredTo ?? a.occurredFrom ?? "";
    const bLate = b.occurredTo ?? b.occurredFrom ?? "";
    const d2 = compareTimestamps(aLate, bLate);
    if (d2 !== 0) return d2;
    return a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : 0;
  };
  dated.sort(byKnownBounds);
  undated.sort((a, b) => (a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : 0));
  return [...dated, ...undated];
}

/** Honest phrasing for the occurrence window; `full` keeps the raw bounds verbatim (title). */
export function occurrenceLabel(item: Pick<TimelineItem, "occurredFrom" | "occurredTo">): { text: string; full: string } {
  const { occurredFrom: f, occurredTo: t } = item;
  const shape = occurrenceShape(item);
  const text =
    shape === "unknown"
      ? "غير محدد"
      : shape === "point"
        ? `في ${f}`
        : shape === "closed"
          ? `من ${f} إلى ${t}`
          : shape === "open-start"
            ? `البداية غير محددة — حتى ${t}`
            : `من ${f} — النهاية غير محددة`;
  const full = `${f ?? ""} ← ${t ?? ""}`;
  return { text, full };
}
