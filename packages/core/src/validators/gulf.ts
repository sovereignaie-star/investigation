import { checkIban, type IbanResult } from "./iban.ts";
import { luhn } from "./luhn.ts";

/**
 * P5-005: الصيغ المحلية الخليجية — مدققات على قواعد علنية موثقة المصدر.
 *
 * كل قاعدة هنا مسندة إلى مصدر علني (موثقة في docs/evidence/2026-10-23-P5-005-red.md):
 * - الهوية/الإقامة السعودية: خانة تحقق Luhn (انظر SAUDI_ID_LUHN_NOTE).
 * - الهواتف: خطط الترقيم الوطنية (CST السعودية وTDRA الإمارات وITU) — نطاقات
 *   الأوائل المخصصة والأطوال الرسمية؛ الأوائل غير المخصصة ترفض.
 * - IBAN: سجل SWIFT الرسمي (الطول + بنية BBAN + mod-97 + مطابقة الدولة).
 * - السجل التجاري: صيغة 10 خانات فقط — لا خانة تحقق علنية موجودة (موثق بصدق).
 * - الرقم الضريبي السعودي: 15 خانة تبدأ وتنتهي بـ3 (توثيق ZATCA للفاتورة الإلكترونية).
 *
 * كل مدقق دالة صرفة في القيمة المقيسة (normalized) — لا حالة ولا اعتماد على المدخلات الخام.
 */

export type Validation = { valid: true; detail?: string } | { valid: false; reason: string };

const ok = (detail?: string): Validation => (detail ? { valid: true, detail } : { valid: true });
const bad = (reason: string): Validation => ({ valid: false, reason });

/**
 * الهوية الوطنية والإقامة السعودية تحملان خانة تحقق Luhn (نفس خوارزمية بطاقات
 * الدفع): خانة واحدة في النهاية تجعل المجموع المرجح يقبل القسمة على 10. القاعدة
 * علنية ومعلنة — معمول بها في أنظمة إدارية ومنشورة في تطبيقات تحقق مستقلة متعددة؛
 * لا يوجد إعلان رسمي مكتوب من الأحوال المدنية للخوارزمية، لكن الاتساق بين التطبيقات
 * المستقلة هو الدليل العملي المتاح. الأول: 1 مواطن، 2 مقيم.
 */
export const SAUDI_ID_LUHN_NOTE =
  "Saudi national ID and iqama carry a public Luhn check digit (10 digits, leading 1 = citizen, 2 = resident); no official NIC algorithm publication exists — the rule is cross-verified across independent implementations.";

/** الهوية/الإقامة السعودية: 10 خانات، أولها 1 أو 2، خانة تحقق Luhn سليمة. */
export function checkSaudiId(v: string): Validation {
  if (!/^\d{10}$/.test(v)) return bad("length");
  if (v[0] !== "1" && v[0] !== "2") return bad("leading_digit");
  return luhn(v) ? ok("luhn") : bad("checksum");
}

/**
 * السجل التجاري السعودي: 10 خانات. لا خانة تحقق علنية موجودة — الصيغة فقط:
 * الترقيم التاريخي يبدأ برمز الغرفة (1010 الرياض، 4030 جدة…) والرقم الموحد
 * منذ 2025 يبدأ بـ7. خانة تحقق بلا مصدر علني = لا اختراع.
 */
/** السجل التجاري الموحد: 10 خانات تبدأ بـ7 (صيغة 2025 الموحدة). لا خانة تحقق علنية. */
export function checkCrSa(v: string): Validation {
  if (!/^\d{10}$/.test(v)) return bad("length");
  if (v[0] !== "7") return bad("unified_prefix");
  return ok("format_only_no_check_digit");
}

/** الرقم الضريبي السعودي (ZATCA): 15 خانة تبدأ بـ3 وتنتهي بـ3. */
export function checkVatSa(v: string): Validation {
  if (!/^\d{15}$/.test(v)) return bad("length");
  if (v[0] !== "3") return bad("leading_digit");
  if (v[14] !== "3") return bad("trailing_digit");
  return ok("zatca_format");
}

/** IBAN دولة خليجية محددة: صلاحية السجل الرسمي + مطابقة الدولة. */
export function checkIbanCountry(v: string, country: "SA" | "AE" | "KW" | "QA" | "BH" | "OM"): Validation {
  const r: IbanResult = checkIban(v);
  if (!r.valid) return bad(r.reason ?? "invalid");
  if (r.country !== country) return bad("country");
  return ok(`mod97 ${country}`);
}

/**
 * رقم أمريكي/كندي (NANP): قاعدة علنية — NPA (رمز المنطقة) وNXX (رمز المكتب)
 * أول رقمين من كل منهما لا يبدآن بـ0 أو 1، وNPA وسطه 0-8. هذا المدقق يخرج
 * الأرقام العشرة المجردة من نطاق الهاتف الأمريكي (نطاقات الهويات مثلاً)
 * ويرفع دقة الكشف (P5-005: أصل انجراف نوعية النوع عند إضافة أمثلة
 * عشرية الخانات الجديدة).
 */
export function checkNanp(v: string): Validation {
  const e164 = /^\+\d{7,15}$/.test(v);
  const digits = v.replace(/\D/g, "");
  let nsn: string;
  if (e164) {
    if (!digits.startsWith("1")) return bad("country_code");
    nsn = digits.slice(1);
  } else {
    // الصيغة المجردة ببادئة الجذع 1 (11 خانة) مرفوضة عمداً: تتطابق مع هويات
    // وطنية لبلدان أخرى بطول 11 (تركيا/نيجيريا/ألمانيا) فيبتلعها الفحص
    // الآمن لبوابة الخروج — يبقى E.164 (+1) هو الصيغة الدولية الوحيدة.
    nsn = digits;
  }
  if (nsn.length !== 10) return bad("nsn_length");
  if (!/^[2-9][0-8][0-9][2-9]\d{6}$/.test(nsn)) return bad("nanp");
  return ok("nanp");
}

/** هيكل خطة ترقيم: طول NSN + نطاقات الأوائل (regEx على الـNSN). */
export interface GulfPhonePlan {
  /** Country calling code (E.164). */
  cc: string;
  /** National (significant) number length in digits. */
  nsnLength: number | readonly number[];
  /** Allowed leading shapes of the NSN (anchored regex on the NSN). */
  nsn: RegExp;
  /** Trunk prefix of the domestic form ("0" in SA/AE; none in KW/QA/BH/OM). */
  trunk?: string;
}

/**
 * خطط الترقيم الخليجية (مصادرها في ملف الدليل):
 * - SA (CST): 9 خانات NSN — جوال 5[0134-9] (052 غير مخصص)، ثابت 1[123467]،
 *   موحد 92[0-9]، مجاني 800 (10 خانات NSN).
 * - AE (TDRA/ITU): جوال 5[0-9] تسع خانات، ثابت [2-9 بلا 5/8] ثماني خانات.
 * - KW: 8 خانات — ثابت 2، جوال 5/6/9.
 * - QA: 8 خانات — ثابت 4، جوال 3/5/6/7.
 * - BH: 8 خانات — ثابت 17، جوال 3/6.
 * - OM: 8 خانات — ثابت 2، جوال 7/9.
 */
export const GULF_PHONE_PLANS: Readonly<Record<"SA" | "AE" | "KW" | "QA" | "BH" | "OM", GulfPhonePlan>> = {
  SA: { cc: "966", nsnLength: [9, 10], nsn: /^(5[0134-9]\d{7}|1[123467]\d{7}|92[0-9]\d{6}|800\d{7})$/, trunk: "0" },
  AE: { cc: "971", nsnLength: [8, 9], nsn: /^(5\d{8}|[234679]\d{7})$/, trunk: "0" },
  KW: { cc: "965", nsnLength: 8, nsn: /^[2569]\d{7}$/ },
  QA: { cc: "974", nsnLength: 8, nsn: /^[34567]\d{7}$/ },
  BH: { cc: "973", nsnLength: 8, nsn: /^(17\d{6}|[36]\d{7})$/ },
  OM: { cc: "968", nsnLength: 8, nsn: /^[279]\d{7}$/ },
};

/**
 * مدقق هاتف خليجي: يقبل الصيغة الدولية الكاملة (+CC NSN) أو المحلية (0 NSN حيث
 * يوجد جذع، أو NSN مجرداً في دول بلا جذع). يرفض كل ما عدا ذلك: كود دولة غير
 * مطابق، طولاً خارج الخطة، أو أولاً غير مخصص.
 */
export function checkGulfPhone(v: string, country: keyof typeof GULF_PHONE_PLANS): Validation {
  const plan = GULF_PHONE_PLANS[country];
  const lengths = (Array.isArray(plan.nsnLength) ? plan.nsnLength : [plan.nsnLength]) as readonly number[];
  const e164 = /^\+\d{6,17}$/.test(v);
  const digits = v.replace(/\D/g, "");
  let nsn: string;

  if (e164) {
    if (!digits.startsWith(plan.cc)) return bad("country_code");
    nsn = digits.slice(plan.cc.length);
  } else if (plan.trunk && digits.startsWith(plan.trunk) && lengths.includes(digits.length - 1)) {
    // محلي بجذع الصفر: 0 + NSN بطول مخطط
    nsn = digits.slice(1);
  } else {
    // NSN مجرد أو محلي بلا جذع (KW/QA/BH/OM المحلي = NSN مباشرة)
    nsn = digits;
  }

  if (nsn.length === 0) return bad("format");
  if (!lengths.includes(nsn.length)) return bad("nsn_length");
  if (!plan.nsn.test(nsn)) return bad("prefix");
  return ok(`e164:${plan.cc} nsn:${nsn.length}`);
}
