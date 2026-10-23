/**
 * P5-021 — سجل استخدام الذكاء الاصطناعي وتكلفته، ومفتاح تعطيل كامل لكل قضية.
 *
 * كل استدعاء مسجّل بالنموذج والحجم والتكلفة التقديرية — يُرفع إلى سجل تدقيق
 * القضية نفسه (P1-017) عبر محقن تسجيل، فتبقى الحزمة مستقلة عن المخزن. والتعطيل
 * يمنع أي استدعاء: الحارس يرفض قبل أي مسار نقل (فشل-مغلق — لا يصل الطلب
 * أصلاً)، والتفعيل يعيدها. والتكلفة التقديرية حتمية معلومة الصيغة: النماذج
 * المحلية صفر تكلفة (تعمل على جهاز المستخدم)، والسحابية بجدول معلن لكل ألف
 * رمز — والرموز تُقدّر بالحروف/4.
 */

/** قيد استخدام واحد — يُرفع إلى سجل تدقيق القضية. */
export interface UsageAuditRecord {
  readonly kind: "chat" | "embed";
  readonly model: string;
  readonly inputChars: number;
  readonly outputChars: number;
  readonly estimatedCostUsd: number;
}

/** محقن التسجيل — يوصله المستدعي بسجل القضية (audit) أو يجمعه للاختبار. */
export type UsageAuditSink = (record: UsageAuditRecord) => void;

/** تعطل الذكاء الاصطناعي — يُرفض الاستدعاء قبل أي مسار نقل (فشل-مغلق). */
export class AiDisabledError extends Error {
  constructor() {
    super("ai: الذكاء الاصطناعي معطّل لهذه القضية — مفتاح التعطيل مفعّل، لا استدعاء إطلاقاً");
    this.name = "AiDisabledError";
  }
}

/** تكلفة معلنة لكل ألف رمز — المحلي صفر (جهاز المستخدم)، والسحابي بجدول. */
const MODEL_COSTS: Record<string, { readonly input: number; readonly output: number }> = {
  "qwen2.5:7b": { input: 0, output: 0 },
  "nomic-embed-text": { input: 0, output: 0 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
};

/** رموز تقديرية: الحروف/4 (تقريب معلن). */
const tokensOf = (chars: number): number => chars / 4;

/**
 * التكلفة التقديرية الحتمية — نموذج محلي صفر، وسحابي بجدول معلن لكل ألف رمز
 * (إدخال وإخراج)، ونموذج مجهول التسعير بجدول افتراضي معلن (0.002$/0.006$).
 */
export function estimateAiCost(model: string, inputChars: number, outputChars = 0): number {
  const costs = MODEL_COSTS[model] ?? { input: 0.002, output: 0.006 };
  return (tokensOf(inputChars) / 1000) * costs.input + (tokensOf(outputChars) / 1000) * costs.output;
}

/** غلاف محادثة موثّق — يسجل كل استدعاء بالنموذج والحجم والتكلفة. */
export function withUsageAudit(
  provider: { chat: (request: { model: string; messages: readonly { content: string }[] }) => Promise<{ content: string }> },
  sink: UsageAuditSink,
): { chat: (request: { model: string; messages: readonly { content: string }[] }) => Promise<{ content: string }> } {
  return {
    async chat(request) {
      const inputChars = request.messages.reduce((sum, m) => sum + m.content.length, 0);
      const response = await provider.chat(request);
      sink({
        kind: "chat",
        model: request.model,
        inputChars,
        outputChars: response.content.length,
        estimatedCostUsd: estimateAiCost(request.model, inputChars, response.content.length),
      });
      return response;
    },
  };
}

/** غلاف تضمين موثّق — يسجل كل استدعاء. */
export function withEmbedUsageAudit(
  provider: { embed: (texts: readonly string[]) => Promise<readonly number[][]> },
  sink: UsageAuditSink,
): { embed: (texts: readonly string[]) => Promise<readonly number[][]> } {
  return {
    async embed(texts) {
      const vectors = await provider.embed(texts);
      const inputChars = texts.reduce((sum, t) => sum + t.length, 0);
      const outputChars = vectors.reduce((sum, v) => sum + v.length, 0);
      sink({
        kind: "embed",
        model: "nomic-embed-text",
        inputChars,
        outputChars,
        estimatedCostUsd: 0,
      });
      return vectors;
    },
  };
}

export interface AiGuard {
  /** تعطيل كامل — كل استدعاء يُرفض قبل أي مسار نقل. */
  readonly disable: () => void;
  readonly enable: () => void;
  readonly isEnabled: () => boolean;
  /** يلف المزوّد بحارس التعطيل (فشل-مغلق). */
  readonly wrap: <P>(provider: P) => P;
}

/** مفتاح تعطيل كامل لكل قضية — يمنع أي استدعاء (فشل-مغلق). */
export function createAiGuard(): AiGuard {
  let enabled = true;
  return {
    disable() {
      enabled = false;
    },
    enable() {
      enabled = true;
    },
    isEnabled: () => enabled,
    wrap(provider) {
      return new Proxy(provider as object, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value !== "function") return value;
          // التعطيل يمنع أي استدعاء قبل مسار النقل — ورفض متسق مع العقد غير المتزامن
          return (...args: unknown[]) => {
            if (!enabled) return Promise.reject(new AiDisabledError());
            return value.apply(target, args);
          };
        },
      }) as never;
    },
  };
}
