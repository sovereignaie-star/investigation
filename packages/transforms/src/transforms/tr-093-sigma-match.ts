/**
 * TR-093 — Sigma rule matching over imported log events (P4-021, local LC-A
 * transform).
 *
 * Evaluates the frozen official SigmaHQ rules (bundled, normalized — no YAML at
 * runtime, no network) against structured log events the case imported. Pure
 * evaluation: nothing is fetched and nothing is executed.
 *
 * Every match becomes a finding whose evidence is the INPUT EVENTS
 * (`derivedFrom: "input"` — the runner binds it to the input's evidence):
 * "كل تطابق ملاحظة بدليل". Fail-closed: empty or non-object input is
 * refused; a rule outside the documented normalized shape fails LOUDLY.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformContext } from "../transform.ts";
import { matchSigma, type NormalizedSigmaRule, type SigmaEvent } from "../sigma/sigma.ts";
import { SIGMA_RULES } from "../sigma/rules.generated.ts";

export interface SigmaMatchInput {
  /** The structured events to evaluate (each one a log record). */
  readonly events: unknown[];
}

/** Resource limit (P2-034): the event batch is bounded before evaluation. */
const MAX_EVENTS = 100_000;

export const sigmaMatch = defineTransform<SigmaMatchInput>(
  {
    id: "TR-093",
    version: "1.0.0",
    inputs: ["log_events"],
    outputs: ["sigma_rule"],
    // Local transform: no network. `public` with an empty allow list is the
    // only valid declaration for a transform that never calls ctx.http.
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 100, timeoutMs: 60_000, maxBytes: 64 * 1024 * 1024 },
    sensitivity: "normal",
    license: "LC-A",
    admiralty: {
      reliability: "F",
      credibility: 3,
      rationale: "مطابقة قواعد SigmaHQ المجمدة على سجلات مستوردة — السجلات نفسها هي الدليل، ولا يُجلب ولا يُنفّذ شيء",
    },
  },
  async (input: SigmaMatchInput, _ctx: TransformContext) => {
    if (!input || !Array.isArray(input.events) || input.events.length === 0) {
      throw new Error("TR-093: input.events (a non-empty array) is required");
    }
    if (input.events.length > MAX_EVENTS) {
      throw new Error(`TR-093: input.events is ${input.events.length} events (limit ${MAX_EVENTS})`);
    }
    for (const e of input.events) {
      if (e === null || typeof e !== "object" || Array.isArray(e)) {
        throw new Error("TR-093: every event must be an object (a log record)");
      }
    }
    const findings = [];
    for (const raw of SIGMA_RULES) {
      const rule = raw as unknown as NormalizedSigmaRule;
      const matching = (input.events as SigmaEvent[]).filter((ev) => matchSigma(rule, ev));
      if (matching.length === 0) continue;
      findings.push(sigmaFindingOf(rule, matching));
    }
    return { findings };
  },
);

/** The finding for one rule's match set: confidence from the rule's level, evidence is the input events. */
function sigmaFindingOf(rule: NormalizedSigmaRule, matching: SigmaEvent[]) {
  const firstFields = rule.selections[0]?.alternatives[0]?.matchers.map((m) => `${m.field}=${matching[0]?.[m.field] ?? ""}`).join(" ");
  return {
    predicate: "sigma_match",
    objectType: "sigma_rule",
    objectValue: `${rule.id} — ${rule.title}`,
    confidence: LEVEL_CONFIDENCE[rule.level] ?? 0.6,
    explanation: `قاعدة Sigma «${rule.title}» (مستوى ${rule.level}) طابقت ${matching.length} حدثاً من السجلات المستوردة (${firstFields ?? ""}) — الدليل هو السجلات نفسها`,
    derivedFrom: "input" as const,
  };
}

const LEVEL_CONFIDENCE: Record<string, number> = {
  critical: 0.9,
  high: 0.8,
  medium: 0.6,
  low: 0.4,
};
