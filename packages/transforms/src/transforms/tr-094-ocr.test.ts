/**
 * P5-024 — TR-094: OCR محلي للعربية والإنجليزية (LC-A — لا شبكة وقت تشغيل).
 *
 * صادق الأدلة: كُتب قبل أي تنفيذ (الوحدة غير موجودة — الأحمر هيكلي).
 * المحرك tesseract.js (WASM في worker محلي) ونماذج اللغة مضمّنة في الحزمة
 * (packages/transforms/ocr/tessdata — Apache-2.0) فلا تنزيل وقت تشغيل.
 * كل فشل صريح (fail-closed) ولا نتيجة فارغة صامتة.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ocrTransform, OCR_LANGS, TESSDATA_DIR, MAX_IMAGE_BYTES, type OcrInput } from "./tr-094-ocr.ts";

const B64 = (b: Buffer): string => b.toString("base64");
const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "ocr");
const arImage = B64(readFileSync(join(fixtures, "ar-01.png")));

function ctxOf(): never {
  return { manifest: ocrTransform.manifest } as never;
}

describe("TR-094 — OCR محلي (LC-A، لا شبكة)", () => {
  it("T-094-001: البيان محلي — LC-A، شبكة public بقائمة سماح فارغة، مخرج ocr_text", () => {
    expect(ocrTransform.manifest.license).toBe("LC-A");
    expect(ocrTransform.manifest.network).toMatchObject({ mode: "public", allow: [] });
    expect(ocrTransform.manifest.outputs).toContain("ocr_text");
    expect(ocrTransform.manifest.inputs).toContain("image_content");
  });

  it("T-094-002: مسارات الأصول محلية داخل الحزمة — لا CDN ولا رابط شبكة", () => {
    expect(TESSDATA_DIR).not.toMatch(/^https?:/);
    expect(TESSDATA_DIR.includes("tessdata")).toBe(true);
    for (const lang of OCR_LANGS) {
      expect(lang).toMatch(/^[a-z]{3}$/);
    }
  });

  it("T-094-003: يرفض فاشلاً-مغلقاً مدخلاً فارغاً أو غير base64", async () => {
    // دفعات غير صالحة عمداً — تُصاغ كـOcrInput لأن الفحص سلوكي (فاشل-مغلق)
    await expect(ocrTransform.run({ content: "" } as OcrInput, ctxOf())).rejects.toThrow();
    await expect(ocrTransform.run({ content: "ليست base64!!" } as OcrInput, ctxOf())).rejects.toThrow();
    await expect(ocrTransform.run({} as OcrInput, ctxOf())).rejects.toThrow();
  });

  it("T-094-004: يرفض لغة غير مدعومة فاشلاً-مغلقاً", async () => {
    await expect(ocrTransform.run({ content: arImage, lang: "fr" as never }, ctxOf())).rejects.toThrow();
  });

  it("T-094-005: يرفض صورة تتجاوز حد البايتات فاشلاً-مغلقاً", async () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    await expect(ocrTransform.run({ content: B64(big), lang: "ara" }, ctxOf())).rejects.toThrow();
  });

  it("T-094-006: يتعرف على صورة عربية مرجعية ويعيد النص كملاحظة بدليل الدخل", async () => {
    const out = await ocrTransform.run({ content: arImage, lang: "ara" }, ctxOf());
    expect(out.findings).toHaveLength(1);
    const f = out.findings[0];
    expect(f.predicate).toBe("ocr_text");
    expect(f.objectType).toBe("ocr_text");
    expect(f.derivedFrom).toBe("input");
    const text = f.objectValue;
    expect(text).toContain("التحقيق");
    expect(text).toContain("الأدلة");
  });

  it("T-094-007: يتعرف على صورة إنجليزية مرجعية", async () => {
    const enImage = B64(readFileSync(join(fixtures, "en-01.png")));
    const out = await ocrTransform.run({ content: enImage, lang: "eng" }, ctxOf());
    const text = out.findings[0].objectValue;
    expect(text).toContain("investigation");
    expect(text).toContain("evidence");
  });
});
