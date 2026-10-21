/**
 * P2-012 — TR-034: document metadata (PDF), LOCAL ONLY (no network, no canvas).
 *
 * ROADMAP: «PDF/Office ← مؤلف، تواريخ، برنامج، نص». This implementation covers
 * the PDF half via pdfjs-dist (Apache-2.0, owner decision 2026-10-16). The
 * Office half needs a separate dependency decision (new license) and is NOT
 * silently included here — documented in the task row.
 *
 * Canvas-free operation VERIFIED in this environment before adoption: text and
 * metadata extraction work with no `canvas` package installed (rendering is
 * never needed for this contract). The input is a base64-encoded PDF; the
 * transform extracts:
 *
 * - the author (Info.Author);
 * - the creation time (Info.CreationDate, "D:YYYYMMDDHHMMSS" normalized to
 *   "YYYY-MM-DD HH:mm:ss" — PDF dates carry no timezone, so none is invented);
 * - the producing application (Info.Producer, falling back to Info.Creator);
 * - the text (every page's text items joined with single spaces).
 *
 * Every finding cites `derivedFrom: "input"`: the analysis is computed from the
 * input alone, and a run that made no request must not cite request evidence
 * (P2-036 evidence contract). The run makes ZERO requests. Fail-closed: bytes
 * pdf.js cannot parse throw (measured 2026-10-16); a PDF without an Info
 * dictionary is a legitimate text-only result — an absence is not an error.
 * Nothing is guessed: each fact is emitted only when present.
 *
 * Sensitivity `normal` (ROADMAP), license LC-A (local only, no network).
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

/** Decoded-input ceiling: 10 MB, enforced before parsing. */
const MAX_DECODED_BYTES = 10_000_000;

/** "D:YYYYMMDDHHMMSS…" => "YYYY-MM-DD HH:mm:ss" (no timezone invented). */
function normalizePdfDate(raw: string): string | undefined {
  const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(raw);
  if (m === null) return undefined;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Every page's text items joined; pages separated by newlines. */
async function extractText(doc: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>): Promise<string> {
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const text = await page.getTextContent();
    pages.push(
      text.items
        .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
        .filter((s) => s.length > 0)
        .join(" "),
    );
  }
  return pages.filter((p) => p.length > 0).join("\n");
}

export const pdfMetadata = defineTransform<{ content: string }>(
  {
    id: "TR-034",
    version: "1.0.0",
    inputs: ["document_content"],
    outputs: ["author", "date", "application", "text"],
    // Local transform: no network. `public` with an empty allow list is the
    // only valid declaration for a transform that never calls ctx.http.
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 14_000_000 },
    sensitivity: "normal",
    license: "LC-A",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "F",
      credibility: 3,
      rationale: "تحليل محلي لملف PDF كما هو — مصدر الملف غير معروف؛ البيانات الوصفية مستخرجة بنيوياً من الملف",
    },
  },
  async (input) => {
    const content = input?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("TR-034: input.content (base64 PDF) is required");
    }
    const bytes = Buffer.from(content, "base64");
    if (bytes.length === 0 || bytes.length > MAX_DECODED_BYTES) {
      throw new Error(`TR-034: decoded input must be 1..${MAX_DECODED_BYTES} bytes, got ${bytes.length}`);
    }

    let doc: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
    try {
      // pdf.js refuses Buffer: hand it a Uint8Array over the same bytes.
      doc = await pdfjs.getDocument({
        data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        useSystemFonts: false,
      }).promise;
    } catch {
      throw new Error("TR-034: the input is not a valid PDF (pdf.js could not parse it)");
    }

    const findings: TransformFinding[] = [];
    const meta = await doc.getMetadata().catch(() => undefined);
    const info = (meta?.info ?? {}) as Record<string, unknown>;

    const author = str(info.Author);
    if (author !== undefined) {
      findings.push({
        predicate: "has_author",
        derivedFrom: "input",
        objectType: "author",
        objectValue: author,
        confidence: 1,
        explanation: "document author from the PDF Info dictionary (local parse, no network)",
      });
    }

    const rawDate = str(info.CreationDate);
    const created = rawDate !== undefined ? normalizePdfDate(rawDate) : undefined;
    if (created !== undefined) {
      findings.push({
        predicate: "created_at_time",
        derivedFrom: "input",
        objectType: "date",
        objectValue: created,
        confidence: 1,
        explanation: "creation time from the PDF Info dictionary (PDF dates carry no timezone — none invented)",
      });
    }

    const application = str(info.Producer) ?? str(info.Creator);
    if (application !== undefined) {
      findings.push({
        predicate: "created_with",
        derivedFrom: "input",
        objectType: "application",
        objectValue: application,
        confidence: 1,
        explanation: "producing application from the PDF Info dictionary (local parse, no network)",
      });
    }

    const text = await extractText(doc);
    if (text.length > 0) {
      findings.push({
        predicate: "contains_text",
        derivedFrom: "input",
        objectType: "text",
        objectValue: text,
        confidence: 1,
        explanation: `extracted text of ${doc.numPages} page(s) (local parse, no network, no rendering)`,
      });
    }

    return { findings };
  },
);
