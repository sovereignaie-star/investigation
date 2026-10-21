/**
 * P4-001 (ROADMAP 5.13 / D2): the deterministic, explainable confidence model.
 *
 * The mathematical summary (5.13):
 *   c(claim) = 1 − ∏(1 − r_g · k_g)   over independent observation groups g
 *
 * - G is the set of INDEPENDENT groups: observations that trace back to one
 *   original source form ONE group (the model never double counts repetition).
 * - r_g is the source's reliability (Admiralty A–F), k_g the information's
 *   credibility (1–6). Inside one group only the highest r·k counts.
 * - Contradicting evidence is DISPLAYED SEPARATELY and never subtracted in GA
 *   (ADR-12 — no automatic contradiction arithmetic).
 *
 * Declared decision (DECLARED_LIMITS): the spec fixes only the anchors
 * (A=0.95 … E=0.30, F=0.50 unknown; k1=0.95 … k5=0.20, k6=0.50 unknown). The
 * intermediate grades are the exact linear interpolation between those anchors —
 * an engineering-delegated parameter table the owner may retune in ONE place
 * (the tables below); every property (monotonicity, bounds, determinism) is
 * tested independently of the concrete numbers.
 */

export type ReliabilityGrade = "A" | "B" | "C" | "D" | "E" | "F";
export type CredibilityGrade = 1 | 2 | 3 | 4 | 5 | 6;

/** r — source reliability. Anchors per 5.13; B–D linear in between; F=0.50 unknown. */
export const RELIABILITY_WEIGHTS: Record<ReliabilityGrade, number> = {
  A: 0.95,
  B: 0.7875,
  C: 0.625,
  D: 0.4625,
  E: 0.3,
  F: 0.5,
};

/** k — information credibility. Anchors per 5.13; 2–4 linear in between; 6=0.50 unknown. */
export const CREDIBILITY_WEIGHTS: Record<CredibilityGrade, number> = {
  1: 0.95,
  2: 0.7625,
  3: 0.575,
  4: 0.3875,
  5: 0.2,
  6: 0.5,
};

/** One observation of a claim: which original source it traces back to, with its grades. */
export interface Observation {
  /** Identity of the ORIGINAL source — observations sharing it are ONE independent group. */
  source: string;
  reliability: ReliabilityGrade;
  credibility: CredibilityGrade;
}

/** One independent group's contribution to the formula. */
export interface GroupContribution {
  /** The group's original source identity. */
  source: string;
  reliability: ReliabilityGrade;
  credibility: CredibilityGrade;
  /** r_g · k_g — the group's effective weight (the max within the group). */
  weight: number;
  /** 1 − weight — the group's factor in the product. */
  factor: number;
}

/** Contradicting evidence — carried to the UI untouched, never merged into the score (ADR-12). */
export interface Contradiction extends Observation {
  /** Human-readable summary of what the contradicting source claims. */
  summary: string;
}

export interface ConfidenceResult {
  /** c(claim) ∈ [0,1]. */
  confidence: number;
  /** The independent groups, in order of first appearance in the input. */
  groups: GroupContribution[];
  /** Contradicting evidence, displayed separately — never affects `confidence`. */
  contradictions: Contradiction[];
  /** Arabic rendering of the applied formula — the model is مفسَّر (explainable). */
  explanation: string;
}

/** The group's weight: within one group only the highest r·k counts (no double counting). */
function groupWeight(observations: Observation[]): { weight: number; best: Observation } {
  let best = observations[0];
  let weight = 0;
  for (const o of observations) {
    const w = RELIABILITY_WEIGHTS[o.reliability] * CREDIBILITY_WEIGHTS[o.credibility];
    if (w > weight) {
      weight = w;
      best = o;
    }
  }
  return { weight, best };
}

/**
 * Computes c(claim) per 5.13. Deterministic, pure, order-independent (groups are
 * keyed by their original source). Contradictions pass through for separate
 * display and never touch the score.
 */
export function claimConfidence(observations: Observation[], contradictions: Contradiction[] = []): ConfidenceResult {
  // group by original source, preserving first-appearance order
  const bySource = new Map<string, Observation[]>();
  for (const o of observations) {
    const list = bySource.get(o.source);
    if (list === undefined) bySource.set(o.source, [o]);
    else list.push(o);
  }

  const groups: GroupContribution[] = [];
  let product = 1;
  for (const [source, list] of bySource) {
    const { weight, best } = groupWeight(list);
    const factor = 1 - weight;
    product *= factor;
    groups.push({
      source,
      reliability: best.reliability,
      credibility: best.credibility,
      weight,
      factor,
    });
  }

  const confidence = 1 - product;

  // the explanation: the applied formula, rendered — every group named, every factor shown
  const formula =
    groups.length === 0
      ? "لا ملاحظات مستقلة بعد؛ الثقة صفر حتى توجد ملاحظة موثقة"
      : groups.map((g) => `(1−${g.weight.toFixed(4)})`).join(" × ");
  const sourcesLine =
    groups.length === 0
      ? ""
      : `مجموعات مستقلة: ${groups.map((g) => `${g.source} (r=${g.reliability}=${RELIABILITY_WEIGHTS[g.reliability]}، k=${g.credibility}=${CREDIBILITY_WEIGHTS[g.credibility]})`).join("؛ ")}`;
  const contradictionLine =
    contradictions.length === 0
      ? ""
      : ` أدلة مناقضة تُعرض منفصلة ولا تُطرح آلياً (ADR-12): ${contradictions.map((c) => `${c.source} (r=${c.reliability}، k=${c.credibility}): ${c.summary}`).join("؛ ")}`;

  const explanation = `الثقة = 1 − ${formula} = ${confidence.toFixed(4)}. ${sourcesLine}.${contradictionLine}`;

  return { confidence, groups, contradictions, explanation };
}
