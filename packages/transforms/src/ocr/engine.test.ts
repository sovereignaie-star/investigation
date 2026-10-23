/**
 * P5-024 — تصحيح القبول (مراجعة مستقلة): المعالجة المسبقة داخل المحرك،
 * لا تعديل المجموعة المرجعية.
 *
 * الحارس الأحمر: صورة عربية بخط كبير (44px em — الحجم الأصلي المجمد
 * للمجموعة) يُسقط فيها التمرير الأحادي سطرها الأول؛ المحرك بتمريرين
 * (1.0x + 0.82x) واختيار الأفضل بعدد الكلمات يقرأ السطر كاملاً —
 * بمعالجة داخل المحرك لا بتعديل المرجع.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOcrEngine } from "./engine.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "ocr");

describe("P5-024 — المعالجة المسبقة داخل المحرك (تمريران)", () => {
  it("T-ENG-001: يقرأ السطر الأول الذي يُسقطه التمرير الأحادي — المعالجة داخل المحرك لا في المرجع", async () => {
    const engine = await createOcrEngine();
    try {
      const ar03 = readFileSync(join(fixtures, "ar-03.png"));
      const text = await engine.recognize(ar03, "ara");
      // السطر الأول: «تشير سجلات البنك إلى تحويل مبلغ كبير» — يُسقط بالتمرير الأحادي
      expect(text).toContain("البنك");
      expect(text).toContain("تحويل");
    } finally {
      await engine.terminate();
    }
  }, 60_000);
});
