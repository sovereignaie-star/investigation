/**
 * P5-024 — محرك OCR المحلي (LC-A): tesseract.js في worker محلي ونماذج
 * اللغة مضمّنة في الحزمة (packages/transforms/ocr/tessdata — Apache-2.0).
 *
 * لا شبكة وقت تشغيل: langPath محلي داخل الحزمة (لا CDN)، والنواة (WASM)
 * من node_modules عبر require عادي. worker واحد يُعاد استخدامه لمجموعة
 * الصور، ويُنهى صراحة (terminate) — والاستدعاء مسؤول عن الإنهاء في finally.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** مسار نماذج اللغة المضمّنة — داخل الحزمة، لا رابط شبكة. */
export const TESSDATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ocr", "tessdata");

/** اللغات المدعومة (نماذجها مضمّنة). */
export const OCR_LANGS = ["ara", "eng"] as const;
export type OcrLang = (typeof OCR_LANGS)[number];

export interface OcrEngine {
  /** التعرف على صورة (بايتات) بلغة مدعومة — يعيد النص الخام. */
  recognize(image: Buffer, lang: OcrLang): Promise<string>;
  /** إنهاء الـworker — الاستدعاء مسؤول عن استدعائها في finally. */
  terminate(): Promise<void>;
}

/** ينشئ محرك OCR بمسارات محلية فقط — يفشل صريحاً إذا غاب أي أصل. */
export async function createOcrEngine(): Promise<OcrEngine> {
  for (const lang of OCR_LANGS) {
    const model = join(TESSDATA_DIR, `${lang}.traineddata.gz`);
    if (!existsSync(model)) {
      throw new Error(`OCR: نموذج اللغة المحلي مفقود: ${model}`);
    }
  }
  // تحميل كسول (dynamic import): حزمة واحدة ملفات (ir.mjs) لا تنفذ tesseract.js
  // عند الإقلاع — يُحمَّل فقط عند تشغيل OCR فعلاً، ويفشل صريحاً إن تعذر.
  let worker: Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;
  try {
    worker = await import("tesseract.js").then((mod) =>
      mod.createWorker(OCR_LANGS[0], 1, {
        // مسارات محلية فقط — لا CDN ولا تنزيل وقت تشغيل (LC-A)
        langPath: TESSDATA_DIR,
        gzip: true,
        logger: () => undefined,
      }),
    );
  } catch (err) {
    throw new Error(
      `OCR: تعذر تحميل محرك tesseract.js في هذه البيئة (الحزمة أحادية الملف لا تشمل ملفات العامل) — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let currentLang: OcrLang = OCR_LANGS[0];
  return {
    async recognize(image: Buffer, lang: OcrLang): Promise<string> {
      if (lang !== currentLang) {
        // تبديل اللغة بالنموذج المحلي المضمّن (reinitialize يقرأ من langPath)
        await worker.reinitialize(lang);
        currentLang = lang;
      }
      const result = await worker.recognize(image);
      return result.data.text;
    },
    async terminate(): Promise<void> {
      await worker.terminate();
    },
  };
}
