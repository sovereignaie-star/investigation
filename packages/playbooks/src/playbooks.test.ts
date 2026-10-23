import { describe, expect, it } from "vitest";
import { loadPlaybook, executePlaybook, type PlaybookState } from "./index.ts";

/**
 * P5-007 — محرك كتب الإجراءات (T-PLAY-001..004).
 *
 * الكتاب: YAML بمخطط (ADR-16) — مدخل، خطوات (استدعاءات محوّلات بترتيب طوبولوجي)،
 * وبوابات بشرية توقف التنفيذ قبل الخطوة المحمية حتى تأكيد صريح. المحرك تنسيق
 * صرف: لا يعرف المحوّلات — يستدعيها عبر حقن (في الإنتاج: عدّاء المحوّلات عبر بوابة
 * الخروج؛ في الاختبار: بديل حتمي). حتمي وقابل للاستئناف من حالة محفوظة.
 */

const DOMAIN_PB = `
id: PB-01
title: فحص نطاق
description: فحص أساسي لنطاق قبل أي محوّل بمفتاح مدفوع
input: domain
scope:
  natural_persons: out_of_scope
steps:
  - id: dns
    transform: tr-dns
    input: playbook
  - id: rdap
    transform: tr-rdap
    input: playbook
  - id: certs
    transform: tr-certs
    input: rdap
  - id: paid-lookup
    transform: tr-paid
    input: playbook
gates:
  - id: before-paid
    before: paid-lookup
    reason: قبل أي محوّل بمفتاح مدفوع
    requires: human_confirmation
`;

/** بديل محوّل حتمي: مخرجات مرجعية قابلة للتحقق. */
const fakeInvoke = async (transformId: string, input: unknown): Promise<unknown> => {
  if (transformId === "tr-dns") return { kind: "dns", records: [{ type: "A", value: `10.0.0.${String(input).length}` }] };
  if (transformId === "tr-rdap") return { kind: "rdap", domain: input, registrar: "sim-registrar" };
  if (transformId === "tr-certs") return { kind: "certs", for: (input as { domain: string }).domain, cn: "*.sim.test" };
  if (transformId === "tr-paid") return { kind: "paid", domain: input, tier: "reference" };
  throw new Error(`unknown transform in test fake: ${transformId}`);
};

const stepIds = (state: PlaybookState): string[] => state.completedSteps.map((s) => s.stepId);

describe("P5-007 — المخطط والتحقق (T-PLAY-001)", () => {
  it("T-PLAY-001a: كتاب سليم يُحمّل ويُتحقق (YAML → مخطط صارم fail-closed)", () => {
    const def = loadPlaybook(DOMAIN_PB);
    expect(def.id).toBe("PB-01");
    expect(def.steps.map((s) => s.id)).toEqual(["dns", "rdap", "certs", "paid-lookup"]);
    expect(def.gates[0]?.before).toBe("paid-lookup");
  });

  it("T-PLAY-001b: الرفض الصريح — مرجع خطوة غير موجود، معرفات مكررة، بوابة لخطوة مجهولة، حلقة اعتماد", () => {
    expect(() => loadPlaybook(DOMAIN_PB.replace("input: rdap", "input: nonexistent-step"))).toThrow();
    expect(() => loadPlaybook(DOMAIN_PB.replace("- id: certs", "- id: dns"))).toThrow(/duplicate/i);
    expect(() => loadPlaybook(DOMAIN_PB.replace("before: paid-lookup", "before: ghost-step"))).toThrow();
    expect(() =>
      loadPlaybook(
        DOMAIN_PB.replace("    input: rdap", "    input: paid-lookup").replace(
          "    transform: tr-paid\n    input: playbook",
          "    transform: tr-paid\n    input: certs",
        ),
      ),
    ).toThrow(/cycle/i);
    expect(() => loadPlaybook("id: PB-99\ntitle: بلا خطوات\ninput: domain\nsteps: []\ngates: []")).toThrow(/step/i);
  });
});

describe("P5-007 — البوابات البشرية (T-PLAY-002)", () => {
  it("T-PLAY-002a: التنفيذ يتوقف عند البوابة — لا استدعاء لأي خطوة بعدها بلا تأكيد", async () => {
    const def = loadPlaybook(DOMAIN_PB);
    const state = await executePlaybook(def, { canonicalInput: "example.test" }, { invoke: fakeInvoke });
    expect(state.phase).toBe("awaiting_gate");
    expect(state.pendingGate?.gateId).toBe("before-paid");
    expect(stepIds(state)).toEqual(["dns", "rdap", "certs"]); // الخطوة المحمية لم تنفذ
  });

  it("T-PLAY-002b: إعادة المحاولة بلا تأكيد تبقى متوقفة (لا تنفيذ صامت خلف البوابة)", async () => {
    const def = loadPlaybook(DOMAIN_PB);
    const first = await executePlaybook(def, { canonicalInput: "example.test" }, { invoke: fakeInvoke });
    const again = await executePlaybook(def, { canonicalInput: "example.test" }, { invoke: fakeInvoke, resume: first });
    expect(again.phase).toBe("awaiting_gate");
    expect(again.completedSteps).toHaveLength(3); // لم تتكرر الخطوات المنجزة
  });

  it("T-PLAY-002c: التأكيد يفتح البوابة ويكمل حتى النهاية (أو البوابة التالية)", async () => {
    const def = loadPlaybook(DOMAIN_PB);
    const paused = await executePlaybook(def, { canonicalInput: "example.test" }, { invoke: fakeInvoke });
    const done = await executePlaybook(
      def,
      { canonicalInput: "example.test" },
      {
        invoke: fakeInvoke,
        resume: paused,
        confirmations: { "before-paid": { confirmedBy: "investigator-1", note: "اعتمد المفتاح المدفوع" } },
      },
    );
    expect(done.phase).toBe("completed");
    expect(stepIds(done)).toEqual(["dns", "rdap", "certs", "paid-lookup"]);
  });
});

describe("P5-007 — الإنجاز الحتمي والاستئناف (T-PLAY-003)", () => {
  it("T-PLAY-003a: كتاب بلا بوابات يكتمل بنتيجة مرجعية حتمية (نفس المدخل → نفس بصمة الحالة)", async () => {
    const def = loadPlaybook(DOMAIN_PB.replace(/gates:[\s\S]*$/, "gates: []\n"));
    const a = await executePlaybook(def, { canonicalInput: "example.test" }, { invoke: fakeInvoke });
    const b = await executePlaybook(def, { canonicalInput: "example.test" }, { invoke: fakeInvoke });
    expect(a.phase).toBe("completed");
    expect(a.stateHash).toBe(b.stateHash);
    expect((a.outputs["paid-lookup"] as { tier: string }).tier).toBe("reference");
  });

  it("T-PLAY-003b: الاستئناف بعد البوابة يوصل لنفس حالة الإنجاز غير المتقطع (عدم مرئية التوقف)", async () => {
    const def = loadPlaybook(DOMAIN_PB);
    const paused = await executePlaybook(def, { canonicalInput: "example.test" }, { invoke: fakeInvoke });
    const resumed = await executePlaybook(
      def,
      { canonicalInput: "example.test" },
      {
        invoke: fakeInvoke,
        resume: paused,
        confirmations: { "before-paid": { confirmedBy: "investigator-1", note: "ok" } },
      },
    );
    const straight = await executePlaybook(
      def,
      { canonicalInput: "example.test" },
      {
        invoke: fakeInvoke,
        confirmations: { "before-paid": { confirmedBy: "investigator-1", note: "ok" } },
      },
    );
    expect(resumed.stateHash).toBe(straight.stateHash);
  });

  it("T-PLAY-003c: فشل خطوة يوقف الكتاب بفشل مصنّف — لا ابتلاع صامت (D-017)", async () => {
    const def = loadPlaybook(DOMAIN_PB.replace(/gates:[\s\S]*$/, "gates: []\n"));
    const failing = async (transformId: string): Promise<unknown> => {
      if (transformId === "tr-paid") throw new Error("transform exploded");
      return fakeInvoke(transformId, "example.test");
    };
    const state = await executePlaybook(def, { canonicalInput: "example.test" }, { invoke: failing });
    expect(state.phase).toBe("failed");
    expect(state.failure?.message).toContain("transform exploded");
    expect(stepIds(state)).toEqual(["dns", "rdap", "certs"]); // الخطوة الفاشلة ليست منجزة
  });
});

describe("P5-007 — أخلاقيات النطاق (T-PLAY-004)", () => {
  it("T-PLAY-004a: مدخل شخص طبيعي يُرفض بلا تأكيد غرض (فشل-مغلق) — صفر استدعاءات محوّلات", async () => {
    const def = loadPlaybook(DOMAIN_PB.replace("natural_persons: out_of_scope", "natural_persons: requires_purpose"));
    const state = await executePlaybook(def, { canonicalInput: "2291363352", sensitivity: "natural_person_gate" }, { invoke: fakeInvoke });
    expect(state.phase).toBe("refused");
    expect(state.failure?.reason).toBe("natural_person");
    expect(state.completedSteps).toHaveLength(0);
  });

  it("T-PLAY-004b: كتاب يعلن الأشخاص الطبيعيين خارج النطاق يرفضهم حتى مع تأكيد غرض", async () => {
    const def = loadPlaybook(DOMAIN_PB); // scope.natural_persons: out_of_scope
    const state = await executePlaybook(
      def,
      { canonicalInput: "2291363352", sensitivity: "natural_person_gate" },
      {
        invoke: fakeInvoke,
        purposeConfirmation: { purpose: "تحقق موثق", confirmedBy: "investigator-1" },
      },
    );
    expect(state.phase).toBe("refused");
    expect(state.failure?.reason).toBe("out_of_scope");
  });

  it("T-PLAY-004c: كتاب يطلب غرضاً يقبل الشخص الطبيعي مع تأكيد غرض موثق فقط", async () => {
    const def = loadPlaybook(DOMAIN_PB.replace("natural_persons: out_of_scope", "natural_persons: requires_purpose"));
    const withPurpose = await executePlaybook(
      def,
      { canonicalInput: "2291363352", sensitivity: "natural_person_gate" },
      {
        invoke: fakeInvoke,
        purposeConfirmation: { purpose: "تحقق موثق لقضية قائمة", confirmedBy: "investigator-1" },
        confirmations: { "before-paid": { confirmedBy: "investigator-1", note: "ok" } },
      },
    );
    expect(withPurpose.phase).toBe("completed");
    const emptyPurpose = await executePlaybook(
      def,
      { canonicalInput: "2291363352", sensitivity: "natural_person_gate" },
      {
        invoke: fakeInvoke,
        purposeConfirmation: { purpose: "   ", confirmedBy: "investigator-1" },
      },
    );
    expect(emptyPurpose.phase).toBe("refused");
  });

  it("T-PLAY-004d: مدخل طبيعي غير موسوم يجتاز فحص النطاق ويعمل", async () => {
    const def = loadPlaybook(DOMAIN_PB.replace(/gates:[\s\S]*$/, "gates: []\n"));
    const state = await executePlaybook(def, { canonicalInput: "example.test" }, { invoke: fakeInvoke });
    expect(state.phase).toBe("completed");
  });
});
