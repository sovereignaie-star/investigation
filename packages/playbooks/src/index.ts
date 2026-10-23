/**
 * P5-007 — محرك كتب الإجراءات (YAML + بوابات، ADR-16).
 *
 * الكتاب تعريف YAML بمخطط صارم: مدخل، خطوات (استدعاءات محوّلات بترتيب طوبولوجي
 * معلن)، وبوابات بشرية توقف التنفيذ قبل الخطوة المحمية حتى تأكيد صريح. المحرك
 * تنسيق صرف: لا يستورد المحوّلات ولا الشبكة — يستدعي كل خطوة عبر دالة محقونة
 * (في الإنتاج: عدّاء المحوّلات عبر بوابة الخروج؛ في الاختبار: بديل حتمي)، فخّه
 * فاشل-مغلق (بيانات غير صالحة تُرفض عند التحميل لا عند التنفيذ) وحتمي وقابل
 * للاستئناف من حالة محفوظة (البوابة لا «تُعبر» بلا تأكيد، والاستئناف لا يعيد
 * تنفيذ الخطوات المنجزة).
 *
 * حدود معلنة (T-PLAY-004): مدخلات الأشخاص الطبيعيين تفحص قبل أي خطوة — كتاب
 * يعلنهم خارج النطاق يرفضهم دوماً، وكتاب يطلب غرضاً يرفضهم بلا تأكيد غرض موثق.
 */
import { createHash } from "node:crypto";
import { parse as parseYaml, type ParseOptions } from "yaml";
import { z } from "zod";

/* --------------------------------------------------------------- المخطط */

const StepSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "step id: lowercase kebab"),
  transform: z.string().min(1),
  /** مصدر مدخل الخطوة: «playbook» (مدخل الكتاب) أو معرّف خطوة سابقة. */
  input: z.string().min(1),
});

const GateSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "gate id: lowercase kebab"),
  /** الخطوة التي تحميها البوابة — يوقف التنفيذ قبلها. */
  before: z.string().min(1),
  reason: z.string().min(1),
  requires: z.literal("human_confirmation"),
});

const PlaybookYamlSchema = z.object({
  id: z.string().regex(/^PB-\d{2}$/, "playbook id: PB-nn"),
  title: z.string().min(1),
  description: z.string().optional(),
  /** نوع مدخل الكتاب (اسم حر غير فارغ — يفحصه المستدعي). */
  input: z.string().min(1),
  scope: z.object({
    natural_persons: z.enum(["out_of_scope", "requires_purpose"]),
  }),
  steps: z.array(StepSchema).min(1),
  gates: z.array(GateSchema).default([]),
});

/** الكتاب بعد التحقق — كل المراجع البينية محسومة (لا فحص لاحق). */
export interface PlaybookDefinition {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly input: string;
  readonly scope: { natural_persons: "out_of_scope" | "requires_purpose" };
  readonly steps: readonly { id: string; transform: string; input: string }[];
  readonly gates: readonly { id: string; before: string; reason: string; requires: "human_confirmation" }[];
}

export class PlaybookSchemaError extends Error {
  constructor(message: string) {
    super(`playbook schema: ${message}`);
    this.name = "PlaybookSchemaError";
  }
}

/**
 * تحميل كتاب من YAML نصي: تحليل ثم تحقق مخططي ثم فحوص مرجعية بينية صارمة —
 * معرفات خطوات فريدة، مراجع المدخلات موجودة، البوابات تحمي خطوات موجودة،
 * ولا حلقات اعتماد (ترتيب طوبولوجي). فاشل-مغلق: أي عيب يرفض الكتاب كله.
 */
export function loadPlaybook(yaml: string, options: ParseOptions = {}): PlaybookDefinition {
  const parsed = PlaybookYamlSchema.parse(parseYaml(yaml, options));
  const stepIds = new Set(parsed.steps.map((s) => s.id));
  if (stepIds.size !== parsed.steps.length) {
    const seen = new Set<string>();
    for (const s of parsed.steps) {
      if (seen.has(s.id)) throw new PlaybookSchemaError(`duplicate step id: ${s.id}`);
      seen.add(s.id);
    }
  }
  for (const s of parsed.steps) {
    if (s.input !== "playbook" && !stepIds.has(s.input)) {
      throw new PlaybookSchemaError(`step ${s.id} references unknown input: ${s.input}`);
    }
  }
  const gateIds = new Set<string>();
  for (const g of parsed.gates) {
    if (gateIds.has(g.id)) throw new PlaybookSchemaError(`duplicate gate id: ${g.id}`);
    gateIds.add(g.id);
    if (!stepIds.has(g.before)) {
      throw new PlaybookSchemaError(`gate ${g.id} guards unknown step: ${g.before}`);
    }
  }
  topoOrder(parsed.steps); // يرفع CycleError عند الحلقة
  return parsed;
}

/** ترتيب طوبولوجي حتمي (ترتيب الإعلان بين الجاهزين)؛ يرفع عند الحلقة. */
function topoOrder(steps: readonly { id: string; input: string }[]): string[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const done = new Set<string>();
  const order: string[] = [];
  let progressed = true;
  while (order.length < steps.length && progressed) {
    progressed = false;
    for (const s of steps) {
      if (done.has(s.id)) continue;
      if (s.input === "playbook" || done.has(s.input)) {
        done.add(s.id);
        order.push(s.id);
        progressed = true;
      }
    }
  }
  if (order.length < steps.length) {
    const remaining = steps.filter((s) => !done.has(s.id)).map((s) => s.id);
    throw new PlaybookSchemaError(`dependency cycle among steps: ${remaining.join(", ")} (byId=${[...byId.keys()].length})`);
  }
  return order;
}

/* --------------------------------------------------------------- التنفيذ */

/** مدخل تشغيل الكتاب. */
export interface PlaybookInput {
  readonly canonicalInput: string;
  readonly sensitivity?: "normal" | "natural_person_gate" | "minor";
}

/** استدعاء محوّل محقون — المحرك لا يعرف المحوّلات (تنسيق صرف). */
export type PlaybookInvoke = (transformId: string, input: unknown) => Promise<unknown>;

/** تأكيد بوابة بشرية. */
export interface GateConfirmation {
  readonly confirmedBy: string;
  readonly note?: string;
}

/** تأكيد غرض (متطلب E-02 للأشخاص الطبيعيين). */
export interface PurposeConfirmation {
  readonly purpose: string;
  readonly confirmedBy: string;
}

export interface ExecutePlaybookOptions {
  readonly invoke: PlaybookInvoke;
  /** تأكيدات البوابات المتاحة لهذا التشغيل. */
  readonly confirmations?: Readonly<Record<string, GateConfirmation>>;
  /** تأكيد الغرض (للأشخاص الطبيعيين عندما يطلب الكتاب غرضاً). */
  readonly purposeConfirmation?: PurposeConfirmation;
  /** استئناف من حالة محفوظة — لا يعاد تنفيذ المنجز. */
  readonly resume?: PlaybookState;
}

export type PlaybookPhase = "awaiting_gate" | "completed" | "failed" | "refused";

export interface CompletedStep {
  readonly stepId: string;
  readonly transform: string;
}

export type PlaybookFailure =
  | { readonly reason: "natural_person" | "out_of_scope" | "minor"; readonly message: string }
  | { readonly reason: "transform"; readonly message: string };

/** حالة تشغيل الكتاب — قابلة للتسلسل والاستئناف والحفظ مع القضية. */
export interface PlaybookState {
  readonly phase: PlaybookPhase;
  readonly completedSteps: readonly CompletedStep[];
  /** مخرجات الخطوات بمعرّفها. */
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly pendingGate?: { readonly gateId: string; readonly before: string; readonly reason: string };
  readonly failure?: PlaybookFailure;
  /** بصمة حتمية للحالة (نفس المنجز → نفس البصمة). */
  readonly stateHash: string;
}

/** تسلسل JSON حتمي (مفاتيح مرتبة تكرارياً). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

const stateHashOf = (completedSteps: readonly CompletedStep[], outputs: Readonly<Record<string, unknown>>): string =>
  createHash("sha256").update(stableStringify({ completedSteps, outputs })).digest("hex").slice(0, 32);

/** فحص نطاق الأشخاص الطبيعيين — قبل أي خطوة (فشل-مغلق). */
function scopeRefusal(def: PlaybookDefinition, input: PlaybookInput, purpose?: PurposeConfirmation): PlaybookFailure | undefined {
  if (input.sensitivity === "minor") {
    return { reason: "minor", message: "minor identifiers stop playbook execution (E-08)" };
  }
  if (input.sensitivity !== "natural_person_gate") return undefined;
  if (def.scope.natural_persons === "out_of_scope") {
    return {
      reason: "out_of_scope",
      message: `${def.id} declares natural persons out of scope — refusing the input`,
    };
  }
  const hasPurpose = purpose !== undefined && purpose.purpose.trim().length > 0 && purpose.confirmedBy.trim().length > 0;
  if (!hasPurpose) {
    return {
      reason: "natural_person",
      message: "natural-person input requires a documented purpose confirmation (E-02)",
    };
  }
  return undefined;
}

/**
 * تشغيل كتاب: يفحص النطاق أولاً (رفض صريح بلا أي استدعاء)، ثم ينفذ الخطوات
 * بترتيبها الطوبولوجي، متوقفاً عند كل بوابة بلا تأكيد (الخطوة المحمية لا تنفذ
 * أبداً بلا تأكيد صريح)، ويكمل أو يفشل بفشل مصنّف (لا ابتلاع صامت). الاستئناف
 * من حالة محفوظة لا يعيد تنفيذ المنجز.
 */
export async function executePlaybook(
  def: PlaybookDefinition,
  input: PlaybookInput,
  options: ExecutePlaybookOptions,
): Promise<PlaybookState> {
  const refusal = scopeRefusal(def, input, options.purposeConfirmation);
  if (refusal !== undefined) {
    return { phase: "refused", completedSteps: [], outputs: {}, failure: refusal, stateHash: stateHashOf([], {}) };
  }

  const resume = options.resume;
  const completedSteps: CompletedStep[] = resume ? [...resume.completedSteps] : [];
  const outputs: Record<string, unknown> = resume ? { ...resume.outputs } : {};
  const doneIds = new Set(completedSteps.map((s) => s.stepId));
  const confirmations = options.confirmations ?? {};

  const fail = (reason: "transform", message: string): PlaybookState => ({
    phase: "failed",
    completedSteps,
    outputs,
    failure: { reason, message },
    stateHash: stateHashOf(completedSteps, outputs),
  });

  for (const step of def.steps) {
    if (doneIds.has(step.id)) continue;
    const gate = def.gates.find((g) => g.before === step.id);
    if (gate !== undefined && !confirmations[gate.id]) {
      return {
        phase: "awaiting_gate",
        completedSteps,
        outputs,
        pendingGate: { gateId: gate.id, before: gate.before, reason: gate.reason },
        stateHash: stateHashOf(completedSteps, outputs),
      };
    }
    const stepInput = step.input === "playbook" ? input.canonicalInput : outputs[step.input];
    let result: unknown;
    try {
      result = await options.invoke(step.transform, stepInput);
    } catch (error) {
      return fail("transform", error instanceof Error ? error.message : String(error));
    }
    completedSteps.push({ stepId: step.id, transform: step.transform });
    outputs[step.id] = result;
  }

  return {
    phase: "completed",
    completedSteps,
    outputs,
    stateHash: stateHashOf(completedSteps, outputs),
  };
}
