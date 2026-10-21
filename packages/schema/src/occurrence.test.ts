import { describe, expect, it } from "vitest";
import { Claim, compareTimestamps } from "./index.ts";

/**
 * ADR-33 (قرار مالك 2026-10-21): نافذة حدوث مستقلة على الادعاء — `occurredFrom/occurredTo`
 * تفصل «وقت الوقوع» (نافذة الغموض) عن «وقت الصلاحية» (`validFrom/validTo`) وعن وقت الرصد
 * (`observedAt` على الملاحظة). عدم اليقين الزمني فترات، لا نقاط زائفة:
 * «تقريباً 2019» = فترة السنة، «قبل 2020-03» = بداية مفتوحة ونهاية محددة.
 *
 * صادق الأدلة: الاختبار (1) أحمر سلوكياً — الحقلان مجردان من الادعاء حالياً فلا يُحفظان.
 * الاختبار (2) أحمر سلوكياً أيضاً — يثبت خللاً كامناً في تحقق الصلاحية القائم:
 * مقارنة `Date.parse` تدمج الكسور دون الملي ثانية فتقبل validFrom أحدث لحظةً من validTo
 * ضمن الثانية نفسها. اختبارات compareTimestamps (3) حمراء هيكلياً (الوحدة غير موجودة) —
 * الحاجة السلوكية إليها يثبتها (2)؛ مخرجات الأحمر الكاملة موثقة في WORKLOG قبل التنفيذ.
 */

const U = (n: number) => `01J${String(n).padStart(23, "0")}`; // valid ULIDs for fixtures
const base = { id: U(5), subjectId: U(2), predicate: "resolves_to", objectId: U(6), confidence: 0.9, explanation: "DNS A record" };

describe("ADR-33: claim occurrence window", () => {
  it("preserves occurredFrom/occurredTo on the claim — the window is first-class data", () => {
    const r = Claim.safeParse({
      ...base,
      occurredFrom: "2019-01-01T00:00:00Z",
      occurredTo: "2019-12-31T23:59:59Z",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.occurredFrom).toBe("2019-01-01T00:00:00Z");
      expect(r.data.occurredTo).toBe("2019-12-31T23:59:59Z");
    }
  });

  it("an open-start window («قبل 2020-03») is valid: occurredFrom null, occurredTo set", () => {
    const r = Claim.safeParse({ ...base, occurredFrom: null, occurredTo: "2020-03-01T00:00:00Z" });
    expect(r.success).toBe(true);
  });

  it("rejects an inverted occurrence window — by whole seconds AND within one second (full precision)", () => {
    expect(Claim.safeParse({ ...base, occurredFrom: "2020-03-02T00:00:00Z", occurredTo: "2020-03-01T00:00:00Z" }).success).toBe(false);
    // same second, sub-millisecond inversion: .0009Z happened AFTER .0001Z
    expect(
      Claim.safeParse({
        ...base,
        occurredFrom: "2020-03-01T00:00:00.0009Z",
        occurredTo: "2020-03-01T00:00:00.0001Z",
      }).success,
    ).toBe(false);
  });

  it("fixes the latent validity defect: a same-second validFrom/validTo inversion via sub-ms fractions is rejected", () => {
    // Date.parse collapses both to the same millisecond, so the OLD text/ms comparison accepted this.
    expect(Claim.safeParse({ ...base, validFrom: "2026-02-01T00:00:00.0009Z", validTo: "2026-02-01T00:00:00.0001Z" }).success).toBe(false);
    // and the honest order is still accepted
    expect(Claim.safeParse({ ...base, validFrom: "2026-02-01T00:00:00.0001Z", validTo: "2026-02-01T00:00:00.0009Z" }).success).toBe(true);
  });
});

describe("compareTimestamps — the single full-precision moment comparator (browser-safe)", () => {
  it("mixed timezone offsets compare by MOMENT, not text", () => {
    expect(compareTimestamps("2026-01-01T12:00:00Z", "2026-01-01T10:00:00-05:00")).toBeLessThan(0); // 12:00Z < 15:00Z
    expect(compareTimestamps("2026-01-01T07:00:00-05:00", "2026-01-01T12:00:00Z")).toBe(0); // 12:00Z == 12:00Z
  });

  it("equal moments in different representations are equal; .1 equals .10; .01 sorts before both", () => {
    expect(compareTimestamps("2026-01-01T12:00:00Z", "2026-01-01T07:00:00-05:00")).toBe(0);
    expect(compareTimestamps("2026-01-01T00:00:00.1Z", "2026-01-01T00:00:00.10Z")).toBe(0);
    expect(compareTimestamps("2026-01-01T00:00:00.01Z", "2026-01-01T00:00:00.1Z")).toBeLessThan(0);
  });

  it("fractions of ANY length keep full precision — never truncated to milliseconds or nanoseconds", () => {
    // 10-digit fractions: .0000000009Z is a LATER moment than .0000000001Z
    expect(compareTimestamps("2026-01-01T00:00:00.0000000001Z", "2026-01-01T00:00:00.0000000009Z")).toBeLessThan(0);
    // 20-digit fractions (verified accepted by the schema): full text comparison
    expect(compareTimestamps("2026-01-01T00:00:00.12345678901234567890Z", "2026-01-01T00:00:00.12345678901234567891Z")).toBeLessThan(0);
  });

  it("no fraction = the whole second: equal to .000..., earlier than any nonzero fraction", () => {
    expect(compareTimestamps("2026-01-01T00:00:00Z", "2026-01-01T00:00:00.000Z")).toBe(0);
    expect(compareTimestamps("2026-01-01T00:00:00Z", "2026-01-01T00:00:00.0000000001Z")).toBeLessThan(0);
  });

  it("the missing-seconds form T00:00Z compares as the whole second", () => {
    expect(compareTimestamps("2026-01-01T00:00Z", "2026-01-01T00:00:00Z")).toBe(0);
  });
});
