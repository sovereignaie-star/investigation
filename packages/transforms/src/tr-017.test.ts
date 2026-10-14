/**
 * P2-010 — TR-017 contract test (T-RULE-06). Runs the Ethereum transform against
 * a deterministic sim and asserts balance findings. The transform declares a
 * pinned secret (ETHERSCAN_KEY) injected by the egress gateway; the test runs
 * via sim only (no real key, no real connection).
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { ethereumAddress } from "./transforms/tr-017-ethereum.ts";
import { runTransform } from "./runner.ts";

describe("TR-017 ethereum", () => {
  it("emits a balance finding", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.etherscan\.io\/api\?module=account&action=balance/,
        response: { status: 200, body: JSON.stringify({ status: "1", result: "1234567890000000000" }) },
      },
    ]);
    const result = await runTransform(ethereumAddress, {
      transport: sim.transport,
      input: { address: "0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae" },
    });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings[0]).toEqual(
      expect.objectContaining({
        predicate: "has_balance",
        objectType: "ethereum_address",
        objectValue: "0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae",
      }),
    );
  });

  it("rejects an invalid address before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(ethereumAddress, { transport: sim.transport, input: { address: "not-an-address" } })).rejects.toThrow(
      /invalid Ethereum address/,
    );
    expect(sim.requestCount()).toBe(0);
  });
});
