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
import { existsSync } from "node:fs";
import { Document, Header, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { ReportIdentity } from "./export.ts";
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
export function renderReportHtml(doc: ReportDocument, identity?: ReportIdentity): string {
  const dir = doc.lang === "ar" ? "rtl" : "ltr";
  // هوية التقرير (P5-022): علامة مائية في طبقة ثابتة تظهر في كل صفحة عند الطباعة،
  // وتصنيف سرية معلن، ولون هوية، وشعار — بلا هوية يبقى القالب كما هو (توافق خلفي).
  const identityStyles =
    identity === undefined
      ? ""
      : `\n.watermark-layer { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 999; }\n.watermark-layer span { transform: rotate(-20deg); font-size: 3rem; color: rgba(0,0,0,0.08); font-weight: bold; }\n@media print { .watermark-layer { position: fixed; } .classification-banner { position: fixed; top: 0; left: 0; right: 0; } }`;
  const identityBody =
    identity === undefined
      ? ""
      : `\n  <div class="classification-banner" style="${identity.classification !== undefined ? `background:${escapeHtml(identity.primaryColor ?? "#1a5276")};color:#fff;padding:0.25rem 1rem;font-weight:bold` : ""}">${identity.classification !== undefined ? escapeHtml(identity.classification) : ""}${identity.logoDataUrl !== undefined ? ` <img src="${escapeHtml(identity.logoDataUrl)}" alt="logo" style="height:1.5rem;vertical-align:middle">` : ""}</div>\n  <div class="watermark-layer" aria-hidden="true"><span>${escapeHtml(identity.watermark ?? "")}</span></div>`;

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
${identityStyles}
</style>
</head>
<body>${identityBody}
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
    if (name === "docProps/core.xml") continue;
    if (entry.dir) {
      // مجلدات OOXML (word/، docProps/...) تحمل «الآن» أيضاً — تُثبت مثل الملفات
      zip.file(name, null, { date: FIXED_DATE, dir: true });
      continue;
    }
    const content = await entry.async("nodebuffer");
    zip.file(name, content, { date: FIXED_DATE });
  }
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return out;
}

/** قالب DOCX — عربي RTL مع إحالات [n] وملحق أدلة بالبصمات، حتمي بيتاً-بيتاً. */
export async function renderReportDocx(doc: ReportDocument, identity?: ReportIdentity): Promise<Buffer> {
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
  // هوية التقرير (P5-022): التصنيف معلن في مقدمة الجسم
  if (identity?.classification !== undefined) {
    children.unshift(
      new Paragraph({
        bidirectional: rtl,
        children: [new TextRun({ text: identity.classification, rightToLeft: rtl, bold: true })],
      }),
    );
  }
  const document = new Document({
    title: doc.title,
    creator: "@ir/reports",
    description: `${rtl ? "قضية" : "Case"}: ${doc.caseRef}`,
    sections: [
      {
        properties: {},
        ...(identity?.watermark !== undefined
          ? {
              headers: {
                default: new Header({
                  children: [
                    new Paragraph({
                      bidirectional: rtl,
                      children: [new TextRun({ text: identity.watermark, rightToLeft: rtl, color: "BBBBBB" })],
                    }),
                  ],
                }),
              },
            }
          : {}),
        children,
      },
    ],
  });
  const raw = await Packer.toBuffer(document);
  return pinDocxTimestamps(Buffer.from(raw));
}

/* --------------------------------------------------------------- PDF */

/**
 * P5-027 (ADR-35): Chromium عبر Playwright على قالب HTML نفسه — محرك PDF
 * المختار للمقارنة الثلاثية (Typst/Playwright/React-PDF). نفس القالب يعني نفس
 * التقرير في HTML وPDF (مصدر حقيقة واحد)، والإحالات `<a href="#EV-n">`
 * تبقى توضيحات روابط داخلية قابلة للنقر في PDF. فشل-مغلق: لا Chromium
 * (حزمة أو نظام) = خطأ صريح لا PDF صامت.
 */
export async function renderReportPdf(doc: ReportDocument): Promise<Buffer> {
  const html = renderReportHtml(doc);
  let browser = await launchChromium();
  let page = await newPage(browser);
  if (!page) {
    // مات المتصفح المشترك بين النداءات — يُصفَّر ويُطلق واحد جديد (لا PDF صامت)
    browserPromise = null;
    browser = await launchChromium();
    page = await newPage(browser);
    if (!page) throw new Error("لا يمكن فتح صفحة Chromium لتوليد PDF — فشل-مغلق");
  }
  try {
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A4" });
    return normalizePdfDates(Buffer.from(pdf));
  } finally {
    await page.close();
  }
  // المتصفح مشترك (launchChromium) فلا يُغلق هنا — إغلاقه يُبطل المشاركة؛
  // فشل newPage بعد موته يُصفّر browserPromise ويُعاد الإطلاق تلقائياً في النداء التالي.
}

/** فتح صفحة جديدة — undefined إذا مات المتصفح المشترك (يُعاد الإطلاق فوق). */
async function newPage(browser: Awaited<ReturnType<typeof launchChromium>>): Promise<{
  setContent: (html: string, opts?: { waitUntil?: string }) => Promise<void>;
  pdf: (opts?: { format?: string }) => Promise<Uint8Array>;
  close: () => Promise<void>;
}> {
  try {
    return await browser.newPage();
  } catch (pageOpenFailed) {
    lastLaunchError = pageOpenFailed; // يُضمَّن في رسالة الفشل النهائية (لا التقاط صامت — D-017)
    return undefined;
  }
}

/** تاريخ PDF مثبت — الحتمية (مرآة pinDocxTimestamps): نفس التقرير = نفس البايتات. */
const FIXED_PDF_DATE = "D:20000101000000+00'00'";

/**
 * تثبيت طوابع إنشاء/تعديل PDF (Chromium يكتب «الآن» — قيس 2026-10-24).
 * استبدال متساوي الطول حرفاً-بحرف يبقي إزاحات xref سليمة بلا إعادة كتابة.
 * طابع Chromium ثابت البنية (23 محرفاً)؛ أي تطابق آخر بنيوياً يُترك كما هو
 * (كشفه اختبار الحتمية T-REP-011 — لا صمت).
 */
function normalizePdfDates(pdf: Buffer): Buffer {
  const latin1 = pdf.toString("latin1");
  const normalized = latin1.replace(/\/(CreationDate|ModDate) \(D:[^)]*\)/g, (match, label: string) => {
    const pinned = `/${label} (${FIXED_PDF_DATE})`;
    return pinned.length === match.length ? pinned : match;
  });
  return Buffer.from(normalized, "latin1");
}

/** متصفح Chromium مشترك بين الاستدعاءات — الإطلاق مكلف فيُعاد استخدامه. */
let browserPromise: Promise<import("playwright").Browser> | null = null;

/** مسارات أسماء Chrome/Chromium المعتادة على الأنظمة (سابقة G-11). */
const CHROME_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"] as const;

/** يطلق Chromium: المتصفح المضمّن مع Playwright، ثم Chrome النظامي (CHROME_PATH أو PATH). */
async function launchChromium(): Promise<{
  newPage: () => Promise<{
    setContent: (html: string, opts?: { waitUntil?: string }) => Promise<void>;
    pdf: (opts?: { format?: string }) => Promise<Uint8Array>;
    close: () => Promise<void>;
  }>;
  close: () => Promise<void>;
}> {
  const { chromium } = await import("playwright");
  if (browserPromise) {
    // متصفح واحد مشترك — إطلاق Chromium هو المكلف؛ إعادة الاستخدام تُبقي
    // الاستدعاءات التالية سريعة (وإلا انفجر مهلة الاختبار/الإنتاج).
    try {
      return await browserPromise;
    } catch (browserDead) {
      browserPromise = null; // مات المتصفح — إعادة إطلاق في المحاولة التالية
      lastLaunchError = browserDead;
    }
  }
  try {
    const browser = await chromium.launch();
    browserPromise = Promise.resolve(browser);
    return browser;
  } catch (bundledUnavailable) {
    // لا متصفح مضمن في هذا التثبيت — Chrome النظامي (سابقة G-11 في gates)؛
    // سبب غياب المضمن يُضمَّن إلى رسالة الفشل النهائية (لا التقاط صامت — D-017)
    const fromEnv = process.env["CHROME_PATH"];
    const candidates = [fromEnv, ...CHROME_NAMES.map((n) => which(n))].filter((p): p is string => p !== undefined);
    for (const executablePath of candidates) {
      try {
        const browser = await chromium.launch({ executablePath });
        browserPromise = Promise.resolve(browser);
        return browser;
      } catch (systemUnavailable) {
        lastLaunchError = systemUnavailable;
      }
    }
    throw new Error(
      `لا Chromium متاح لتوليد PDF (ADR-35): المضمن — ${String(bundledUnavailable)}؛ النظامي — ${String(lastLaunchError)}؛ ثبّت متصفح Playwright (pnpm exec playwright install chromium) أو Chrome نظامي (CHROME_PATH) — فشل-مغلق، لا PDF صامت`,
    );
  }
}

/** آخر خطأ إطلاق نظامي — يضمَّن في رسالة الفشل (لا التقاط صامت — D-017). */
let lastLaunchError: unknown = undefined;

/** `which` متزامن بلا تبعية خارجية. */
function which(name: string): string | undefined {
  const pathDirs = (process.env["PATH"] ?? "").split(":");
  for (const dir of pathDirs) {
    if (dir.length === 0) continue;
    const p = `${dir.replace(/\/$/, "")}/${name}`;
    if (existsSync(p)) return p;
  }
  return undefined;
}

/* ---------------------------------------------------- P5-011: مدقق الإحالات */

export type CitationIssue =
  | { readonly kind: "uncited_statement"; readonly detail: string }
  | { readonly kind: "dangling_citation"; readonly detail: string }
  | { readonly kind: "orphan_evidence"; readonly detail: string };

export interface CitationAudit {
  readonly ok: boolean;
  readonly statementCount: number;
  readonly citedCount: number;
  readonly issues: readonly CitationIssue[];
}

/**
 * مدقق مستقل للنموذج — تأكيد خارج مسار البناء: عبارة بلا إحالة، إحالة معلقة،
 * أو دليل يتيم كلها تُكشف هنا حتى لو افترض البناء أنه سليم.
 */
export function auditReportDocument(doc: ReportDocument): CitationAudit {
  const ids = new Set(doc.evidence.map((e) => e.id));
  const issues: CitationIssue[] = [];
  let statementCount = 0;
  let citedCount = 0;
  for (const section of doc.sections) {
    for (const statement of section.statements) {
      statementCount += 1;
      if (statement.citations.length === 0) {
        issues.push({ kind: "uncited_statement", detail: statement.text.slice(0, 60) });
        continue;
      }
      citedCount += 1;
      for (const citation of statement.citations) {
        if (!ids.has(citation.id)) issues.push({ kind: "dangling_citation", detail: citation.id });
      }
    }
  }
  const cited = new Set(doc.sections.flatMap((s) => s.statements.flatMap((st) => st.citations.map((c) => c.id))));
  for (const e of doc.evidence) {
    if (!cited.has(e.id)) issues.push({ kind: "orphan_evidence", detail: e.id });
  }
  return { ok: issues.length === 0, statementCount, citedCount, issues };
}

/**
 * مدقق المخرج النهائي — يفحص HTML المُصيَّر لا افتراضات النموذج: كل فقرة عبارة
 * يجب أن تحمل رابط إحالة إلى مرساة دليل موجودة، وكل دليل في الملحق مقتبس.
 * مستقل عن القالب: يفحص أي HTML فيه فقرات ومراسي أدلة.
 */
/** مراسي الأدلة في الملحق: <li id="EV-...">. */
function scanEvidenceAnchors(html: string): Set<string> {
  const anchors = new Set<string>();
  for (let i = html.indexOf('<li id="'); i !== -1; i = html.indexOf('<li id="', i + 1)) {
    const start = i + 8;
    const end = html.indexOf('"', start);
    if (end === -1) break;
    anchors.add(html.slice(start, end));
  }
  return anchors;
}

/** فقرات العبارات: <p ...>...</p> (تخطَّ <pre> ونحوها). */
function scanParagraphs(html: string): { attrs: string; body: string }[] {
  const paragraphs: { attrs: string; body: string }[] = [];
  for (let i = html.indexOf("<p"); i !== -1; i = html.indexOf("<p", i + 1)) {
    const gt = html.indexOf(">", i);
    if (gt === -1) break;
    if (html[i + 2] !== " " && html[i + 2] !== ">") continue;
    const close = html.indexOf("</p>", gt);
    if (close === -1) continue;
    paragraphs.push({ attrs: html.slice(i + 2, gt), body: html.slice(gt + 1, close) });
  }
  return paragraphs;
}

/** معرّفات الإحالات داخل فقرة: href="#EV-...". */
function scanCitations(body: string): string[] {
  const citations: string[] = [];
  for (let i = body.indexOf('href="#'); i !== -1; i = body.indexOf('href="#', i + 1)) {
    const start = i + 7;
    const end = body.indexOf('"', start);
    if (end === -1) break;
    citations.push(body.slice(start, end));
  }
  return citations;
}

export function auditReportHtml(html: string): CitationAudit {
  const issues: CitationIssue[] = [];
  const anchors = scanEvidenceAnchors(html);
  const citedIds: string[] = [];
  let statementCount = 0;
  let citedCount = 0;
  for (const { attrs, body } of scanParagraphs(html)) {
    if (attrs.includes('class="case"')) continue;
    statementCount += 1;
    const citations = scanCitations(body);
    if (citations.length === 0) {
      issues.push({ kind: "uncited_statement", detail: body.slice(0, 60) });
      continue;
    }
    citedCount += 1;
    citedIds.push(...citations);
    for (const id of citations) {
      if (!anchors.has(id)) issues.push({ kind: "dangling_citation", detail: id });
    }
  }
  const cited = new Set(citedIds);
  for (const id of anchors) {
    if (!cited.has(id)) issues.push({ kind: "orphan_evidence", detail: id });
  }
  return { ok: issues.length === 0 && statementCount > 0, statementCount, citedCount, issues };
}

export { renderReportMarkdown, renderGraphSvg, renderGraphPng } from "./export.ts";
export { buildDossierReport, buildTimelineReport, buildComparisonReport } from "./templates.ts";
export type { DossierInput, TimelineInput, TimelineEvent, ComparisonInput } from "./templates.ts";
export type { ReportIdentity, GraphData, GraphNode, GraphEdge } from "./export.ts";
