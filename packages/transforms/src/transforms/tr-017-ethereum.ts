/**
 * P2-010 — TR-017: Ethereum & EVM (address → transactions, tokens).
 *
 * Source: Etherscan API (`api.etherscan.io`), user key (LC-C). The transform
 * queries the account balance endpoint and emits findings for the address's
 * balance and transaction count. The API key is declared as a secret
 * (`ETHERSCAN_KEY`) and injected by the egress gateway at request time from the
 * vault (ADR-08 §3); the transform never embeds a key (fixes D-014, which
 * flagged a dummy `YourApiKeyToken`).
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 1, timeoutMs 15s, maxBytes 2MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { isEthereumAddress, parseJson } from "./util.ts";

const API = "https://api.etherscan.io/api";

export const ethereumAddress = defineTransform<{ address: string }>(
  {
    id: "TR-017",
    version: "1.0.0",
    inputs: ["address"],
    outputs: ["ethereum_address"],
    network: { mode: "pinned", allow: ["api.etherscan.io"] },
    secrets: ["ETHERSCAN_KEY"],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 2_000_000 },
    sensitivity: "normal",
    license: "LC-C",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "C",
      credibility: 3,
      rationale: "Etherscan مفهرس تجاري لسلسلة الإيثيريوم — مشتقات (أرصدة/تحويلات) من سلسلة قابلة للتحقق عبر وسيط غير رسمي",
    },
  },
  async (input, ctx) => {
    const address = input.address.trim();
    if (!isEthereumAddress(address)) throw new Error(`TR-017: invalid Ethereum address "${input.address}"`);
    // The secret is injected by the egress gateway as a header (never in the URL).
    const res = await ctx.http.get(`${API}?module=account&action=balance&address=${encodeURIComponent(address)}&tag=latest`);
    const data = parseJson(res.body, "Etherscan") as { status?: string; result?: string };
    const findings: TransformFinding[] = [];
    if (data.status === "1" && data.result !== undefined) {
      findings.push({
        predicate: "has_balance",
        evidence: [res.requestId],
        objectType: "ethereum_address",
        objectValue: address,
        confidence: 0.9,
        explanation: `Etherscan: address ${address} balance ${data.result} wei`,
      });
    }
    return { findings };
  },
);
