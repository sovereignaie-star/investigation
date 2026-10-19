import { describe, it } from "vitest";
import { SLOW_MS, slowIt } from "@ir/test-utils";

// P6-016: the @slow mechanism contract. The two heavy guard tests tagged with
// slowIt get SLOW_MS (15 s = 3x the Vitest default of 5 s, which stays the
// default for everything else). This test is deterministic: slowIt takes the
// runner as an injected parameter so the contract is asserted without
// registering a real (sleeping) test — the owner directive limits @slow
// tagging to the two named guard tests, and no new test may exceed 5 s.

describe("@ir/test-utils slow mechanism (P6-016)", () => {
  it("SLOW_MS is 15 s (3x the vitest default of 5 s)", () => {
    if (SLOW_MS !== 15_000) throw new Error(`SLOW_MS is ${SLOW_MS}, expected 15_000`);
  });

  it("slowIt registers the test with the @slow timeout via the runner", () => {
    const calls: unknown[][] = [];
    const fakeRunner = (...args: unknown[]) => {
      calls.push(args);
    };
    const fn = () => {};
    slowIt("a slow guard test", fn, fakeRunner as never);
    if (calls.length !== 1) throw new Error(`runner called ${calls.length} times, expected 1`);
    const [name, body, timeout] = calls[0] as [string, typeof fn, number];
    if (name !== "a slow guard test") throw new Error(`name is ${String(name)}`);
    if (body !== fn) throw new Error("body not passed through");
    if (timeout !== SLOW_MS) throw new Error(`timeout is ${String(timeout)}, expected ${SLOW_MS}`);
  });
});
