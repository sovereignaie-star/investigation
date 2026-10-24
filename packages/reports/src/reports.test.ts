import { describe, expect, it } from "vitest";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
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

describe("P5-027 — محرك PDF المختار: Chromium عبر Playwright على قالب HTML نفسه (ADR-35)", () => {
  /**
   * الأحمر أولاً: كُتب هذا القسم قبل التنفيذ وشُغّل — كان renderReportPdf يرفض
   * صريحاً (T-REP-009 القديم) ففشلت هذه الاختبارات للسبب الصحيح (قرار المحرك
   * لم يكن نُفّذ). الدليل: docs/evidence/2026-10-24-P5-027-pdf-comparison.md.
   */
  it("T-REP-009: يولّد PDF من التقرير العربي المرجعي — ترويسة %PDF صحيحة", async () => {
    const pdf = await renderReportPdf(validDoc());
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // P6-023: Chromium cold start + Arabic shaping + print can exceed 30s on a loaded
    // CI runner (run 40082187391 / 40082949474 both timed out at 30s and passed on rerun);
    // 90s keeps the assertion strict while accommodating the runner variance.
  }, 90000);

  it("T-REP-010: الإحالات قابلة للنقر — روابط داخلية إلى EV-1 وEV-2 في توضيحات PDF", async () => {
    const pdf = await renderReportPdf(validDoc());
    const annotations = await linkAnnotations(pdf);
    const dests = annotations.map((a) => String(a.dest ?? ""));
    expect(dests.some((d) => d.includes("EV-1"))).toBe(true);
    expect(dests.some((d) => d.includes("EV-2"))).toBe(true);
  }, 30000);

  it("T-REP-011: حتمية PDF — طوابع الإنشاء مثبتة لا عشوائية (مرآة T-REP-008 للـ DOCX)", async () => {
    const a = await renderReportPdf(validDoc());
    const b = await renderReportPdf(validDoc());
    expect(a.equals(b)).toBe(true);
  }, 30000);

  it("T-REP-012: النص العربي قابل للاستخراج من PDF (طبقة ToUnicode سليمة)", async () => {
    const pdf = await renderReportPdf(validDoc());
    const text = (await extractedText(pdf)).normalize("NFKC");
    // Chromium يكتب العربي بأشكال العرض (U+FExx) — NFKC يعيدها إلى الحروف
    // الأساسية؛ العبرة أن طبقة ToUnicode تحمل العربية فعلًا لا مربعات فارغة
    const arabicCodepoints = [...text].filter((c) => /[؀-ۿ]/.test(c)).length;
    expect(arabicCodepoints).toBeGreaterThan(20);
    // البصمات اللاتينية موجودة نصاً
    expect(text).toContain("example.test");
    expect(text).toContain("case-001");
  }, 30000);
});

/** توضيحات الروابط من صفحة PDF الأولى (pdfjs-dist — نفس مكتبة TR-034). */
async function linkAnnotations(pdf: Buffer): Promise<Array<{ dest?: unknown }>> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise;
  const page = await doc.getPage(1);
  const annotations = await page.getAnnotations();
  return annotations.filter((a: { subtype?: string }) => a.subtype === "Link");
}

/** النص المستخرج من صفحة PDF الأولى. */
async function extractedText(pdf: Buffer): Promise<string> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  return content.items.map((i: { str?: string }) => i.str ?? "").join("");
}
