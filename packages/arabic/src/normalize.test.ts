import { describe, expect, it } from "vitest";

import { normalizeArabicName, stripDiacritics } from "./normalize.ts";

/**
 * P5-001 — تطبيع الأسماء العربية: أساس مطابقة الأسماء في الدمج والبحث
 * (P5-002/003 تُبنى فوقه). كل قاعدة موثقة في normalize.ts بسببها.
 */

describe("P5-001 — التشكيل والتطويل", () => {
  it("strips tashkeel (fatha/damma/kasra/shadda/sukun/tanwin)", () => {
    expect(normalizeArabicName("مُحَمَّد")).toBe("محمد");
    expect(normalizeArabicName("أَحْمَد")).toBe("احمد");
    expect(normalizeArabicName("فَاطِمَة")).toBe("فاطمه");
    expect(stripDiacritics("مُحَمَّد")).toBe("محمد");
  });

  it("removes tatweel (kashida) — التطويل", () => {
    expect(normalizeArabicName("محـــمد")).toBe("محمد");
    expect(normalizeArabicName("عـبد الله")).toBe("عبدالله");
  });
});

describe("P5-001 — توحيد الحروف", () => {
  it("unifies alef variants (أ إ آ ٱ → ا)", () => {
    expect(normalizeArabicName("إبراهيم")).toBe("ابراهيم");
    expect(normalizeArabicName("آمنة")).toBe("امنه");
    expect(normalizeArabicName("أحمد")).toBe("احمد");
  });

  it("unifies ta marbuta (ة → ه) and alef maqsura (ى → ي)", () => {
    expect(normalizeArabicName("فاطمة")).toBe("فاطمه");
    expect(normalizeArabicName("عيسى")).toBe("عيسي");
    expect(normalizeArabicName("موسى")).toBe("موسي");
  });

  it("unifies hamza carriers (ؤ → و، ئ → ي، ء removed standalone)", () => {
    expect(normalizeArabicName("رؤوف")).toBe("رووف");
    expect(normalizeArabicName("رئيف")).toBe("رييف");
  });

  it("unifies Persian/Farsi keyboard variants (ك ي ه‌ variants)", () => {
    expect(normalizeArabicName("محمد كريم")).toBe("محمد كريم"); // U+0643
    expect(normalizeArabicName("محم\u06A9")).toBe("محمك"); // U+06A9 فارسي → ك
    expect(normalizeArabicName("عل\u06CC")).toBe("علي"); // U+06CC فارسي → ي
  });

  it("expands the lam-alef ligature (لا) — النمط المركب", () => {
    expect(normalizeArabicName("\uFEFBد")).toBe("لاد"); // ligature لا + د
    expect(normalizeArabicName("ب\uFEFB")).toBe("بلا");
  });
});

describe("P5-001 — عبد والأرقام والمسافات", () => {
  it("unifies عبد + ال compound forms (عبد الله ≡ عبدالله)", () => {
    expect(normalizeArabicName("عبد الله")).toBe("عبدالله");
    expect(normalizeArabicName("عبدالله")).toBe("عبدالله");
    expect(normalizeArabicName("عبد الرحمن")).toBe("عبدالرحمن");
    expect(normalizeArabicName("عبدالرحمن")).toBe("عبدالرحمن");
    // عبد بلا «ال» لا يتغير: عبد العزيز لقب، وعبدال (شاذ) يبقى
    expect(normalizeArabicName("عبيد")).toBe("عبيد");
  });

  it("converts Arabic-Indic digits to ASCII", () => {
    expect(normalizeArabicName("سعود ١٢٣")).toBe("سعود 123");
    expect(normalizeArabicName("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
  });

  it("collapses whitespace and trims", () => {
    expect(normalizeArabicName("  محمد   أحمد  ")).toBe("محمد احمد");
  });

  it("strips Arabic/Latin punctuation as separators", () => {
    expect(normalizeArabicName("محمد، أحمد")).toBe("محمد احمد");
    expect(normalizeArabicName("محمد-أحمد")).toBe("محمد احمد");
    expect(normalizeArabicName("محمد.أحمد")).toBe("محمد احمد");
  });
});

describe("P5-001 — الحدود الصادقة", () => {
  it("empty and whitespace-only inputs yield empty string — no invention", () => {
    expect(normalizeArabicName("")).toBe("");
    expect(normalizeArabicName("   ")).toBe("");
    expect(normalizeArabicName("ـ ـ")).toBe("");
  });

  it("Latin text passes through unchanged (scope: Arabic names)", () => {
    expect(normalizeArabicName("John Smith")).toBe("John Smith");
    expect(normalizeArabicName("O'Brien Jr.")).toBe("O'Brien Jr"); // النقطة فاصل مثل العربية
  });

  it("mixed Arabic/Latin normalizes the Arabic part only", () => {
    expect(normalizeArabicName("محمد Al-Ahmad")).toBe("محمد Al Ahmad");
  });

  it("deterministic: idempotent (التطبيع مرتين = مرة)", () => {
    const once = normalizeArabicName("عَبْدُ اللهِ الفارسي");
    expect(normalizeArabicName(once)).toBe(once);
  });

  it("titles are NOT stripped by default — هوية لا تُبتر (documented decision)", () => {
    expect(normalizeArabicName("الشيخ محمد")).toBe("الشيخ محمد");
    expect(normalizeArabicName("الدكتور أحمد")).toBe("الدكتور احمد");
  });
});
