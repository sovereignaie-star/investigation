import umalqura from "@umalqura/core";

/**
 * P5-004: الهجري وتنسيق التواريخ — تحويل أم القرى وتنسيقات عربية/إنجليزية.
 *
 * المرجع: جداول أم القرى (تنفيذ `@umalqura/core`، MIT، بلا اعتماديات) الصالحة
 * من 1 محرم 1356هـ = 1937-03-13 إلى 30 ذي الحجة 1500هـ = 2077-11-16. المكتبة
 * تقبل مدخلات أقدم وتقرّح بالاستقراء — مرفوض هنا: الحارس أدناه يفرض النطاق
 * فشلاً مغلقاً قبل أي استقراء (T-AR-H-005). تحقق متقاطع مقيس: مطابقة كاملة مع
 * `Intl` بميلاد `islamic-umalqura` على 2000..2030 (11,323 يوماً، صفر انحراف)؛
 * خارج تلك النافذة تنحرف Intl ±يوم واحد عن الجداول — الجداول هي المرجع المعلن
 * والانحراف موثق في DECLARED_LIMITS (L-72).
 *
 * كل الدوال مدنية (CivilDate/HijriDate بأرقام صريحة) — لا Date ولا منطقة
 * زمنية: التحويل دالة في التاريخ المدني كما كُتب، حتمي في أي بيئة تشغيل.
 */

/** A Gregorian civil date (1-based month and day). */
export interface CivilDate {
  y: number;
  m: number;
  d: number;
}

/** A Hijri (Umm al-Qura) civil date (1-based month and day). */
export interface HijriDate {
  hy: number;
  hm: number;
  hd: number;
}

/** The supported Umm al-Qura table range (fail-closed outside it). */
export const HIJRI_RANGE = {
  minHy: 1356,
  maxHy: 1500,
  /** 1 Muharram 1356 as a civil date. */
  minCivil: { y: 1937, m: 3, d: 13 } as CivilDate,
  /** 30 Dhu al-Hijjah 1500 as a civil date. */
  maxCivil: { y: 2077, m: 11, d: 16 } as CivilDate,
} as const;

/** Arabic month names (Gulf usage — the workbench is Arabic-first). */
export const GREGORIAN_MONTHS_AR: readonly string[] = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

/** Hijri month names (Umm al-Qura), 1-based index helper below. */
export const HIJRI_MONTHS_AR: readonly string[] = [
  "محرم",
  "صفر",
  "ربيع الأول",
  "ربيع الآخر",
  "جمادى الأولى",
  "جمادى الآخرة",
  "رجب",
  "شعبان",
  "رمضان",
  "شوال",
  "ذو القعدة",
  "ذو الحجة",
];

const HIJRI_MONTHS_EN: readonly string[] = [
  "Muharram",
  "Safar",
  "Rabi' al-Awwal",
  "Rabi' al-Thani",
  "Jumada al-Ula",
  "Jumada al-Akhirah",
  "Rajab",
  "Sha'ban",
  "Ramadan",
  "Shawwal",
  "Dhu al-Qi'dah",
  "Dhu al-Hijjah",
];

const GREGORIAN_MONTHS_EN: readonly string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function assertMonthIndex(hm: number): void {
  if (!Number.isInteger(hm) || hm < 1 || hm > 12) {
    throw new RangeError(`شهر هجري غير صالح: ${hm} (المسموح 1..12)`);
  }
}

function assertHijriDate(h: HijriDate): void {
  assertMonthIndex(h.hm);
  if (!Number.isInteger(h.hd) || h.hd < 1 || h.hd > 30) {
    throw new RangeError(`يوم هجري غير صالح: ${h.hd} (المسموح 1..30)`);
  }
  if (!Number.isInteger(h.hy) || h.hy < HIJRI_RANGE.minHy || h.hy > HIJRI_RANGE.maxHy) {
    throw new RangeError(`سنة هجرية خارج جداول أم القرى (${HIJRI_RANGE.minHy}..${HIJRI_RANGE.maxHy}هـ): ${h.hy}`);
  }
}

function civilToUtcMs(c: CivilDate): number {
  return Date.UTC(c.y, c.m - 1, c.d);
}

function isWithinCivilRange(c: CivilDate): boolean {
  const t = civilToUtcMs(c);
  return t >= civilToUtcMs(HIJRI_RANGE.minCivil) && t <= civilToUtcMs(HIJRI_RANGE.maxCivil);
}

/** The Hijri month name in Arabic (1-based). */
export function hijriMonthNameAr(hm: number): string {
  assertMonthIndex(hm);
  return HIJRI_MONTHS_AR[hm - 1];
}

/**
 * Civil Gregorian date → Hijri (Umm al-Qura). Throws RangeError outside the
 * official tables (before 1937-03-13 / after 2077-11-16) — fail-closed, no
 * extrapolation (the underlying library would extrapolate; we refuse).
 */
export function toHijri(civil: CivilDate): HijriDate {
  if (!isWithinCivilRange(civil)) {
    throw new RangeError(
      `تاريخ خارج جداول أم القرى (${HIJRI_RANGE.minCivil.y}-${HIJRI_RANGE.minCivil.m}-${HIJRI_RANGE.minCivil.d} .. ${HIJRI_RANGE.maxCivil.y}-${HIJRI_RANGE.maxCivil.m}-${HIJRI_RANGE.maxCivil.d}): ${civil.y}-${civil.m}-${civil.d}`,
    );
  }
  // Civil noon in the runtime's local zone: the local getters the library reads
  // always see the intended civil date in any timezone (noon never crosses a
  // day under any real offset, and DST shifts are ≤ 2h).
  const local = new Date(civil.y, civil.m - 1, civil.d, 12, 0, 0, 0);
  const u = umalqura(local);
  return { hy: u.hy, hm: u.hm, hd: u.hd };
}

/** Hijri (Umm al-Qura) → civil Gregorian date. Throws RangeError outside the tables. */
export function fromHijri(h: HijriDate): CivilDate {
  assertHijriDate(h);
  // The static converter returns civil numbers directly — no Date, no timezone.
  const g = umalqura.$.hijriToGregorian(h.hy, h.hm, h.hd);
  const civil: CivilDate = { y: g.gy, m: g.gm + 1, d: g.gd };
  // Silent roll-over guard: a day-30 in a 29-day month would slide into the next
  // month inside the library — refused loudly instead of accepted silently.
  const back = toHijri(civil);
  if (back.hy !== h.hy || back.hm !== h.hm || back.hd !== h.hd) {
    throw new RangeError(`تاريخ هجري غير موجود في جداول أم القرى: ${h.hy}-${h.hm}-${h.hd}`);
  }
  return civil;
}

/** "12 جمادى الأولى 1448هـ" — ASCII digits, Arabic month name, هـ suffix. */
export function formatHijriDateAr(h: HijriDate): string {
  assertHijriDate(h);
  return `${h.hd} ${hijriMonthNameAr(h.hm)} ${h.hy}هـ`;
}

/** "23 October 2026" — for the en locale. */
export function formatGregorianDateEn(c: CivilDate): string {
  return `${c.d} ${GREGORIAN_MONTHS_EN[c.m - 1]} ${c.y}`;
}

/** "12 Jumada al-Ula 1448 AH" — for the en locale. */
export function formatHijriDateEn(h: HijriDate): string {
  assertHijriDate(h);
  return `${h.hd} ${HIJRI_MONTHS_EN[h.hm - 1]} ${h.hy} AH`;
}

/** "23 أكتوبر 2026" — Arabic month names, ASCII digits. */
export function formatGregorianDateAr(c: CivilDate): string {
  return `${c.d} ${GREGORIAN_MONTHS_AR[c.m - 1]} ${c.y}`;
}
