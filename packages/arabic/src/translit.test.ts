import { describe, expect, it } from "vitest";

import { normalizeArabicName } from "./normalize.ts";
import { arabicToLatin, latinMatchesArabic, type TranslitScheme } from "./translit.ts";

/**
 * P5-002 — التحويل الصوتي عربي↔لاتيني متعدد المخططات.
 *
 * الاتجاه الأمامي (عربي→لاتيني): مخططان حتميان (ascii الأكاديمي وnatural
 * الشائع في الوثائق السعودية) — كل حرف/مزدوج بقاعدة معلنة.
 *
 * الاتجاه العكسي (لاتيني→عربي) ليس ترجماً بل مطابقة احتمالية: البحث الراجع
 * يجيب «هل يمكن لهذه الكتابة اللاتينية أن تُنتج هذا الاسم العربي بالضبط؟» —
 * والاستدعاء (recall) هو معيار القبول: على المجموعة الذهبية (أزواج كتابات
 * لاتينية شائعة ↔ أسماء عربية سعودية) يطابق المخطط ≥ 0.95 من الأزواج.
 * مجموعة P5-006 (2000 زوج) ستوسّع هذا لاحقاً.
 */

describe("P5-002 — الاتجاه الأمامي: عربي→لاتيني (مخططان حتميان)", () => {
  const cases: Array<[string, string, string]> = [
    // [العربية (مطبّعة), ascii (بكوولتر مبسط), natural (وثائقي تقريبي بلا إدخال حركات)]
    ["محمد", "mhmd", "mhmd"],
    ["احمد", "ahmd", "ahmd"],
    ["خالد", "khald", "khald"],
    ["فاطمة", "fatmh", "fatma"],
    ["علي", "`ly", "aly"],
    ["عبدالله", "`bdallh", "abdallh"],
    ["الشمراني", "alshmrany", "alshmrany"],
    ["نورة", "nwrh", "nwra"],
  ];
  it.each(cases)("%s → %s (ascii)", (ar, ascii) => {
    expect(arabicToLatin(ar, "ascii" as TranslitScheme)).toBe(ascii);
  });
  it.each(cases)("%s → %s (natural)", (_ar, _ascii, natural) => {
    expect(arabicToLatin(_ar, "natural" as TranslitScheme)).toBe(natural);
  });

  it("unknown schemes are refused loudly — no silent fallback", () => {
    expect(() => arabicToLatin("محمد", "nope" as TranslitScheme)).toThrow();
  });

  it("non-Arabic characters pass through unchanged", () => {
    expect(arabicToLatin("John", "ascii")).toBe("John");
  });
});

describe("P5-002 — الاتجاه العكسي: هل يمكن أن تُنتج هذه الكتابة هذا الاسم؟", () => {
  it("exact production via backtracking — vowel letters may vanish or become long vowels/ayn", () => {
    expect(latinMatchesArabic("Muhammad", "محمد")).toBe(true);
    expect(latinMatchesArabic("Omar", "عمر")).toBe(true);
    expect(latinMatchesArabic("Ali", "علي")).toBe(true);
    expect(latinMatchesArabic("Alharbi", "الحربي")).toBe(true);
  });

  it("spaces and hyphens are separators that may vanish (Abdul Aziz ≡ Abdulaziz)", () => {
    expect(latinMatchesArabic("Abdul Aziz", "عبدالعزيز")).toBe(true);
    expect(latinMatchesArabic("Al-Qahtani", "القحطاني")).toBe(true);
  });

  it("a different name is honestly rejected (no forced match)", () => {
    expect(latinMatchesArabic("Khalid", "محمد")).toBe(false);
    expect(latinMatchesArabic("Omar", "علي")).toBe(false);
  });
});

describe("P5-002 — معيار القبول: recall ≥ 0.95 على المجموعة الذهبية", () => {
  /**
   * المجموعة الذهبية: كتابات لاتينية شائعة فعلاً (وثائق/جوازات/نطق سعودي)
   * مقابل الاسم العربي المطبّع. كل زوج حالة استخدام حقيقية لا اختراع نظري.
   */
  const GOLDEN: Array<[latin: string, arabic: string]> = [
    ["Muhammad", "محمد"],
    ["Mohammed", "محمد"],
    ["Mohamed", "محمد"],
    ["Muhamed", "محمد"],
    ["Ahmad", "أحمد"],
    ["Ahmed", "أحمد"],
    ["Abdullah", "عبدالله"],
    ["Abdallah", "عبدالله"],
    ["Abdulaziz", "عبدالعزيز"],
    ["Abdul Aziz", "عبدالعزيز"],
    ["Khalid", "خالد"],
    ["Khaled", "خالد"],
    ["Fatima", "فاطمة"],
    ["Fatimah", "فاطمة"],
    ["Fatma", "فاطمة"],
    ["Noura", "نورة"],
    ["Nora", "نورة"],
    ["Nourah", "نورة"],
    ["Salman", "سلمان"],
    ["Turki", "تركي"],
    ["Saud", "سعود"],
    ["Saleh", "صالح"],
    ["Salih", "صالح"],
    ["Alharbi", "الحربي"],
    ["Al Harbi", "الحربي"],
    ["Alqahtani", "القحطاني"],
    ["Al Qahtani", "القحطاني"],
    ["Alghamdi", "الغامدي"],
    ["Al Ghamdi", "الغامدي"],
    ["Alshammari", "الشمري"],
    ["Al Shammari", "الشمري"],
    ["Sara", "سارة"],
    ["Sarah", "سارة"],
    ["Reem", "ريم"],
    ["Layan", "ليان"],
    ["Hind", "هند"],
    ["Maha", "مها"],
    ["Omar", "عمر"],
    ["Omer", "عمر"],
    ["Umar", "عمر"],
    ["Ali", "علي"],
    ["Hassan", "حسن"],
    ["Hasan", "حسن"],
    ["Hussein", "حسين"],
    ["Hussain", "حسين"],
    ["Ibrahim", "إبراهيم"],
    ["Ebrahim", "إبراهيم"],
    ["Majed", "ماجد"],
    ["Majid", "ماجد"],
    ["Bandar", "بندر"],
    ["Mishal", "مشعل"],
    ["Osama", "أسامة"],
    ["Usama", "أسامة"],
    ["Yousef", "يوسف"],
    ["Yusuf", "يوسف"],
    ["Youssef", "يوسف"],
    ["Zainab", "زينب"],
    ["Zeinab", "زينب"],
    ["Latifa", "لطيفة"],
    ["Latifah", "لطيفة"],
    ["Manal", "منال"],
    ["Jawaher", "جواهر"],
    ["Aisha", "عائشة"],
    ["Aysha", "عائشة"],
    ["Asma", "أسماء"],
    ["Ghada", "غادة"],
    ["Suad", "سعاد"],
    ["Soad", "سعاد"],
    ["Jamal", "جمال"],
    ["Gamal", "جمال"],
    ["Talal", "طلال"],
    ["Nawaf", "نواف"],
    ["Faisal", "فيصل"],
    ["Feisal", "فيصل"],
    ["Haya", "هيا"],
    ["Dana", "دانة"],
    ["Danah", "دانة"],
    ["Rahaf", "رهف"],
    ["Wadha", "وضحى"],
  ];

  it("≥ 0.95 of the golden pairs match (the acceptance)", () => {
    const results = GOLDEN.map(([latin, arabic]) => latinMatchesArabic(latin, normalizeArabicName(arabic)));
    const hits = results.filter(Boolean).length;
    const recall = hits / GOLDEN.length;
    // نطبع الأزواج الفائتة بصدق لا نخفيها
    const missed = GOLDEN.filter((_, i) => !results[i]);
    if (recall < 0.95) console.log("مفقودات:", JSON.stringify(missed));
    expect(recall).toBeGreaterThanOrEqual(0.95);
  });
});
