import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { claimConfidence, type Observation } from "./confidence.ts";
import { canonicalSource, registerSourceAlias, resetSourceAliases } from "./independence.ts";

/**
 * P4-003 (ROADMAP 6.4): independence detection — the rules that decide when two
 * "sources" are actually ONE original (mirrors, aliases, the same host behind
 * trivial URL variations). The acceptance: repetition never raises confidence
 * (التكرار لا يرفع الثقة) — observations that trace back to the same original
 * form ONE group in the 5.13 model.
 */

const o = (source: string, reliability: Observation["reliability"], credibility: Observation["credibility"]): Observation => ({
  source,
  reliability,
  credibility,
});

describe("P4-003: canonical source identity rules (T-IND-001..010)", () => {
  beforeEach(() => resetSourceAliases());

  it("T-IND-001: scheme differences never split a source", () => {
    expect(canonicalSource("https://example.com")).toBe(canonicalSource("http://example.com"));
    expect(canonicalSource("https://example.com")).toBe(canonicalSource("//example.com"));
  });

  it("T-IND-002: the www. prefix never split a source", () => {
    expect(canonicalSource("https://www.example.com")).toBe(canonicalSource("https://example.com"));
  });

  it("T-IND-003: credentials, default ports, paths, queries, fragments and trailing slashes never split a source", () => {
    const base = canonicalSource("example.com");
    for (const variant of [
      "https://user:pass@example.com:443/a/b?x=1#frag",
      "https://example.com/a/b/",
      "https://example.com:443",
      "https://example.com./",
    ]) {
      expect(canonicalSource(variant)).toBe(base);
    }
  });

  it("T-IND-004: host identity is case-insensitive", () => {
    expect(canonicalSource("https://ExAmple.COM")).toBe(canonicalSource("https://example.com"));
  });

  it("T-IND-005: a plain (non-URL) source name is normalized, not mangled", () => {
    expect(canonicalSource("  سجل-الشركات  ")).toBe("سجل-الشركات");
  });

  it("T-IND-006: registered aliases are one source — the declared mirror of an original", () => {
    registerSourceAlias("mirror.example.org", "example.com");
    expect(canonicalSource("https://www.mirror.example.org")).toBe(canonicalSource("https://example.com"));
    // aliases resolve transitively (a mirror of a mirror)
    registerSourceAlias("mirror2.example.net", "mirror.example.org");
    expect(canonicalSource("https://mirror2.example.net")).toBe(canonicalSource("https://example.com"));
  });

  it("T-IND-007 (THE ACCEPTANCE): repetition through mirrors never raises the confidence", () => {
    // one honest observation of an original…
    const single = claimConfidence([o("https://example.com", "B", 2)]).confidence;
    // …plus the same observation through the original's trivial URL variants
    const variants = claimConfidence([
      o("https://example.com", "B", 2),
      o("http://www.example.com/", "B", 2),
      o("https://example.com:443/x", "B", 2),
    ]).confidence;
    expect(variants).toBe(single);
    // …plus the same observation through a REGISTERED mirror
    registerSourceAlias("cdn-mirror.example", "example.com");
    const viaMirror = claimConfidence([o("https://example.com", "B", 2), o("https://cdn-mirror.example", "B", 2)]).confidence;
    expect(viaMirror).toBe(single);
    // while a genuinely independent second source still raises it (corroboration is not repetition)
    const corroborated = claimConfidence([o("https://example.com", "B", 2), o("https://other-source.example", "B", 2)]).confidence;
    expect(corroborated).toBeGreaterThan(single);
  });

  it("T-IND-008: merged repetitions are reported — the result names the mirror as one origin", () => {
    registerSourceAlias("mirror.example.org", "example.com");
    const result = claimConfidence([o("https://example.com", "B", 2), o("https://www.mirror.example.org", "B", 2)]);
    expect(result.groups).toHaveLength(1);
    expect(result.repetitions.length).toBe(1);
    expect(result.repetitions[0]).toMatchObject({ source: "https://www.mirror.example.org", duplicateOf: "https://example.com" });
  });

  it("T-IND-009: canonical grouping is deterministic and order-independent", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 15 }),
        fc.array(fc.constantFrom(...(["A", "B", "C", "D", "E", "F"] as const))),
        fc.array(fc.constantFrom(...([1, 2, 3, 4, 5, 6] as const))),
        (sources, rels, creds) => {
          const observations = sources.map((source, i) => ({
            source,
            reliability: rels[i % Math.max(rels.length, 1)] ?? "B",
            credibility: creds[i % Math.max(creds.length, 1)] ?? 3,
          }));
          const a = claimConfidence(observations);
          const b = claimConfidence([...observations].reverse());
          return a.confidence === b.confidence && a.groups.length === b.groups.length;
        },
      ),
    );
  });

  it("T-IND-010: canonicalization never SPLITS a source (canonical groups <= raw groups)", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 24 }), { maxLength: 20 }), (sources) => {
        // raw-string grouping (P4-001 semantics) vs canonical grouping (P4-003):
        // canonicalization can only MERGE (repetition), never split.
        const rawGroups = new Set(sources).size;
        const canonicalGroups = new Set(sources.map((s) => canonicalSource(s))).size;
        return canonicalGroups <= rawGroups;
      }),
    );
  });
});
