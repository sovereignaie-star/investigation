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

/**
 * معامل التصغير للتمرير الثاني — 36/44: المحرك LSTM مستقر عند ~36px em
 * (قيست 28/32/36/44/56/72/88 — الدليل: docs/evidence/2026-10-23-P5-024-red.md).
 */
const DOWNSCALE_FACTOR = 36 / 44;

/**
 * تصغير PNG حتمي عبر تضمينه في SVG وإعادة التصيير بـresvg (إعادة عينة
 * حتمية — لا خطوط نظام ولا عشوائية). يعيد null لغير PNG (مثل JPEG —
 * يُعالج بتمرير واحد، موثق) أو عند تعذر تحميل resvg (تحميل كسول —
 * الحزمة الأحادية).
 */
async function downscalePng(png: Buffer, factor: number): Promise<Buffer | null> {
  const PNG_MAGIC = "89504e470d0a1a0a";
  if (png.subarray(0, 8).toString("hex") !== PNG_MAGIC || png.length < 24) return null;
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const w2 = Math.max(1, Math.round(width * factor));
  const h2 = Math.max(1, Math.round(height * factor));
  if (w2 === width && h2 === height) return null;
  let Resvg: new (svg: string) => { render: () => { asPng: () => Uint8Array } };
  try {
    Resvg = (await import("@resvg/resvg-js")).Resvg;
  } catch {
    return null; // الحزمة الأحادية بلا الوحدة الأصلية — تمرير واحد (موثق)
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w2}" height="${h2}" viewBox="0 0 ${width} ${height}"><image x="0" y="0" width="${width}" height="${height}" href="data:image/png;base64,${png.toString("base64")}"/></svg>`;
  return Buffer.from(new Resvg(svg).render().asPng());
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
      // تمريران حتميان: الأصلي + مقلَّص (المحرك LSTM يسقط أسطراً عند المحارف
      // الكبيرة — التصغير للنطاق المستقر)؛ اختيار الأفضل بعدد الكلمات ثم الثقة —
      // معالجة داخل المحرك لا تعديلاً للمرجع (قرار مراجعة P5-024).
      const first = await worker.recognize(image);
      const scaled = await downscalePng(image, DOWNSCALE_FACTOR);
      if (scaled === null) return first.data.text;
      const second = await worker.recognize(scaled);
      const words = (t: string): number => t.split(/\s+/).filter(Boolean).length;
      const firstWords = words(first.data.text);
      const secondWords = words(second.data.text);
      const pick =
        secondWords > firstWords
          ? second
          : firstWords > secondWords
            ? first
            : second.data.confidence > first.data.confidence
              ? second
              : first;
      return pick.data.text;
    },
    async terminate(): Promise<void> {
      await worker.terminate();
    },
  };
}
