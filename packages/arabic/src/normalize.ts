/**
 * P5-001 — تطبيع الأسماء العربية (orthographic normalization only).
 *
 * The goal: two spellings of the SAME name must normalize to one string —
 * the basis of P5-002/003 (transliteration and name matching). What this
 * module deliberately does NOT do (documented decisions, not omissions):
 * - it does NOT strip honorific titles (الشيخ، السيد، الدكتور) — a title is
 *   part of a person's identity in an investigation; stripping it could MERGE
 *   two different people. The caller decides.
 * - it does NOT reorder name parts (اسم اللقب) or split/merge tokens beyond
 *   the عبد compound (the single documented case).
 *
 * Every rule below is standard Arabic text-search normalization; each is
 * applied in a fixed order so the result is idempotent (tested).
 */

/** Tashkeel (U+064B–U+0652), tatweel, superscript alef, soft hyphen. */
const DIACRITICS = /[\u064B-\u0652\u0670\u0640\u00AD]/g;

/** Single-character letter unifications (applied after NFKC). */
const LETTER_MAP: Record<string, string> = {
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ٱ: "ا", // ألف بمهمزة/مدّة → ألف
  ة: "ه", // تاء مربوطة → هاء (مطابقة الأسماء: فاطمة ≡ فاطمه)
  ى: "ي", // ألف مقصورة → ياء
  ؤ: "و",
  ئ: "ي", // همزات على حروف مدّ
  "\u06A9": "ك", // الكاف الفارسية (كيبورد فارسي) → كاف
  "\u06CC": "ي", // الياء الفارسية → ياء
};

/** Arabic-Indic and extended Arabic-Indic digits → ASCII. */
const DIGIT_MAP: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

/** Punctuation (Arabic and Latin) becomes a separator. */
const PUNCTUATION = /[\u060C\u061B\u061F.,؛:;!?()[\]{}،ـ-]/g;

/** حذف التشكيل والتطويل فقط — يُستقل لمن يحتاج الطبقة الأولى وحدها. */
export function stripDiacritics(text: string): string {
  return text.normalize("NFKC").replace(DIACRITICS, "");
}

/**
 * تطبيع اسم عربي للخط الأساسي: التشكيل والتطويل، توحيد الحروف
 * (ألفات/همزات/تاء مربوطة/مقصورة/فارسيات)، رقعة اللام-ألف، أرقام هندية،
 * فواصل، مسافات، وضم «عبد» بـ«ال».
 */
export function normalizeArabicName(name: string): string {
  let out = name.normalize("NFKC"); // يفك لا المركبة ويوحّد أشكال العرض
  out = out.replace(DIACRITICS, "");
  // ligature-form لا قد تبقى بعد NFKC في مدخلات نادرة — فك صريح
  out = out
    .replace(/\uFEFB/g, "لا")
    .replace(/\uFEFC/g, "لا")
    .replace(/\uFEF7/g, "لأ")
    .replace(/\uFEF8/g, "لأ")
    .replace(/\uFEF9/g, "لإ")
    .replace(/\uFEFA/g, "لإ")
    .replace(/\uFEF5/g, "لآ")
    .replace(/\uFEF6/g, "لآ");
  out = out.replace(DIACRITICS, ""); // ما فكّه NFKC من تشكيل عاد ظاهراً
  out = out.replace(PUNCTUATION, " ");
  out = Array.from(out)
    .map((ch) => LETTER_MAP[ch] ?? DIGIT_MAP[ch] ?? ch)
    .join("");
  // ضم «عبد» بـ«ال»: «عبد الله» ≡ «عبدالله» — الحالة الموثقة الوحيدة
  out = out.replace(/(^|\s)عبد\s+ال/g, "$1عبدال");
  // النسب المختصر: «ابن» ≡ «بن» (كلاهما "ابن فلان" — الصيغة الكلاسيكية والمختصرة
  // لنفس التركيب) — P5-006: متطلب D5 الصريح «مطابقة بن/ابن/بنت»
  out = out.replace(/(^|\s)ابن(?=\s|$)/g, "$1بن");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}
