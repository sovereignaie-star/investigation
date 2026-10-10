import { accepts, expandExample, IDENTIFIER_SPECS, matchesSpec } from "./index.ts";
import type { IdentifierSpecData } from "./types.ts";

/**
 * Multi-candidate identifier detection (5.6, P1-006). Never "first match": every type whose pattern accepts the value
 * and whose validator does not reject it is a candidate, ranked by
 *   - validation: a passing structural check (checksum, registry, PSL) is strong evidence;
 *   - specificity: measured on the catalog itself, as how many other types' examples the pattern also accepts
 *     (a bare-username pattern accepts dozens, "sk_test_..." accepts one);
 *   - context: keywords near the value (a type with `context.required` is dropped without one, D-009) and the
 *     type's own label words ("IBAN", "passport", "هاتف").
 * Scores are in (0, 1]; candidates that share a pattern stay separate entries with equal scores (D-007, D-029).
 */
export interface Candidate {
  type: string;
  score: number;
  validated: boolean;
  specificity: number;
  context: string[];
  sensitivity: IdentifierSpecData["sensitivity"];
}

export interface DetectOptions {
  /** Surrounding text (a sentence, a column header, a form label). */
  context?: string;
  /** Keep at most this many candidates (default: all). */
  limit?: number;
  /** Drop candidates under this score (default 0). */
  minScore?: number;
}

const W = { validated: 0.45, specificity: 0.35, keyword: 0.15, label: 0.15, contextCap: 0.2 };

let generality: Map<string, number> | undefined;
/** For each type, how many catalog examples (of any type) it accepts; computed once, lazily. */
function generalityOf(id: string): number {
  if (!generality) {
    const examples = IDENTIFIER_SPECS.flatMap((s) => s.examples.positive.map(expandExample));
    generality = new Map(IDENTIFIER_SPECS.map((s) => [s.id, Math.max(1, examples.filter((e) => accepts(s, e)).length)]));
  }
  return generality.get(id) ?? 1;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);
const STOP = new Set(["address", "number", "code", "username", "profile", "user", "account", "key", "token", "the", "and", "for"]);

function labelWords(spec: IdentifierSpecData): string[] {
  return [...new Set([...words(spec.labels.en), ...words(spec.labels.ar), ...spec.id.split("_").filter((w) => w.length >= 3)])].filter(
    (w) => !STOP.has(w),
  );
}

const round = (x: number) => Math.round(x * 1e4) / 1e4;

/** Scores one type against the value; null when the type is not a candidate. */
function score(spec: IdentifierSpecData, text: string, ctx: string, ctxWords: Set<string>): Candidate | null {
  const m = matchesSpec(spec, text);
  if (!m.pattern || m.valid === false) return null;
  const keywords = (spec.context?.keywords ?? []).filter((k) => ctx.includes(k.toLowerCase()));
  if (spec.context?.required && keywords.length === 0) return null;
  const labels = labelWords(spec).filter((w) => ctxWords.has(w));
  const specificity = 1 - Math.log(generalityOf(spec.id)) / Math.log(IDENTIFIER_SPECS.length);
  const contextScore = Math.min(W.contextCap, (keywords.length > 0 ? W.keyword : 0) + (labels.length > 0 ? W.label : 0));
  return {
    type: spec.id,
    score: round((m.valid === true ? W.validated : 0) + W.specificity * specificity + contextScore),
    validated: m.valid === true,
    specificity: round(specificity),
    context: [...keywords, ...labels],
    sensitivity: spec.sensitivity,
  };
}

export function detect(value: string, opts: DetectOptions = {}): Candidate[] {
  const text = value.trim();
  if (text.length === 0 || text.length > 4096) return [];
  const ctx = (opts.context ?? "").toLowerCase();
  const ctxWords = new Set(words(ctx));
  const out = IDENTIFIER_SPECS.flatMap((spec) => score(spec, text, ctx, ctxWords) ?? []);
  out.sort((a, b) => b.score - a.score || b.specificity - a.specificity || a.type.localeCompare(b.type));
  const kept = out.filter((c) => c.score >= (opts.minScore ?? 0));
  return opts.limit ? kept.slice(0, opts.limit) : kept;
}

/** The best candidate, or null; callers that need certainty should inspect the full list instead. */
export const detectBest = (value: string, opts: DetectOptions = {}): Candidate | null => detect(value, { ...opts, limit: 1 })[0] ?? null;
