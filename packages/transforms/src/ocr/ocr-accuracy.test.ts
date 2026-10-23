/**
 * P5-024 — قياس قبول OCR: دقة كلمات ≥ 90% على المجموعة المرجعية العربية
 * المطبوعة (اصطناعياً — انظر DECLARED_LIMITS) وبلا شبكة.
 *
 * المقياس (معلن قبل القياس ولم يُعدّل بعده): مسافة تحرير على تسلسل الكلمات —
 * الدقة = 1 − (بدائل+حذف+إضافات)/كلمات المرجع، مجمعة على المجموعة كاملة.
 * التطبيع (معلن): حذف التشكيل (\p{M}) والتطويل (ـ) والترقيم، وتوحيد الفراغات —
 * يطبق بالتساوي على المرجع والخرج.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeWords, wordAccuracy } from "./metrics.ts";
import { createOcrEngine } from "./engine.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "ocr");
const gt = JSON.parse(readFileSync(join(fixtures, "ground-truth.json"), "utf8")) as {
  ar: { id: string; file: string; text: string }[];
  en: { id: string; file: string; text: string }[];
};

describe("P5-024 — قبول دقة OCR على المجموعة المرجعية", () => {
  it("T-OCR-ACC-001: التطبيع معلن ومستقر — التشكيل والترقيم يُحذفان بالتساوي", () => {
    expect(normalizeWords("وحُللتِ السجلات، بدقة!")).toEqual(["وحللت", "السجلات", "بدقة"]);
    expect(normalizeWords("Hello, world!")).toEqual(["hello", "world"]);
  });

  it("T-OCR-ACC-002: مقياس مسافة التحرير للكلمات — النص المطابق 100% والمعكوس أقل", () => {
    const perfect = wordAccuracy(["a", "b", "c"], ["a", "b", "c"]);
    expect(perfect.accuracy).toBe(1);
    const swapped = wordAccuracy(["a", "b", "c"], ["c", "b", "a"]);
    expect(swapped.substitutions).toBe(2);
    expect(swapped.accuracy).toBeLessThan(1);
  });

  it("T-OCR-ACC-003: القبول — دقة كلمات ≥ 90% على المجموعة العربية المرجعية (10 صور، بلا شبكة)", async () => {
    const engine = await createOcrEngine();
    try {
      const results = [];
      for (const entry of gt.ar) {
        const image = readFileSync(join(fixtures, entry.file));
        const recognized = await engine.recognize(image, "ara");
        const acc = wordAccuracy(normalizeWords(entry.text), normalizeWords(recognized));
        results.push({
          id: entry.id,
          accuracy: acc.accuracy,
          substitutions: acc.substitutions,
          deletions: acc.deletions,
          insertions: acc.insertions,
          referenceWords: acc.referenceWords,
        });
      }
      const totalRef = results.reduce((s, r) => s + r.referenceWords, 0);
      const totalErr = results.reduce((s, r) => s + r.substitutions + r.deletions + r.insertions, 0);
      const aggregate = 1 - totalErr / totalRef;
      console.log("AR per-image:", JSON.stringify(results.map((r) => `${r.id}=${(r.accuracy * 100).toFixed(1)}%`)));
      console.log(`AR aggregate: ${(aggregate * 100).toFixed(2)}% (${totalErr} errors / ${totalRef} words)`);
      expect(aggregate).toBeGreaterThanOrEqual(0.9);
    } finally {
      await engine.terminate();
    }
  }, 120_000);

  it("T-OCR-ACC-004: القبول — دقة كلمات ≥ 90% على المجموعة الإنجليزية (3 صور)", async () => {
    const engine = await createOcrEngine();
    try {
      const results = [];
      for (const entry of gt.en) {
        const image = readFileSync(join(fixtures, entry.file));
        const recognized = await engine.recognize(image, "eng");
        const acc = wordAccuracy(normalizeWords(entry.text), normalizeWords(recognized));
        results.push({
          id: entry.id,
          accuracy: acc.accuracy,
          substitutions: acc.substitutions,
          deletions: acc.deletions,
          insertions: acc.insertions,
          referenceWords: acc.referenceWords,
        });
      }
      const totalRef = results.reduce((s, r) => s + r.referenceWords, 0);
      const totalErr = results.reduce((s, r) => s + r.substitutions + r.deletions + r.insertions, 0);
      const aggregate = 1 - totalErr / totalRef;
      console.log("EN per-image:", JSON.stringify(results.map((r) => `${r.id}=${(r.accuracy * 100).toFixed(1)}%`)));
      console.log(`EN aggregate: ${(aggregate * 100).toFixed(2)}% (${totalErr} errors / ${totalRef} words)`);
      expect(aggregate).toBeGreaterThanOrEqual(0.9);
    } finally {
      await engine.terminate();
    }
  }, 60_000);
});
