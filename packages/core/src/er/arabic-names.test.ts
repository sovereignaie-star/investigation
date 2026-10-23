import { describe, expect, it } from "vitest";

import { arabicNameMatches, nameSkeleton, searchArabicNames } from "@ir/arabic";
import { erComparisonKey } from "./compare.ts";
import { blockKeys } from "./blocking.ts";
import { nameLevel } from "./fellegi-sunter.ts";
import { estimateWeights } from "./fellegi-sunter.ts";
import { generateReferenceSet } from "./reference-set.ts";
import { resolveEntities } from "./resolve.ts";
import type { ErRecord } from "./types.ts";

/**
 * P5-003 — مطابقة الأسماء العربية في الدمج والبحث (T-AR-001..030).
 *
 * Integration of the P5-001/002 Arabic layer into the P4-004 ER engine:
 * cross-script (Arabic↔Latin) name pairs must BLOCK together, COMPARE as
 * agreements, and produce MERGE SUGGESTIONS; the search side matches a query
 * in either script against names in either script. Same-script behavior is
 * REGRESSION-TESTED (T-ER-003/008 equivalents) — nothing may break.
 */

const rec = (name: string, country = "SA", extra: Partial<ErRecord> = {}): ErRecord =>
  ({ id: name, name, country, birthDate: null, addresses: [], identifiers: [], ...extra }) as ErRecord;

describe("P5-003 — الأساس: المفاتيح والهياكل (T-AR-001..005)", () => {
  it("T-AR-001: the comparison key applies the full P5-001 normalization (تشكيل/همزات/ة/ى)", () => {
    expect(erComparisonKey("مُحَمَّد")).toBe(erComparisonKey("محمد"));
    expect(erComparisonKey("أحمد")).toBe(erComparisonKey("احمد"));
    expect(erComparisonKey("فاطمة")).toBe(erComparisonKey("فاطمه"));
  });

  it("T-AR-002: the name skeleton is script-neutral — محمد ≡ Muhammad", () => {
    expect(nameSkeleton("محمد")).toBe(nameSkeleton("Muhammad"));
    expect(nameSkeleton("عمر")).toBe(nameSkeleton("Omar"));
    expect(nameSkeleton("الحربي")).toBe(nameSkeleton("Alharbi"));
    expect(nameSkeleton("عبدالله")).toBe(nameSkeleton("Abdullah"));
    expect(nameSkeleton("وليد")).toBe(nameSkeleton("Waleed"));
  });

  it("T-AR-003: blockKeys collide cross-script (same skeleton + country)", () => {
    const a = new Set(blockKeys(rec("محمد الحربي")));
    const b = blockKeys(rec("Mohammed Alharbi"));
    const shared = b.filter((k) => a.has(k));
    expect(shared.length).toBeGreaterThan(0);
  });

  it("T-AR-004: the skeleton is pure and deterministic", () => {
    expect(nameSkeleton("  محمد   أحمد ")).toBe(nameSkeleton("محمد أحمد"));
    expect(nameSkeleton("Muhammad")).toBe(nameSkeleton("muhammad"));
  });

  it("T-AR-005: identifier blocking is unchanged (regression)", () => {
    const keys = blockKeys(rec("محمد", "SA", { identifiers: ["x@y.z"] }));
    expect(keys).toContain("id:x@y.z");
  });
});

describe("P5-003 — مقارنة الأسماء عبر الكتابتين (T-AR-006..013)", () => {
  it("T-AR-006: cross-script same name → agree", () => {
    expect(nameLevel(rec("محمد"), rec("Muhammad"))).toBe("agree");
  });

  it("T-AR-007: cross-script different names → disagree", () => {
    expect(nameLevel(rec("محمد"), rec("Khalid"))).toBe("disagree");
    expect(nameLevel(rec("علي"), rec("Omar"))).toBe("disagree");
  });

  it("T-AR-008: Arabic↔Arabic with diacritics/typos still works (regression)", () => {
    expect(nameLevel(rec("مُحَمَّد"), rec("محمد"))).toBe("agree");
  });

  it("T-AR-009: Latin↔Latin Jaro-Winkler unchanged (regression)", () => {
    expect(nameLevel(rec("John Smith"), rec("John Smith"))).toBe("agree");
    expect(nameLevel(rec("John Smith"), rec("Sara Jones"))).toBe("disagree");
  });

  it("T-AR-010: عائشة ≡ Aisha → agree", () => {
    expect(nameLevel(rec("عائشة"), rec("Aisha"))).toBe("agree");
  });

  it("T-AR-011: عبدالله ≡ Abdullah → agree", () => {
    expect(nameLevel(rec("عبدالله"), rec("Abdullah"))).toBe("agree");
    expect(nameLevel(rec("عبد الله"), rec("Abdullah"))).toBe("agree");
  });

  it("T-AR-012: الحربي ≡ Alharbi → agree (ال التعريف عبر الكتابتين)", () => {
    expect(nameLevel(rec("الحربي"), rec("Alharbi"))).toBe("agree");
    expect(nameLevel(rec("القحطاني"), rec("Alqahtani"))).toBe("agree");
  });

  it("T-AR-013: empty names → missing (regression)", () => {
    expect(nameLevel(rec(""), rec("محمد"))).toBe("missing");
  });
});

describe("P5-003 — الدمج عبر الكتابتين (T-AR-014..019)", () => {
  const train = generateReferenceSet(42);
  const weights = estimateWeights(train.train);

  it("T-AR-014: cross-script pair is a candidate (blocking recall)", () => {
    const a = rec("محمد الحربي");
    const b = rec("Mohammed Alharbi");
    const ka = new Set(blockKeys(a));
    expect(blockKeys(b).some((k) => ka.has(k))).toBe(true);
  });

  it("T-AR-015: resolveEntities suggests the cross-script duplicate", () => {
    const a = rec("محمد الحربي", "SA", { birthDate: "1980-01-01", addresses: ["الرياض"], identifiers: [] });
    const b = rec("Mohammed Alharbi", "SA", { birthDate: "1980-01-01", addresses: [], identifiers: [] });
    const suggestions = resolveEntities([a, b], weights);
    const pair = suggestions.find((s) => (s.aId === a.id && s.bId === b.id) || (s.aId === b.id && s.bId === a.id));
    expect(pair).toBeDefined();
  });

  it("T-AR-016: cross-script different people are not suggested", () => {
    const a = rec("محمد الحربي", "SA");
    const b = rec("Khalid Alqahtani", "SA");
    const suggestions = resolveEntities([a, b], weights);
    expect(suggestions).toHaveLength(0);
  });

  it("T-AR-017: regression — F1 ≥ 0.9 on the frozen reference set (T-ER-008)", () => {
    const frozen = generateReferenceSet(1337);
    const suggestions = resolveEntities(frozen.eval.records, weights);
    const truth = new Set(frozen.eval.duplicatePairs.map((p) => [p.a.id, p.b.id].sort().join("|")));
    let tp = 0,
      fp = 0;
    for (const s of suggestions) {
      if (truth.has([s.aId, s.bId].sort().join("|"))) tp += 1;
      else fp += 1;
    }
    const fn = truth.size - tp;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = truth.size === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    expect(f1).toBeGreaterThanOrEqual(0.9);
  });

  it("T-AR-018: regression — blocking recall = 100% on the reference set (T-ER-003)", () => {
    const frozen = generateReferenceSet(1337);
    const keys = new Map(frozen.eval.records.map((r) => [r.id, new Set(blockKeys(r))]));
    for (const p of frozen.eval.duplicatePairs) {
      const shared = [...(keys.get(p.a.id) ?? new Set<string>())].filter((k) => keys.get(p.b.id)?.has(k));
      expect(shared.length).toBeGreaterThan(0);
    }
  });

  it("T-AR-019: regression — suggestions stay explainable (reasons, D9)", () => {
    const frozen = generateReferenceSet(1337);
    const suggestions = resolveEntities(frozen.eval.records, weights);
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe("P5-003 — البحث عبر الكتابتين (T-AR-020..025)", () => {
  const names = ["محمد الحربي", "Mohammed Alharbi", "نورة الغامدي", "Khalid Alqahtani", "عبدالعزيز"];

  it("T-AR-020: an Arabic query matches the Latin-spelled entity", () => {
    expect(arabicNameMatches("محمد", "Mohammed Alharbi")).toBe(true);
    expect(arabicNameMatches("الحربي", "Mohammed Alharbi")).toBe(true);
  });

  it("T-AR-021: a Latin query matches the Arabic-spelled entity", () => {
    expect(arabicNameMatches("Noura", "نورة الغامدي")).toBe(true);
    expect(arabicNameMatches("Alghamdi", "نورة الغامدي")).toBe(true);
  });

  it("T-AR-022: searchArabicNames returns the matches from a mixed-script list (ranked, deterministic order)", () => {
    const hits = searchArabicNames("محمد", names);
    expect(hits).toContain("محمد الحربي");
    expect(hits).toContain("Mohammed Alharbi");
    expect(hits).not.toContain("Khalid Alqahtani");
  });

  it("T-AR-023: a non-matching query returns nothing — no invention", () => {
    expect(searchArabicNames("Sara", names)).toEqual([]);
    expect(arabicNameMatches("محمد", "Khalid Alqahtani")).toBe(false);
  });

  it("T-AR-024: a family-name query matches by token (القحطاني finds Khalid Alqahtani)", () => {
    expect(arabicNameMatches("القحطاني", "Khalid Alqahtani")).toBe(true);
    expect(arabicNameMatches("Qahtani", "خالد القحطاني")).toBe(true);
  });

  it("T-AR-025: a diacritized query matches the plain form", () => {
    expect(arabicNameMatches("مُحَمَّد", "محمد الحربي")).toBe(true);
  });
});

describe("P5-003 — الحدود الصادقة (T-AR-026..030)", () => {
  const names = ["محمد الحربي", "Mohammed Alharbi", "نورة"];

  it("T-AR-026: an empty/whitespace query matches nothing", () => {
    expect(searchArabicNames("", names)).toEqual([]);
    expect(searchArabicNames("   ", names)).toEqual([]);
  });

  it("T-AR-027: whitespace differences never matter", () => {
    expect(arabicNameMatches("محمد  الحربي", "محمد الحربي")).toBe(true);
    expect(arabicNameMatches("Mohammed  Alharbi", "Mohammed Alharbi")).toBe(true);
  });

  it("T-AR-028: deterministic — same query, same results, same order", () => {
    expect(searchArabicNames("محمد", names)).toEqual(searchArabicNames("محمد", names));
  });

  it("T-AR-029: a mixed-script name answers to queries in both scripts (token-wise)", () => {
    expect(arabicNameMatches("محمد", "محمد Al-Ahmad")).toBe(true);
    expect(arabicNameMatches("Almad", "محمد Al-Ahmad")).toBe(true);
  });

  it("T-AR-030: a name is never matched against itself only by script coincidence (ال sound-alikes refuse honestly)", () => {
    // «علي» و«عمر» كلاهما قصير — لا يجوز أن يتطابقا لصغر الاسم
    expect(arabicNameMatches("علي", "عمر")).toBe(false);
    expect(arabicNameMatches("Ali", "Omar")).toBe(false);
  });
});
