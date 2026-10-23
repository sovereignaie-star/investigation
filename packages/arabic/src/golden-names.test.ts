import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { arabicNameMatches } from "./index.ts";

/**
 * P5-006 — المجموعة الذهبية العربية (2,000 زوج اسم) والمراجعة اللغوية الثانية.
 *
 * المجموعة: أزواج أسماء (متطابق/غير متطابق) من أسماء مركبة عامة ومولّدة — لا بيانات
 * أشخاص حقيقيين (قاعدة بيانات الاختبار §8.4). الدلالة المعلنة: الزوج «متطابق» عندما
 * يجد أحد الاسمين الآخر وفق دلالة البحث المعلنة في P5-003 (كل رمز في الاستعلام
 * يطابق رمزاً في المرشّح — استعلام العائلة يجد الاسم الكامل)، والتنبؤ هنا هو
 * `arabicNameMatches(a,b) || arabicNameMatches(b,a)`.
 *
 * العتبات (ROADMAP §D5): recall ≥ 0.95 وprecision ≥ 0.90.
 */

interface Pair {
  id: number;
  a: string;
  b: string;
  match: boolean;
  category: string;
}

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures", "arabic");
const rawPath = path.join(dir, "name-pairs.jsonl");
const raw = existsSync(rawPath) ? readFileSync(rawPath, "utf8") : "";
const rows: Pair[] = raw
  .trim()
  .split("\n")
  .filter((l) => l.length > 0)
  .map((l) => JSON.parse(l) as Pair);
const manifest = existsSync(path.join(dir, "manifest.json"))
  ? (JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as {
      pairs: number;
      sha256: string;
      matched: number;
      unmatched: number;
    })
  : { pairs: 0, sha256: "", matched: 0, unmatched: 0 };

const predicted = (p: Pair): boolean => arabicNameMatches(p.a, p.b) || arabicNameMatches(p.b, p.a);

const byCategory = new Map<string, { total: number; tp: number; fp: number; fn: number }>();
for (const p of rows) {
  const pred = predicted(p);
  const c = byCategory.get(p.category) ?? { total: 0, tp: 0, fp: 0, fn: 0 };
  c.total++;
  if (p.match && pred) c.tp++;
  if (!p.match && pred) c.fp++;
  if (p.match && !pred) c.fn++;
  byCategory.set(p.category, c);
}
const tp = [...byCategory.values()].reduce((s, c) => s + c.tp, 0);
const fp = [...byCategory.values()].reduce((s, c) => s + c.fp, 0);
const fn = [...byCategory.values()].reduce((s, c) => s + c.fn, 0);
const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
const precision = tp + fp > 0 ? tp / (tp + fp) : 0;

describe("P5-006 — المجموعة الذهبية العربية: سلامة العتاد", () => {
  it("T-GLDN-001: 2,000 زوج فريد، والمُبيّن يطابق الملف (عدد وبصمة)", () => {
    expect(rows).toHaveLength(2000);
    expect(manifest.pairs).toBe(2000);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2000);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(manifest.sha256);
    expect(manifest.matched).toBe(rows.filter((r) => r.match).length);
    expect(manifest.unmatched).toBe(rows.filter((r) => !r.match).length);
  });

  it("T-GLDN-002: بنية سليمة — كل زوج اسمان غير فارغين، خليط كتابات فقط (عربية/لاتينية)، لا أرقام ولا رموز غريبة", () => {
    for (const p of rows) {
      expect(p.a.trim().length, `id=${p.id} a`).toBeGreaterThan(1);
      expect(p.b.trim().length, `id=${p.id} b`).toBeGreaterThan(1);
      expect(p.a, `id=${p.id}`).not.toMatch(/[0-9@#]/);
      expect(p.b, `id=${p.id}`).not.toMatch(/[0-9@#]/);
      expect(p.category.length, `id=${p.id}`).toBeGreaterThan(0);
    }
  });

  it("T-GLDN-003: توازن وتغطية — أغلبية متطابقة بفجوة صادقة، وكل الفئات المعلنة حاضرة", () => {
    const matched = rows.filter((r) => r.match).length;
    expect(matched).toBeGreaterThan(1000);
    expect(matched).toBeLessThan(1400);
    for (const cat of [
      "orthographic",
      "cross_script",
      "nasab",
      "ordering",
      "subset",
      "latin_variant",
      "compound_spacing",
      "different_person_same_family",
      "different_person",
      "lookalike",
    ]) {
      expect(byCategory.get(cat)?.total ?? 0, cat).toBeGreaterThan(20);
    }
  });
});

describe("P5-006 — القياس على المجموعة الذهبية (عتبات ROADMAP §D5)", () => {
  it("T-GLDN-004: recall ≥ 0.95", () => {
    expect(recall).toBeGreaterThanOrEqual(0.95);
  });

  it("T-GLDN-005: precision ≥ 0.90", () => {
    expect(precision).toBeGreaterThanOrEqual(0.9);
  });

  it("T-GLDN-006: كل فئة متطابقة تحقق recall ≥ 0.90 داخلها (لا إخفاء فشل فئة خلف المتوسط)", () => {
    for (const [cat, c] of byCategory) {
      if (rows.some((r) => r.match && r.category === cat)) {
        const catMatched = rows.filter((r) => r.match && r.category === cat).length;
        expect(c.tp / catMatched, `${cat} recall`).toBeGreaterThanOrEqual(0.9);
      }
    }
  });

  it("T-GLDN-007: كل فئة غير متطابقة تحقق دقة داخلية ≥ 0.90 (لا فئة سالبة تُغرق الدقة)", () => {
    for (const [cat, c] of byCategory) {
      if (rows.some((r) => !r.match && r.category === cat)) {
        const catUnmatched = rows.filter((r) => !r.match && r.category === cat).length;
        expect((catUnmatched - c.fp) / catUnmatched, `${cat} specificity`).toBeGreaterThanOrEqual(0.9);
      }
    }
  });
});
