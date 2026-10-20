/**
 * P2-010 — TR-016 contract test (T-RULE-06). Runs the Bitcoin transform against
 * a deterministic sim and asserts balance findings.
 * P3-020 (red-first): the roadmap row promises «عنوان/معاملة ← معاملات، أرصدة» and UC-05
 * requires transactions + related addresses with checksum verification before any
 * request — these two tests were written BEFORE that capability and failed for the
 * correct reasons (missing /txs findings; a well-formed bad-checksum address passed).
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { bitcoinAddress } from "./transforms/tr-016-bitcoin.ts";
import { runTransform } from "./runner.ts";

describe("TR-016 bitcoin", () => {
  it("emits balance and transaction count findings", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/mempool\.space\/api\/address\/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa$/,
        response: {
          status: 200,
          body: JSON.stringify({
            address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
            chain_stats: { funded_txo_sum: 100000, spent_txo_sum: 20000, tx_count: 5 },
          }),
        },
      },
      // P3-020 (v1.1.0): the address's transactions endpoint — empty list, no tx findings
      {
        match: /^https:\/\/mempool\.space\/api\/address\/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa\/txs$/,
        response: { status: 200, body: JSON.stringify([]) },
      },
    ]);
    const result = await runTransform(bitcoinAddress, {
      transport: sim.transport,
      input: { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" },
    });
    expect(result.requestCount).toBe(2);
    const findings = result.output.findings;
    // P3-020 (v1.1.1): the balance and tx count are LITERAL attributes of the address —
    // satoshis/tx_count are not catalog identifier types, so the ledger renders them as the
    // node's attributes. (The old shape — objectType bitcoin_address, objectValue the address
    // itself — self-looped on the subject and rendered nowhere: no edge, no attribute.)
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "has_balance",
        objectType: "satoshis",
        objectValue: "80000",
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_transaction_count", objectType: "tx_count", objectValue: "5" }),
    );
  });

  it("rejects an invalid address before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(bitcoinAddress, { transport: sim.transport, input: { address: "not-an-address" } })).rejects.toThrow(
      /invalid Bitcoin address/,
    );
    expect(sim.requestCount()).toBe(0);
  });

  // P3-020 / UC-05 acceptance: a well-formed address with a wrong Base58Check checksum is
  // refused BEFORE any request — the checksum is the only thing separating a typo from a
  // silently wrong lookup on the chain.
  it("rejects a well-formed address with a bad checksum before any request (P3-020)", async () => {
    const sim = createSimServer([]);
    await expect(
      runTransform(bitcoinAddress, {
        transport: sim.transport,
        // the genesis address with its last character changed — shape-valid, checksum-invalid
        input: { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb" },
      }),
    ).rejects.toThrow(/checksum/);
    expect(sim.requestCount()).toBe(0);
  });

  // P3-020 / UC-05: the roadmap row promises transactions, and the journey's output is
  // «معاملات وعناوين مرتبطة» — the /txs endpoint findings must cite the same recorded
  // evidence as every other finding of the run.
  it("emits transaction and counterparty findings from the address's transactions (P3-020)", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/mempool\.space\/api\/address\/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa$/,
        response: {
          status: 200,
          body: JSON.stringify({
            address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
            chain_stats: { funded_txo_sum: 100000, spent_txo_sum: 20000, tx_count: 2 },
          }),
        },
      },
      {
        match: /^https:\/\/mempool\.space\/api\/address\/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa\/txs$/,
        response: {
          status: 200,
          body: JSON.stringify([
            {
              txid: "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
              vin: [{ prevout: { scriptpubkey_address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" } }],
              vout: [{ scriptpubkey_address: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2" }],
            },
            {
              txid: "1e6ea2007e1f650040436e11d1f942be52a1fb47f55d055d1f1be65c15663f8e",
              vin: [{ prevout: { scriptpubkey_address: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2" } }],
              vout: [{ scriptpubkey_address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" }],
            },
          ]),
        },
      },
    ]);
    const result = await runTransform(bitcoinAddress, {
      transport: sim.transport,
      input: { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" },
    });
    expect(result.requestCount).toBe(2);
    const findings = result.output.findings;
    // the balance/count findings of the address endpoint are unchanged (literal attributes)
    expect(findings).toContainEqual(expect.objectContaining({ predicate: "has_balance", objectType: "satoshis" }));
    expect(findings).toContainEqual(expect.objectContaining({ predicate: "has_transaction_count", objectType: "tx_count" }));
    // each transaction of the address is a has_transaction finding on its txid
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "has_transaction",
        objectType: "crypto_tx_hash",
        objectValue: "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "has_transaction",
        objectType: "crypto_tx_hash",
        objectValue: "1e6ea2007e1f650040436e11d1f942be52a1fb47f55d055d1f1be65c15663f8e",
      }),
    );
    // the counterparty of both transactions is a transacted_with finding (related address)
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "transacted_with",
        objectType: "bitcoin_address",
        objectValue: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
      }),
    );
    // every finding cites the recorded evidence of the request that produced it
    for (const f of findings) expect(f.evidence?.length ?? 0).toBeGreaterThan(0);
  });
});
