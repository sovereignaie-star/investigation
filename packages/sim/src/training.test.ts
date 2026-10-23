import { describe, expect, it } from "vitest";
import { createTrainingWorld, gradeTrainingRun, loadTrainingScenario, TrainingScenarioError, type TrainingScenario } from "./training.ts";

/**
 * P5-016 — وضع التدريب في المحاكاة (UC-23: تمرين بنتيجة مرجعية، يعمل بلا إنترنت).
 *
 * التمرين = عالم وهمي محدد القواعد (نفس عالم المحاكاة الحتمي) + هدف + نتيجة
 * مرجعية (مجموعة النتائج المرجعية) + تصحيح حتمي. المتدرب يستقصي داخل العالم
 * (استدعاءات عبر نقل المحاكاة — بلا شبكة حقيقية) ويسجل نتائجه، ثم يُصحح عمله
 * بدرجة نتيجة مرجعية: المطابقة الكاملة للنتائج المرجعية = ناجح، والفروق تُشخّص
 * (مفقود/خطأ/إضافي) — التصحيح نفسه حتمي: نفس العمل نفس النتيجة.
 */

const SCENARIO_YAML = `
id: TRN-01
title: تمرين تدريبي — النطاق المشبوه
objective: تحديد مالك النطاق example.test وعنوانه المسجل من عالم المحاكاة.
world:
  - match: "https://sim.example/rdap/domain/example.test"
    response:
      status: 200
      body: '{"domain": "example.test", "registrar": "Sim Registrar Ltd"}'
  - match: "https://sim.example/dns/example.test"
    response:
      status: 200
      body: '{"domain": "example.test", "a": ["93.184.216.34"]}'
reference_outcome:
  - key: registrar
    value: Sim Registrar Ltd
  - key: resolved_ip
    value: 93.184.216.34
`;

const BROKEN_YAML = `
id: TRN-99
title: تمرين بلا عالم
objective: ناقص التعريف
reference_outcome: []
`;

const loadScenario = (): TrainingScenario => loadTrainingScenario(SCENARIO_YAML);

describe("P5-016 — تحميل التمرين", () => {
  it("T-TRN-001: يُحمّل التمرين من YAML بمخطط صارم — فشل مغلق عند النقص", () => {
    const scenario = loadScenario();
    expect(scenario.id).toBe("TRN-01");
    expect(scenario.world.length).toBe(2);
    expect(scenario.referenceOutcome.length).toBe(2);
    expect(() => loadTrainingScenario(BROKEN_YAML)).toThrow(TrainingScenarioError);
  });
});

describe("P5-016 — العالم الوهمي بلا إنترنت", () => {
  it("T-TRN-002: عالم التمرين هو نقل المحاكاة — إجابات محددة القواعد ولا تخمين", async () => {
    const scenario = loadScenario();
    const world = createTrainingWorld(scenario);
    const response = await world.transport.fetch(
      { method: "GET", url: "https://sim.example/rdap/domain/example.test", headers: {} },
      new AbortController().signal,
    );
    expect(response.status).toBe(200);
    expect(response.body).toContain("Sim Registrar Ltd");
    // عالم لا يخمّن: URL غير منصوص يفشل بوضوح — لا شبكة ولا اتصال خارجي
    await expect(
      world.transport.fetch({ method: "GET", url: "https://real-internet.example/anything", headers: {} }, new AbortController().signal),
    ).rejects.toThrow(/sim|no rule/i);
  });
});

describe("P5-016 — التصحيح بنتيجة مرجعية", () => {
  it("T-TRN-003: عمل المتدرب المطابق للنتيجة المرجعية = ناجح بدرجة كاملة", () => {
    const scenario = loadScenario();
    const result = gradeTrainingRun(scenario, [
      { key: "registrar", value: "Sim Registrar Ltd" },
      { key: "resolved_ip", value: "93.184.216.34" },
    ]);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.missing).toEqual([]);
    expect(result.wrong).toEqual([]);
  });

  it("T-TRN-004: عمل ناقص أو خاطئ يُرسب ويُشخّص الفروق — لا يمر صامتاً", () => {
    const scenario = loadScenario();
    const result = gradeTrainingRun(scenario, [
      { key: "registrar", value: "جهة خاطئة" },
      { key: "extra", value: "نتيجة إضافية" },
    ]);
    expect(result.passed).toBe(false);
    expect(result.missing).toContain("resolved_ip");
    expect(result.wrong).toEqual([{ key: "registrar", value: "جهة خاطئة" }]);
    expect(result.extra).toEqual([{ key: "extra", value: "نتيجة إضافية" }]);
  });

  it("T-TRN-005: التصحيح حتمي — نفس العمل يعطي نفس النتيجة بالضبط", () => {
    const scenario = loadScenario();
    const findings = [{ key: "registrar", value: "Sim Registrar Ltd" }];
    const first = gradeTrainingRun(scenario, findings);
    const second = gradeTrainingRun(scenario, findings);
    expect(first).toEqual(second);
  });

  it("T-TRN-006: تمرين كامل بلا إنترنت — استقصاء في العالم ثم تصحيح بنتيجة مرجعية", async () => {
    const scenario = loadScenario();
    const world = createTrainingWorld(scenario);
    // المتدرب يستقصي: RDAP ثم DNS عبر عالم المحاكاة (بلا أي شبكة حقيقية)
    const rdap = await world.transport.fetch(
      { method: "GET", url: "https://sim.example/rdap/domain/example.test", headers: {} },
      new AbortController().signal,
    );
    const dns = await world.transport.fetch(
      { method: "GET", url: "https://sim.example/dns/example.test", headers: {} },
      new AbortController().signal,
    );
    // يسجل نتائجه من إجابات العالم
    const registrar = JSON.parse(String(rdap.body)).registrar as string;
    const resolvedIp = (JSON.parse(String(dns.body)).a as string[])[0];
    const result = gradeTrainingRun(scenario, [
      { key: "registrar", value: registrar },
      { key: "resolved_ip", value: resolvedIp },
    ]);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });
});
