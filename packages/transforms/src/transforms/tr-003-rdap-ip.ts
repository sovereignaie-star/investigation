/**
 * P2-009 — TR-003: RDAP for an IP or ASN (IP/ASN → network, owner).
 *
 * Source: RIR RDAP via the IANA number bootstraps (`data.iana.org/rdap/ipv4.json`, `ipv6.json` and `asn.json`),
 * public, no key (LC-B). The transform resolves the RIR base URL from the bootstrap (most specific entry), then
 * queries `{base}ip/{ip}` or `{base}autnum/{n}`.
 *
 * P2-037 (1.1.0):
 * - the IPv4 network is emitted as the exact list of aligned CIDR blocks covering `startAddress..endAddress`
 *   (or the RDAP `cidr0_cidrs` extension when it agrees), never as a "start-end" string: each value matches the
 *   catalog `cidr` pattern, has its host bits zero and contains the queried address — an RDAP answer whose range
 *   does not contain the address fails the run;
 * - IPv6 addresses use `ipv6.json`; no `cidr` finding is emitted for an IPv6 network because the catalog `cidr`
 *   type is IPv4-only (its pattern rejects IPv6) — the network name and owner are still reported;
 * - names are typed as what they are: `network_name` / `as_name` (RIR handles such as "GOOGLE"), and the owner is
 *   an `organization` only when the registrant's jCard kind is `org` (no natural-person data, see `rdap.ts`);
 * - bootstrap entries carry a LIST of URLs (RFC 9224); RDAP 404 is a genuine negative; other statuses fail;
 * - every finding cites the RDAP response, not the bootstrap.
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 2, timeoutMs 10s, maxBytes 1MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import type { TransformContext } from "../transform.ts";
import { entitiesWithRole, httpsBase, orgName, parseBootstrap, rdapNotFound, type BootstrapService } from "./rdap.ts";
import { ipv4RangeToCidrs, ipv4ToInt, ipv6InCidr, isAlignedIpv4Cidr, isAsn, isIpv4, isIpv6, ipv6ToBigInt, parseJson } from "./util.ts";

const IANA_IPV4 = "https://data.iana.org/rdap/ipv4.json";
const IANA_IPV6 = "https://data.iana.org/rdap/ipv6.json";
const IANA_ASN = "https://data.iana.org/rdap/asn.json";

interface RdapIpNetwork {
  startAddress?: string;
  endAddress?: string;
  name?: string;
  cidr0_cidrs?: Array<{ v4prefix?: string; v6prefix?: string; length?: number }>;
  entities?: unknown;
}

export const rdapIp = defineTransform<{ ip: string }>(
  {
    id: "TR-003",
    version: "1.1.0",
    inputs: ["ip"],
    outputs: ["cidr", "organization", "network_name", "as_name"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 2, timeoutMs: 10_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-B",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "A",
      credibility: 2,
      rationale: "RDAP سجلات الإنترنت الإقليمية الرسمية عبر إقلالات IANA — بيانات تخصيص العناوين من السلطات المفوضة نفسها",
    },
  },
  async (input, ctx) => {
    const raw = input.ip.trim();
    if (isAsn(raw) || /^\d{1,10}$/.test(raw)) return resolveAsn(raw, ctx);
    if (isIpv4(raw)) return resolveIp(raw, 4, ctx);
    if (isIpv6(raw)) {
      ipv6ToBigInt(raw); // strict parse: a malformed address never reaches the network
      return resolveIp(raw, 6, ctx);
    }
    throw new Error(`TR-003: invalid IP or ASN "${raw}"`);
  },
);

/** The owner findings: registrant entities whose jCard kind is `org`. */
function owners(data: { entities?: unknown }, subject: string, requestId: number): TransformFinding[] {
  const names = new Set(
    entitiesWithRole(data, "registrant")
      .map((e) => orgName(e))
      .filter((n): n is string => !!n),
  );
  return [...names].map((name) => ({
    predicate: "owned_by",
    evidence: [requestId],
    objectType: "organization",
    objectValue: name,
    confidence: 0.9,
    explanation: `RDAP registrant (kind org) for ${subject}`,
  }));
}

/** RDAP lookup for an ASN ("AS15169" or "15169"). */
async function resolveAsn(asnRaw: string, ctx: TransformContext): Promise<{ findings: TransformFinding[] }> {
  const n = Number(asnRaw.replace(/^AS/i, ""));
  if (!Number.isSafeInteger(n) || n < 0 || n > 4_294_967_295) throw new Error(`TR-003: invalid ASN "${asnRaw}"`);
  const asn = `AS${n}`;
  const services = parseBootstrap(await ctx.http.get(IANA_ASN), "IANA ASN bootstrap");
  const entry = services.find(([ranges]) => ranges.some((r) => asnInRange(r, n)));
  const base = entry ? httpsBase(entry) : undefined;
  if (!base) throw new Error(`TR-003: no https RDAP server for ${asn} in the IANA bootstrap`);
  const res = await ctx.http.get(`${base}autnum/${n}`);
  if (rdapNotFound(res, "RDAP")) return { findings: [] };
  const data = parseJson(res.body, "RDAP") as { name?: string; entities?: unknown };
  const findings: TransformFinding[] = [];
  if (typeof data.name === "string" && data.name.trim()) {
    findings.push({
      predicate: "asn_named",
      evidence: [res.requestId],
      objectType: "as_name",
      objectValue: data.name.trim(),
      confidence: 1,
      explanation: `RDAP name for ${asn}`,
    });
  }
  findings.push(...owners(data, asn, res.requestId));
  return { findings };
}

/** RDAP lookup for an IPv4/IPv6 address. */
async function resolveIp(ip: string, version: 4 | 6, ctx: TransformContext): Promise<{ findings: TransformFinding[] }> {
  const services = parseBootstrap(await ctx.http.get(version === 4 ? IANA_IPV4 : IANA_IPV6), `IANA IPv${version} bootstrap`);
  const base = mostSpecific(services, ip, version);
  if (!base) throw new Error(`TR-003: no https RDAP server for ${ip} in the IANA bootstrap`);
  const res = await ctx.http.get(`${base}ip/${encodeURIComponent(ip)}`);
  if (rdapNotFound(res, "RDAP")) return { findings: [] };
  const data = parseJson(res.body, "RDAP") as RdapIpNetwork;
  const findings: TransformFinding[] = [];
  if (version === 4) {
    for (const cidr of networkCidrs(ip, data)) {
      findings.push({
        predicate: "in_network",
        evidence: [res.requestId],
        objectType: "cidr",
        objectValue: cidr,
        confidence: 1,
        explanation: `RDAP network ${data.startAddress ?? "?"} - ${data.endAddress ?? "?"} contains ${ip}`,
      });
    }
  }
  if (typeof data.name === "string" && data.name.trim()) {
    findings.push({
      predicate: "network_named",
      evidence: [res.requestId],
      objectType: "network_name",
      objectValue: data.name.trim(),
      confidence: 1,
      explanation: `RDAP network name for ${ip}`,
    });
  }
  findings.push(...owners(data, ip, res.requestId));
  return { findings };
}

/**
 * The aligned IPv4 CIDR block(s) of the RDAP network that contain `ip` — usually exactly one. `cidr0_cidrs` is used
 * when every entry is aligned and together they cover the start..end range; otherwise the range is decomposed. A
 * network that does not contain the queried address is an inconsistent answer and fails the run.
 */
function networkCidrs(ip: string, data: RdapIpNetwork): string[] {
  if (typeof data.startAddress !== "string" || typeof data.endAddress !== "string") return [];
  const start = data.startAddress.trim();
  const end = data.endAddress.trim();
  const blocks = ipv4RangeToCidrs(start, end);
  const x = ipv4ToInt(ip);
  if (x < ipv4ToInt(start) || x > ipv4ToInt(end)) throw new Error(`TR-003: RDAP network ${start} - ${end} does not contain ${ip}`);
  const cidr0 = (data.cidr0_cidrs ?? [])
    .filter((c) => typeof c.v4prefix === "string" && typeof c.length === "number")
    .map((c) => `${c.v4prefix}/${c.length}`);
  const candidates = cidr0.length > 0 && cidr0.every(isAlignedIpv4Cidr) && sameCover(cidr0, blocks) ? cidr0 : blocks;
  // Only the block(s) that contain the address describe its network; the rest of a multi-block range does not.
  return candidates.filter((c) => {
    const [net, len] = c.split("/");
    const size = 2 ** (32 - Number(len));
    const lo = ipv4ToInt(net);
    return x >= lo && x < lo + size;
  });
}

/** Two CIDR lists cover the same addresses (compared on their exact decomposition). */
function sameCover(a: string[], b: string[]): boolean {
  const norm = (l: string[]) =>
    l
      .flatMap((c) => {
        const [net, len] = c.split("/");
        const lo = ipv4ToInt(net);
        const hi = lo + 2 ** (32 - Number(len)) - 1;
        return [[lo, hi] as const];
      })
      .sort((p, q) => p[0] - q[0]);
  const na = norm(a);
  const nb = norm(b);
  const lo = (l: ReadonlyArray<readonly [number, number]>) => l[0]?.[0];
  const hi = (l: ReadonlyArray<readonly [number, number]>) => l[l.length - 1]?.[1];
  const total = (l: ReadonlyArray<readonly [number, number]>) => l.reduce((s, [p, q]) => s + (q - p + 1), 0);
  return lo(na) === lo(nb) && hi(na) === hi(nb) && total(na) === total(nb);
}

/** Base URL of the most specific bootstrap entry containing `ip`. */
function mostSpecific(services: BootstrapService[], ip: string, version: 4 | 6): string | undefined {
  let best: { len: number; base: string } | undefined;
  for (const s of services) {
    const base = httpsBase(s);
    if (!base) continue;
    for (const range of s[0]) {
      const m = /^(.+)\/(\d{1,3})$/.exec(range.trim());
      if (!m) continue;
      const len = Number(m[2]);
      const inside = version === 4 ? ipv4InCidr(ip, m[1], len) : ipv6InCidr(ip, range.trim());
      if (inside && (!best || len > best.len)) best = { len, base };
    }
  }
  return best?.base;
}

function ipv4InCidr(ip: string, net: string, len: number): boolean {
  if (!isIpv4(net) || len > 32) return false;
  const size = 2 ** (32 - len);
  return Math.floor(ipv4ToInt(ip) / size) === Math.floor(ipv4ToInt(net) / size);
}

/** True if ASN number `n` falls inside an IANA ASN range entry ("1-1876" or "15169"). */
function asnInRange(range: string, n: number): boolean {
  const m = /^(\d+)(?:-(\d+))?$/.exec(range.trim());
  if (!m) return false;
  const a = Number(m[1]);
  const b = m[2] !== undefined ? Number(m[2]) : a;
  return n >= a && n <= b;
}
