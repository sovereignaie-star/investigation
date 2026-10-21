import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CREDIBILITY_WEIGHTS,
  RELIABILITY_WEIGHTS,
  claimConfidence,
  type CredibilityGrade,
  type Observation,
  type ReliabilityGrade,
} from "./confidence.ts";

/**
 * P4-001 (ROADMAP 5.13 / D2): the deterministic, explainable confidence model —
 * property tests T-CONF-001..015 (fast-check): monotonicity, no double counting of
 * repetition, [0,1] bounds, determinism. The mathematical summary:
 *   c(claim) = 1 − ∏(1 − r_g · k_g) over independent groups g; within one group
 *   only the highest value counts. Contradictions are displayed separately and
 *   never subtracted in GA (ADR-12).
 */

const RELIABILITY_GRADES: ReliabilityGrade[] = ["A", "B", "C", "D", "E", "F"];
const CREDIBILITY_GRADES: CredibilityGrade[] = [1, 2, 3, 4, 5, 6];

/** Arbitrary observation: a source key and its Admiralty grades. */
const observationArb = fc.record({
  source: fc.string({ minLength: 1, maxLength: 12 }),
  reliability: fc.constantFrom(...RELIABILITY_GRADES),
  credibility: fc.constantFrom(...CREDIBILITY_GRADES),
}) as fc.Arbitrary<Observation>;

describe("P4-001: the 5.13 confidence model (T-CONF property tests)", () => {
  it("T-CONF-001: the result is always within [0, 1]", () => {
    fc.assert(
      fc.property(fc.array(observationArb, { maxLength: 30 }), (observations) => {
        const { confidence } = claimConfidence(observations);
        return confidence >= 0 && confidence <= 1;
      }),
    );
  });

  it("T-CONF-002: no observations → zero confidence (nothing claimed)", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (sources) => {
        const { confidence } = claimConfidence([]);
        return confidence === 0 && sources.length >= 0;
      }),
    );
  });

  it("T-CONF-003: a single observation's group contributes exactly r·k", () => {
    fc.assert(
      fc.property(observationArb, (o) => {
        const { confidence, groups } = claimConfidence([o]);
        const r = RELIABILITY_WEIGHTS[o.reliability];
        const k = CREDIBILITY_WEIGHTS[o.credibility];
        return groups.length === 1 && Math.abs(confidence - r * k) < 1e-12 && groups[0].weight === r * k;
      }),
    );
  });

  it("T-CONF-004: repetition inside one group never raises the confidence", () => {
    fc.assert(
      fc.property(fc.array(observationArb, { minLength: 1, maxLength: 10 }), (observations) => {
        const once = claimConfidence(observations).confidence;
        const doubled = claimConfidence([...observations, ...observations]).confidence;
        return Math.abs(once - doubled) < 1e-12;
      }),
    );
  });

  it("T-CONF-005: monotonicity in source reliability — a higher grade never lowers c", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 0, maxLength: 8 }),
        fc.constantFrom(...CREDIBILITY_GRADES),
        fc.nat(3), // index into the ordered reliability ladder (A..E — F is "unknown", off-ladder)
        (sources, k, i) => {
          const better = RELIABILITY_GRADES[i]; // A is the strongest; later letters are weaker
          const worse = RELIABILITY_GRADES[i + 1];
          const base = sources.map((source) => ({ source, reliability: "C" as const, credibility: k }));
          const withBetter = claimConfidence([...base, { source: "s-grade", reliability: better, credibility: k }]).confidence;
          const withWorse = claimConfidence([...base, { source: "s-grade", reliability: worse, credibility: k }]).confidence;
          return withBetter >= withWorse - 1e-12;
        },
      ),
    );
  });

  it("T-CONF-006: monotonicity in information credibility — a better grade never lowers c", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 0, maxLength: 8 }),
        fc.constantFrom(...RELIABILITY_GRADES),
        fc.nat(3), // index into the ordered credibility ladder (1..5 — 6 is "unknown", off-ladder)
        (sources, r, i) => {
          const better = CREDIBILITY_GRADES[i]; // 1 is the strongest; higher numbers are weaker
          const worse = CREDIBILITY_GRADES[i + 1];
          const base = sources.map((source) => ({ source, reliability: r, credibility: 3 as CredibilityGrade }));
          const withBetter = claimConfidence([...base, { source: "s-grade", reliability: r, credibility: better }]).confidence;
          const withWorse = claimConfidence([...base, { source: "s-grade", reliability: r, credibility: worse }]).confidence;
          return withBetter >= withWorse - 1e-12;
        },
      ),
    );
  });

  it("T-CONF-007: adding an independent group never decreases the confidence", () => {
    fc.assert(
      fc.property(fc.array(observationArb, { minLength: 0, maxLength: 10 }), observationArb, (observations, extra) => {
        const before = claimConfidence(observations).confidence;
        const after = claimConfidence([...observations, extra]).confidence;
        return after >= before - 1e-12;
      }),
    );
  });

  it("T-CONF-008: the groups' order never changes the result (commutativity)", () => {
    fc.assert(
      fc.property(fc.array(observationArb, { minLength: 0, maxLength: 12 }), (observations) => {
        const forward = claimConfidence(observations).confidence;
        const reversed = claimConfidence([...observations].reverse()).confidence;
        return Math.abs(forward - reversed) < 1e-12;
      }),
    );
  });

  it("T-CONF-009: determinism — the same input yields the identical result, every time", () => {
    fc.assert(
      fc.property(fc.array(observationArb, { maxLength: 15 }), (observations) => {
        const a = claimConfidence(observations);
        const b = claimConfidence([...observations]);
        return a.confidence === b.confidence && JSON.stringify(a.groups) === JSON.stringify(b.groups) && a.explanation === b.explanation;
      }),
    );
  });

  it("T-CONF-010: the spec's anchors — A=0.95, E=0.30, F=0.50, k1=0.95, k5=0.20, k6=0.50", () => {
    expect(RELIABILITY_WEIGHTS.A).toBe(0.95);
    expect(RELIABILITY_WEIGHTS.E).toBe(0.3);
    expect(RELIABILITY_WEIGHTS.F).toBe(0.5);
    expect(CREDIBILITY_WEIGHTS[1]).toBe(0.95);
    expect(CREDIBILITY_WEIGHTS[5]).toBe(0.2);
    expect(CREDIBILITY_WEIGHTS[6]).toBe(0.5);
    // and the anchors compose exactly as the formula says for one group
    expect(claimConfidence([{ source: "s", reliability: "A", credibility: 1 }]).confidence).toBeCloseTo(0.95 * 0.95, 12);
  });

  it("T-CONF-011: the intermediate grades are the documented linear interpolation (declared decision)", () => {
    // RELIABILITY: linear between A=0.95 and E=0.30 (F=0.5 unknown, off-ladder)
    expect(RELIABILITY_WEIGHTS.B).toBeCloseTo(0.95 - (0.65 / 4) * 1, 12);
    expect(RELIABILITY_WEIGHTS.C).toBeCloseTo(0.95 - (0.65 / 4) * 2, 12);
    expect(RELIABILITY_WEIGHTS.D).toBeCloseTo(0.95 - (0.65 / 4) * 3, 12);
    // CREDIBILITY: linear between 1=0.95 and 5=0.20 (6=0.5 unknown, off-ladder)
    expect(CREDIBILITY_WEIGHTS[2]).toBeCloseTo(0.95 - (0.75 / 4) * 1, 12);
    expect(CREDIBILITY_WEIGHTS[3]).toBeCloseTo(0.95 - (0.75 / 4) * 2, 12);
    expect(CREDIBILITY_WEIGHTS[4]).toBeCloseTo(0.95 - (0.75 / 4) * 3, 12);
  });

  it("T-CONF-012: two independent groups with equal weight v give 1−(1−v)²", () => {
    fc.assert(
      fc.property(observationArb, (o) => {
        const v = RELIABILITY_WEIGHTS[o.reliability] * CREDIBILITY_WEIGHTS[o.credibility];
        const { confidence, groups } = claimConfidence([
          { ...o, source: "one" },
          { ...o, source: "two" },
        ]);
        return groups.length === 2 && Math.abs(confidence - (1 - (1 - v) * (1 - v))) < 1e-12;
      }),
    );
  });

  it("T-CONF-013: many strong independent groups approach 1 but never exceed it", () => {
    const groups = Array.from({ length: 50 }, (_, i) => ({
      source: `independent-${i}`,
      reliability: "A" as ReliabilityGrade,
      credibility: 1 as CredibilityGrade,
    }));
    const { confidence } = claimConfidence(groups);
    expect(confidence).toBeLessThanOrEqual(1);
    expect(confidence).toBeGreaterThan(0.999); // 1−(1−0.9025)^50
    expect(confidence).toBeCloseTo(1 - Math.pow(1 - 0.95 * 0.95, 50), 12);
  });

  it("T-CONF-014 (ADR-12): contradictions are displayed separately and never change the score", () => {
    fc.assert(
      fc.property(
        fc.array(observationArb, { maxLength: 10 }),
        fc.array(observationArb, { maxLength: 10 }),
        (observations, contradicting) => {
          const without = claimConfidence(observations);
          const withContradictions = claimConfidence(
            observations,
            contradicting.map((o) => ({ ...o, summary: `مناقض من ${o.source}` })),
          );
          return without.confidence === withContradictions.confidence && withContradictions.contradictions.length === contradicting.length;
        },
      ),
    );
  });

  it("T-CONF-015: within a group only the max r·k counts — weaker duplicates are inert", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.constantFrom(...RELIABILITY_GRADES),
        fc.constantFrom(...CREDIBILITY_GRADES),
        fc.nat(6), // how many inert weak duplicates to pile onto the strong one
        (source, strongR, strongK, weakCount) => {
          const strong = { source, reliability: strongR, credibility: strongK };
          // E×5 (0.06) is the minimum possible weight — these duplicates can never
          // displace the strong observation's max, so they must be perfectly inert.
          const weak = Array.from({ length: weakCount }, () => ({
            source,
            reliability: "E" as const,
            credibility: 5 as CredibilityGrade,
          }));
          const alone = claimConfidence([strong]).confidence;
          const withWeak = claimConfidence([strong, ...weak]).confidence;
          return Math.abs(alone - withWeak) < 1e-12;
        },
      ),
    );
  });

  it("the explanation names every group and renders the applied formula (مفسَّر)", () => {
    const result = claimConfidence(
      [
        { source: "سجل-الشركات", reliability: "A", credibility: 1 },
        { source: "تقرير-إخباري", reliability: "C", credibility: 3 },
      ],
      [{ source: "مدونة-مجهولة", reliability: "E", credibility: 5, summary: "ادعاء مناقض" }],
    );
    // the explanation mentions both independent sources and the contradiction, separately
    expect(result.explanation).toContain("سجل-الشركات");
    expect(result.explanation).toContain("تقرير-إخباري");
    expect(result.explanation).toContain("مدونة-مجهولة");
    expect(result.explanation).toContain("مناقض"); // contradictions flagged, not merged
    // and the score itself is the exact formula
    const v1 = 0.95 * 0.95;
    const v2 = RELIABILITY_WEIGHTS.C * CREDIBILITY_WEIGHTS[3];
    expect(result.confidence).toBeCloseTo(1 - (1 - v1) * (1 - v2), 12);
  });
});
