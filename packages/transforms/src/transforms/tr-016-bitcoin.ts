/**
 * P2-010 — TR-016: Bitcoin (address/tx → transactions, balances).
 *
 * Source: mempool.space API (`mempool.space`), public, no key (LC-B). The
 * transform queries the address endpoint and emits findings for the address's
 * balance and transaction count. All network I/O goes through `ctx.http`
 * (egress gateway in production, ADR-08).
 *
 * Limits: rps 1, timeoutMs 15s, maxBytes 2MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { isBitcoinAddress, parseJson } from "./util.ts";

const API = "https://mempool.space/api";

export const bitcoinAddress = defineTransform<{ address: string }>(
  {
    id: "TR-016",
    version: "1.0.0",
    inputs: ["address"],
    outputs: ["bitcoin_address"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 2_000_000 },
    sensitivity: "normal",
    license: "LC-B",
  },
  async (input, ctx) => {
    const address = input.address.trim();
    if (!isBitcoinAddress(address)) throw new Error(`TR-016: invalid Bitcoin address "${input.address}"`);
    const res = await ctx.http.get(`${API}/address/${encodeURIComponent(address)}`);
    const data = parseJson(res.body, "mempool.space") as {
      address?: string;
      chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number; tx_count?: number };
    };
    const chain = data.chain_stats;
    const balance = chain ? (chain.funded_txo_sum ?? 0) - (chain.spent_txo_sum ?? 0) : undefined;
    const findings: TransformFinding[] = [];
    if (balance !== undefined) {
      findings.push({
        predicate: "has_balance",
        evidence: [res.requestId],
        objectType: "bitcoin_address",
        objectValue: address,
        confidence: 0.9,
        explanation: `mempool.space: address ${address} balance ${balance} satoshis`,
      });
    }
    if (chain && chain.tx_count !== undefined) {
      findings.push({
        predicate: "has_transaction_count",
        evidence: [res.requestId],
        objectType: "bitcoin_address",
        objectValue: address,
        confidence: 0.9,
        explanation: `mempool.space: address ${address} has ${chain.tx_count} transactions`,
      });
    }
    return { findings };
  },
);
