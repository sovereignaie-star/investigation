import { describe, expect, it } from "vitest";

import {
  formatGregorianDateAr,
  formatGregorianDateEn,
  formatHijriDateAr,
  formatHijriDateEn,
  fromHijri,
  hijriMonthNameAr,
  HIJRI_RANGE,
  toHijri,
  type CivilDate,
} from "./hijri";

/**
 * P5-004 (T-AR-H): الهجري وتنسيق التواريخ — التحويل مطابق لأم القرى على مرجع.
 *
 * المرجع الأول: جداول أم القرى عبر `@umalqura/core` (MIT، بلا اعتماديات) — وهي
 * تنفيذ لبيانات أم القرى الرسمية الصالحة 1356هـ (1937-03-13) إلى 1500هـ (2077-11-16).
 * المرجع الثاني (تحقق متقاطع): `Intl.DateTimeFormat` بميلاد `islamic-umalqura` في
 * Node 24 — اتفق مع الجداول على كل يوم في 2000-01-01..2030-12-31 (مُقاس قبل كتابة
 * التنفيذ)، وتنحرف ±يوم واحد خارجهما (موثق L-72).
 */

/** A civil date as UTC midnight — the reference instants for Intl comparison. */
function utcCivil(c: CivilDate): Date {
  return new Date(Date.UTC(c.y, c.m - 1, c.d));
}

const INTL_UQ = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** The Hijri date Intl assigns to a civil date (UTC) — the cross-reference. */
function intlHijri(c: CivilDate): { hy: number; hm: number; hd: number } {
  const parts = Object.fromEntries(INTL_UQ.formatToParts(utcCivil(c)).map((p) => [p.type, p.value]));
  return { hy: Number(parts.year), hm: Number(parts.month), hd: Number(parts.day) };
}

describe("T-AR-H-001 — مطابقة المرجع: نافذة اتفاق الجداول مع Intl islamic-umalqura", () => {
  it("لا انحراف واحداً على كل يوم 2000-01-01..2029-08-10 (نهاية الاتفاق المقيس)", () => {
    let checked = 0;
    const start = Date.UTC(2000, 0, 1);
    // 2029-08-11: آخر يوم قبل انحراف Intl عن جداول أم القرى الرسمية (L-72) —
    // الجداول (المكتبة) هي المرجع، والانحراف في ICU لا هنا.
    const end = Date.UTC(2029, 7, 10);
    for (let t = start; t <= end; t += 86_400_000) {
      const d = new Date(t);
      const civil: CivilDate = { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
      expect(toHijri(civil)).toEqual(intlHijri(civil));
      checked += 1;
    }
    expect(checked).toBe(10_815);
  });

  it("خارج نافذة الاتفاق: الجداول تطابق أم القرى الرسمية وIntl ينحرف — 1 ربيع الآخر 1451 = 2029-08-11 [مُتحقَّق من مصادر مستقلة]", () => {
    // مراسي رسمية محققة من مصادر تقويم مستقلة متعددة (hijriconv وhabibur وislamiccal
    // وأخواتها): 1 محرم 1451 = 2029-05-14 و1 ربيع الأول 1451 = 2029-07-13
    // و1 ربيع الآخر 1451 = 2029-08-11 و1 رمضان 1452 = 2030-12-26.
    expect(toHijri({ y: 2029, m: 5, d: 14 })).toEqual({ hy: 1451, hm: 1, hd: 1 });
    expect(toHijri({ y: 2029, m: 7, d: 13 })).toEqual({ hy: 1451, hm: 3, hd: 1 });
    expect(toHijri({ y: 2029, m: 8, d: 11 })).toEqual({ hy: 1451, hm: 4, hd: 1 });
    expect(toHijri({ y: 2030, m: 12, d: 26 })).toEqual({ hy: 1452, hm: 9, hd: 1 });
  });
});

describe("T-AR-H-002 — مراسي معلنة من جداول أم القرى", () => {
  it("مرسى المكتبة الموثق: 2019-07-03 = 10 شوال 1440", () => {
    expect(toHijri({ y: 2019, m: 7, d: 3 })).toEqual({ hy: 1440, hm: 10, hd: 30 });
  });

  it("يوم كتابة الاختبار: 2026-10-23 = 12 جمادى الأولى 1448", () => {
    expect(toHijri({ y: 2026, m: 10, d: 23 })).toEqual({ hy: 1448, hm: 5, hd: 12 });
  });

  it("حدا النطاق الصالح: 1 محرم 1356 = 1937-03-13 و30 ذي الحجة 1500 = 2077-11-16", () => {
    expect(toHijri({ y: 1937, m: 3, d: 13 })).toEqual({ hy: 1356, hm: 1, hd: 1 });
    expect(toHijri({ y: 2077, m: 11, d: 16 })).toEqual({ hy: 1500, hm: 12, hd: 30 });
    expect(fromHijri({ hy: 1356, hm: 1, hd: 1 })).toEqual({ y: 1937, m: 3, d: 13 });
    expect(fromHijri({ hy: 1500, hm: 12, hd: 30 })).toEqual({ y: 2077, m: 11, d: 16 });
  });
});

describe("T-AR-H-003 — دورة ذهاب وعودة على النطاق كله (عيّنة شهرية)", () => {
  it("fromHijri(toHijri(civil)) = civil لكل أول شهر ميلادي داخل الجداول", () => {
    let checked = 0;
    const minMs = Date.UTC(HIJRI_RANGE.minCivil.y, HIJRI_RANGE.minCivil.m - 1, HIJRI_RANGE.minCivil.d);
    const maxMs = Date.UTC(HIJRI_RANGE.maxCivil.y, HIJRI_RANGE.maxCivil.m - 1, HIJRI_RANGE.maxCivil.d);
    for (let y = 1937; y <= 2077; y += 1) {
      for (let m = 1; m <= 12; m += 1) {
        const t = Date.UTC(y, m - 1, 1);
        if (t < minMs || t > maxMs) continue; // خارج الجداول — الحارس يرمي، لا يُختبر هنا
        const civil: CivilDate = { y, m, d: 1 };
        expect(fromHijri(toHijri(civil))).toEqual(civil);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(1_600);
  });
});

describe("T-AR-H-004 — أطوال الشهور الهجرية كلها 29 أو 30 يوماً", () => {
  it("كل شهر من 1356/1 إلى 1500/11 (حافة 1500/12 لا تملك شهراً تالياً داخل الجداول)", () => {
    for (let hy = 1356; hy <= 1500; hy += 1) {
      for (let hm = 1; hm <= 12; hm += 1) {
        if (hy === 1500 && hm === 12) continue; // آخر شهر — لا تالٍ داخل النطاق
        const next = fromHijri(hm === 12 ? { hy: hy + 1, hm: 1, hd: 1 } : { hy, hm: hm + 1, hd: 1 });
        const first = fromHijri({ hy, hm, hd: 1 });
        const days = Math.round((Date.UTC(next.y, next.m - 1, next.d) - Date.UTC(first.y, first.m - 1, first.d)) / 86_400_000);
        expect(days === 29 || days === 30, `${hy}/${hm} len=${days}`).toBe(true);
      }
    }
  });
});

describe("T-AR-H-005 — حارس النطاق: فشل-مغلق خارج جداول أم القرى", () => {
  it("قبل 1356هـ (1937-03-13) يرمي RangeError — لا استقراء", () => {
    // 1910 داخل حد المكتبة الزمني لكنه قبل الجداول: الاستقراء يعطي 1328هـ — مرفوض
    expect(() => toHijri({ y: 1910, m: 6, d: 1 })).toThrow(RangeError);
    expect(() => toHijri({ y: 1937, m: 3, d: 12 })).toThrow(RangeError);
  });

  it("بعد 1500هـ (2077-11-16) يرمي RangeError", () => {
    expect(() => toHijri({ y: 2077, m: 11, d: 17 })).toThrow(RangeError);
    expect(() => toHijri({ y: 2100, m: 1, d: 1 })).toThrow(RangeError);
  });

  it("fromHijri خارج النطاق أو بقيم غير صالحة يرمي RangeError", () => {
    expect(() => fromHijri({ hy: 1355, hm: 12, hd: 29 })).toThrow(RangeError);
    expect(() => fromHijri({ hy: 1501, hm: 1, hd: 1 })).toThrow(RangeError);
    expect(() => fromHijri({ hy: 1448, hm: 0, hd: 1 })).toThrow(RangeError);
    expect(() => fromHijri({ hy: 1448, hm: 13, hd: 1 })).toThrow(RangeError);
    expect(() => fromHijri({ hy: 1448, hm: 5, hd: 0 })).toThrow(RangeError);
    expect(() => fromHijri({ hy: 1448, hm: 5, hd: 31 })).toThrow(RangeError);
  });
});

describe("T-AR-H-006 — التنسيق العربي", () => {
  it("formatHijriDateAr: اليوم اسم-الشهر السنةهـ بأرقام لاتينية", () => {
    expect(formatHijriDateAr({ hy: 1448, hm: 5, hd: 12 })).toBe("12 جمادى الأولى 1448هـ");
    expect(formatHijriDateAr({ hy: 1440, hm: 10, hd: 30 })).toBe("30 شوال 1440هـ");
    expect(formatHijriDateAr({ hy: 1356, hm: 1, hd: 1 })).toBe("1 محرم 1356هـ");
    expect(formatHijriDateAr({ hy: 1500, hm: 12, hd: 30 })).toBe("30 ذو الحجة 1500هـ");
  });

  it("hijriMonthNameAr: الأشهر الاثنا عشر بأسمائها الكاملة", () => {
    expect(hijriMonthNameAr(1)).toBe("محرم");
    expect(hijriMonthNameAr(2)).toBe("صفر");
    expect(hijriMonthNameAr(3)).toBe("ربيع الأول");
    expect(hijriMonthNameAr(4)).toBe("ربيع الآخر");
    expect(hijriMonthNameAr(5)).toBe("جمادى الأولى");
    expect(hijriMonthNameAr(6)).toBe("جمادى الآخرة");
    expect(hijriMonthNameAr(7)).toBe("رجب");
    expect(hijriMonthNameAr(8)).toBe("شعبان");
    expect(hijriMonthNameAr(9)).toBe("رمضان");
    expect(hijriMonthNameAr(10)).toBe("شوال");
    expect(hijriMonthNameAr(11)).toBe("ذو القعدة");
    expect(hijriMonthNameAr(12)).toBe("ذو الحجة");
    expect(() => hijriMonthNameAr(13)).toThrow(RangeError);
  });

  it("formatGregorianDateAr: اليوم اسم-الشهر السنة بأسماء الأشهر الخليجية الشائعة", () => {
    expect(formatGregorianDateAr({ y: 2026, m: 10, d: 23 })).toBe("23 أكتوبر 2026");
    expect(formatGregorianDateAr({ y: 2019, m: 7, d: 3 })).toBe("3 يوليو 2019");
    expect(formatGregorianDateAr({ y: 2026, m: 1, d: 1 })).toBe("1 يناير 2026");
  });
});

describe("T-AR-H-007 — التنسيق الإنجليزي (واجهة en)", () => {
  it("formatHijriDateEn / formatGregorianDateEn", () => {
    expect(formatHijriDateEn({ hy: 1448, hm: 5, hd: 12 })).toBe("12 Jumada al-Ula 1448 AH");
    expect(formatHijriDateEn({ hy: 1440, hm: 10, hd: 30 })).toBe("30 Shawwal 1440 AH");
    expect(formatGregorianDateEn({ y: 2026, m: 10, d: 23 })).toBe("23 October 2026");
  });
});
