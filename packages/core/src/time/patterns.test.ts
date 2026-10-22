import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { activityPeriods, escalations, repetitions, suddenSilences, type TimePatternEvent } from "./patterns.ts";

/**
 * P4-019 — time patterns: activity periods, sudden silence, escalation,
 * repetition. Acceptance: "كل نمط يُعرض مع أدلته، ويُختبر على خط زمني مرجعي".
 * The reference of record is `fixtures/time/reference-timeline.json` — a
 * deterministic timeline with PLANTED patterns; its expected values were
 * computed by an INDEPENDENT Python implementation (tools/time/reference_timeline.py,
 * double-entry) and frozen. CI pins the committed fixture; the tool's --check
 * mode exists for local verification.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const reference = JSON.parse(readFileSync(join(root, "fixtures", "time", "reference-timeline.json"), "utf8")) as {
  params: { gapMs: number; quietMs: number; bucketMs: number; factor: number; withinMs: number; minTimes: number };
  events: { at: string; value?: string; evidenceIds: string[] }[];
  expected: {
    activityPeriods: { start: string; end: string; count: number; evidenceIds: string[] }[];
    suddenSilences: { from: string; to: string; gapMs: number; beforeEvidenceIds: string[]; afterEvidenceIds: string[] }[];
    escalations: { from: string; to: string; previousCount: number; count: number; evidenceIds: string[] }[];
    repetitions: { value: string; times: number; from: string; to: string; evidenceIds: string[] }[];
  };
};

describe("P4-019 — الأنماط الزمنية على الخط المرجعي المجمد", () => {
  it("فترات النشاط تطابق المرجع — كل فترة بأدلتها", () => {
    expect(activityPeriods(reference.events, { gapMs: reference.params.gapMs })).toEqual(reference.expected.activityPeriods);
  });

  it("الصمت المفاجئ يطابق المرجع — بأدلة الحدّين", () => {
    expect(suddenSilences(reference.events, { quietMs: reference.params.quietMs })).toEqual(reference.expected.suddenSilences);
  });

  it("التصاعد يطابق المرجع — عدّاء المتتاليتين وأدلتهما", () => {
    expect(escalations(reference.events, { bucketMs: reference.params.bucketMs, factor: reference.params.factor })).toEqual(
      reference.expected.escalations,
    );
  });

  it("التكرار يطابق المرجع — القيمة المتكررة وأدلة كل مرة", () => {
    expect(repetitions(reference.events, { withinMs: reference.params.withinMs, minTimes: reference.params.minTimes })).toEqual(
      reference.expected.repetitions,
    );
  });
});

describe("P4-019 — قواعد الحدود موثقة يدوياً (لا تُخمن من المرجع وحده)", () => {
  const ev = (at: string, value?: string): TimePatternEvent => ({
    at,
    ...(value ? { value } : {}),
    evidenceIds: [`ev-${at}`],
  });

  it("الحد فاصل حرفياً: فجوة تساوي gapMs بالضبط تفصل فترتين (الأصغر تدمج)", () => {
    const events = [ev("2026-10-01T09:00:00.000Z"), ev("2026-10-01T15:00:00.000Z")]; // 6h بالضبط
    expect(activityPeriods(events, { gapMs: 6 * 3600_000 })).toEqual([
      { start: "2026-10-01T09:00:00.000Z", end: "2026-10-01T09:00:00.000Z", count: 1, evidenceIds: ["ev-2026-10-01T09:00:00.000Z"] },
      { start: "2026-10-01T15:00:00.000Z", end: "2026-10-01T15:00:00.000Z", count: 1, evidenceIds: ["ev-2026-10-01T15:00:00.000Z"] },
    ]);
    expect(activityPeriods(events, { gapMs: 6 * 3600_000 + 1 })).toHaveLength(1);
  });

  it("حدود عمر القضية ليست صمتاً: فجوات ما بين الأحداث فقط", () => {
    const events = [ev("2026-10-01T09:00:00.000Z"), ev("2026-10-10T09:00:00.000Z")];
    const silences = suddenSilences(events, { quietMs: 72 * 3600_000 });
    expect(silences).toHaveLength(1);
    expect(silences[0]).toMatchObject({
      beforeEvidenceIds: ["ev-2026-10-01T09:00:00.000Z"],
      afterEvidenceIds: ["ev-2026-10-10T09:00:00.000Z"],
    });
  });

  it("التصاعد يتطلب تكتلات متجاورة: يوم فارغ بينهما يلغي التصعيد", () => {
    const daily = (d: number, n: number): TimePatternEvent[] =>
      Array.from({ length: n }, (_, i) => ({
        at: `2026-10-${String(d).padStart(2, "0")}T09:0${i}:00.000Z`,
        evidenceIds: [`ev-${d}-${i}`],
      }));
    const adjacent = [...daily(10, 1), ...daily(11, 4)];
    expect(escalations(adjacent, { bucketMs: 86_400_000, factor: 2 })).toHaveLength(1);
    const gapped = [...daily(10, 1), ...daily(12, 4)]; // يوم 11 فارغ
    expect(escalations(gapped, { bucketMs: 86_400_000, factor: 2 })).toEqual([]);
  });

  it("التكرار يفصل النوافذ إلى أشواط قصوى، وminTimes حد صادق", () => {
    const events: TimePatternEvent[] = [
      { at: "2026-10-01T09:00:00.000Z", value: "v", evidenceIds: ["a"] },
      { at: "2026-10-01T09:30:00.000Z", value: "v", evidenceIds: ["b"] },
      { at: "2026-10-01T09:50:00.000Z", value: "v", evidenceIds: ["c"] },
      { at: "2026-10-02T09:00:00.000Z", value: "v", evidenceIds: ["d"] }, // خارج النافذة
    ];
    expect(repetitions(events, { withinMs: 3600_000, minTimes: 3 })).toEqual([
      { value: "v", times: 3, from: "2026-10-01T09:00:00.000Z", to: "2026-10-01T09:50:00.000Z", evidenceIds: ["a", "b", "c"] },
    ]);
    expect(repetitions(events, { withinMs: 3600_000, minTimes: 4 })).toEqual([]);
  });

  it("سلسلة فارغة لا تعطي أي نمط — لا اختراع", () => {
    expect(activityPeriods([], { gapMs: 1000 })).toEqual([]);
    expect(suddenSilences([], { quietMs: 1000 })).toEqual([]);
    expect(escalations([], { bucketMs: 1000, factor: 2 })).toEqual([]);
    expect(repetitions([], { withinMs: 1000, minTimes: 2 })).toEqual([]);
  });
});
