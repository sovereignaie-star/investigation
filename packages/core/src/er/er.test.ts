/**
 * P4-004 (ROADMAP 5.14 / D9) — entity resolution: blocking, comparison, weights.
 *
 * The red test for the whole `core/er` module: written FIRST, against an API
 * that does not exist yet. Every test below names its spec source.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  erComparisonKey,
  jaroWinkler,
  blockKeys,
  estimateWeights,
  scorePair,
  resolveEntities,
  generateReferenceSet,
  type ErRecord,
  type FsWeights,
  ER_MODEL_VERSION,
  ER_MODEL_WEIGHTS,
  ER_MODEL_THRESHOLDS,
  STRONG_THRESHOLD,
  REVIEW_THRESHOLD,
} from "./index.ts";

describe("P4-004: comparison primitives (5.14 المقارنة)", () => {
  it("T-ER-001: Jaro-Winkler matches the reference cases from the literature, and is symmetric", () => {
    // Winkler's own published examples (1990): the classic test vectors.
    expect(jaroWinkler("MARTHA", "MARHTA")).toBeCloseTo(0.9611, 3);
    expect(jaroWinkler("DWAYNE", "DUANE")).toBeCloseTo(0.84, 2);
    expect(jaroWinkler("DIXON", "DICKSONX")).toBeCloseTo(0.8133, 3);
    // symmetry and bounds
    expect(jaroWinkler("محمد", "محمود")).toBe(jaroWinkler("محمود", "محمد"));
    expect(jaroWinkler("a", "a")).toBe(1);
    expect(jaroWinkler("", "")).toBe(1); // identical (empty) strings — identity
    expect(jaroWinkler("abc", "xyz")).toBe(0);
  });

  it("T-ER-001p: Jaro-Winkler properties — symmetry, bounds, identity (fast-check)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 30 }), fc.string({ minLength: 0, maxLength: 30 }), (a, b) => {
        const s = jaroWinkler(a, b);
        return Number.isFinite(s) && s >= 0 && s <= 1 && s === jaroWinkler(b, a) && (a !== b || s === 1);
      }),
    );
  });

  it("T-ER-002: the Arabic comparison key applies the DECLARED approximate folds (and nothing more)", () => {
    // folds: diacritics/tatweel stripped, alef variants → ا, taa marbuta → ه, ى/ي folded, case
    expect(erComparisonKey("أحمد")).toBe(erComparisonKey("احمد"));
    expect(erComparisonKey("إبراهيم")).toBe(erComparisonKey("ابراهيم"));
    expect(erComparisonKey("آمنة")).toBe(erComparisonKey("امنه"));
    expect(erComparisonKey("فاطمة")).toBe(erComparisonKey("فاطمه"));
    expect(erComparisonKey("مصطفى")).toBe(erComparisonKey("مصطفي"));
    expect(erComparisonKey("مُحَمَّد")).toBe(erComparisonKey("محمد"));
    expect(erComparisonKey("محمدـ")).toBe(erComparisonKey("محمد"));
    expect(erComparisonKey("ACME Ltd")).toBe(erComparisonKey("acme ltd"));
    // the ى/ي fold is the SAME name spelled two ways — it must fold (approximate,
    // not identity: a declared fold, asserted on the positive side too)
    expect(erComparisonKey("على")).toBe(erComparisonKey("علي"));
    // NEGATIVE collision test: the folds are APPROXIMATE, not equality — distinct
    // names that share letters must NOT collapse to the same key
    expect(erComparisonKey("سالم")).not.toBe(erComparisonKey("سالمه"));
    expect(erComparisonKey("محمد")).not.toBe(erComparisonKey("محمود"));
    expect(erComparisonKey("علي")).not.toBe(erComparisonKey("علاء"));
  });
});

describe("P4-004: blocking (5.14 الحجب)", () => {
  it("T-ER-003: every TRUE duplicate pair in the reference set shares at least one block key (blocking recall = 100%)", () => {
    const set = generateReferenceSet(42);
    const allPairs = [...set.train.duplicatePairs, ...set.eval.duplicatePairs];
    for (const { a, b } of allPairs) {
      const ka = new Set(blockKeys(a));
      const overlap = blockKeys(b).some((k) => ka.has(k));
      if (!overlap) {
        throw new Error(`blocking missed a true duplicate: ${a.id} / ${b.id}`);
      }
    }
  });

  it("T-ER-004: block keys are the spec's keys — normalized identifier and first-3-of-name + country — and deterministic", () => {
    const r: ErRecord = {
      id: "e1",
      name: "محمد عبدالله",
      country: "SA",
      identifiers: ["passport:P1234567"],
    };
    const keys = blockKeys(r);
    expect(keys).toContain("id:passport:p1234567");
    const k3 = erComparisonKey("محمد عبدالله").slice(0, 3);
    expect(keys).toContain(`name3:${k3}:sa`);
    expect(blockKeys(r)).toEqual(keys);
  });

  it("T-ER-004p: blocking completeness under arbitrary field permutations (fast-check)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 3, maxLength: 20 }),
        fc.option(fc.constantFrom("SA", "EG", "JO", "US"), { nil: undefined }),
        (name, country) => {
          const a: ErRecord = { id: "a", name, country, identifiers: ["x:1"] };
          const b: ErRecord = { id: "b", name, country, identifiers: [] };
          const ka = new Set(blockKeys(a));
          return blockKeys(b).some((k) => ka.has(k));
        },
      ),
    );
  });
});

describe("P4-004: Fellegi-Sunter weights (5.14 الأوزان)", () => {
  it("T-ER-005: m/u estimated from the TRAIN split — discriminative features get positive weight, finite values", () => {
    const set = generateReferenceSet(42);
    const weights = estimateWeights(set.train);
    expect(Number.isFinite(weights.name)).toBeTruthy();
    expect(Number.isFinite(weights.namePartial)).toBeTruthy();
    expect(Number.isFinite(weights.date)).toBeTruthy();
    expect(Number.isFinite(weights.address)).toBeTruthy();
    // the name feature is discriminative: agreement is far more likely for matches
    expect(weights.name).toBeGreaterThan(0);
    // u < m: agreement on a discriminative feature must favor match
    expect(weights.name).toBeGreaterThan(weights.namePartial);
  });

  it("T-ER-006: scoring — shared normalized identifier is DETERMINISTIC strong; missing fields contribute nothing", () => {
    const set = generateReferenceSet(42);
    const weights = estimateWeights(set.train);
    // same canonical identifier → strong suggestion regardless of everything else (D9)
    const r1: ErRecord = { id: "a", name: "محمد", identifiers: ["passport:p123"] };
    const r2: ErRecord = { id: "b", name: "شركة مختلفة تماماً", identifiers: ["passport:p123"] };
    const shared = scorePair(r1, r2, weights);
    expect(shared.decision).toBe("strong");
    expect(shared.reasons.some((x) => x.feature === "identifier")).toBeTruthy();
    // completely missing fields → no contribution (neutral), not a penalty
    const bare1: ErRecord = { id: "c", name: "محمد" };
    const bare2: ErRecord = { id: "d", name: "محمد" };
    const bare = scorePair(bare1, bare2, weights);
    expect(bare.reasons.every((x) => x.feature !== "date" && x.feature !== "address")).toBeTruthy();
    expect(bare.score).toBeGreaterThanOrEqual(weights.name);
  });
});

describe("P4-004: resolution end-to-end (D9 — F1 ≥ 0.9 على مجموعة مرجعية)", () => {
  it("T-ER-008: F1 ≥ 0.9 on the fixed synthetic acceptance set (seed 1337)", () => {
    // HONESTY NOTE (recorded in WORKLOG/DECLARED_LIMITS L-45): the development
    // set (seed 42) was measured twice while the generator was iterated (0.8992
    // → generator realism fix → 0.9345) — that is eval leakage, so the generator
    // is NOT independent of that development history. This seed-1337 set is a
    // FIXED synthetic acceptance set: the model was measured on it, then
    // re-measured on the SAME set after the review-found bug fixes (identifier
    // guarantee, Laplace denominators) with NO retuning. The weights are
    // estimated from seed-42 TRAIN only; the thresholds are declared constants
    // (4.0 / 1.0, not estimated).
    const dev = generateReferenceSet(42);
    const weights = estimateWeights(dev.train);
    const frozen = generateReferenceSet(1337);
    const suggestions = resolveEntities(frozen.eval.records, weights);
    // every suggestion is a candidate pair the reference set can judge
    const truth = new Set(frozen.eval.duplicatePairs.map((p) => [p.a.id, p.b.id].sort().join("|")));
    let tp = 0;
    let fp = 0;
    for (const s of suggestions) {
      const key = [s.aId, s.bId].sort().join("|");
      if (truth.has(key)) tp += 1;
      else fp += 1;
    }
    const fn = truth.size - tp;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = truth.size === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    expect(f1).toBeGreaterThanOrEqual(0.9);
  });

  it("T-ER-009: every suggestion is EXPLAINABLE — reasons with weights, summing to the score (D9 التفسير)", () => {
    const set = generateReferenceSet(42);
    const weights = estimateWeights(set.train);
    const suggestions = resolveEntities(set.eval.records, weights);
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.reasons.length).toBeGreaterThan(0);
      const sum = s.reasons.reduce((acc, r) => acc + r.weight, 0);
      expect(Math.abs(sum - s.score)).toBeLessThan(1e-9);
    }
  });

  it("T-ER-010: resolution is deterministic — same input, same output", () => {
    const set = generateReferenceSet(42);
    const weights = estimateWeights(set.train);
    const a = resolveEntities(set.eval.records, weights);
    const b = resolveEntities(set.eval.records, weights);
    expect(a).toEqual(b);
  });

  it("T-ER-006b [RED-then-green]: a shared normalized identifier is DETERMINISTIC strong — disagreement weights can NEVER cancel it (D9 مطابقة حتمية)", () => {
    // Contract (T-ER-006 / D9): a shared normalized identifier means the pair is
    // the same real-world entity, whatever the other fields say. Adversarial
    // weights: every disagreement term at -10 must still yield "strong".
    const adversarial = {
      name: -10,
      namePartial: -10,
      nameDisagree: -10,
      date: -10,
      datePartial: -10,
      dateDisagree: -10,
      address: -10,
      addressDisagree: -10,
    } as unknown as FsWeights;
    const a: ErRecord = { id: "a", name: "محمد", birthDate: "1950-01-01", addresses: ["الرياض"], identifiers: ["passport:p123"] };
    const b: ErRecord = {
      id: "b",
      name: "شركة مختلفة تماماً",
      birthDate: "1999-01-01",
      addresses: ["دبي"],
      identifiers: ["passport:p123"],
    };
    const s = scorePair(a, b, adversarial);
    expect(s.decision).toBe("strong");
    // reasons and score stay consistent: score is still the sum of reason weights
    const sum = s.reasons.reduce((acc, r) => acc + r.weight, 0);
    expect(Math.abs(sum - s.score)).toBeLessThan(1e-9);
  });

  it("T-ER-005b [RED-then-green]: multi-level Laplace smoothing — hand-computed weights (denominator = N + number of levels)", () => {
    // A minimal hand-checkable train split. Six records in ONE block (shared
    // country + first-3 name chars), two TRUE duplicate pairs:
    //   A-B name AGREE, C-D name DISAGREE (a true match may disagree on name)
    // and four candidate non-matches (all name-disagree).
    // Name has 3 levels => Laplace denominator is N+3, so each feature's
    // estimated probabilities sum to EXACTLY 1 over its levels.
    const rec = (id: string, name: string): ErRecord => ({ id, name, country: "SA" });
    // all four share the first-3 comparison-key chars (محم) + country => ONE block
    // (levels verified: A-B jw=1.0 agree; C-D jw=0.822 and cross pairs 0.842 => disagree)
    const A = rec("a", "محمد السالم");
    const B = rec("b", "محمد السالم");
    const C = rec("c", "محمد يوسف");
    const D = rec("d", "محمد راشد");
    const train = {
      records: [A, B, C, D],
      duplicatePairs: [
        { a: A, b: B },
        { a: C, b: D },
      ],
    };
    const w = estimateWeights(train);
    // matches with name present: 2 (A-B agree, C-D disagree); non-matches: 4 (all disagree)
    // m(agree) = (1+1)/(2+3) = 2/5;  u(agree) = (0+1)/(4+3) = 1/7
    expect(w.name).toBeCloseTo(Math.log(2 / 5 / (1 / 7)), 12);
    // m(disagree) = (1+1)/(2+3) = 2/5;  u(disagree) = (4+1)/(4+3) = 5/7
    expect(w.nameDisagree).toBeCloseTo(Math.log(2 / 5 / (5 / 7)), 12);
    // m(partial) = (0+1)/(2+3) = 1/5;  u(partial) = (0+1)/(4+3) = 1/7
    expect(w.namePartial).toBeCloseTo(Math.log(1 / 5 / (1 / 7)), 12);
  });

  it("T-MODEL-001: er-model/1 — the frozen weights match the reference TRAIN derivation; thresholds equal the declared scoring constants", () => {
    // The pinned production model must be a FROZEN measurement, not a runtime
    // estimate. If the generator ever changes, this breaks VISIBLY and forces a
    // version bump — never a silent drift of the production model.
    const derived = estimateWeights(generateReferenceSet(42).train);
    expect(derived.name).toBeCloseTo(ER_MODEL_WEIGHTS.name, 12);
    expect(derived.namePartial).toBeCloseTo(ER_MODEL_WEIGHTS.namePartial, 12);
    expect(derived.nameDisagree).toBeCloseTo(ER_MODEL_WEIGHTS.nameDisagree, 12);
    expect(derived.date).toBeCloseTo(ER_MODEL_WEIGHTS.date, 12);
    expect(derived.datePartial).toBeCloseTo(ER_MODEL_WEIGHTS.datePartial, 12);
    expect(derived.dateDisagree).toBeCloseTo(ER_MODEL_WEIGHTS.dateDisagree, 12);
    expect(derived.address).toBeCloseTo(ER_MODEL_WEIGHTS.address, 12);
    expect(derived.addressDisagree).toBeCloseTo(ER_MODEL_WEIGHTS.addressDisagree, 12);
    // the model's threshold reference IS what the scoring path consumes
    expect(ER_MODEL_THRESHOLDS.strong).toBe(STRONG_THRESHOLD);
    expect(ER_MODEL_THRESHOLDS.review).toBe(REVIEW_THRESHOLD);
    expect(ER_MODEL_VERSION).toBe("er-model/2"); // P5-003: ترقية معلنة — التطبيع العربي الكامل
  });

  it("T-ER-007: decisions follow the two thresholds — strong / review / none, and NO automatic merge", () => {
    const set = generateReferenceSet(42);
    const weights = estimateWeights(set.train);
    // identical record → the strongest possible evidence → strong
    const twin = set.eval.records[0];
    const s = scorePair(twin, { ...twin, id: "twin" }, weights);
    expect(s.decision).toBe("strong");
    // totally different records → none
    const far = scorePair(
      { id: "x", name: "زيد بن حارثة", country: "JO", birthDate: "1950-01-01", addresses: ["عمان - جبل الحسين"], identifiers: ["nat:100"] },
      {
        id: "y",
        name: "شركة النور للتجارة",
        country: "AE",
        birthDate: "1999-01-01",
        addresses: ["دبي - القرهود"],
        identifiers: ["nat:200"],
      },
      weights,
    );
    expect(far.decision).toBe("none");
    // suggestions are SUGGESTIONS: resolveEntities never mutates/merges records
    const before = JSON.stringify(set.eval.records);
    resolveEntities(set.eval.records, weights);
    expect(JSON.stringify(set.eval.records)).toBe(before);
  });
});
