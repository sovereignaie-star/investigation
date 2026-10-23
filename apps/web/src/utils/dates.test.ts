import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { civilFromIso, formatTimestamp } from "./dates";

/**
 * P5-004 (واجهة): صيغ عرض التواريخ في مساحة العمل — ميلادي/هجري (أم القرى)/كلاهما.
 * كُتبت قبل أي تنفيذ (أحمر أولاً): `dates.ts` غير موجود أصلاً.
 *
 * العقد: ISO يُقرأ كما سُجّل (تاريخه المدني بمنطوقه ومع إزاحته — لا تحويل صامت)،
 * والقيمة الخام تبقى في title (لا فقد دقة)، والمدخل غير القابل للتحليل يُعرض خاماً
 * كما هو (لا اختراع تحويل).
 */

describe("civilFromIso", () => {
  it("Z: التاريخ المدني بتوقيت UTC والوقت كما سُجّل", () => {
    expect(civilFromIso("2026-10-23T08:05:00Z")).toEqual({ y: 2026, m: 10, d: 23, hh: 8, mm: 5 });
  });

  it("إزاحة صريحة: التاريخ المدني بمنطوق المصدر لا بـ UTC", () => {
    expect(civilFromIso("2026-03-02T09:00:00-05:00")).toEqual({ y: 2026, m: 3, d: 2, hh: 9, mm: 0 });
    expect(civilFromIso("2026-10-23T23:30:00+03:00")).toEqual({ y: 2026, m: 10, d: 23, hh: 23, mm: 30 });
  });

  it("تاريخ فقط بلا وقت: hh/mm فارغة", () => {
    expect(civilFromIso("2019-01-01")).toEqual({ y: 2019, m: 1, d: 1, hh: null, mm: null });
  });

  it("مدخل غير قابل للتحليل: null صادق — لا اختراع", () => {
    expect(civilFromIso("not-a-date")).toBeNull();
    expect(civilFromIso("")).toBeNull();
  });
});

describe("formatTimestamp", () => {
  it("raw (الافتراضي): القيمة كما هي — لا تحويل صامت للدقة", () => {
    expect(formatTimestamp("2026-03-01T10:00:00Z", "raw")).toBe("2026-03-01T10:00:00Z");
  });

  it("greg: اليوم اسم-الشهر السنة · الوقت", () => {
    expect(formatTimestamp("2026-03-01T10:00:00Z", "greg")).toBe("1 مارس 2026 · 10:00");
  });

  it("hijri: أم القرى · الوقت", () => {
    expect(formatTimestamp("2026-10-23T08:05:00Z", "hijri")).toBe("12 جمادى الأولى 1448هـ · 08:05");
  });

  it("both: الميلادي بين قوسين ثم الهجري", () => {
    expect(formatTimestamp("2026-10-23T08:05:00Z", "both")).toBe("23 أكتوبر 2026 (12 جمادى الأولى 1448هـ) · 08:05");
  });

  it("الإزاحة تُحترم: يوم المصدر هو المرجع لا يوم UTC", () => {
    // 2026-10-23T22:30:00-05:00 = 2026-10-24T03:30Z — اليوم المدني المسجل هو 23
    expect(formatTimestamp("2026-10-23T22:30:00-05:00", "hijri")).toBe("12 جمادى الأولى 1448هـ · 22:30");
  });

  it("مدخل غير قابل للتحليل يُعرض خاماً — لا اختراع ولا استثناء في الواجهة", () => {
    expect(formatTimestamp("not-a-date", "hijri")).toBe("not-a-date");
  });

  it("خارج جداول أم القرى (قبل 1356هـ): القيمة الخام خاماً — فشل مغلق صادق", () => {
    expect(formatTimestamp("1910-06-01T00:00:00Z", "hijri")).toBe("1910-06-01T00:00:00Z");
    expect(formatTimestamp("1910-06-01T00:00:00Z", "both")).toBe("1910-06-01T00:00:00Z");
  });
});

describe("formatTimestamp — تفضيل الواجهة (متجر التخزين)", () => {
  // بيئة العرض بلا متصفح: تخزين محلي مُحاكى (نفس عقد الوصول المحمي في المتجر)
  const backing = new Map<string, string>();
  const localStorageStub = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => {
      backing.set(k, String(v));
    },
    clear: () => backing.clear(),
  };

  beforeEach(() => {
    vi.stubGlobal("localStorage", localStorageStub);
    backing.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    backing.clear();
  });

  it("الافتراضي خام (raw)، والتغيير يُخزن ويُبَلَّغ عنه", async () => {
    const store = await import("../store/dateFormatStore");
    expect(store.getDateFormat()).toBe("raw");
    let notified = 0;
    const off = store.subscribeDateFormat(() => {
      notified += 1;
    });
    store.setDateFormat("hijri");
    expect(notified).toBe(1);
    expect(store.getDateFormat()).toBe("hijri");
    expect(localStorageStub.getItem("ir.ui.date-format")).toBe('"hijri"');
    off();
    // قيمة غير صالحة من التخزين تُتجاهل — الافتراضي الصادق
    localStorageStub.setItem("ir.ui.date-format", '"nope"');
    expect(store.readStoredDateFormat()).toBe("raw");
  });
});
