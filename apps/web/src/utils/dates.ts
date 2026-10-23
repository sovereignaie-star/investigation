import { formatGregorianDateAr, formatHijriDateAr, toHijri, type CivilDate } from "@ir/arabic";

/**
 * P5-004 (واجهة): صيغ عرض التواريخ في مساحة العمل.
 *
 * العقد الصادق:
 * - ISO يُقرأ كما سُجّل: التاريخ المدني بمنطوق المصدر ومع إزاحته (لا تحويل صامت
 *   إلى UTC — يوم المصدر هو المرجع).
 * - الوضع الخام (raw، الافتراضي): القيمة كما هي — أقصى دقة، سلوك اليوم نفسه.
 * - خارج جداول أم القرى أو مدخل غير قابل للتحليل: القيمة الخام خاماً — فشل
 *   مغلق صادق في العرض (لا اختراع تحويل ولا استثناء يكسر الواجهة).
 */

/** How workbench timestamps are displayed (P5-004). "raw" is the default. */
export type DateDisplay = "raw" | "greg" | "hijri" | "both";

const CIVIL_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?/;

export interface CivilTime {
  y: number;
  m: number;
  d: number;
  hh: number | null;
  mm: number | null;
}

/**
 * The civil date/time an ISO string declares at its source (its own offset —
 * never silently converted to UTC). Null for unparseable input — no invention.
 */
export function civilFromIso(iso: string): CivilTime | null {
  const m = CIVIL_ISO_RE.exec(iso);
  if (!m) return null;
  const [, ys, ms, ds, hhs, mms] = m;
  const y = Number(ys);
  const mo = Number(ms);
  const d = Number(ds);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return {
    y,
    m: mo,
    d,
    hh: hhs === undefined ? null : Number(hhs),
    mm: mms === undefined ? null : Number(mms),
  };
}

function timePart(c: CivilTime): string {
  if (c.hh === null || c.mm === null) return "";
  return ` · ${String(c.hh).padStart(2, "0")}:${String(c.mm).padStart(2, "0")}`;
}

function datePart(c: CivilDate, pref: DateDisplay): string {
  if (pref === "greg") return formatGregorianDateAr(c);
  const hijri = formatHijriDateAr(toHijri(c));
  if (pref === "hijri") return hijri;
  return `${formatGregorianDateAr(c)} (${hijri})`;
}

/**
 * Formats one workbench timestamp for display. Outside the Umm al-Qura tables
 * (1937-03-13..2077-11-16) or for unparseable input the raw string is returned
 * verbatim — the display never invents a conversion and never throws.
 */
export function formatTimestamp(iso: string, pref: DateDisplay): string {
  if (pref === "raw") return iso;
  const civil = civilFromIso(iso);
  if (!civil) return iso;
  try {
    return datePart(civil, pref) + timePart(civil);
  } catch {
    // Out-of-table dates (before 1356H / after 1500H): fail-closed honest display.
    return iso;
  }
}
