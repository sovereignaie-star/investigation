/**
 * P5-016 — وضع التدريب في المحاكاة (UC-23: تمرين بنتيجة مرجعية، بلا إنترنت).
 *
 * التمرين = عالم وهمي (قواعد محاكاة حتمية — نفس عالم P2-008) + هدف + نتيجة
 * مرجعية + تصحيح حتمي. المتدرب يستقصي داخل العالم عبر نقل المحاكاة (بلا أي
 * شبكة) ويسجل نتائجه، ثم يُصحح بنتيجة مرجعية: المطابقة الكاملة = ناجح،
 * والفروق تُشخّص (مفقود/خطأ/إضافي). فشل مغلق عند التحميل (مخطط صارم).
 */
import { createSimServer, type SimRule, type SimServer } from "./server.ts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/** نتيجة يسجلها المتدرب — حقيقة مفاتيحها ومقاديرها. */
export interface TrainingFinding {
  readonly key: string;
  readonly value: string;
}

/** نتيجة مرجعية — بند في مجموعة النتائج المتوقعة. */
export interface ReferenceOutcomeItem {
  readonly key: string;
  readonly value: string;
}

export interface TrainingScenario {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  /** قواعد العالم الوهمي (تُبنى عليها خادمة المحاكاة). */
  readonly world: readonly SimRule[];
  /** النتيجة المرجعية — مجموعة النتائج التي يجب أن يصل إليها التمرين. */
  readonly referenceOutcome: readonly ReferenceOutcomeItem[];
}

export class TrainingScenarioError extends Error {
  constructor(
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = "TrainingScenarioError";
  }
}

const ResponseRuleSchema = z.object({
  status: z.number().int().min(200).max(599),
  body: z.string().optional(),
});

const WorldRuleSchema = z.object({
  match: z.string().min(1),
  response: ResponseRuleSchema,
});

const OutcomeItemSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});

const ScenarioSchema = z.object({
  id: z.string().regex(/^TRN-\d{2}$/, "scenario id: TRN-nn"),
  title: z.string().min(1),
  objective: z.string().min(1),
  world: z.array(WorldRuleSchema).min(1),
  reference_outcome: z.array(OutcomeItemSchema).min(1),
});

/** تحميل تمرين تدريبي من YAML — فشل مغلق عند أي نقص أو مخالفة مخطط. */
export function loadTrainingScenario(yaml: string): TrainingScenario {
  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch (cause) {
    throw new TrainingScenarioError(`training scenario: YAML غير صالح — ${cause instanceof Error ? cause.message : "parse failure"}`);
  }
  const result = ScenarioSchema.safeParse(parsed);
  if (!result.success) {
    throw new TrainingScenarioError(
      `training scenario: مخطط التمرين غير مكتمل — ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      result.error.issues,
    );
  }
  return {
    id: result.data.id,
    title: result.data.title,
    objective: result.data.objective,
    world: result.data.world.map((r) => ({
      match: r.match,
      response: { status: r.response.status, body: r.response.body ?? "" },
    })),
    referenceOutcome: result.data.reference_outcome,
  };
}

/** عالم التمرين: خادمة محاكاة حتمية من قواعد السيناريو — بلا أي شبكة. */
export function createTrainingWorld(scenario: TrainingScenario): SimServer {
  return createSimServer([...scenario.world]);
}

export interface TrainingGrade {
  readonly passed: boolean;
  /** نسبة النتائج المرجعية المستوفاة (0..1). */
  readonly score: number;
  /** نتائج مرجعية لم يصل إليها المتدرب. */
  readonly missing: readonly string[];
  /** نتائج خاطئة — مفتاح موجود بقيمة مغايرة. */
  readonly wrong: readonly TrainingFinding[];
  /** نتائج إضافية ليست في المرجع — تُعلن ولا تُرسب وحدها. */
  readonly extra: readonly TrainingFinding[];
}

/**
 * تصحيح حتمي بنتيجة مرجعية: المطابقة الكاملة (لا مفقود ولا خطأ) = ناجح
 * بدرجة كاملة، والفروق تُشخّص بمقدارها — نفس العمل يعطي نفس النتيجة بالضبط.
 */
export function gradeTrainingRun(scenario: TrainingScenario, findings: readonly TrainingFinding[]): TrainingGrade {
  const reference = new Map(scenario.referenceOutcome.map((o) => [o.key, o.value]));
  const submitted = new Map(findings.map((f) => [f.key, f.value]));
  const missing: string[] = [];
  const wrong: TrainingFinding[] = [];
  const extra: TrainingFinding[] = [];
  for (const [key, expectedValue] of reference) {
    const actual = submitted.get(key);
    if (actual === undefined) {
      missing.push(key);
    } else if (actual !== expectedValue) {
      wrong.push({ key, value: actual });
    }
  }
  for (const [key, value] of submitted) {
    if (!reference.has(key)) {
      extra.push({ key, value });
    }
  }
  const total = scenario.referenceOutcome.length;
  const correct = total - missing.length - wrong.length;
  return {
    passed: missing.length === 0 && wrong.length === 0,
    score: total === 0 ? 0 : correct / total,
    missing,
    wrong,
    extra,
  };
}
