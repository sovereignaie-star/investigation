import { describe, it } from "vitest";
import { sleep, slowIt, SLOW_MS } from "@ir/test-utils";

// P6-016: the @slow mechanism. The proof test deliberately exceeds Vitest's
// default 5 s timeout by a small margin (5.2 s sleep). Under the default it
// fails (that is the red round, recorded in the WORKLOG); under slowIt (15 s)
// it passes — living proof that the mechanism works and a guard against
// anyone lowering SLOW_MS below the default.

describe("@ir/test-utils slow mechanism (P6-016)", () => {
  it("SLOW_MS is 15 s (3x the vitest default of 5 s)", () => {
    if (SLOW_MS !== 15_000) throw new Error(`SLOW_MS is ${SLOW_MS}, expected 15_000`);
  });

  slowIt("a test exceeding the 5 s default fits the @slow timeout", async () => {
    await sleep(5_200);
  });
});
