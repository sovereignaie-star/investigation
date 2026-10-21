/**
 * P2-009 — TR-007: IP info (IP → approximate location, ISP).
 *
 * Source: ipinfo.io (`ipinfo.io`), public basic endpoint, no key required for
 * the basic fields (LC-C per ROADMAP — a user key upgrades the fields). The
 * transform queries `{ip}/json` and emits typed findings for org/ASN, city,
 * country and region.
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 2, timeoutMs 10s, maxBytes 1MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { isIpv4, isIpv6, parseJson } from "./util.ts";

const IPINFO = "https://ipinfo.io";

export const ipInfo = defineTransform<{ ip: string }>(
  {
    id: "TR-007",
    version: "1.0.0",
    inputs: ["ip"],
    outputs: ["asn", "organization", "city", "country"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 2, timeoutMs: 10_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-C",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "C",
      credibility: 4,
      rationale: "ipinfo.io نقطة النهاية العامة — تجميع تجاري لبيانات جغرافية وتنظيمية للعناوين بطبيعة تقديرية معروفة الحدود",
    },
  },
  async (input, ctx) => {
    const ip = input.ip.trim();
    if (!isIpv4(ip) && !isIpv6(ip)) throw new Error(`TR-007: invalid IP "${input.ip}"`);
    const res = await ctx.http.get(`${IPINFO}/${encodeURIComponent(ip)}/json`);
    const data = parseJson(res.body, "ipinfo") as {
      org?: string;
      city?: string;
      region?: string;
      country?: string;
    };

    const findings: TransformFinding[] = [];
    if (data.org) {
      const [asn, ...orgParts] = data.org.split(" ");
      if (asn?.startsWith("AS")) {
        findings.push({
          predicate: "has_asn",
          evidence: [res.requestId],
          objectType: "asn",
          objectValue: asn,
          confidence: 0.9,
          explanation: `ipinfo: ${ip} is in ${asn}`,
        });
      }
      const org = orgParts.join(" ");
      if (org) {
        findings.push({
          predicate: "hosted_by",
          evidence: [res.requestId],
          objectType: "organization",
          objectValue: org,
          confidence: 0.9,
          explanation: `ipinfo: ${ip} is hosted by ${org}`,
        });
      }
    }
    if (data.city) {
      findings.push({
        predicate: "located_in_city",
        evidence: [res.requestId],
        objectType: "city",
        objectValue: data.city,
        confidence: 0.7,
        explanation: `ipinfo: ${ip} is in ${data.city}`,
      });
    }
    if (data.country) {
      findings.push({
        predicate: "located_in_country",
        evidence: [res.requestId],
        objectType: "country",
        objectValue: data.country,
        confidence: 0.7,
        explanation: `ipinfo: ${ip} is in ${data.country}`,
      });
    }
    return { findings };
  },
);
