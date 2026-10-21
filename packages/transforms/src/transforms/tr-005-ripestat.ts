/**
 * P2-009 — TR-005: RIPEstat (IP/ASN/prefix → routing and history).
 *
 * Source: stat.ripe.net (RIPEstat), public, no key (LC-B). The transform picks
 * the endpoint by input kind:
 *   - IP → announced-prefixes (prefixes the IP is announced in)
 *   - ASN → as-overview (AS name, holder)
 *   - prefix → prefix-overview (announcing ASes)
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 2, timeoutMs 10s, maxBytes 1MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { isAsn, isIpv4, isIpv6, isPrefix, parseJson } from "./util.ts";

const RIPESTAT = "https://stat.ripe.net/data";

export const ripestat = defineTransform<{ resource: string }>(
  {
    id: "TR-005",
    version: "1.0.0",
    inputs: ["ip", "asn", "bgp_prefix"],
    outputs: ["bgp_prefix", "asn", "organization"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 2, timeoutMs: 10_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-B",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "B",
      credibility: 3,
      rationale: "RIPEstat أداة RIPE NCC الرسمية — بيانات التوجيه والاشتقاقات الإحصائية موثوقة لكنها مشتقات اجتهادية لا سجلات أولية",
    },
  },
  async (input, ctx) => {
    const raw = input.resource.trim();
    const findings: TransformFinding[] = [];

    if (isAsn(raw)) {
      const asn = raw.toUpperCase();
      const res = await ctx.http.get(`${RIPESTAT}/as-overview/data.json?resource=${encodeURIComponent(asn.replace(/^AS/i, ""))}`);
      const data = parseJson(res.body, "RIPEstat") as { data?: { holder?: string; asn?: string } };
      if (data.data?.holder) {
        findings.push({
          predicate: "asn_named",
          evidence: [res.requestId],
          objectType: "organization",
          objectValue: data.data.holder,
          confidence: 0.9,
          explanation: `RIPEstat holder for ${asn}`,
        });
      }
      return { findings };
    }

    if (isPrefix(raw)) {
      const res = await ctx.http.get(`${RIPESTAT}/prefix-overview/data.json?resource=${encodeURIComponent(raw)}`);
      const data = parseJson(res.body, "RIPEstat") as { data?: { asns?: Array<{ asn?: string; holder?: string }> } };
      for (const a of data.data?.asns ?? []) {
        if (a.asn) {
          findings.push({
            predicate: "announced_by",
            evidence: [res.requestId],
            objectType: "asn",
            objectValue: `AS${a.asn}`,
            confidence: 0.9,
            explanation: `RIPEstat: ${raw} announced by AS${a.asn}`,
          });
        }
      }
      return { findings };
    }

    if (!isIpv4(raw) && !isIpv6(raw)) throw new Error(`TR-005: invalid resource "${raw}"`);
    const res = await ctx.http.get(`${RIPESTAT}/announced-prefixes/data.json?resource=${encodeURIComponent(raw)}`);
    const data = parseJson(res.body, "RIPEstat") as { data?: { prefixes?: Array<{ prefix?: string }> } };
    for (const p of data.data?.prefixes ?? []) {
      if (p.prefix) {
        findings.push({
          predicate: "in_prefix",
          evidence: [res.requestId],
          objectType: "bgp_prefix",
          objectValue: p.prefix,
          confidence: 0.9,
          explanation: `RIPEstat: ${raw} is in ${p.prefix}`,
        });
      }
    }
    return { findings };
  },
);
