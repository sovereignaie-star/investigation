import { describe, expect, it } from "vitest";
import { auditReportHtml, auditReportDocument, buildReport, renderReportHtml, type ReportDocument } from "./index.ts";

/**
 * P5-011 — مدقق الإحالات في التقارير: كل جملة واقعية بإحالة.
 *
 * المدقق حارس مستقل عن القالب: يفحص المخرج النهائي (HTML المُصيَّر) لا افتراضات
 * النموذج — عبارة بلا إحالة، أو إحالة إلى مرساة غير موجودة، أو دليل يتيم في
 * الملحق لا يقتبسه أحد — كلها تُكشف وتُصنّف، لا أن يمر التقرير صامتاً.
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

describe("P5-011 — مدقق الإحالات (المخرج النهائي)", () => {
  it("T-CIT-001: تقرير سليم المُصيَّر — كل جملة بإحالة، والمدقق يوافق", () => {
    const audit = auditReportHtml(renderReportHtml(validDoc()));
    expect(audit.ok).toBe(true);
    expect(audit.statementCount).toBe(2);
    expect(audit.citedCount).toBe(2);
    expect(audit.issues).toHaveLength(0);
  });

  it("T-CIT-002: عبارة بلا إحالة في المخرج تُكشف — لا يمر التقرير صامتاً", () => {
    const html = renderReportHtml(validDoc()).replace(/<sup class="cite">.*?<\/sup>/, "");
    const audit = auditReportHtml(html);
    expect(audit.ok).toBe(false);
    expect(audit.citedCount).toBe(1);
    expect(audit.issues.some((i) => i.kind === "uncited_statement")).toBe(true);
  });

  it("T-CIT-003: إحالة إلى مرساة غير موجودة في الملحق تُكشف — لا روابط مكسورة", () => {
    const html = renderReportHtml(validDoc()).replace(/href="#EV-2"/g, 'href="#EV-9"');
    const audit = auditReportHtml(html);
    expect(audit.ok).toBe(false);
    expect(audit.issues.some((i) => i.kind === "dangling_citation")).toBe(true);
  });

  it("T-CIT-004: دليل يتيم في الملحق (لا يقتبسه أحد) يُكشف — لا أدلة ديكورية", () => {
    const html = renderReportHtml(validDoc()).replace(/href="#EV-2"/g, 'href="#EV-1"');
    const audit = auditReportHtml(html);
    expect(audit.ok).toBe(false);
    expect(audit.issues.some((i) => i.kind === "orphan_evidence")).toBe(true);
  });

  it("T-CIT-005: المدقق مستقل — يفحص أي HTML لا مخرجات قالبنا فقط", () => {
    const foreign = `<!DOCTYPE html><html><body>
<section><h2>قسم</h2><p>عبارة بلا إحالة إطلاقاً</p></section>
</body></html>`;
    const audit = auditReportHtml(foreign);
    expect(audit.ok).toBe(false);
    expect(audit.issues.some((i) => i.kind === "uncited_statement")).toBe(true);
  });
});

describe("P5-011 — مدقق النموذج", () => {
  it("T-CIT-006: مستند نموذجي فيه عبارة بلا إحالة يرسب المدقق (تأكيد مستقل عن البناء)", () => {
    const doc = validDoc() as ReportDocument & {
      sections: { statements: { text: string; citations: unknown[] }[] }[];
    };
    doc.sections[0].statements[1].citations = [];
    const audit = auditReportDocument(doc);
    expect(audit.ok).toBe(false);
    expect(audit.issues.some((i) => i.kind === "uncited_statement")).toBe(true);
  });
});
