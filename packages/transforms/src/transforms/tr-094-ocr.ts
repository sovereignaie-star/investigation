/**
 * TR-094 — OCR محلي للعربية والإنجليزية (P5-024، محوّل LC-A).
 *
 * محرك التعرف tesseract.js (WASM) في worker محلي ونماذج اللغة مضمّنة في
 * الحزمة — لا شبكة وقت تشغيل إطلاقاً. الدخل صورة (base64) والخرج النص
 * المعروف ملاحظةً بدليل الدخل نفسه (derivedFrom: "input"). فاشل-مغلق:
 * دخل فارغ أو غير base64 أو لغة غير مدعومة أو صورة تتجاوز الحد — خطأ
 * صريح لا نتيجة فارغة صامتة. دقة الكلمات على المجموعة المرجعية مقيسة
 * وموثقة (≥ 90% — انظر ocr-accuracy.test.ts).
 */
import { defineTransform } from "../manifest.ts";
import type { TransformContext } from "../transform.ts";
import { createOcrEngine, OCR_LANGS, TESSDATA_DIR, type OcrLang } from "../ocr/engine.ts";

/** حد بايتات الصورة (نفس حدود TR-092 للملفات). */
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

export interface OcrInput {
  /** بايتات الصورة base64. */
  readonly content: string;
  /** لغة التعرف — ara أو eng (نماذجهما مضمّنة). */
  readonly lang: OcrLang;
}

/** محوّل OCR — واجهة الملف الكاملة. */
export const ocrTransform = defineTransform<OcrInput>(
  {
    id: "TR-094",
    version: "1.0.0",
    inputs: ["image_content"],
    outputs: ["ocr_text"],
    // محوّل محلي: لا شبكة. `public` بقائمة سماح فارغة هي الإعلان الوحيد
    // الصحيح لمحوّل لا يستدعي ctx.http إطلاقاً.
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 10, timeoutMs: 120_000, maxBytes: MAX_IMAGE_BYTES },
    sensitivity: "normal",
    license: "LC-A",
    admiralty: {
      reliability: "F",
      credibility: 3,
      rationale:
        "تعرف ضوئي محلي على صورة الدليل بنماذج مضمّنة — النص المعروف ناتج آلي له نسبة خطأ مقيسة (دقة كلمات ≥ 90% على المرجع)، والدليل هو الصورة نفسها",
    },
  },
  async (input: OcrInput, _ctx: TransformContext) => {
    if (input === null || typeof input !== "object" || typeof input.content !== "string" || input.content.length === 0) {
      throw new Error("TR-094: input.content (base64) مطلوب");
    }
    const lang = input.lang;
    if (typeof lang !== "string" || !OCR_LANGS.includes(lang as OcrLang)) {
      throw new Error(`TR-094: لغة غير مدعومة (المدعوم: ${OCR_LANGS.join("، ")}): ${JSON.stringify(lang)}`);
    }
    const bytes = Buffer.from(input.content, "base64");
    if (bytes.length === 0 || bytes.toString("base64").replace(/=+$/, "") !== input.content.replace(/=+$/, "")) {
      throw new Error("TR-094: input.content ليس base64 صالحاً");
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new Error(`TR-094: الصورة ${bytes.length} بايت (الحد ${MAX_IMAGE_BYTES})`);
    }
    if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" && bytes.subarray(0, 3).toString("hex") !== "ffd8ff") {
      throw new Error("TR-094: الدخل ليس PNG أو JPEG — الصيغ المدعومة: PNG وJPEG");
    }
    const engine = await createOcrEngine();
    try {
      const text = await engine.recognize(bytes, lang as OcrLang);
      return {
        findings: [
          {
            predicate: "ocr_text",
            objectType: "ocr_text",
            objectValue: text,
            confidence: 0.8,
            explanation: `نص معروف ضوئياً (OCR محلي — ${lang === "ara" ? "عربي" : "إنجليزي"}) من الصورة بدليلها؛ النماذج محلية مضمّنة (${TESSDATA_DIR}) ولا شبكة — الناتج ناتج آلي نسبة خطأه مقيسة`,
            derivedFrom: "input",
          },
        ],
      };
    } finally {
      await engine.terminate();
    }
  },
);

export { OCR_LANGS, TESSDATA_DIR } from "../ocr/engine.ts";
