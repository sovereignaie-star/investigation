/**
 * P4-009 — the monitor's comparison state (UC-10): what a check compares, and what counts as change.
 *
 * The comparable state of a monitor check is the transform's FINDINGS, normalized — not the whole case
 * projection (every run appends new claim ids and evidence, so a case-level diff would always "change").
 * Execution data (the evidence request ids a finding cites) is excluded; the finding's own substance —
 * predicate, object, confidence, explanation and the P2-031 time fields — is kept, because a source
 * reporting a new validity window IS a real change. Findings are keyed by (predicate, objectType,
 * objectValue, objectId) so identity is content, never run-local ids.
 */
import { describe, expect, it } from "vitest";
import { compareFindingStates, monitorFindingKey, monitorFindingState } from "./monitor-compare.ts";
import type { TransformFinding } from "@ir/transforms";

function finding(over: Partial<TransformFinding> = {}): TransformFinding {
  return {
    predicate: "has_technology",
    objectType: "technology",
    objectValue: "nginx",
    confidence: 0.8,
    explanation: "server header of the response",
    evidence: [1],
    ...over,
  };
}

describe("monitor comparison state (P4-009)", () => {
  it("evidence request ids and finding order do not affect the state", () => {
    const a = monitorFindingState([
      finding(),
      finding({ predicate: "has_http_response", objectType: "http_status", objectValue: "200", evidence: [1] }),
    ]);
    const b = monitorFindingState([
      finding({ predicate: "has_http_response", objectType: "http_status", objectValue: "200", evidence: [7] }),
      finding({ evidence: [7, 9] }),
    ]);
    // same substance, different request refs and order → identical state
    expect(monitorFindingState(a)).toEqual(a);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the same finding count with different content is a change (counts are not a signature)", () => {
    const baseline = monitorFindingState([finding()]);
    const current = monitorFindingState([finding({ confidence: 0.4 })]);
    const d = compareFindingStates(baseline, current);
    expect(d.equal).toBe(false);
    expect(d.changed).toHaveLength(1);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("a validity-window change is a real change (P2-031 time fields are part of the substance)", () => {
    const baseline = monitorFindingState([finding()]);
    const current = monitorFindingState([finding({ validFrom: "2026-01-01T00:00:00.000Z", validTo: "2026-06-01T00:00:00.000Z" })]);
    expect(compareFindingStates(baseline, current).equal).toBe(false);
  });

  it("a finding that disappears from a successful check is reported as removed", () => {
    const baseline = monitorFindingState([
      finding(),
      finding({ predicate: "has_http_response", objectType: "http_status", objectValue: "200" }),
    ]);
    const current = monitorFindingState([finding()]);
    const d = compareFindingStates(baseline, current);
    expect(d.equal).toBe(false);
    expect(d.removed).toHaveLength(1);
    expect(d.removed[0]).toContain("has_http_response");
  });

  it("a new finding is reported as added, and a changed objectId is old-removed/new-added", () => {
    const d = compareFindingStates([], monitorFindingState([finding()]));
    expect(d.added).toHaveLength(1);
    // the object id is part of the finding's identity: a different target is a different finding
    const d2 = compareFindingStates(
      monitorFindingState([finding({ objectId: "ent-a" })]),
      monitorFindingState([finding({ objectId: "ent-b" })]),
    );
    expect(d2.equal).toBe(false);
    expect(d2.removed).toHaveLength(1);
    expect(d2.added).toHaveLength(1);
  });

  it("identical states compare equal with empty lists", () => {
    const baseline = monitorFindingState([finding(), finding({ predicate: "resolves_to", objectType: "ip", objectValue: "192.0.2.1" })]);
    const d = compareFindingStates(
      baseline,
      monitorFindingState([finding({ predicate: "resolves_to", objectType: "ip", objectValue: "192.0.2.1" }), finding()]),
    );
    expect(d.equal).toBe(true);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it("the finding key names the predicate and the object value", () => {
    expect(monitorFindingKey(monitorFindingState([finding()])[0])).toContain("has_technology");
    expect(monitorFindingKey(monitorFindingState([finding()])[0])).toContain("nginx");
  });
});

describe("monitor comparison state — duplicate-key findings (P4-009 round 3)", () => {
  it("two findings with the SAME key are a multiset: reversing their order is NOT a change", () => {
    const a = monitorFindingState([finding({ confidence: 0.5 }), finding({ confidence: 0.9 })]);
    const b = monitorFindingState([finding({ confidence: 0.9 }), finding({ confidence: 0.5 })]);
    expect(compareFindingStates(a, b).equal).toBe(true);
  });

  it("gaining a second finding with an EXISTING key is detected (not silently merged away)", () => {
    const one = monitorFindingState([finding({ confidence: 0.9 })]);
    const two = monitorFindingState([finding({ confidence: 0.5 }), finding({ confidence: 0.9 })]);
    expect(compareFindingStates(one, two).equal).toBe(false);
  });

  it("the finding key is an unambiguous encoding: a | inside a value cannot forge another finding's key", () => {
    const f1 = monitorFindingState([finding({ predicate: "p", objectType: "t", objectValue: "a|b" })])[0];
    const f2 = monitorFindingState([finding({ predicate: "p|t", objectType: "a", objectValue: "b" })])[0];
    expect(monitorFindingKey(f1)).not.toBe(monitorFindingKey(f2));
  });
});
