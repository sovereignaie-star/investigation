import { describe, expect, it } from "vitest";
import { buildReport, renderReportHtml, renderReportDocx, renderReportPdf, validateReport, type ReportDocument } from "./index.ts";

/**
 * P5-010 — `@ir/reports`: قوالب HTML/PDF/DOCX بإحالات (UC-14).
 *
 * القاعدة الحديدية للتقارير: كل جملة واقعية تحمل إحالة — لا يُقبل تقرير فيه
 * عبارة بلا إحالة (فشل-مغلق عند البناء والتحقق). PDF محركه قرار لاحق (P5-027
 * يقارن Typst/Playwright/React-PDF للعربية RTL) — يُرفض صريحاً لا صمتاً.
 */

const EVIDENCE = [
  { id: "EV-1", label: "سجل DNS للنطاق", sha256: "a".repeat(64) },
  { id: "EV-2", label: "لقطة WARC", sha256: "b".repeat(64) },
];

const validDoc = (): ReportDocument =>
  buildReport({
    title: "تقرير فحص النطاق example.test",
    caseRef: "case-001",
    lang: "ar",
    sections: [
      {
        title: "الملخص التنفيذي",
        statements: [
          { text: "النطاق example.test يسجّل سجل A عند 93.184.216.34.", citations: [EVIDENCE[0]] },
          { text: "الصفحة الرئيسية موثقة بلقطة أرشيفية كاملة.", citations: [EVIDENCE[1]] },
        ],
      },
    ],
    evidence: EVIDENCE,
  });

describe("P5-010 — نموذج التقرير والإحالات", () => {
  it("T-REP-001: جملة واقعية بلا إحالة تُرفض — لا تقرير بلا إحالات (فشل-مغلق)", () => {
    expect(() =>
      buildReport({
        title: "تقرير",
        caseRef: "case-001",
        lang: "ar",
        sections: [{ title: "قسم", statements: [{ text: "عبارة بلا مصدر", citations: [] }] }],
        evidence: EVIDENCE,
      }),
    ).toThrow(/إحالة|citation/i);
  });

  it("T-REP-002: تقرير صحيح يُقبل ويصمد التحقق", () => {
    const doc = validDoc();
    expect(validateReport(doc).ok).toBe(true);
  });

  it("T-REP-003: إحالة إلى دليل غير مذكور في الملحق تُرفض — لا إحالات معلقة", () => {
    expect(() =>
      buildReport({
        title: "تقرير",
        caseRef: "case-001",
        lang: "ar",
        sections: [
          {
            title: "قسم",
            statements: [{ text: "عبارة", citations: [{ id: "EV-X", label: "غير موجود" }] }],
          },
        ],
        evidence: EVIDENCE,
      }),
    ).toThrow(/ملحق|appendix|evidence/i);
  });
});

describe("P5-010 — قالب HTML", () => {
  it("T-REP-004: كل عبارة تحمل علامة إحالة قابلة للنقر إلى ملحق الأدلة", () => {
    const html = renderReportHtml(validDoc());
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("تقرير فحص النطاق example.test");
    expect(html).toMatch(/<a[^>]+href="#EV-1"[^>]*>\[?1\]?<\/a>|href="#EV-1"/);
    expect(html).toMatch(/href="#EV-2"/);
  });

  it("T-REP-005: ملحق الأدلة يسرد كل دليل مع بصمته — لا دليل مقتبس بلا بصمة", () => {
    const html = renderReportHtml(validDoc());
    expect(html).toContain("سجل DNS للنطاق");
    expect(html).toContain("a".repeat(64));
    expect(html).toContain("b".repeat(64));
  });

  it("T-REP-006: الحتمية — نفس التقرير يعطي نفس HTML بلا طوابع زمنية", () => {
    const a = renderReportHtml(validDoc());
    const b = renderReportHtml(validDoc());
    expect(a).toBe(b);
  });
});

describe("P5-010 — قالب DOCX", () => {
  it("T-REP-007: يولّد ملف DOCX صالحاً (حزمة OOXML) فيه العبارات والإحالات", async () => {
    const buffer = await renderReportDocx(validDoc());
    expect(buffer.length).toBeGreaterThan(1000);
    // DOCX حزمة ZIP — توقيع PK ووثيقة رئيسية
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("T-REP-008: حتمية DOCX — طوابع الإنشاء مثبتة لا عشوائية", async () => {
    const a = await renderReportDocx(validDoc());
    const b = await renderReportDocx(validDoc());
    expect(a.equals(b)).toBe(true);
  });
});

describe("P5-010 — PDF", () => {
  it("T-REP-009: PDF يُرفض صريحاً حتى قرار المحرك (P5-027) — لا صمت ولا غش", async () => {
    await expect(renderReportPdf(validDoc())).rejects.toThrow(/P5-027|PDF/i);
  });
});
