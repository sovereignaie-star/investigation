/**
 * P2-009 — TR-008: exposed ports/services (IP → ports, fingerprints).
 *
 * Source: Shodan (`api.shodan.io`), commercial, user-provided key (LC-D).
 * The transform queries `/shodan/host/{ip}` and emits a finding per open port
 * and per detected product. The key is declared in the manifest (`secrets`),
 * which forces pinned mode: the egress gateway injects the key from the vault
 * into the provider's header at request time (ADR-08 §7) — the transform never
 * sees or embeds the key.
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 1, timeoutMs 15s, maxBytes 2MB.
 */
import { defineTransform } from "../manifest.ts";
import { isIpv4, isIpv6, parseJson } from "./util.ts";

const SHODAN = "https://api.shodan.io";

export const shodanHost = defineTransform<{ ip: string }>(
  {
    id: "TR-008",
    version: "1.0.0",
    inputs: ["ip"],
    outputs: ["port_service", "technology"],
    network: { mode: "pinned", allow: ["api.shodan.io"] },
    secrets: ["SHODAN_KEY"],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 2_000_000 },
    sensitivity: "normal",
    license: "LC-D",
  },
  async (input, ctx) => {
    const ip = input.ip.trim();
    if (!isIpv4(ip) && !isIpv6(ip)) throw new Error(`TR-008: invalid IP "${input.ip}"`);
    const res = await ctx.http.get(`${SHODAN}/shodan/host/${encodeURIComponent(ip)}`);
    const data = parseJson(res.body, "Shodan") as {
      ports?: number[];
      data?: Array<{ port?: number; product?: string; transport?: string }>;
    };

    const findings: Array<{ predicate: string; objectType: string; objectValue: string; confidence: number; explanation: string }> = [];
    for (const port of data.ports ?? []) {
      findings.push({
        predicate: "has_open_port",
        objectType: "port_service",
        objectValue: String(port),
        confidence: 0.9,
        explanation: `Shodan: port ${port} open on ${ip}`,
      });
    }
    for (const svc of data.data ?? []) {
      if (svc.product) {
        findings.push({
          predicate: "runs_service",
          objectType: "technology",
          objectValue: svc.product,
          confidence: 0.8,
          explanation: `Shodan: ${svc.product} on port ${svc.port ?? "?"}`,
        });
      }
    }
    return { findings };
  },
);
