/**
 * P5-022 — تصدير Markdown وصورة الرسم (PNG/SVG) وتخصيص هوية التقرير.
 *
 * التقرير العربي يحافظ على الاتجاه والخطوط: RTL في كل الصيغ، والخط العربي
 * مضمّن في التنقيط (Noto Naskh Arabic — OFL — لا خطوط النظام، فالناتج حتمي
 * عبر البيئات). والعلامة المائية تظهر في كل صفحة (طبقة ثابتة في الطباعة في
 * HTML، ورأس في كل صفحة في DOCX، وشريط في الصورة)، والتصنيف معلن في كل
 * صيغة. والتضمين حتمي: نفس المدخل نفس البايتات (PNG بتنقيط الخط المضمّن
 * فقط — بلا خطوط نظام).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { ReportDocument } from "./index.ts";

/** هوية التقرير — شعار وألوان وعلامة مائية وتصنيف سرية. */
export interface ReportIdentity {
  /** نص العلامة المائية — يظهر في كل صفحة. */
  readonly watermark?: string;
  /** تصنيف السرية — يعلن في كل صيغة تصدير. */
  readonly classification?: string;
  /** لون الهوية الأساسي (CSS hex). */
  readonly primaryColor?: string;
  /** شعار — data URL (صورة مضمنة). */
  readonly logoDataUrl?: string;
}

/* --------------------------------------------------------------- Markdown */

const mdEscape = (s: string): string => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");

const evidenceNumberOf = (doc: ReportDocument, id: string): number => doc.evidence.findIndex((e) => e.id === id) + 1;

/** تصدير Markdown حتمي — RTL بالمحتوى، وإحالات [n] وملحق أدلة بالبصمات. */
export function renderReportMarkdown(doc: ReportDocument, identity?: ReportIdentity): string {
  const lines: string[] = [];
  if (identity?.classification !== undefined) {
    lines.push(`> **${mdEscape(doc.lang === "ar" ? "التصنيف" : "Classification")}: ${mdEscape(identity.classification)}**`, "");
  }
  lines.push(`# ${mdEscape(doc.title)}`, "");
  lines.push(`${doc.lang === "ar" ? "القضية" : "Case"}: ${mdEscape(doc.caseRef)}`, "");
  for (const section of doc.sections) {
    lines.push(`## ${mdEscape(section.title)}`, "");
    for (const statement of section.statements) {
      const citations = statement.citations.map((c) => `[${evidenceNumberOf(doc, c.id)}]`).join("");
      lines.push(`${mdEscape(statement.text)}${citations}`, "");
    }
  }
  lines.push(`## ${doc.lang === "ar" ? "ملحق الأدلة" : "Evidence appendix"}`, "");
  for (const e of doc.evidence) {
    const sha = e.sha256 !== undefined ? ` — \`${e.sha256}\`` : "";
    lines.push(`${evidenceNumberOf(doc, e.id)}. ${mdEscape(e.label)}${sha}`);
  }
  return `${lines.join("\n")}\n`;
}

/* --------------------------------------------------------------- Graph SVG/PNG */

export interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind?: string;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

export interface GraphData {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

const svgEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const NODE_W = 180;
const NODE_H = 48;
const GAP_X = 60;
const GAP_Y = 40;

/** تخطيط حتمي: شبكة (أعمدة = جذر عدد العقد) بترتيب العقد كما وردت. */
function layout(nodes: readonly GraphNode[]): { x: number; y: number }[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  return nodes.map((_, i) => ({
    x: 40 + (i % cols) * (NODE_W + GAP_X),
    y: 40 + Math.floor(i / cols) * (NODE_H + GAP_Y),
  }));
}

/** صورة الرسم SVG — حتمية، اتجاه rtl، تسميات عربية، وتصنيف الهوية بشريط. */
export function renderGraphSvg(graph: GraphData, identity?: ReportIdentity): string {
  const positions = layout(graph.nodes);
  const width = Math.max(1, ...positions.map((p) => p.x + NODE_W)) + 40;
  const height = Math.max(1, ...positions.map((p) => p.y + NODE_H)) + 40;
  const index = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const color = identity?.primaryColor ?? "#1a5276";
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" dir="rtl">`);
  if (identity?.classification !== undefined) {
    parts.push(
      `<rect x="0" y="0" width="${width}" height="28" fill="${svgEscape(color)}"/>`,
      `<text x="${width / 2}" y="19" text-anchor="middle" font-family="Noto Naskh Arabic" font-size="14" fill="#ffffff">${svgEscape(identity.classification)}</text>`,
    );
  }
  if (identity?.watermark !== undefined) {
    parts.push(
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="Noto Naskh Arabic" font-size="${Math.max(18, Math.floor(width / 14))}" fill="rgba(0,0,0,0.08)" transform="rotate(-20 ${width / 2} ${height / 2})">${svgEscape(identity.watermark)}</text>`,
    );
  }
  for (const edge of graph.edges) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const a = positions[from];
    const b = positions[to];
    const x1 = a.x + NODE_W / 2;
    const y1 = a.y + NODE_H;
    const x2 = b.x + NODE_W / 2;
    const y2 = b.y;
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#888" stroke-width="1.5"/>`);
    if (edge.label !== undefined) {
      parts.push(
        `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2}" text-anchor="middle" font-family="Noto Naskh Arabic" font-size="11" fill="#555">${svgEscape(edge.label)}</text>`,
      );
    }
  }
  for (const [i, node] of graph.nodes.entries()) {
    const p = positions[i];
    parts.push(
      `<rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="8" fill="#ffffff" stroke="${svgEscape(color)}" stroke-width="2"/>`,
      `<text x="${p.x + NODE_W / 2}" y="${p.y + 29}" text-anchor="middle" font-family="Noto Naskh Arabic" font-size="13" direction="rtl">${svgEscape(node.label)}</text>`,
    );
  }
  parts.push("</svg>");
  return parts.join("\n");
}

/** الخط العربي المضمّن — تنقيط PNG حتمي لا يعتمد خطوط النظام. */
const ARABIC_FONT = join(dirname(new URL(import.meta.url).pathname), "..", "fonts", "NotoNaskhArabic-Regular.ttf");

/** صورة الرسم PNG — تنقيط حتمي بالخط العربي المضمّن (لا خطوط نظام). */
export async function renderGraphPng(graph: GraphData, identity?: ReportIdentity): Promise<Buffer> {
  const svg = renderGraphSvg(graph, identity);
  const fontFiles = existsSync(ARABIC_FONT) ? [ARABIC_FONT] : [];
  const widthMatch = svg.match(/width="(\d+)"/);
  const svgWidth = widthMatch !== null ? Number(widthMatch[1]) : 400;
  const resvg = new Resvg(svg, {
    font: { fontFiles, loadSystemFonts: false },
    fitTo: { mode: "width", value: Math.max(400, svgWidth) },
  });
  return Buffer.from(resvg.render().asPng());
}
