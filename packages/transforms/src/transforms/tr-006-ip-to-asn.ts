/**
 * P2-009 — TR-006: IP → ASN (IP → ASN, prefix).
 *
 * Source: Team Cymru DNS (`origin.asn.cymru.com` TXT), public, no key (LC-B).
 * The transform reverses the IPv4 octets, queries the TXT record via
 * DNS-over-HTTPS, and parses the `ASN | prefix | cc | registry | date` payload.
 *
 * P2-037 (1.1.0): a prefix announced by several origins ("15169 36040 | ...", multi-origin) yields one `has_asn`
 * per origin instead of one invalid "AS15169 36040" value; every TXT answer is read, not only the first; the prefix
 * is emitted only when it is an aligned IPv4 network that contains the address (`bgp_prefix` pattern); a non-200
 * status or a DNS RCODE other than NOERROR/NXDOMAIN fails the run (SERVFAIL is not "unrouted"); NXDOMAIN (the address
 * is not announced) is a genuine negative. Each finding cites the DoH response.
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 2, timeoutMs 10s, maxBytes 1MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { ipv4ToInt, isAlignedIpv4Cidr, isIpv4, parseDoh } from "./util.ts";

const DOH = "https://dns.google/resolve";
const TXT = 16;

export const ipToAsn = defineTransform<{ ip: string }>(
  {
    id: "TR-006",
    version: "1.1.0",
    inputs: ["ip"],
    outputs: ["asn", "bgp_prefix"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 2, timeoutMs: 10_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-B",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "B",
      credibility: 3,
      rationale: "Team Cymru DNS — خدمة مستقرة لبيانات ASN المستمدة من جداول التوجيه؛ الاشتقاق موثوق نسبياً وليس سجلاً تفويضياً",
    },
  },
  async (input, ctx) => {
    const ip = input.ip.trim();
    if (!isIpv4(ip)) throw new Error(`TR-006: invalid IPv4 "${input.ip}"`);
    const reversed = ip.split(".").reverse().join(".");
    const url = `${DOH}?name=${encodeURIComponent(`${reversed}.origin.asn.cymru.com`)}&type=${TXT}`;
    const res = await ctx.http.get(url);
    const answers = parseDoh(res, "dns.google TXT (Team Cymru)");

    const findings: TransformFinding[] = [];
    const seen = new Set<string>();
    const push = (predicate: string, objectType: string, objectValue: string, explanation: string) => {
      const key = `${predicate}|${objectValue}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push({ predicate, evidence: [res.requestId], objectType, objectValue, confidence: 1, explanation });
    };
    for (const a of answers) {
      if (a.type !== TXT || typeof a.data !== "string") continue;
      const txt = a.data.trim().replace(/^"|"$/g, "");
      const [asnField = "", prefix = ""] = txt.split("|").map((s) => s.trim());
      for (const n of asnField.split(/\s+/).filter(Boolean)) {
        if (!/^\d{1,10}$/.test(n) || Number(n) > 4_294_967_295) continue;
        push("has_asn", "asn", `AS${Number(n)}`, `Team Cymru: ${ip} is announced by AS${Number(n)}`);
      }
      if (prefix && isAlignedIpv4Cidr(prefix) && contains(prefix, ip)) {
        push("in_prefix", "bgp_prefix", prefix, `Team Cymru: ${ip} is in ${prefix}`);
      }
    }
    return { findings };
  },
);

function contains(cidr: string, ip: string): boolean {
  const [net, len] = cidr.split("/");
  const size = 2 ** (32 - Number(len));
  return Math.floor(ipv4ToInt(ip) / size) === Math.floor(ipv4ToInt(net) / size);
}
