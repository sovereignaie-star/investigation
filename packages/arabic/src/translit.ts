/**
 * P5-002 — التحويل الصوتي عربي↔لاتيني (multi-scheme).
 *
 * الأمامي (عربي→لاتيني): جداول حتمية لكل حرف — المخططان المجمدان
 * "ascii" (أحادية الاتجاه بلا غموض، على نهج Buckwalter) و"natural"
 * (تقريب كتابات الوثائق بلا إدخال حركات — الحركات ليست في النص فلا
 * تُخترع). البنية تقبل مخططات إضافية لاحقاً (المخططات الحرفية للمصادر
 * التاريخية مثلاً).
 *
 * العكسي (لاتيني→عربي) ليس ترجمة بل احتمال مطابقة: backtracking يجيب
 * «هل يمكن لهذه الكتابة أن تُنتج هذا الاسم العربي المطبّع بالضبط؟» —
 * لأن الكتابة اللاتينية الواحدة تقبل أشكالاً عربية عدة (Omar/Omer/Umar
 * كلها يمكن أن تنتج عمر). حروف العلة اللاتينية قد تختفي أو تصبح حروفاً
 * مدّية أو عيناً؛ والفواصل قد تختفي. لا تخمين خارج الجداول المعلنة.
 */
import { normalizeArabicName } from "./normalize.ts";

export type TranslitScheme = "ascii" | "natural";

/** جداول الأمامي: حرف → لاتيني لكل مخطط. */
const FORWARD: Record<TranslitScheme, Record<string, string>> = {
  ascii: {
    ا: "a",
    ب: "b",
    ت: "t",
    ث: "th",
    ج: "j",
    ح: "h",
    خ: "kh",
    د: "d",
    ذ: "dh",
    ر: "r",
    ز: "z",
    س: "s",
    ش: "sh",
    ص: "s",
    ض: "d",
    ط: "t",
    ظ: "z",
    ع: "`",
    غ: "gh",
    ف: "f",
    ق: "q",
    ك: "k",
    ل: "l",
    م: "m",
    ن: "n",
    ه: "h",
    و: "w",
    ي: "y",
    ء: "'",
    "0": "0",
    "1": "1",
    "2": "2",
    "3": "3",
    "4": "4",
    "5": "5",
    "6": "6",
    "7": "7",
    "8": "8",
    "9": "9",
  },
  natural: {
    ا: "a",
    ب: "b",
    ت: "t",
    ث: "th",
    ج: "j",
    ح: "h",
    خ: "kh",
    د: "d",
    ذ: "dh",
    ر: "r",
    ز: "z",
    س: "s",
    ش: "sh",
    ص: "s",
    ض: "d",
    ط: "t",
    ظ: "z",
    ع: "a",
    غ: "gh",
    ف: "f",
    ق: "q",
    ك: "k",
    ل: "l",
    م: "m",
    ن: "n",
    ه: "h",
    و: "w",
    ي: "y",
    ء: "",
    "0": "0",
    "1": "1",
    "2": "2",
    "3": "3",
    "4": "4",
    "5": "5",
    "6": "6",
    "7": "7",
    "8": "8",
    "9": "9",
  },
};

/** عربي→لاتيني: حتمي لكل مخطط؛ غير العربي يمر كما هو. */
export function arabicToLatin(name: string, scheme: TranslitScheme): string {
  const table = FORWARD[scheme];
  if (table === undefined) throw new Error(`unknown transliteration scheme: ${String(scheme)}`);
  const normalized = normalizeArabicName(name);
  let out = "";
  for (const ch of normalized) {
    const mapped = table[ch];
    if (mapped === undefined)
      out += ch; // غير العربي يمر
    else out += mapped;
  }
  // natural: الهاء النهائية إن كانت أصلاً تاء مربوطة (ة) تكتب a في الوثائق —
  // لا يطبق على هاء حقيقية (عبدالله لا تنتهي ة)
  if (scheme === "natural" && out.endsWith("h") && name.trim().endsWith("ة")) {
    out = out.slice(0, -1) + "a";
  }
  return out;
}

/* --------------------------------------------------------------- العكسي */

/**
 * قاعدة عكسية: مقطع لاتيني → بدائل عربية. المرتبة بالأطول أولاً (المزدوجات
 * قبل المفردة). حروف العلة والفواصل لها بدائل منها الفارغ.
 */
const REVERSE: Array<{ latin: string; arabic: readonly string[] }> = [
  // مزدوجات شائعة
  { latin: "th", arabic: ["ث", "ذ"] },
  { latin: "kh", arabic: ["خ"] },
  { latin: "sh", arabic: ["ش"] },
  { latin: "gh", arabic: ["غ"] },
  { latin: "dh", arabic: ["ذ", "ظ", "ض"] },
  { latin: "ch", arabic: ["تش", "ج"] },
  { latin: "ss", arabic: ["س", "ص"] },
  // التضعيف الإنجليزي: mm في Muhammad/Alshammari قد تكون م واحدة
  { latin: "mm", arabic: ["مم", "م"] },
  { latin: "nn", arabic: ["نن", "ن"] },
  { latin: "ll", arabic: ["لل", "ل"] },
  { latin: "dd", arabic: ["دد", "د"] },
  { latin: "rr", arabic: ["رر", "ر"] },
  { latin: "tt", arabic: ["تت", "طط", "ت", "ط"] },
  { latin: "aa", arabic: ["ا", "ع"] },
  { latin: "ee", arabic: ["ي"] },
  { latin: "oo", arabic: ["و", "ع"] },
  { latin: "ou", arabic: ["و", "ع"] },
  { latin: "ai", arabic: ["ا", "ع", ""] },
  { latin: "ay", arabic: ["ي", "ا", "ع"] },
  // ال التعريف مكتوبة مع الكلمة
  { latin: "al", arabic: ["ال", "أل", "إل"] },
  // مفردة: صوامت
  { latin: "m", arabic: ["م"] },
  { latin: "h", arabic: ["ه", "ح", "ة"] },
  { latin: "d", arabic: ["د", "ض", "ظ", "ذ"] },
  { latin: "b", arabic: ["ب"] },
  { latin: "t", arabic: ["ت", "ط"] },
  { latin: "s", arabic: ["س", "ص", "ث", "ز"] },
  { latin: "k", arabic: ["ك", "ق", "خ"] },
  { latin: "l", arabic: ["ل"] },
  { latin: "r", arabic: ["ر"] },
  { latin: "n", arabic: ["ن"] },
  { latin: "f", arabic: ["ف"] },
  { latin: "q", arabic: ["ق", "ك"] },
  { latin: "g", arabic: ["ج", "غ", "ق"] },
  { latin: "j", arabic: ["ج"] },
  { latin: "z", arabic: ["ز", "ظ", "ذ", "ض"] },
  { latin: "c", arabic: ["ك", "س", "ق"] },
  { latin: "v", arabic: ["ف"] },
  { latin: "p", arabic: ["ب"] },
  { latin: "x", arabic: ["كس", "س"] },
  { latin: "w", arabic: ["و"] },
  { latin: "y", arabic: ["ي", "اي"] },
  // حروف علة: قد تختفي أو تصبح مدّاً أو عيناً (Omar→عمر) أو همزة/هاء
  // P5-006: تتابعات العين — «Adel» ≡ عادل (عين+ألف تنتجان حرف علة واحداً في اللاتينية)
  // و«Ismail» ≡ إسماعيل (عين+ياء من حرف واحد) — إسماعيل/عادل كانتا تفشلان قبل هذا
  { latin: "a", arabic: ["", "ا", "ي", "ع", "غ", "ء", "ه", "اء", "عا"] },
  { latin: "e", arabic: ["", "ا", "ع", "ي", "ء", "عي"] },
  { latin: "i", arabic: ["", "ا", "ي", "اي", "ع", "ء", "عي"] },
  { latin: "o", arabic: ["", "ا", "و", "ع", "غ", "ء"] },
  { latin: "u", arabic: ["", "ا", "و", "ع", "ء"] },
  // فواصل تختفي
  { latin: " ", arabic: [""] },
  { latin: "-", arabic: [""] },
  { latin: "'", arabic: ["", "ء", "ع"] },
];

/**
 * هل يمكن لـlatin أن تُنتج arabic بالضبط عبر الجداول؟ بحث راجع كامل
 * (لا توليد انفجاري — الهدف يقيّد البحث).
 */
export function latinMatchesArabic(latin: string, arabic: string): boolean {
  const target = normalizeArabicName(arabic);
  const source = latin.toLowerCase();
  const rules = REVERSE;

  const canMatch = (li: number, ai: number, memo: Map<string, boolean> = new Map()): boolean => {
    const key = `${li}:${ai}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let ok = false;
    if (li === source.length && ai === target.length) {
      ok = true;
    } else if (li < source.length) {
      for (const rule of rules) {
        if (!source.startsWith(rule.latin, li)) continue;
        for (const arabicPiece of rule.arabic) {
          if (arabicPiece === "") {
            if (canMatch(li + rule.latin.length, ai, memo)) {
              ok = true;
              break;
            }
          } else if (target.startsWith(arabicPiece, ai)) {
            if (canMatch(li + rule.latin.length, ai + arabicPiece.length, memo)) {
              ok = true;
              break;
            }
          }
        }
        if (ok) break;
      }
    }
    memo.set(key, ok);
    return ok;
  };

  return canMatch(0, 0);
}
