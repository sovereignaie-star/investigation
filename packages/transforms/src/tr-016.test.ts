/**
 * P2-010 — TR-016 contract test (T-RULE-06). Runs the Bitcoin transform against
 * a deterministic sim and asserts balance findings.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { bitcoinAddress } from "./transforms/tr-016-bitcoin.ts";
import { runTransform } from "./runner.ts";

describe("TR-016 bitcoin", () => {
  it("emits balance and transaction count findings", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/mempool\.space\/api\/address\//,
        response: {
          status: 200,
          body: JSON.stringify({
            address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
            chain_stats: { funded_txo_sum: 100000, spent_txo_sum: 20000, tx_count: 5 },
          }),
        },
      },
    ]);
    const result = await runTransform(bitcoinAddress, {
      transport: sim.transport,
      input: { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" },
    });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "has_balance",
        objectType: "bitcoin_address",
        objectValue: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
      }),
    );
    expect(findings).toContainEqual(expect.objectContaining({ predicate: "has_transaction_count", objectType: "bitcoin_address" }));
  });

  it("rejects an invalid address before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(bitcoinAddress, { transport: sim.transport, input: { address: "not-an-address" } })).rejects.toThrow(
      /invalid Bitcoin address/,
    );
    expect(sim.requestCount()).toBe(0);
  });
});
