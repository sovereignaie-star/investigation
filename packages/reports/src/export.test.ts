import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  buildReport,
  renderReportHtml,
  renderReportDocx,
  renderReportMarkdown,
  renderGraphSvg,
  renderGraphPng,
  type ReportIdentity,
  type GraphData,
} from "./index.ts";

/**
 * P5-022 — تصدير Markdown وصورة الرسم (PNG/SVG) وتخصيص هوية التقرير.
 *
 * التقرير العربي يحافظ على الاتجاه والخطوط (RTL في كل الصيغ، خط عربي مضمّن
 * في التنقيط)، والعلامة المائية تظهر في كل صفحة (طبقة ثابتة في الطباعة في
 * HTML، ورأس في كل صفحة في DOCX)، والتصنيف معلن في كل صيغة، والتضمين
 * الحتمي: نفس المدخل نفس البايتات.
 */

const DOC = buildReport({
  title: "تقرير تحقيق النطاق example.test",
  caseRef: "01JTESTCASE0000000000000000",
  lang: "ar",
  sections: [
    {
      title: "النتائج",
      statements: [
        {
          text: "النطاق example.test يسجّل سجل A عند العنوان 93.184.216.34 منذ يناير 2020.",
          citations: [{ id: "EV-1", label: "سجل DNS" }],
        },
      ],
    },
  ],
  evidence: [{ id: "EV-1", label: "سجل DNS من المحاكاة", sha256: "a".repeat(64) }],
});

const IDENTITY: ReportIdentity = {
  watermark: "سري — نسخة المحقق",
  classification: "سري",
  primaryColor: "#1a5276",
  logoDataUrl: "data:image/png;base64,iVBORw0KGgo=",
};

const GRAPH: GraphData = {
  nodes: [
    { id: "n1", label: "النطاق example.test", kind: "domain" },
    { id: "n2", label: "العنوان 93.184.216.34", kind: "ip" },
    { id: "n3", label: "شهادة TLS", kind: "certificate" },
  ],
  edges: [
    { from: "n1", to: "n2", label: "يسجّل" },
    { from: "n1", to: "n3", label: "تغطي" },
  ],
};

describe("P5-022 — تصدير Markdown", () => {
  it("T-EXP-001: تصدير Markdown حتمي — الاتجاه العربي محفوظ والإحالات مرقمة", () => {
    const md = renderReportMarkdown(DOC);
    expect(md).toContain("# تقرير تحقيق النطاق example.test");
    expect(md).toContain("[1]");
    expect(md).toContain("سجل DNS من المحاكاة");
    expect(md).toContain("a".repeat(64));
    // حتمي: نفس التقرير نفس الملف
    expect(renderReportMarkdown(DOC)).toBe(md);
  });

  it("T-EXP-002: تصنيف السرية يظهر في Markdown عند تخصيص الهوية", () => {
    const md = renderReportMarkdown(DOC, IDENTITY);
    expect(md).toContain("سري");
    expect(md).toContain("التصنيف");
  });
});

describe("P5-022 — هوية التقرير في HTML", () => {
  it("T-EXP-003: العلامة المائية في طبقة ثابتة تظهر في كل صفحة عند الطباعة + التصنيف معلن", () => {
    const html = renderReportHtml(DOC, IDENTITY);
    expect(html).toContain("سري — نسخة المحقق");
    expect(html).toContain("position: fixed");
    expect(html).toContain("@media print");
    expect(html).toContain("سري");
    expect(html).toContain("#1a5276");
  });

  it("T-EXP-004: بلا هوية — لا علامة مائية ولا تصنيف (توافق خلفي)", () => {
    const html = renderReportHtml(DOC);
    expect(html).not.toContain("سري — نسخة المحقق");
    expect(html).not.toContain("position: fixed");
  });
});

describe("P5-022 — هوية التقرير في DOCX", () => {
  it("T-EXP-005: العلامة المائية في رأس كل صفحة + التصنيف في المستند", async () => {
    const buffer = await renderReportDocx(DOC, IDENTITY);
    // DOCX = ZIP: فك الضغط والفحص — الرأس (header) يظهر في كل صفحة
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files);
    const headerNames = names.filter((n) => /header\d+\.xml$/.test(n));
    expect(headerNames.length).toBeGreaterThan(0);
    const headerXml = await zip.file(headerNames[0]).async("string");
    expect(headerXml).toContain("سري — نسخة المحقق");
    // التصنيف في جسم المستند
    const documentXml = await zip.file("word/document.xml").async("string");
    expect(documentXml).toContain("سري");
  });
});

describe("P5-022 — صورة الرسم SVG وPNG", () => {
  it("T-EXP-006: SVG حتمي — الاتجاه والخطوط العربية محفوظة والتسميات ظاهرة", () => {
    const svg = renderGraphSvg(GRAPH, IDENTITY);
    expect(svg).toContain("<svg");
    expect(svg).toContain('dir="rtl"');
    expect(svg).toContain("النطاق example.test");
    expect(svg).toContain("يسجّل");
    expect(svg).toContain("سري"); // تصنيف الهوية في الصورة
    expect(renderGraphSvg(GRAPH, IDENTITY)).toBe(svg);
  });

  it("T-EXP-007: PNG صالح حتمي — بخط عربي مضمّن (لا خطوط النظام)", async () => {
    const png = await renderGraphPng(GRAPH, IDENTITY);
    expect(png.length).toBeGreaterThan(1000);
    // توقيع PNG
    expect(png[0]).toBe(0x89);
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    // حتمي: نفس الرسم نفس البايتات
    const again = await renderGraphPng(GRAPH, IDENTITY);
    expect(createHash("sha256").update(again).digest("hex")).toBe(createHash("sha256").update(png).digest("hex"));
  });

  it("T-EXP-008: الرسم فارغ — صورة صغيرة صريحة لا خطأ", async () => {
    const svg = renderGraphSvg({ nodes: [], edges: [] });
    expect(svg).toContain("<svg");
    const png = await renderGraphPng({ nodes: [], edges: [] });
    expect(png[0]).toBe(0x89);
  });
});
