import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { TimelineView } from "./TimelineView";
import { buildTimelineItems, sortTimelineItems } from "./timelineModel";

/**
 * P4-007 (UC-08): خط زمني ثنائي البعد — البُعدان الظاهران: نافذة الحدوث (المحور الأساسي)
 * ووقت الرصد لكل ملاحظة (البعد الثاني). صادق الأدلة: كُتب قبل أي تنفيذ؛ الأحمر الأول
 * هيكلي (الوحدة غير موجودة) وموثق في WORKLOG، والنقر الفعلي يُثبت في e2e (uc12)
 * وفق نمط المستودع المتبع (الترميز الساكن يفحص الجاهزية للنقر: معرف العقدة على الصف).
 * تحويل إلى .ts بـReact.createElement (عرف المستودع للمكونات في .ts): ملف .tsx الأصلي
 * لم يكن ضمن نمط تضمين vitest (نمط apps ثم أي مسار بلاحقة .test.ts) فلم يكن يعمل
 * أصلاً — اكتُشف في جولة التحقق الأولى وأُصلح؛ الشحنة التراكمية النهائية تضمه فعلياً.
 */

const items = sortTimelineItems([
  {
    claimId: "c-2019",
    subjectId: "a",
    subjectLabel: "شخص a",
    predicate: "job",
    objectLabel: "مهندس",
    validFrom: null,
    validTo: null,
    occurredFrom: "2019-01-01T00:00:00Z",
    occurredTo: "2019-12-31T23:59:59Z",
    observations: [
      { observationId: "o1", evidenceId: "ev1", observedAt: "2026-03-01T10:00:00Z", kind: "positive" },
      { observationId: "o2", evidenceId: "ev2", observedAt: "2026-03-02T09:00:00-05:00", kind: "error" },
    ],
  },
  {
    claimId: "c-open",
    subjectId: "b",
    subjectLabel: "شخص b",
    predicate: "knows",
    objectLabel: "شخص c",
    validFrom: null,
    validTo: null,
    occurredFrom: null,
    occurredTo: "2020-03-01T00:00:00Z",
    observations: [{ observationId: "o3", evidenceId: "ev3", observedAt: "2026-04-01T00:00:00Z", kind: "negative" }],
  },
  {
    claimId: "c-unknown",
    subjectId: "d",
    subjectLabel: "شخص d",
    predicate: "mentions",
    objectLabel: "شخص a",
    validFrom: null,
    validTo: null,
    occurredFrom: null,
    occurredTo: null,
    observations: [],
  },
]);

describe("TimelineView (P4-007/UC-08) — الخط الزمني ثنائي البعد", () => {
  const html = renderToStaticMarkup(React.createElement(TimelineView, { items }));

  it("renders every event with its subject, predicate and object — sorted display order", () => {
    expect(html).toContain("شخص a");
    expect(html).toContain("شخص b");
    expect(html).toContain("شخص d");
    const a = html.indexOf("c-2019");
    const b = html.indexOf("c-open");
    const d = html.indexOf("c-unknown");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a); // dated before undated in the markup
    expect(d).toBeGreaterThan(b);
  });

  it("shows BOTH dimensions: the occurrence window label AND each observation's observedAt with its kind", () => {
    // dimension 1 — occurrence window, honest interval text (phrasing + isolated ISO runs)
    expect(html).toContain("<span>من </span>");
    expect(html).toContain("<span> إلى </span>");
    expect(html).toContain("البداية غير محددة — حتى ");
    // dimension 2 — observation times with kinds (multiple evidence per event)
    expect(html).toContain("2026-03-01T10:00:00Z");
    expect(html).toContain("2026-03-02T09:00:00-05:00");
    expect(html).toContain("2026-04-01T00:00:00Z");
    expect(html).toContain("رصد إيجابي");
    expect(html).toContain("رصد خطأ");
    expect(html).toContain("رصد سلبي");
  });

  it("an event with no observations says so honestly instead of faking a time", () => {
    expect(html).toContain("لا رصد");
  });

  it("the row is the selection affordance: its subject node id is on the row (click wiring is proven in e2e)", () => {
    expect(html).toContain('data-node-id="a"');
    expect(html).toContain('data-node-id="b"');
    expect(html).toContain('data-node-id="d"');
  });

  it("the full raw occurrence window is exposed verbatim (title) — no precision or offset loss", () => {
    expect(html).toContain('title="2019-01-01T00:00:00Z ← 2019-12-31T23:59:59Z"');
    expect(html).toContain('title=" ← 2020-03-01T00:00:00Z"');
  });

  it("ISO timestamps are directionally isolated (dir=ltr) inside the RTL context — the BiDi visual scrambling fix", () => {
    // Visual QA caught it: inside an RTL paragraph the ISO run "2019-01-01T00:00:00Z"
    // renders visually scrambled («01T00:00:00Z-01-2019») because its neutral characters
    // (T, Z, -, :) resolve to the paragraph direction. The fix is per-timestamp
    // directional isolation — asserted here on the markup, proven on the screenshots.
    // Second catch (375px): a long timestamp may WRAP MID-STRING («...إلى -12-2019» then
    // «31T23:59:59Z») — so each isolated run must also refuse internal line breaks
    // (whitespace-nowrap: the timestamp wraps as one unit or not at all).
    expect(html).toMatch(/<span dir="ltr" class="whitespace-nowrap"[^>]*>\s*2019-01-01T00:00:00Z\s*<\/span>/);
    expect(html).toMatch(/<span dir="ltr" class="whitespace-nowrap"[^>]*>\s*2019-12-31T23:59:59Z\s*<\/span>/);
    expect(html).toMatch(/<span dir="ltr" class="whitespace-nowrap"[^>]*>\s*2020-03-01T00:00:00Z\s*<\/span>/);
    expect(html).toMatch(/<span dir="ltr" class="whitespace-nowrap"[^>]*>\s*2026-03-01T10:00:00Z\s*<\/span>/);
  });

  it("buildTimelineItems feeds real graph shapes into the view (integration of model + view)", () => {
    const graph = {
      nodes: [
        {
          id: "a",
          type: "person",
          canonicalKey: "person:a",
          labels: { ar: "شخص a" },
          props: {},
          aliases: [],
          attributes: [
            {
              claimId: "c-1",
              predicate: "job",
              value: "مهندس",
              confidence: 0.8,
              validFrom: null,
              validTo: null,
              occurredFrom: null,
              occurredTo: null,
              evidenceIds: [],
              observations: [],
            },
          ],
          observations: { positive: 0, negative: 0, error: 0 },
          evidenceIds: [],
        },
      ],
      edges: [],
    };
    const rendered = renderToStaticMarkup(React.createElement(TimelineView, { items: sortTimelineItems(buildTimelineItems(graph)) }));
    expect(rendered).toContain("شخص a");
    expect(rendered).toContain("غير محدد");
  });
});

describe("TimelineView patterns (P4-019 — كل نمط يُعرض مع أدلته)", () => {
  const patternItems = sortTimelineItems([
    {
      claimId: "c-a",
      subjectId: "a",
      subjectLabel: "عقدة a",
      predicate: "status",
      objectLabel: "up",
      validFrom: null,
      validTo: null,
      occurredFrom: "2026-10-01T09:00:00Z",
      occurredTo: null,
      observations: [
        { observationId: "o1", evidenceId: "ev-a1", observedAt: "2026-10-01T09:00:00Z", kind: "positive" },
        { observationId: "o2", evidenceId: "ev-a2", observedAt: "2026-10-01T10:00:00Z", kind: "positive" },
      ],
    },
    {
      claimId: "c-b",
      subjectId: "a",
      subjectLabel: "عقدة a",
      predicate: "status",
      objectLabel: "up",
      validFrom: null,
      validTo: null,
      occurredFrom: "2026-10-10T09:00:00Z",
      occurredTo: null,
      observations: [{ observationId: "o3", evidenceId: "ev-b1", observedAt: "2026-10-10T09:00:00Z", kind: "positive" }],
    },
  ]);

  it("renders the detected patterns with their evidence — a sudden silence carries its bounding evidence", () => {
    const html = renderToStaticMarkup(React.createElement(TimelineView, { items: patternItems }));
    expect(html).toContain('data-testid="timeline-patterns"');
    // صمت مفاجئ بين 10-01 و10-10 (9 أيام ≥ 72 ساعة) بأدلة الحدّين
    expect(html).toMatch(/2026-10-01T09:00:00Z/);
    expect(html).toContain("ev-a2");
    expect(html).toContain("ev-b1");
    // فترتا نشاط (10-01 ساعتان متتاليتان، و10-10 وحدها)
    expect((html.match(/data-testid="timeline-pattern-activity"/g) ?? []).length).toBe(2);
  });

  it("hides the patterns section when no pattern is detectable — no invented patterns", () => {
    const single = [
      {
        claimId: "c-x",
        subjectId: "x",
        subjectLabel: "عقدة x",
        predicate: "p",
        objectLabel: "v",
        validFrom: null,
        validTo: null,
        occurredFrom: "2026-10-01T09:00:00Z",
        occurredTo: null,
        observations: [], // بلا رصد لا أحداث ولا أنماط — لا اختراع
      },
    ];
    const html = renderToStaticMarkup(React.createElement(TimelineView, { items: single }));
    expect(html).not.toContain('data-testid="timeline-patterns"');
  });
});

describe("TimelineView (P5-004) — صيغ عرض التواريخ: خام/ميلادي/هجري/كلاهما", () => {
  beforeEach(async () => {
    const store = await import("../../store/dateFormatStore");
    store.setDateFormat("raw");
  });

  it("الافتراضي خام: أرقام ISO كما هي (لا تغيير على سلوك اليوم)", () => {
    const html = renderToStaticMarkup(React.createElement(TimelineView, { items }));
    expect(html).toMatch(/<span dir="ltr" class="whitespace-nowrap"[^>]*>\s*2019-01-01T00:00:00Z\s*<\/span>/);
  });

  it("هجري: التواريخ الهجرية (أم القرى) تظهر والخام يبقى في title — لا فقد دقة", async () => {
    const store = await import("../../store/dateFormatStore");
    store.setDateFormat("hijri");
    const html = renderToStaticMarkup(React.createElement(TimelineView, { items }));
    // 2019-01-01 = 25 ربيع الآخر 1440هـ
    expect(html).toContain("25 ربيع الآخر 1440هـ");
    // 2026-03-01 = 12 رمضان 1447هـ (وقت الرصد)
    expect(html).toContain("12 رمضان 1447هـ");
    // الخام لا يختفي: title يبقى يحمل النافذة كاملة
    expect(html).toContain('title="2019-01-01T00:00:00Z ← 2019-12-31T23:59:59Z"');
    store.setDateFormat("raw");
  });

  it("كلاهما: الميلادي والهجري معاً", async () => {
    const store = await import("../../store/dateFormatStore");
    store.setDateFormat("both");
    const html = renderToStaticMarkup(React.createElement(TimelineView, { items }));
    expect(html).toContain("1 يناير 2019 (25 ربيع الآخر 1440هـ)");
    store.setDateFormat("raw");
  });

  it("مفتاح الصيغة ظاهر في رأس الخط الزمني بأربع حالات", () => {
    const html = renderToStaticMarkup(React.createElement(TimelineView, { items }));
    expect(html).toContain('data-testid="timeline-dateformat-raw"');
    expect(html).toContain('data-testid="timeline-dateformat-greg"');
    expect(html).toContain('data-testid="timeline-dateformat-hijri"');
    expect(html).toContain('data-testid="timeline-dateformat-both"');
  });
});
