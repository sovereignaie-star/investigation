/**
 * P2-009 — TR-006: IP → ASN (IP → ASN, prefix).
 *
 * Source: Team Cymru DNS (`origin.asn.cymru.com` TXT), public, no key (LC-B).
 * The transform reverses the IPv4 octets, queries the TXT record via
 * DNS-over-HTTPS, and parses the `ASN | prefix | cc | registry | date` payload.
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 2, timeoutMs 10s, maxBytes 1MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { isIpv4, parseJson } from "./util.ts";

const DOH = "https://dns.google/resolve";

export const ipToAsn = defineTransform<{ ip: string }>(
  {
    id: "TR-006",
    version: "1.0.0",
    inputs: ["ip"],
    outputs: ["asn", "bgp_prefix"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 2, timeoutMs: 10_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-B",
  },
  async (input, ctx) => {
    const ip = input.ip.trim();
    if (!isIpv4(ip)) throw new Error(`TR-006: invalid IPv4 "${input.ip}"`);
    const reversed = ip.split(".").reverse().join(".");
    const url = `${DOH}?name=${encodeURIComponent(`${reversed}.origin.asn.cymru.com`)}&type=TXT`;
    const res = await ctx.http.get(url);
    const data = parseJson(res.body, "dns.google") as { Answer?: Array<{ data?: string }> };
    const answer = data.Answer?.[0]?.data;
    if (!answer) return { findings: [] };

    const txt = answer.replace(/^"|"$/g, "");
    const [asn, prefix, , ,] = txt.split("|").map((s) => s.trim());
    const findings: TransformFinding[] = [];
    if (asn) {
      findings.push({
        predicate: "has_asn",
        evidence: [res.requestId],
        objectType: "asn",
        objectValue: `AS${asn}`,
        confidence: 1,
        explanation: `Team Cymru: ${ip} belongs to AS${asn}`,
      });
    }
    if (prefix) {
      findings.push({
        predicate: "in_prefix",
        evidence: [res.requestId],
        objectType: "bgp_prefix",
        objectValue: prefix,
        confidence: 1,
        explanation: `Team Cymru: ${ip} is in ${prefix}`,
      });
    }
    return { findings };
  },
);
