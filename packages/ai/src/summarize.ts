/**
 * P5-013 — التلخيص المقيد بالأدلة والتحقق منه.
 *
 * النموذج يُعلَّم أن كل جملة خلاصة تحمل إحالة [n] إلى دليل، ثم يُتحقق من الناتج
 * تحققاً حتمياً مستقلاً عن النموذج: كل جملة يجب أن تحمل إحالة قائمة وأن يكون
 * مضمونها مستنداً إلى الدليل المُحال إليه (تراكب كلمات المحتوى — سند يقيس
 * المضمون لا الصياغة، فإعادة الصياغة المخلصة مقبولة والاختلاق يُكشف). الجمل
 * غير المدعومة تُقاس وتُعلن — لا أن تمر صامتة.
 */

import type { AiProvider } from "./index.ts";
import type { EvidenceStatement } from "./summarize-types.ts";
import { buildSummarizeMessages, detectInjection } from "./injection.ts";

export type { ChatMessage, EvidenceStatement } from "./summarize-types.ts";

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
  /** صدى تعليمات مدسوسة في ناتج النموذج — يُكشف ويُعلن ولا يُنفذ إطلاقاً. */
  readonly injectionEcho: boolean;
  /** معيار القبول: ≤ 2% غير مدعوم وبلا صدى حقن. */
  readonly ok: boolean;
}

export interface SummarizeOptions {
  readonly provider: AiProvider;
  readonly model?: string;
  /** حد السند: نسبة كلمات المحتوى المشتركة مع الدليل. */
  readonly supportThreshold?: number;
}

import { contentTokens } from "./support.ts";

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
  // P5-014: الحصر البنيوي — نصوص الأدلة تدخل داخل علامات «بيانات غير موثوقة"
  // (buildSummarizeMessages) ولا تصعد أبداً إلى تعليمات النظام.
  const messages = buildSummarizeMessages(evidence);
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
  const injectionEcho = detectInjection(response.content).detected;
  return {
    summary: response.content,
    claims,
    unsupported,
    unsupportedRatio: ratio,
    injectionEcho,
    ok: claims.length > 0 && ratio <= 0.02 && !injectionEcho,
  };
}
