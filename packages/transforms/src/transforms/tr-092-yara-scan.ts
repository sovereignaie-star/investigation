/**
 * TR-092 — YARA scan of an uploaded file (P4-021, local LC-A transform).
 *
 * Scans a file's BYTES against the frozen YARA Forge core rules (bundled,
 * generated module — no network, no runtime file reads). The scan is STATIC
 * PATTERN MATCHING ONLY: nothing is ever executed (the sandbox's PB-07 rule,
 * extended to whole files — "الفحص داخل العزل ولا يُنفّذ أي ملف").
 *
 * Every match becomes a finding whose evidence is the INPUT FILE itself
 * (`derivedFrom: "input"` — the runner binds it to the input's evidence):
 * "كل تطابق ملاحظة بدليل". Confidence comes from the rule's own `score`
 * meta (0-100 → 0-1); no score → 0.5, honestly mid, never invented high.
 * Fail-closed: empty or non-base64 input is refused; a rule outside the
 * engine's documented subset fails LOUDLY at parse time (a test pins the
 * frozen set against the parser).
 */
import { defineTransform } from "../manifest.ts";
import type { TransformContext } from "../transform.ts";
import { parseYaraRule, scanYara, type YaraMatch } from "../yara/yara.ts";
import { YARA_FORGE_RULES } from "../yara/rules.generated.ts";

export interface YaraScanInput {
  /** The file's bytes, base64-encoded. */
  readonly content: string;
}

const RULES = YARA_FORGE_RULES.map((r) => parseYaraRule(r.text));

/** Resource limit (P2-034): files are bounded before any matching work. */
const MAX_BYTES = 64 * 1024 * 1024;

export const yaraScan = defineTransform<YaraScanInput>(
  {
    id: "TR-092",
    version: "1.0.0",
    inputs: ["file_content"],
    outputs: ["yara_rule"],
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
      rationale: "فحص ثابت لبايتات الملف ضد قواعد YARA Forge المجمدة محلياً — الملف نفسه هو الدليل، ولا يُنفّذ شيء",
    },
  },
  async (input: YaraScanInput, _ctx: TransformContext) => {
    if (!input || typeof input.content !== "string" || input.content.length === 0) {
      throw new Error("TR-092: input.content (base64) is required");
    }
    const bytes = Buffer.from(input.content, "base64");
    if (bytes.length === 0 || bytes.toString("base64").replace(/=+$/, "") !== input.content.replace(/=+$/, "")) {
      throw new Error("TR-092: input.content is not valid base64");
    }
    if (bytes.length > MAX_BYTES) {
      throw new Error(`TR-092: input is ${bytes.length} bytes (limit ${MAX_BYTES})`);
    }
    const matches = scanYara(RULES, new Uint8Array(bytes));
    return {
      findings: matches.map((m: YaraMatch) => {
        const rule = RULES.find((r) => r.name === m.ruleName);
        const score = typeof rule?.meta.score === "number" ? (rule.meta.score as number) : undefined;
        const firstHit = rule?.strings.find((s) => m.matches.some((hit) => hit.id === s.id));
        const detail = firstHit && firstHit.kind === "text" ? ` — أول إصابة: «${firstHit.value}»` : "";
        return {
          predicate: "yara_match",
          objectType: "yara_rule",
          objectValue: m.ruleName,
          confidence: score !== undefined ? score / 100 : 0.5,
          explanation: `قاعدة YARA «${m.ruleName}» طابقت الملف ثابتياً (${m.matches.length} إصابة نمطية)${detail} — الدليل هو الملف المفحوص نفسه`,
          derivedFrom: "input",
        };
      }),
    };
  },
);
