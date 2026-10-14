/**
 * P2-009 — TR-003: RDAP for an IP or ASN (IP/ASN → network, owner).
 *
 * Source: RIR RDAP via the IANA number bootstrap (`data.iana.org/rdap/ipv4.json`
 * and `asn.json`), public, no key (LC-B). The transform resolves the RIR base
 * URL from the bootstrap, then queries `{base}ip/{ip}` or `{base}autnum/{asn}`.
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 2, timeoutMs 10s, maxBytes 1MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { isAsn, isIpv4, isIpv6, parseJson } from "./util.ts";
import type { TransformContext } from "../transform.ts";

const IANA_IPV4 = "https://data.iana.org/rdap/ipv4.json";
const IANA_ASN = "https://data.iana.org/rdap/asn.json";

type Finding = TransformFinding;

export const rdapIp = defineTransform<{ ip: string }>(
  {
    id: "TR-003",
    version: "1.0.0",
    inputs: ["ip"],
    outputs: ["cidr", "organization", "asn"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 2, timeoutMs: 10_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-B",
  },
  async (input, ctx) => {
    const raw = input.ip.trim();
    if (isAsn(raw)) return resolveAsn(raw, ctx);
    if (!isIpv4(raw) && !isIpv6(raw)) throw new Error(`TR-003: invalid IP or ASN "${raw}"`);
    return resolveIp(raw, ctx);
  },
);

/** RDAP lookup for an ASN (e.g. "AS15169"). */
async function resolveAsn(asn: string, ctx: TransformContext): Promise<{ findings: Finding[] }> {
  const bootstrap = parseJson((await ctx.http.get(IANA_ASN)).body, "IANA ASN bootstrap") as {
    services?: Array<[string[], string]>;
  };
  const entry = (bootstrap.services ?? []).find(([ranges]) => ranges.some((r) => asnInRange(r, asn)));
  if (!entry) throw new Error(`TR-003: no RDAP server for ASN "${asn}"`);
  const base = entry[1].replace(/\/$/, "");
  const res = await ctx.http.get(`${base}/autnum/${encodeURIComponent(asn.replace(/^AS/i, ""))}`);
  const data = parseJson(res.body, "RDAP") as {
    name?: string;
    entities?: Array<{ roles?: string[]; vcardArray?: unknown[] }>;
  };
  const findings: Finding[] = [];
  if (data.name) {
    findings.push({
      predicate: "asn_named",
      evidence: [res.requestId],
      objectType: "organization",
      objectValue: data.name,
      confidence: 1,
      explanation: `RDAP name for ${asn}`,
    });
  }
  for (const ent of data.entities ?? []) {
    const name = vcardName(ent.vcardArray);
    if (name && (ent.roles ?? []).includes("registrant")) {
      findings.push({
        predicate: "owned_by",
        evidence: [res.requestId],
        objectType: "organization",
        objectValue: name,
        confidence: 0.9,
        explanation: `RDAP registrant for ${asn}`,
      });
    }
  }
  return { findings };
}

/** RDAP lookup for an IP address. */
async function resolveIp(ip: string, ctx: TransformContext): Promise<{ findings: Finding[] }> {
  const bootstrap = parseJson((await ctx.http.get(IANA_IPV4)).body, "IANA IPv4 bootstrap") as {
    services?: Array<[string[], string]>;
  };
  const entry = (bootstrap.services ?? []).find(([ranges]) => ranges.some((r) => rangeContains(r, ip)));
  if (!entry) throw new Error(`TR-003: no RDAP server for IP "${ip}"`);
  const base = entry[1].replace(/\/$/, "");

  const res = await ctx.http.get(`${base}/ip/${encodeURIComponent(ip)}`);
  const data = parseJson(res.body, "RDAP") as {
    startAddress?: string;
    endAddress?: string;
    name?: string;
    entities?: Array<{ roles?: string[]; vcardArray?: unknown[] }>;
  };

  const findings: Finding[] = [];
  if (data.startAddress && data.endAddress) {
    findings.push({
      predicate: "in_network",
      evidence: [res.requestId],
      objectType: "cidr",
      objectValue: `${data.startAddress}-${data.endAddress}`,
      confidence: 1,
      explanation: `RDAP network range for ${ip}`,
    });
  }
  if (data.name) {
    findings.push({
      predicate: "network_named",
      evidence: [res.requestId],
      objectType: "organization",
      objectValue: data.name,
      confidence: 1,
      explanation: `RDAP network name for ${ip}`,
    });
  }
  for (const ent of data.entities ?? []) {
    const name = vcardName(ent.vcardArray);
    if (name && (ent.roles ?? []).includes("registrant")) {
      findings.push({
        predicate: "owned_by",
        evidence: [res.requestId],
        objectType: "organization",
        objectValue: name,
        confidence: 0.9,
        explanation: `RDAP registrant for ${ip}`,
      });
    }
  }
  return { findings };
}

/** True if `ip` falls inside a CIDR or range string from the IANA bootstrap. */
function rangeContains(range: string, ip: string): boolean {
  if (range.includes("/")) {
    const [net, bits] = range.split("/");
    const b = Number(bits);
    if (!isIpv4(net) || !isIpv4(ip)) return false;
    const mask = b === 0 ? 0 : (~0 << (32 - b)) >>> 0;
    return (ipv4ToInt(net) & mask) === (ipv4ToInt(ip) & mask);
  }
  if (range.includes("-")) {
    const [a, b] = range.split("-");
    if (!isIpv4(a) || !isIpv4(b) || !isIpv4(ip)) return false;
    const n = ipv4ToInt(ip);
    return n >= ipv4ToInt(a) && n <= ipv4ToInt(b);
  }
  return range === ip;
}

function ipv4ToInt(s: string): number {
  return s.split(".").reduce((acc, o) => (acc << 8) | Number(o), 0) >>> 0;
}

/** Extract the formatted name from an RDAP vcardArray (FN field). */
function vcardName(vcardArray?: unknown[]): string | undefined {
  if (!Array.isArray(vcardArray) || vcardArray.length < 2) return undefined;
  const props = vcardArray[1];
  if (!Array.isArray(props)) return undefined;
  for (const p of props) {
    if (Array.isArray(p) && p[0] === "fn" && typeof p[3] === "string") return p[3];
  }
  return undefined;
}

/** True if `asn` (e.g. "AS15169") falls inside an IANA ASN range entry. */
function asnInRange(range: string, asn: string): boolean {
  const n = Number(asn.replace(/^AS/i, ""));
  if (range.includes("-")) {
    const [a, b] = range.split("-").map(Number);
    return n >= a && n <= b;
  }
  return n === Number(range);
}
