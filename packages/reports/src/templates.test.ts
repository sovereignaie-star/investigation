/**
 * P5-023 — قوالب تقارير إضافية: ملف كيان (Dossier)، تقرير خط زمني، تقرير مقارنة.
 *
 * صادق الأدلة: كُتب قبل أي تنفيذ — كل قالب يُبنى كـReportDocument عبر
 * buildReport (فاشل-مغلق: لا جملة بلا إحالة ولا إحالة معلقة) ويجتاز مدقق
 * الإحالات P5-011 (auditReportDocument: لا عبارات بلا إحالة، لا إحالات
 * معلقة، لا أدلة يتيمة)، ويُصدَّر بالقوالب القائمة (HTML وMarkdown).
 */
import { describe, expect, it } from "vitest";
import { auditReportDocument, renderReportHtml, renderReportMarkdown, validateReport } from "./index.ts";
import { buildComparisonReport, buildDossierReport, buildTimelineReport } from "./templates.ts";

const EV = [
  { id: "EV-1", label: "سجل مكالمات", sha256: "a".repeat(64) },
  { id: "EV-2", label: "مستند بنكي", sha256: "b".repeat(64) },
  { id: "EV-3", label: "شهادة شاهد", sha256: "c".repeat(64) },
];

const C = (ids: string[]) => ids.map((id) => EV.find((e) => e.id === id) ?? EV[0]);

describe("P5-023 — قوالب التقارير الإضافية", () => {
  it("T-TPL-001: ملف الكيان (Dossier) — تقرير صالح يجتاز مدقق الإحالات باسم الكيان في العنوان", () => {
    const doc = buildDossierReport({
      entity: { name: "أحمد المكي", kind: "شخص" },
      caseRef: "01J-2026-001",
      lang: "ar",
      evidence: EV,
      sections: [
        {
          title: "الهوية",
          statements: [
            { text: "الكيان شخص طبيعي يظهر في سجل المكالمات", citations: C(["EV-1"]) },
            { text: "له مستند بنكي وشهادة شاهد مرتبطة", citations: C(["EV-2", "EV-3"]) },
          ],
        },
      ],
    });
    expect(validateReport(doc).ok).toBe(true);
    const audit = auditReportDocument(doc);
    expect(audit.ok).toBe(true);
    expect(audit.statementCount).toBeGreaterThan(0);
    expect(doc.title).toContain("أحمد المكي");
  });

  it("T-TPL-002: الملف يرفض فاشلاً-مغلققاً أي جملة بلا إحالة", () => {
    expect(() =>
      buildDossierReport({
        entity: { name: "شركة وهمية", kind: "شركة" },
        caseRef: "01J",
        lang: "ar",
        evidence: EV,
        sections: [{ title: "س", statements: [{ text: "عبارة بلا إحالة", citations: [] }] }],
      }),
    ).toThrow();
  });

  it("T-TPL-003: تقرير الخط الزمني — الأحداث مرتبة زمنياً وكل حدث يحمل إحالته وطابعه الزمني", () => {
    const doc = buildTimelineReport({
      caseRef: "01J-2026-001",
      lang: "ar",
      title: "خط زمني للتحويلات",
      evidence: EV,
      events: [
        { at: "2026-03-02T10:00:00Z", text: "تحويل بنكي بقيمة عالية", citations: C(["EV-2"]) },
        { at: "2026-03-01T09:00:00Z", text: "اتصال أول بين الطرفين", citations: C(["EV-1"]) },
        { at: "2026-03-03T08:00:00Z", text: "شهادة الشاهد على الاجتماع", citations: C(["EV-3"]) },
      ],
    });
    expect(validateReport(doc).ok).toBe(true);
    expect(auditReportDocument(doc).ok).toBe(true);
    const texts = doc.sections.flatMap((s) => s.statements.map((st) => st.text));
    const firstIdx = texts.findIndex((t) => t.includes("09:00"));
    const secondIdx = texts.findIndex((t) => t.includes("10:00"));
    const thirdIdx = texts.findIndex((t) => t.includes("08:00"));
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
    expect(thirdIdx).toBeGreaterThan(secondIdx);
  });

  it("T-TPL-004: الخط الزمني يرفض قائمة أحداث فارغة", () => {
    expect(() => buildTimelineReport({ caseRef: "01J", lang: "ar", title: "فارغ", evidence: EV, events: [] })).toThrow();
  });

  it("T-TPL-005: تقرير المقارنة يرفض أقل من طرفين للمقارنة", () => {
    expect(() =>
      buildComparisonReport({
        caseRef: "01J",
        lang: "ar",
        title: "مقارنة",
        evidence: EV,
        subjects: [{ name: "الطرف الأول" }],
        aspects: [
          {
            name: "حجم التحويلات",
            statements: [{ subject: "الطرف الأول", text: "تحويلات صغيرة متكررة", citations: C(["EV-2"]) }],
          },
        ],
      }),
    ).toThrow();
  });

  it("T-TPL-006: تقرير المقارنة — كل طرف يظهر وكل جانب يحمل إحالاته والمدقق يجتاز", () => {
    const doc = buildComparisonReport({
      caseRef: "01J-2026-001",
      lang: "ar",
      title: "مقارنة طرفي التحويلات",
      evidence: EV,
      subjects: [{ name: "الطرف الأول" }, { name: "الطرف الثاني" }],
      aspects: [
        {
          name: "نمط التحويلات",
          statements: [
            { subject: "الطرف الأول", text: "تحويلات صغيرة متكررة عبر سجل المكالمات", citations: C(["EV-1", "EV-2"]) },
            { subject: "الطرف الثاني", text: "تحويل واحد كبير موثق بالمستند البنكي", citations: C(["EV-2"]) },
          ],
        },
        {
          name: "الشهادات",
          statements: [
            { subject: "الطرف الأول", text: "شاهد واحد يربطه بالاجتماع", citations: C(["EV-3"]) },
            { subject: "الطرف الثاني", text: "لا شهادة عليه", citations: C(["EV-3"]) },
          ],
        },
      ],
    });
    expect(validateReport(doc).ok).toBe(true);
    const audit = auditReportDocument(doc);
    expect(audit.ok).toBe(true);
    const all = JSON.stringify(doc);
    expect(all).toContain("الطرف الأول");
    expect(all).toContain("الطرف الثاني");
    expect(all).toContain("نمط التحويلات");
  });

  it("T-TPL-007: القوالب الثلاثة تُصدَّر بقالب HTML القائم — إحالات [n] وملحق أدلة", () => {
    const dossier = buildDossierReport({
      entity: { name: "كيان", kind: "شخص" },
      caseRef: "01J",
      lang: "ar",
      evidence: EV,
      sections: [{ title: "س", statements: [{ text: "نص", citations: C(["EV-1"]) }] }],
    });
    const html = renderReportHtml(dossier);
    expect(html).toContain('dir="rtl"');
    expect(html).toMatch(/\[1\]/);
    expect(html).toContain("ملحق الأدلة");

    const timeline = buildTimelineReport({
      caseRef: "01J",
      lang: "ar",
      title: "خط",
      evidence: EV,
      events: [{ at: "2026-03-01T09:00:00Z", text: "حدث", citations: C(["EV-1"]) }],
    });
    expect(renderReportHtml(timeline)).toContain('dir="rtl"');

    const comparison = buildComparisonReport({
      caseRef: "01J",
      lang: "ar",
      title: "مقارنة",
      evidence: EV,
      subjects: [{ name: "أ" }, { name: "ب" }],
      aspects: [{ name: "جانب", statements: [{ subject: "أ", text: "نص", citations: C(["EV-3"]) }] }],
    });
    expect(renderReportHtml(comparison)).toContain('dir="rtl"');
  });

  it("T-TPL-008: القوالب الثلاثة تُصدَّر Markdown (P5-022) — إحالات وبصمات", () => {
    const timeline = buildTimelineReport({
      caseRef: "01J",
      lang: "ar",
      title: "خط",
      evidence: EV,
      events: [{ at: "2026-03-01T09:00:00Z", text: "حدث", citations: C(["EV-1"]) }],
    });
    const md = renderReportMarkdown(timeline);
    expect(md).toContain("[1]");
    expect(md).toContain("a".repeat(64));
  });
});
