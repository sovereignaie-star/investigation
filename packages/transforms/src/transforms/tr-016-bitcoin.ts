/**
 * P2-010 — TR-016: Bitcoin (address/tx → transactions, balances).
 *
 * Source: mempool.space API (`mempool.space`), public, no key (LC-B). The
 * transform queries the address endpoint and emits findings for the address's
 * balance and transaction count, and the /txs endpoint for the address's own
 * transactions and their counterparties (P3-020 / UC-05: «معاملات وعناوين
 * مرتبطة»). All network I/O goes through `ctx.http` (egress gateway in
 * production, ADR-08).
 *
 * Limits: rps 1, timeoutMs 15s, maxBytes 2MB. The transactions read is capped at
 * 25 (the findings budget of one run); the cap is declared in every explanation.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { isBitcoinAddress, parseJson, verifyBase58Check } from "./util.ts";

const API = "https://mempool.space/api";

/** P3-020 / UC-05: one run's transaction budget — the newest transactions only. */
const MAX_TXS = 25;

interface MempoolTx {
  txid?: unknown;
  vin?: Array<{ prevout?: { scriptpubkey_address?: unknown } }>;
  vout?: Array<{ scriptpubkey_address?: unknown }>;
}

/** The address endpoint's own findings — the balance and tx count as literal attributes. */
function addressFindings(
  address: string,
  chain: { funded_txo_sum?: number; spent_txo_sum?: number; tx_count?: number } | undefined,
  evidenceId: number,
): TransformFinding[] {
  const findings: TransformFinding[] = [];
  const balance = chain ? (chain.funded_txo_sum ?? 0) - (chain.spent_txo_sum ?? 0) : undefined;
  if (balance !== undefined) {
    findings.push({
      predicate: "has_balance",
      evidence: [evidenceId],
      // P3-020 (v1.1.1): the balance and tx count are LITERAL attributes of the address —
      // satoshis/tx_count are not catalog identifier types, so the ledger renders them as
      // the node's attributes. (The old shape — objectType bitcoin_address, objectValue the
      // address itself — self-looped on the subject and rendered nowhere.)
      objectType: "satoshis",
      objectValue: String(balance),
      confidence: 0.9,
      explanation: `mempool.space: address ${address} balance ${balance} satoshis`,
    });
  }
  if (chain && chain.tx_count !== undefined) {
    findings.push({
      predicate: "has_transaction_count",
      evidence: [evidenceId],
      objectType: "tx_count",
      objectValue: String(chain.tx_count),
      confidence: 0.9,
      explanation: `mempool.space: address ${address} has ${chain.tx_count} transactions`,
    });
  }
  return findings;
}

/** One run's transactions read — the newest MAX_TXS, keyed by their txids. */
function txsFindings(address: string, txs: readonly MempoolTx[], evidenceId: number): TransformFinding[] {
  const findings: TransformFinding[] = [];
  const counterparties = new Map<string, string[]>();
  for (const raw of txs.slice(0, MAX_TXS)) {
    const txid = typeof raw.txid === "string" ? raw.txid : "";
    if (/^[0-9a-f]{64}$/.test(txid)) {
      findings.push({
        predicate: "has_transaction",
        evidence: [evidenceId],
        objectType: "crypto_tx_hash",
        objectValue: txid,
        confidence: 0.9,
        explanation: `mempool.space: transaction ${txid} of address ${address} (newest ${MAX_TXS} cap)`,
      });
    }
    const addresses = [
      ...(raw.vin ?? []).map((v) => v.prevout?.scriptpubkey_address),
      ...(raw.vout ?? []).map((v) => v.scriptpubkey_address),
    ];
    for (const addr of addresses) {
      if (typeof addr !== "string" || addr === address) continue;
      const list = counterparties.get(addr) ?? [];
      if (txid && !list.includes(txid)) list.push(txid);
      counterparties.set(addr, list);
    }
  }
  for (const [addr, txids] of counterparties) {
    findings.push({
      predicate: "transacted_with",
      evidence: [evidenceId],
      objectType: "bitcoin_address",
      objectValue: addr,
      confidence: 0.9,
      explanation: `mempool.space: address ${address} transacted with ${addr}${txids.length > 0 ? ` in ${txids.join(", ")}` : ""}`,
    });
  }
  return findings;
}

export const bitcoinAddress = defineTransform<{ address: string }>(
  {
    id: "TR-016",
    version: "1.1.1",
    inputs: ["address"],
    outputs: ["bitcoin_address", "crypto_tx_hash"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 2_000_000 },
    sensitivity: "normal",
    license: "LC-B",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "C",
      credibility: 3,
      rationale:
        "mempool.space خدمة مجتمعية لبيانات بلوكشين بيتكوين — السلسلة نفسها قابلة للتحقق المستقل لكن الواجهة وسيط غير رسمي بلا SLA",
    },
  },
  async (input, ctx) => {
    const address = input.address.trim();
    if (!isBitcoinAddress(address)) throw new Error(`TR-016: invalid Bitcoin address "${input.address}"`);
    // P3-020 / UC-05: the Base58Check checksum is verified BEFORE any request — a
    // well-shaped address with a wrong checksum is a typo, not a subject.
    if (!(await verifyBase58Check(address))) {
      throw new Error(`TR-016: invalid Bitcoin address "${input.address}" (Base58Check checksum)`);
    }
    const res = await ctx.http.get(`${API}/address/${encodeURIComponent(address)}`);
    const data = parseJson(res.body, "mempool.space") as {
      address?: string;
      chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number; tx_count?: number };
    };
    // P3-020 / UC-05: the address's own transactions and the addresses they
    // moved funds with — the /txs response is the evidence of every finding below.
    const txsRes = await ctx.http.get(`${API}/address/${encodeURIComponent(address)}/txs`);
    const txs = parseJson(txsRes.body, "mempool.space /txs") as unknown;
    if (!Array.isArray(txs)) throw new Error("mempool.space /txs: answer is not a list");
    return { findings: [...addressFindings(address, data.chain_stats, res.requestId), ...txsFindings(address, txs, txsRes.requestId)] };
  },
);
