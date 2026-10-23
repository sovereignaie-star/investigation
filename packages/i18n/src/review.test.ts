import { describe, expect, it } from "vitest";
import { ar } from "./ar.ts";
import { en } from "./en.ts";

/**
 * P5-017 — الترجمة الكاملة والمراجعة اللغوية للواجهة: حراسة آلية على جودة
 * القاموسين. القاموس العربي مصدر الحقيقة، فلا يحمل جملة إنجليزية؛ والقاموس
 * الإنجليزي لا يحمل نصاً عربياً (إلا أسماء اللغات المعروضة بلغتها). وقيم
 * القاموسين نظيفة: لا فراغات مزدوجة أو طرفية، ومفاتيح ar/en متطابقة،
 * وعناصرها النائبة {param} متوافقة، وترقيم العربية سليم (لا فواصل لاتينية
 * بين كلمات عربية).
 */

const ARABIC = /[\u0600-\u06FF]/;

/** قيم لاتينية مقبولة في القاموس العربي: معرفات تقنية وعناصر نائبة فقط. */
const AR_LATIN_WHITELIST = new Set([
  "shell.lang.en", // اسم اللغة الإنجليزية بلغتها — مقصود
  "cases.adminToken.placeholder", // معرف تقني
  "cases.stats.seq", // اختصار تقني
  "evidence.caseIdExample", // مثال ULID
  "evidence.evidenceIdExample", // مثال ULID
  "workbench.map.tilesPlaceholder", // قالب URL
  "evidence.sha256", // بادئة تقنية
  "workbench.nodeDetail.noteBy", // عناصر نائبة فقط — لا نص
]);

/** أسماء اللغات المعروضة بلغتها في القاموس الإنجليزي — مقصودة. */
const EN_ARABIC_WHITELIST = new Set(["shell.lang.ar"]);

describe("P5-017 — مراجعة لغوية آلية للقاموسين", () => {
  it("T-REV-001: القاموس العربي لا يحمل جملاً إنجليزية — اللاتيني المقيد للتقني فقط", () => {
    const offenders = Object.entries(ar)
      .filter(([key, value]) => !ARABIC.test(value) && !AR_LATIN_WHITELIST.has(key))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it("T-REV-002: القاموس الإنجليزي لا يحمل نصاً عربياً — إلا أسماء اللغات بلغتها", () => {
    const offenders = Object.entries(en)
      .filter(([key, value]) => ARABIC.test(value) && !EN_ARABIC_WHITELIST.has(key))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it("T-REV-003: لا فراغات مزدوجة أو طرفية في قيم القاموسين", () => {
    const dirty = (dict: Record<string, string>): string[] =>
      Object.entries(dict)
        .filter(([, v]) => v !== v.trim() || v.includes("  "))
        .map(([k]) => k);
    expect(dirty(ar)).toEqual([]);
    expect(dirty(en)).toEqual([]);
  });

  it("T-REV-004: مفاتيح القاموسين متطابقة — العربية مصدر الحقيقة", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
  });

  it("T-REV-005: العناصر النائبة {param} متوافقة بين القاموسين", () => {
    const placeholders = (value: string): string[] => value.match(/\{(\w+)\}/g)?.sort() ?? [];
    const mismatches = Object.keys(ar)
      .filter((key) => placeholders(ar[key]).join(",") !== placeholders(en[key]).join(","))
      .map((key) => key);
    expect(mismatches).toEqual([]);
  });

  it("T-REV-006: ترقيم عربي سليم — لا فاصلة أو استفهام لاتيني بين كلمات عربية", () => {
    const offenders = Object.entries(ar)
      .filter(([, v]) => /[\u0600-\u06FF][,?][\u0600-\u06FF\s]/.test(v))
      .map(([k]) => k);
    expect(offenders).toEqual([]);
  });
});
