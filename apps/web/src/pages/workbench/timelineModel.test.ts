import type { Graph, GraphEdge, GraphNode } from "@ir/ledger/projections";
import { describe, expect, it } from "vitest";

import { buildTimelineItems, occurrenceLabel, occurrenceShape, sortTimelineItems, type TimelineItem } from "./timelineModel";

/**
 * P4-007 (UC-08): خط زمني ثنائي البعد — معيار القبول: «ترتيب صحيح مع عدم اليقين الزمني».
 *
 * العقد (ADR-33، قرار مالك 2026-10-21): نافذة الحدوث occurredFrom/occurredTo فترات غموض
 * مستقلة عن الصلاحية validFrom/validTo وعن وقت الرصد observedAt — الساعات الثلاث لا يعوض
 * بعضها بعضاً. عدم اليقين يُعرض بفترات صادقة: «تقريباً 2019» = فترة السنة كاملة،
 * «قبل 2020-03» = بداية مفتوحة («البداية غير محددة») — بلا اختراع «تقريباً» من عرض الفترة
 * وبلا صياغة توحي بحدود حصرية. الترتيب عرض حتمي (الحدود المعروفة ثم المعرّف) وليس إثبات
 * سبق زمني بين فترتين متداخلتين. الطوابع تُعرض كما هي — لا فقد دقة ولا فقد إزاحة.
 *
 * صادق الأدلة: كُتب هذا الملف قبل أي تنفيذ؛ التشغيل الأحمر الأول هيكلي (الوحدة غير
 * موجودة) وموثق كذلك في WORKLOG — الحاجة السلوكية يقودها معيار UC-08 أعلاه.
 */

const obs = (id: string, at: string, kind: "positive" | "negative" | "error" = "positive") => ({
  observationId: `obs-${id}`,
  evidenceId: `ev-${id}`,
  observedAt: at,
  kind,
});

function node(id: string, attrs: GraphNode["attributes"] = []): GraphNode {
  return {
    id,
    type: "person",
    canonicalKey: `person:${id}`,
    labels: { ar: `شخص ${id}` },
    props: {},
    aliases: [],
    attributes: attrs,
    observations: { positive: 0, negative: 0, error: 0 },
    evidenceIds: [],
  };
}

function edge(over: Partial<GraphEdge> & { id: string; source: string; target: string }): GraphEdge {
  return {
    predicate: "knows",
    confidence: 0.8,
    validFrom: null,
    validTo: null,
    occurredFrom: null,
    occurredTo: null,
    explanation: "test",
    evidenceIds: [],
    observations: [],
    ...over,
  };
}

function graphOf(nodes: GraphNode[], edges: GraphEdge[]): Graph {
  return { nodes, edges };
}

describe("buildTimelineItems (P4-007/UC-08)", () => {
  it("collects relation claims AND literal attributes as timeline events", () => {
    const g = graphOf(
      [
        node("a", [
          {
            claimId: "c-lit",
            predicate: "job",
            value: "مهندس",
            confidence: 0.8,
            validFrom: null,
            validTo: null,
            occurredFrom: "2019-01-01T00:00:00Z",
            occurredTo: "2019-12-31T23:59:59Z",
            evidenceIds: [],
            observations: [obs("1", "2026-03-01T10:00:00Z")],
          },
        ]),
        node("b"),
      ],
      [
        edge({
          id: "c-rel",
          source: "a",
          target: "b",
          occurredFrom: "2018-03-01T00:00:00Z",
          occurredTo: "2018-03-31T23:59:59Z",
          observations: [obs("2", "2026-03-02T10:00:00Z", "negative")],
        }),
      ],
    );
    const items = buildTimelineItems(g);
    expect(items).toHaveLength(2);
    const lit = items.find((i) => i.claimId === "c-lit");
    expect(lit).toMatchObject({
      subjectId: "a",
      subjectLabel: "شخص a",
      predicate: "job",
      objectLabel: "مهندس",
      occurredFrom: "2019-01-01T00:00:00Z",
      occurredTo: "2019-12-31T23:59:59Z",
    });
    expect(lit?.observations).toHaveLength(1);
    const rel = items.find((i) => i.claimId === "c-rel");
    expect(rel).toMatchObject({ subjectId: "a", predicate: "knows", objectLabel: "شخص b" });
    expect(rel?.observations[0]).toMatchObject({ kind: "negative" });
  });
});

describe("sortTimelineItems — ترتيب صحيح مع عدم اليقين الزمني", () => {
  const item = (claimId: string, occurredFrom: string | null, occurredTo: string | null, subject = claimId): TimelineItem => ({
    claimId,
    subjectId: subject,
    subjectLabel: subject,
    predicate: "p",
    objectLabel: "o",
    validFrom: null,
    validTo: null,
    occurredFrom,
    occurredTo,
    observations: [],
  });

  it("dated events sort by their earliest KNOWN bound (moment order, mixed offsets), undated events go LAST — never mixed in", () => {
    const sorted = sortTimelineItems([
      item("unknown-1", null, null),
      item("late", "2020-06-01T00:00:00Z", "2020-06-30T00:00:00Z"), // later window
      item("early-open-start", null, "2020-03-01T00:00:00Z"), // «قبل 2020-03»: only upper bound known
      item("first", "2019-01-01T00:00:00Z", "2019-12-31T23:59:59Z"), // «تقريباً 2019»
      item("unknown-2", null, null),
    ]);
    expect(sorted.map((i) => i.claimId)).toEqual(["first", "early-open-start", "late", "unknown-1", "unknown-2"]);
  });

  it("full precision: sub-millisecond and long fractions order by TRUE moment, not text or ms", () => {
    const sorted = sortTimelineItems([
      item("b-later", "2026-01-01T00:00:00.0009Z", "2026-01-01T00:00:00.0009Z"),
      item("a-earlier", "2026-01-01T00:00:00.0001Z", "2026-01-01T00:00:00.0001Z"),
    ]);
    expect(sorted.map((i) => i.claimId)).toEqual(["a-earlier", "b-later"]);
  });

  it("equal known bounds tie-break deterministically by claimId", () => {
    const sorted = sortTimelineItems([
      item("zz", "2019-01-01T00:00:00Z", "2019-01-31T00:00:00Z"),
      item("aa", "2019-01-01T00:00:00Z", "2019-01-02T00:00:00Z"),
    ]);
    expect(sorted.map((i) => i.claimId)).toEqual(["aa", "zz"]);
  });
});

describe("occurrenceShape + occurrenceLabel — عرض صادق للفترات", () => {
  it("the five shapes", () => {
    expect(occurrenceShape({ occurredFrom: "2019-01-01T00:00:00Z", occurredTo: "2019-01-01T00:00:00Z" })).toBe("point");
    expect(occurrenceShape({ occurredFrom: "2019-01-01T00:00:00Z", occurredTo: "2019-12-31T23:59:59Z" })).toBe("closed");
    expect(occurrenceShape({ occurredFrom: null, occurredTo: "2020-03-01T00:00:00Z" })).toBe("open-start");
    expect(occurrenceShape({ occurredFrom: "2018-05-01T00:00:00Z", occurredTo: null })).toBe("open-end");
    expect(occurrenceShape({ occurredFrom: null, occurredTo: null })).toBe("unknown");
  });

  it("honest phrasing: open bounds say «غير محددة», never «قبل/بعد» and never an invented «تقريباً»", () => {
    expect(occurrenceLabel({ occurredFrom: "2019-01-01T00:00:00Z", occurredTo: "2019-12-31T23:59:59Z" }).text).toBe(
      "من 2019-01-01T00:00:00Z إلى 2019-12-31T23:59:59Z",
    );
    expect(occurrenceLabel({ occurredFrom: null, occurredTo: "2020-03-01T00:00:00Z" }).text).toBe(
      "البداية غير محددة — حتى 2020-03-01T00:00:00Z",
    );
    expect(occurrenceLabel({ occurredFrom: "2018-05-01T00:00:00Z", occurredTo: null }).text).toBe(
      "من 2018-05-01T00:00:00Z — النهاية غير محددة",
    );
    expect(occurrenceLabel({ occurredFrom: null, occurredTo: null }).text).toBe("غير محدد");
  });

  it("the full raw window is preserved verbatim — no precision or offset loss (title carries it)", () => {
    const from = "2019-01-01T00:00:00.12345678901234567890+05:30";
    const to = "2019-12-31T23:59:59.98765432109876543210-08:00";
    const label = occurrenceLabel({ occurredFrom: from, occurredTo: to });
    expect(label.full).toBe(`${from} ← ${to}`);
  });
});
