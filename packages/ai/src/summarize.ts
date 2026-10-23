/**
 * P5-013 — التلخيص المقيد بالأدلة والتحقق منه.
 *
 * النموذج يُعلَّم أن كل جملة خلاصة تحمل إحالة [n] إلى دليل، ثم يُتحقق من الناتج
 * تحققاً حتمياً مستقلاً عن النموذج: كل جملة يجب أن تحمل إحالة قائمة وأن يكون
 * مضمونها مستنداً إلى الدليل المُحال إليه (تراكب كلمات المحتوى — سند يقيس
 * المضمون لا الصياغة، فإعادة الصياغة المخلصة مقبولة والاختلاق يُكشف). الجمل
 * غير المدعومة تُقاس وتُعلن — لا أن تمر صامتة.
 */

import type { AiProvider, ChatMessage } from "./index.ts";

/** عبارة دليل: نص + معرّف الدليل. */
export interface EvidenceStatement {
  readonly text: string;
  readonly evidenceId: string;
}

/** جملة خلاصة مُتحقق منها. */
export interface SummaryClaim {
  readonly text: string;
  readonly citation: number | null;
}

export interface SummarizeResult {
  /** الخلاصة الخام كما أوردها النموذج. */
  readonly summary: string;
  readonly claims: readonly SummaryClaim[];
  /** الجمل غير المدعومة (نصها) — تُعلن لا أن تُمرر صامتة. */
  readonly unsupported: readonly string[];
  readonly unsupportedRatio: number;
  /** معيار القبول: ≤ 2% غير مدعوم. */
  readonly ok: boolean;
}

export interface SummarizeOptions {
  readonly provider: AiProvider;
  readonly model?: string;
  /** حد السند: نسبة كلمات المحتوى المشتركة مع الدليل. */
  readonly supportThreshold?: number;
}

/** كلمات وقف عربية ولاتينية دنيا — لا تدخل في قياس السند. */
const STOPWORDS = new Set([
  "في",
  "من",
  "إلى",
  "على",
  "عن",
  "عند",
  "منذ",
  "مع",
  "بين",
  "هذا",
  "هذه",
  "التي",
  "الذي",
  "كل",
  "لا",
  "ما",
  "إن",
  "أن",
  "أو",
  "هو",
  "هي",
  "فيه",
  "the",
  "a",
  "an",
  "in",
  "on",
  "at",
  "of",
  "for",
  "since",
  "is",
  "are",
  "by",
  "and",
  "to",
]);

/** كلمات المحتوى: رموز عربية/لاتينية (تشمل النقاط الداخلية للنطاقات والعناوين). */
function contentTokens(text: string): Set<string> {
  const tokens = text.match(/[\p{L}\p{N}][\p{L}\p{N}._'’-]*/gu) ?? [];
  return new Set(tokens.map((t) => t.toLowerCase()).filter((t) => t.length > 1 && !STOPWORDS.has(t)));
}

/** تقسيم الخلاصة إلى جمل — الفواصل العربية واللاتينية. */
function splitSentences(summary: string): string[] {
  return summary
    .split(/[.؟!]\s+|\.$/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** إحالة الجملة: آخر [n] فيها (تُشال من نصها عند قياس السند). */
function extractCitation(sentence: string): { text: string; citation: number | null } {
  const match = sentence.match(/\[(\d+)\]/);
  if (match === null) return { text: sentence, citation: null };
  return { text: sentence.replace(/\[\d+\]/g, "").trim(), citation: Number(match[1]) };
}

/** السند: تراكب كلمات المحتوى بين الجملة والدليل المُحال إليه. */
function isSupported(text: string, citation: number | null, evidence: readonly EvidenceStatement[], threshold: number): boolean {
  if (citation === null || citation < 1 || citation > evidence.length) return false;
  const claimTokens = contentTokens(text);
  if (claimTokens.size === 0) return false;
  const evidenceTokens = contentTokens(evidence[citation - 1].text);
  let hits = 0;
  for (const token of claimTokens) {
    if (evidenceTokens.has(token)) hits += 1;
  }
  return hits / claimTokens.size >= threshold;
}

/**
 * تلخيص مقيد بالأدلة عبر المزوّد (محلي افتراضياً)، مع تحقق حتمي مستقل من
 * الناتج: كل جملة بإحالة قائمة وسند في الدليل — والإجمالي ≤ 2% غير مدعوم.
 */
export async function summarizeEvidence(evidence: readonly EvidenceStatement[], options: SummarizeOptions): Promise<SummarizeResult> {
  const messages: readonly ChatMessage[] = [
    {
      role: "system",
      content:
        "أنت مساعد تحقيق. لخّص الأدلة في خلاصة عربية موجزة. القاعدة الملزمة: كل جملة في الخلاصة يجب أن تنتهي بإحالة إلى رقم الدليل بين قوسين مربعين مثل [1]، ولا تذكر أي معلومة ليست في الأدلة المعطاة — لا استنتاجات ولا معارف خارجية.",
    },
    {
      role: "user",
      content: `لخّص الأدلة التالية:\n` + evidence.map((e, i) => `[${i + 1}] (${e.evidenceId}) ${e.text}`).join("\n"),
    },
  ];
  const response = await options.provider.chat({
    model: options.model ?? "qwen2.5:7b",
    messages,
  });

  const threshold = options.supportThreshold ?? 0.4;
  const claims: SummaryClaim[] = [];
  const unsupported: string[] = [];
  for (const sentence of splitSentences(response.content)) {
    const { text, citation } = extractCitation(sentence);
    claims.push({ text: sentence, citation });
    if (!isSupported(text, citation, evidence, threshold)) {
      unsupported.push(sentence);
    }
  }
  const ratio = claims.length === 0 ? 1 : unsupported.length / claims.length;
  return {
    summary: response.content,
    claims,
    unsupported,
    unsupportedRatio: ratio,
    ok: claims.length > 0 && ratio <= 0.02,
  };
}
