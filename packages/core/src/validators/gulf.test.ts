import { describe, expect, it } from "vitest";

import { IDENTIFIER_SPECS } from "../identifiers/catalog";
import { validate, VALIDATED_TYPES } from "./index";
import {
  checkCrSa,
  checkNanp,
  checkGulfPhone,
  checkIbanCountry,
  checkSaudiId,
  checkVatSa,
  SAUDI_ID_LUHN_NOTE,
  GULF_PHONE_PLANS,
} from "./gulf";

/**
 * P5-005 (T-GLF): الصيغ المحلية الخليجية — أنواع + مدققات على قواعد علنية.
 *
 * المصادر الرسمية الموثقة (الأحمر كُتب قبل التنفيذ):
 * - الهوية السعودية: خانة تحقق Luhn علنية معلنة (معمول بها في أنظمة حكومية ومنشورة
 *   في تطبيقات تحقق متعددة مستقلة) — SAUDI_ID_LUHN_NOTE.
 * - خطة الترقيم السعودية (CST): 05[0-9] جوال (بلا 052)، 01[123467] ثابت، 9200XXXXX رقم
 *   وطني موحد، 800XXXXXXX مجاني — الكل 9 خانات NSN بعد +966.
 * - خطة الإمارات (TDRA/ITU): NSN ثماني أو تسع خانات؛ جوال 5[0-9]، ثابت [234679].
 * - أطوال NSN الرسمية: الكويت/قطر/البحرين/عمان 8 خانات بأوائل مخصصة.
 * - IBAN الخليجي: سجل SWIFT الرسمي (أطوال وBBAN وأمثلة إلكترونية رسمية).
 * - السجل التجاري السعودي: 10 خانات (صيغة الغرف الموثقة + الرقم الموحد 7 منذ 2025)
 *   بلا خانة تحقق علنية — يوثق كصيغة فقط. الرقم الضريبي: 15 خانة تبدأ وتنتهي بـ3.
 */

describe("T-GLF-001 — الهوية السعودية والإقامة: خانة تحقق Luhn", () => {
  it("قبول أمثلة Luhn صحيحة (موثقة من تطبيقات مستقلة متعددة)", () => {
    // 2291363352 و2875132132 من أمثلة منشورة متعددة المصادر؛ 1012345672 أول خانة 1
    expect(checkSaudiId("2291363352")).toMatchObject({ valid: true });
    expect(checkSaudiId("2875132132")).toMatchObject({ valid: true });
    expect(checkSaudiId("1012345672")).toMatchObject({ valid: true });
  });

  it("رفض: خانة تحقق خاطئة، بادئة غير 1/2، طول خاطئ، غير رقمي", () => {
    expect(checkSaudiId("2291363351").valid).toBe(false); // خانة تحقق مكسورة
    expect(checkSaudiId("1234567890").valid).toBe(false); // Luhn غير صالح (المثال القديم في الكتالوج)
    expect(checkSaudiId("3291363352").valid).toBe(false); // بادئة 3 غير موجودة
    expect(checkSaudiId("229136335").valid).toBe(false); // 9 خانات
    expect(checkSaudiId("22913633522").valid).toBe(false); // 11 خانة
    expect(checkSaudiId("229136335A").valid).toBe(false); // حرف
    expect(SAUDI_ID_LUHN_NOTE).toContain("Luhn");
  });
});

describe("T-GLF-002 — السجل التجاري السعودي الموحد: 10 خانات تبدأ بـ7 (لا خانة تحقق علنية)", () => {
  it("قبول صيغة الرقم الموحد 2025 (7-prefixed)؛ صيغ الغرف التاريخية خارج النطاق", () => {
    expect(checkCrSa("7001234567")).toMatchObject({ valid: true });
    expect(checkCrSa("7103456789")).toMatchObject({ valid: true });
  });

  it("رفض: صيغ الغرف التاريخية (1/4 بادئة)، صفر بادئ، طول خاطئ، غير رقمي", () => {
    expect(checkCrSa("1010123456").valid).toBe(false); // صيغة غرفة تاريخية — خارج النطاق الموثق
    expect(checkCrSa("4030123456").valid).toBe(false); // جدة تاريخية
    expect(checkCrSa("0101234567").valid).toBe(false);
    expect(checkCrSa("700123456").valid).toBe(false);
    expect(checkCrSa("70012345678").valid).toBe(false);
    expect(checkCrSa("700123456X").valid).toBe(false);
  });
});

describe("T-GLF-003 — الرقم الضريبي السعودي: 15 خانة تبدأ وتنتهي بـ3", () => {
  it("قبول أمثلة ZATCA المنشورة", () => {
    expect(checkVatSa("310122393500003")).toMatchObject({ valid: true });
    expect(checkVatSa("300000000000003")).toMatchObject({ valid: true });
  });

  it("رفض: بادئة/لاحقة غير 3، طول خاطئ", () => {
    expect(checkVatSa("410122393500003").valid).toBe(false);
    expect(checkVatSa("310122393500004").valid).toBe(false);
    expect(checkVatSa("31012239350000").valid).toBe(false); // 14 خانة
    expect(checkVatSa("3101223935000033").valid).toBe(false); // 16 خانة
  });
});

describe("T-GLF-004 — IBAN الخليجي: سجل SWIFT الرسمي (طول + BBAN + mod-97 + الدولة)", () => {
  it("الأمثلة الرسمية الإلكترونية تقبل في دولتها", () => {
    expect(checkIbanCountry("SA0380000000608010167519", "SA")).toMatchObject({ valid: true });
    expect(checkIbanCountry("AE070331234567890123456", "AE")).toMatchObject({ valid: true });
    expect(checkIbanCountry("BH67BMAG00001299123456", "BH")).toMatchObject({ valid: true });
    expect(checkIbanCountry("KW81CBKU0000000000001234560101", "KW")).toMatchObject({ valid: true });
    expect(checkIbanCountry("QA58DOHB00001234567890ABCDEFG", "QA")).toMatchObject({ valid: true });
    expect(checkIbanCountry("OM810180000001299123456", "OM")).toMatchObject({ valid: true });
  });

  it("رفض: IBAN دولة أخرى، خانة تحقق مكسورة، طول خاطئ", () => {
    expect(checkIbanCountry("SA0380000000608010167519", "AE").valid).toBe(false); // دولة غير مطابقة
    expect(checkIbanCountry("SA0380000000608010167518", "SA").valid).toBe(false); // mod-97 مكسور
    expect(checkIbanCountry("SA038000000060801016751", "SA").valid).toBe(false); // 23 خانة
    expect(checkIbanCountry("DE89370400440532013000", "SA").valid).toBe(false); // ألماني
  });
});

describe("T-GLF-005 — هواتف الخليج: خطط ترقيم رسمية (E.164 والمحلي)", () => {
  it("السعودية (CST): جوال 05[0-9] بلا 052، ثابت 01[123467]، موحد 9200، مجاني 800", () => {
    expect(checkGulfPhone("+966501234567", "SA")).toMatchObject({ valid: true });
    expect(checkGulfPhone("0551234567", "SA")).toMatchObject({ valid: true }); // مثال CST الرسمي
    expect(checkGulfPhone("0113456789", "SA")).toMatchObject({ valid: true }); // مثال CST الرسمي (ثابت)
    expect(checkGulfPhone("8001232222", "SA")).toMatchObject({ valid: true }); // مثال CST الرسمي (مجاني)
    expect(checkGulfPhone("920012345", "SA")).toMatchObject({ valid: true });
    expect(checkGulfPhone("+9660521234567", "SA").valid).toBe(false); // 052 غير مخصص (CST)
    expect(checkGulfPhone("+9660151234567", "SA").valid).toBe(false); // 015 ليس رمز منطقة
    expect(checkGulfPhone("+96650123456", "SA").valid).toBe(false); // 8 خانات NSN
    expect(checkGulfPhone("05512345678", "SA").valid).toBe(false); // 11 خانة محلية
  });

  it("الإمارات (TDRA/ITU): جوال 5[0-9] تسع خانات، ثابت [234679] ثماني", () => {
    expect(checkGulfPhone("+971501234567", "AE")).toMatchObject({ valid: true });
    expect(checkGulfPhone("0501234567", "AE")).toMatchObject({ valid: true });
    expect(checkGulfPhone("+97141234567", "AE")).toMatchObject({ valid: true }); // دبي ثابت
    expect(checkGulfPhone("+971601234567", "AE").valid).toBe(false); // 6 ثابت = 8 خانات لا 9
    expect(checkGulfPhone("+9715012345678", "AE").valid).toBe(false); // NSN عشر خانات
  });

  it("الكويت وقطر والبحرين وعمان: 8 خانات بأوائل مخصصة", () => {
    expect(checkGulfPhone("+96550012345", "KW")).toMatchObject({ valid: true });
    expect(checkGulfPhone("50012345", "KW")).toMatchObject({ valid: true });
    expect(checkGulfPhone("+96541234567", "KW").valid).toBe(false); // 4 غير مخصص
    expect(checkGulfPhone("+97433123456", "QA")).toMatchObject({ valid: true });
    expect(checkGulfPhone("+97423123456", "QA").valid).toBe(false); // 2 غير مخصص
    expect(checkGulfPhone("+97336001234", "BH")).toMatchObject({ valid: true });
    expect(checkGulfPhone("+97317123456", "BH")).toMatchObject({ valid: true }); // ثابت 17
    expect(checkGulfPhone("+97346001234", "BH").valid).toBe(false); // 4 غير مخصص
    expect(checkGulfPhone("+96892123456", "OM")).toMatchObject({ valid: true });
    expect(checkGulfPhone("+96871234567", "OM")).toMatchObject({ valid: true });
    expect(checkGulfPhone("+96852123456", "OM").valid).toBe(false); // 5 غير مخصص
    expect(checkGulfPhone("+968921234567", "OM").valid).toBe(false); // 9 خانات NSN
  });

  it("رفض كود دولة غير مطابق وبادئة دولية ناقصة", () => {
    expect(checkGulfPhone("+966501234567", "AE").valid).toBe(false); // سعودي تحت نوع إماراتي
    expect(checkGulfPhone("966501234567", "SA").valid).toBe(false); // بلا + ولا صفر محلي
    expect(GULF_PHONE_PLANS.SA.nsnLength).toEqual([9, 10]);
  });
});

describe("T-GLF-006 — الكتالوج: الأنواع الجديدة والمدققات مربوطة", () => {
  it("المدققون مسجلون في VALIDATED_TYPES باسم كل نوع", () => {
    for (const id of [
      "national_id_sa",
      "iqama_sa",
      "cr_sa",
      "vat_sa",
      "iban_sa",
      "iban_ae",
      "iban_kw",
      "iban_qa",
      "iban_bh",
      "iban_om",
      "phone_sa",
      "phone_ae",
      "phone_kw",
      "phone_qa",
      "phone_bh",
      "phone_om",
    ]) {
      expect(VALIDATED_TYPES.includes(id), id).toBe(true);
    }
  });

  it("كل نوع جديد في الكتالوج: مدقق + أمثلة موجبة تُقبل وسالبة تُرفض", () => {
    const byId = new Map(IDENTIFIER_SPECS.map((s) => [s.id, s]));
    for (const id of ["cr_sa", "vat_sa", "iban_sa", "iban_ae", "iban_kw", "iban_qa", "iban_bh", "iban_om"]) {
      const spec = byId.get(id);
      expect(spec, id).toBeDefined();
      expect(spec?.validator, id).not.toBeNull();
      expect(spec?.examples.positive.length, id).toBeGreaterThan(0);
      expect(spec?.examples.negative.length, id).toBeGreaterThan(0);
    }
    // الهوية والإقامة والهواتف الخليجية صارت مدققة (كانت بلا مدقق)
    for (const id of ["national_id_sa", "iqama_sa", "phone_sa", "phone_ae", "phone_kw", "phone_qa", "phone_bh", "phone_om"]) {
      expect(byId.get(id)?.validator, id).not.toBeNull();
    }
  });

  it("validate() يستدعي المدقق الجديد عبر اسم النوع", () => {
    expect(validate("national_id_sa", "2291363352")).toMatchObject({ valid: true });
    expect(validate("national_id_sa", "1234567890")?.valid ?? false).toBe(false);
    expect(validate("iqama_sa", "2875132132")).toMatchObject({ valid: true });
    expect(validate("vat_sa", "310122393500003")).toMatchObject({ valid: true });
    expect(validate("iban_om", "OM810180000001299123456")).toMatchObject({ valid: true });
    expect(validate("phone_sa", "0551234567")).toMatchObject({ valid: true });
    expect(validate("phone_sa", "05512345678")?.valid ?? false).toBe(false);
  });
});

describe("T-GLF-007 — NANP (هاتف أمريكي/كندي): قاعدة NPA/NXX العلنية", () => {
  it("قبول أرقام NANP سليمة بصيغها (E.164، محلية بأقواس، مجردة)", () => {
    expect(checkNanp("+14155550199")).toMatchObject({ valid: true });
    expect(checkNanp("(415) 555-0199")).toMatchObject({ valid: true });
    expect(checkNanp("2025550100")).toMatchObject({ valid: true });
  });

  it("رفض: صيغة الجذع المجردة 1+10 خانات (تتعارض مع هويات 11 خانة)، NXX يبدأ بـ1، NPA يبدأ بـ0/1", () => {
    expect(checkNanp("12345678901").valid).toBe(false); // جذع 1 مجرد — يتطابق مع هوية تركيا/نيجيريا
    expect(checkNanp("12025550177").valid).toBe(false); // جذع 1 مجرد حتى لو صحيح البنية

    expect(checkNanp("+1-555-123-4567").valid).toBe(false); // NXX=123 يبدأ بـ1
    expect(checkNanp("1234567890").valid).toBe(false); // NPA=123 يبدأ بـ1
    expect(checkNanp("0551234567").valid).toBe(false); // NPA يبدأ بـ0
    expect(checkNanp("1012345672").valid).toBe(false); // NPA يبدأ بـ1
    expect(checkNanp("+966501234567").valid).toBe(false); // ليس NANP
  });

  it("سلاسل عشرية الخانات صادقة في النظامين معاً (NANP + Luhn إقامة) — التحكيم بالنوعية الأدق", () => {
    // 2025550100: NPA=202 وNXX=555 صالحان NANP، وهي أيضاً Luhn-صالحة كبادئة إقامة 2 —
    // التداخل حقيقي والفصل بالنوعية في الكشف، لا بالمدقق وحده.
    expect(checkNanp("2025550100")).toMatchObject({ valid: true });
  });
});
