import { describe, expect, it } from "vitest";
import { Budget, BudgetExceededError } from "./budget.ts";

const caps = {
  maxNodes: 2,
  maxDepth: 2,
  maxRequests: 2,
  maxCostEstimate: 10,
  maxElapsedMs: 60_000,
};

function fakeNow() {
  let t = 0;
  return () => ++t;
}

describe("Budget", () => {
  it("consumes and reports a snapshot", () => {
    const b = new Budget(caps, fakeNow());
    const s = b.consume({ nodes: 1, depth: 1, requests: 1, costEstimate: 5 });
    expect(s.nodes).toBe(1);
    expect(s.depth).toBe(1);
    expect(s.requests).toBe(1);
    expect(s.costEstimate).toBe(5);
  });

  it("refuses before exceeding nodes cap", () => {
    const b = new Budget(caps, fakeNow());
    b.consume({ nodes: 2 });
    expect(() => b.consume({ nodes: 1 })).toThrow(BudgetExceededError);
    expect(() => b.consume({ nodes: 1 })).toThrow(/budget:nodes/);
  });

  it("refuses depth, requests, cost and time separately", () => {
    const now = fakeNow();
    const b = new Budget(caps, now);
    expect(() => b.check({ depth: 3 })).toThrow(/budget:depth/);
    expect(() => b.check({ requests: 3 })).toThrow(/budget:requests/);
    expect(() => b.check({ costEstimate: 11 })).toThrow(/budget:cost/);
    expect(() => b.check({ elapsedMs: 60_001 })).toThrow(/budget:time/);
  });

  it("check does not mutate state", () => {
    const b = new Budget(caps, fakeNow());
    expect(() => b.check({ nodes: 99 })).toThrow();
    expect(b.snapshot().nodes).toBe(0);
  });

  it("exposes a machine-readable refusal on the error", () => {
    const b = new Budget(caps, fakeNow());
    try {
      b.consume({ nodes: 99 });
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExceededError);
      expect((e as BudgetExceededError).refusal).toBe("budget:nodes");
    }
  });
});
