import {
  activityPeriods,
  escalations,
  repetitions,
  suddenSilences,
  type ActivityPeriod,
  type Escalation,
  type Repetition,
  type SuddenSilence,
  type TimePatternEvent,
} from "@ir/core";
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

/** Honest phrasing for the occurrence window; `full` keeps the raw bounds verbatim (title).
 * A segment of the label: text (Arabic phrasing) or ts (an ISO
 * timestamp — rendered inside a dir="ltr" span; visual QA caught ISO runs
 * scrambling inside the RTL paragraph because their neutral characters
 * (T, Z, -, :) resolve to the paragraph direction). */
export type OccurrenceSegment = { type: "text" | "ts"; value: string };

export function occurrenceLabel(item: Pick<TimelineItem, "occurredFrom" | "occurredTo">): {
  text: string;
  full: string;
  segments: OccurrenceSegment[];
} {
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
  const segments: OccurrenceSegment[] =
    shape === "unknown"
      ? [{ type: "text", value: "غير محدد" }]
      : shape === "point"
        ? [
            { type: "text", value: "في " },
            { type: "ts", value: f as string },
          ]
        : shape === "closed"
          ? [
              { type: "text", value: "من " },
              { type: "ts", value: f as string },
              { type: "text", value: " إلى " },
              { type: "ts", value: t as string },
            ]
          : shape === "open-start"
            ? [
                { type: "text", value: "البداية غير محددة — حتى " },
                { type: "ts", value: t as string },
              ]
            : [
                { type: "text", value: "من " },
                { type: "ts", value: f as string },
                { type: "text", value: " — النهاية غير محددة" },
              ];
  return { text, full, segments };
}

/**
 * P4-019 — the timeline's detected patterns (فترات النشاط، الصمت المفاجئ،
 * التصاعد، التكرار). The atoms are the items' OBSERVATIONS (their observedAt
 * is the honest event time — the occurrence window is an interval, not a
 * point), each carrying its evidence id, and the repetition key is the observed
 * value. Parameters are the module's documented defaults — identical to the
 * frozen reference timeline's (fixtures/time/reference-timeline.json) — so the
 * displayed patterns are exactly the tested semantics.
 */
export interface TimelinePatterns {
  activityPeriods: ActivityPeriod[];
  suddenSilences: SuddenSilence[];
  escalations: Escalation[];
  repetitions: Repetition[];
}

export function buildTimelinePatterns(items: readonly TimelineItem[]): TimelinePatterns {
  const events: TimePatternEvent[] = items.flatMap((item) =>
    item.observations.map((o) => ({
      at: o.observedAt,
      value: item.objectLabel,
      evidenceIds: [o.evidenceId],
    })),
  );
  return {
    activityPeriods: activityPeriods(events, { gapMs: TIMELINE_PATTERN_PARAMS.gapMs }),
    suddenSilences: suddenSilences(events, { quietMs: TIMELINE_PATTERN_PARAMS.quietMs }),
    escalations: escalations(events, { bucketMs: TIMELINE_PATTERN_PARAMS.bucketMs, factor: TIMELINE_PATTERN_PARAMS.factor }),
    repetitions: repetitions(events, { withinMs: TIMELINE_PATTERN_PARAMS.withinMs, minTimes: TIMELINE_PATTERN_PARAMS.minTimes }),
  };
}

/** P4-019 — the display defaults; the same values the frozen reference is tested with. */
export const TIMELINE_PATTERN_PARAMS = {
  gapMs: 6 * 3600_000,
  quietMs: 72 * 3600_000,
  bucketMs: 86_400_000,
  factor: 2,
  withinMs: 3600_000,
  minTimes: 3,
} as const;
