/**
 * P5-010 — `@ir/reports`: قوالب HTML/PDF/DOCX بإحالات (UC-14).
 *
 * القاعدة الحديدية للتقارير: كل جملة واقعية تحمل إحالة إلى دليل في الملحق —
 * لا يُقبل تقرير فيه عبارة بلا إحالة، ولا إحالة إلى دليل غير موجود (فشل-مغلق
 * عند البناء والتحقق لا عند التوليد). القوالب:
 *
 * - HTML: قالب حتمي كامل (RTL للعربية) بعلامات إحالة قابلة للنقر [n] تحيل إلى
 *   ملحق الأدلة بالبصمات — نفس التقرير يعطي نفس الملف بلا طوابع زمنية.
 * - DOCX: حزمة OOXML عبر `docx` مع ما بعد معالجة تثبّت الطوابع (الحزمة تغرس
 *   `new Date()` في خصائص النواة وبيانات أرشيف ZIP — تُستبدل بطوابع ثابتة
 *   ليكون الملف حتمياً بيتاً-بيتاً).
 * - PDF: يُرفض صريحاً حتى قرار المحرك (P5-027 يقارن Typst/Playwright/React-PDF
 *   للعربية RTL والخطوط وروابط الإحالات) — لا غش ولا صمت.
 */
import { z } from "zod";
import { Buffer } from "node:buffer";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";

/* --------------------------------------------------------------- النموذج */

const EvidenceSchema = z.object({
  id: z.string().regex(/^EV-[A-Za-z0-9-]+$/, "معرّف الدليل: EV-n"),
  label: z.string().min(1),
  sha256: z.string().length(64).optional(),
});

const StatementSchema = z.object({
  text: z.string().min(1),
  citations: z.array(EvidenceSchema).min(1, "جملة واقعية بلا إحالة — لا يُقبل التقرير (UC-14)"),
});

const SectionSchema = z.object({
  title: z.string().min(1),
  statements: z.array(StatementSchema).min(1),
});

const ReportSchema = z
  .object({
    title: z.string().min(1),
    caseRef: z.string().min(1),
    lang: z.enum(["ar", "en"]),
    sections: z.array(SectionSchema).min(1),
    evidence: z.array(EvidenceSchema).min(1),
  })
  .superRefine((doc, ctx) => {
    const ids = new Set(doc.evidence.map((e) => e.id));
    for (const section of doc.sections) {
      for (const statement of section.statements) {
        for (const citation of statement.citations) {
          if (!ids.has(citation.id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["evidence"],
              message: `إحالة معلقة إلى دليل غير موجود في ملحق الأدلة: ${citation.id}`,
            });
          }
        }
      }
    }
  });

export interface EvidenceRef {
  readonly id: string;
  readonly label: string;
  readonly sha256?: string;
}
export interface ReportStatement {
  readonly text: string;
  readonly citations: readonly EvidenceRef[];
}
export interface ReportSection {
  readonly title: string;
  readonly statements: readonly ReportStatement[];
}
export interface ReportDocument {
  readonly title: string;
  readonly caseRef: string;
  readonly lang: "ar" | "en";
  readonly sections: readonly ReportSection[];
  readonly evidence: readonly EvidenceRef[];
}

export type ReportValidation = { ok: true } | { ok: false; error: string };

/** بناء تقرير — يرفض فاشلاً-مغلقاً أي جملة بلا إحالة أو إحالة معلقة. */
export function buildReport(input: unknown): ReportDocument {
  return ReportSchema.parse(input) as ReportDocument;
}

/** تحقق مستقل من تقرير موجود (لا استثناء — نتيجة صريحة). */
export function validateReport(doc: ReportDocument): ReportValidation {
  const result = ReportSchema.safeParse(doc);
  return result.success ? { ok: true } : { ok: false, error: result.error.issues[0]?.message ?? "تقرير غير صالح" };
}

/* --------------------------------------------------------------- HTML */

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const evidenceNumber = (doc: ReportDocument, id: string): number => doc.evidence.findIndex((e) => e.id === id) + 1;

const renderStatement = (doc: ReportDocument, statement: ReportStatement): string => {
  const markers = statement.citations.map((c) => `<a href="#${escapeHtml(c.id)}">[${evidenceNumber(doc, c.id)}]</a>`).join("");
  return `      <p>${escapeHtml(statement.text)}<sup class="cite">${markers}</sup></p>`;
};

/** قالب HTML حتمي — بلا طوابع زمنية؛ نفس التقرير يعطي نفس الملف. */
export function renderReportHtml(doc: ReportDocument): string {
  const dir = doc.lang === "ar" ? "rtl" : "ltr";
  const sections = doc.sections
    .map(
      (section) => `    <section>
      <h2>${escapeHtml(section.title)}</h2>
${section.statements.map((s) => renderStatement(doc, s)).join("\n")}
    </section>`,
    )
    .join("\n");
  const appendix = doc.evidence
    .map(
      (e) =>
        `      <li id="${escapeHtml(e.id)}">${escapeHtml(e.label)}${e.sha256 !== undefined ? ` — <code>${escapeHtml(e.sha256)}</code>` : ""}</li>`,
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang="${escapeHtml(doc.lang)}" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.title)}</title>
<style>
body { font-family: "Noto Naskh Arabic", "Segoe UI", sans-serif; max-width: 48rem; margin: auto; padding: 1rem; }
h2 { border-bottom: 1px solid #ccc; }
sup.cite a { text-decoration: none; }
.evidence { list-style: none; padding-inline-start: 0; }
.evidence li { margin-block: 0.25rem; }
</style>
</head>
<body>
  <h1>${escapeHtml(doc.title)}</h1>
  <p class="case">${doc.lang === "ar" ? "القضية" : "Case"}: ${escapeHtml(doc.caseRef)}</p>
${sections}
    <h2>${doc.lang === "ar" ? "ملحق الأدلة" : "Evidence appendix"}</h2>
    <ol class="evidence">
${appendix}
    </ol>
</body>
</html>
`;
}

/* --------------------------------------------------------------- DOCX */

/** طوابت ثابتة — الحزمة الأصلية تغرس new Date() في النواة وفي أرشيف ZIP. */
const FIXED_EPOCH = "2026-01-01T00:00:00Z";
const FIXED_DATE = new Date(FIXED_EPOCH);

/** تثبيت حزمة OOXML: طوابع النواة وتواريخ أرشيف ZIP تُستبدل بقيم ثابتة. */
async function pinDocxTimestamps(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const coreFile = zip.file("docProps/core.xml");
  if (coreFile !== null) {
    const core = await coreFile.async("string");
    const pinned = core
      .replace(/(<dcterms:created[^>]*>)[^<]*(<\/dcterms:created>)/, `$1${FIXED_EPOCH}$2`)
      .replace(/(<dcterms:modified[^>]*>)[^<]*(<\/dcterms:modified>)/, `$1${FIXED_EPOCH}$2`);
    zip.file("docProps/core.xml", pinned, { date: FIXED_DATE });
  }
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || name === "docProps/core.xml") continue;
    const content = await entry.async("nodebuffer");
    zip.file(name, content, { date: FIXED_DATE });
  }
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return out;
}

/** قالب DOCX — عربي RTL مع إحالات [n] وملحق أدلة بالبصمات، حتمي بيتاً-بيتاً. */
export async function renderReportDocx(doc: ReportDocument): Promise<Buffer> {
  const rtl = doc.lang === "ar";
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      bidirectional: rtl,
      children: [new TextRun({ text: doc.title, rightToLeft: rtl, bold: true })],
    }),
    new Paragraph({
      bidirectional: rtl,
      children: [new TextRun({ text: `${rtl ? "القضية" : "Case"}: ${doc.caseRef}`, rightToLeft: rtl })],
    }),
  ];
  for (const section of doc.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        bidirectional: rtl,
        children: [new TextRun({ text: section.title, rightToLeft: rtl })],
      }),
    );
    for (const statement of section.statements) {
      const runs = [new TextRun({ text: `${statement.text} `, rightToLeft: rtl })];
      for (const [index, citation] of statement.citations.entries()) {
        if (index > 0) runs.push(new TextRun({ text: " ", rightToLeft: rtl }));
        runs.push(
          new TextRun({
            text: `[${evidenceNumber(doc, citation.id)}]`,
            rightToLeft: rtl,
            superScript: true,
            color: "0563C1",
          }),
        );
      }
      children.push(new Paragraph({ bidirectional: rtl, children: runs }));
    }
  }
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      bidirectional: rtl,
      children: [new TextRun({ text: rtl ? "ملحق الأدلة" : "Evidence appendix", rightToLeft: rtl })],
    }),
  );
  for (const e of doc.evidence) {
    children.push(
      new Paragraph({
        bidirectional: rtl,
        children: [
          new TextRun({ text: `[${evidenceNumber(doc, e.id)}] ${e.label}`, rightToLeft: rtl }),
          ...(e.sha256 !== undefined ? [new TextRun({ text: ` — ${e.sha256}`, rightToLeft: rtl, size: 16 })] : []),
        ],
      }),
    );
  }
  const document = new Document({
    title: doc.title,
    creator: "@ir/reports",
    description: `${rtl ? "قضية" : "Case"}: ${doc.caseRef}`,
    sections: [{ properties: {}, children }],
  });
  const raw = await Packer.toBuffer(document);
  return pinDocxTimestamps(Buffer.from(raw));
}

/* --------------------------------------------------------------- PDF */

/** PDF مؤجل صراحة — P5-027 يقارن المحركات للعربية RTL ويقرر؛ لا غش ولا صمت. */
export async function renderReportPdf(_doc: ReportDocument): Promise<Buffer> {
  void _doc;
  throw new Error(
    "PDF غير متاح بعد: P5-027 يقارن Typst/Playwright/React-PDF للعربية RTL والخطوط وروابط الإحالات ويقرر المحرك — لا توليد PDF قبل القرار (فشل-مغلق، موثق في DECLARED_LIMITS)",
  );
}
