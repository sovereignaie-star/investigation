/**
 * TR-044 — AbuseIPDB IP abuse reports (P2-026, batch 5).
 *
 * Value: https://api.abuseipdb.com — the community IP abuse database. The transform checks one
 * IP (IPv4 or IPv6) and emits the abuse-confidence claim on the IP itself plus its context
 * (ISP, reverse domain, hostnames, country, Tor-exit marker).
 *
 * The key (ABUSEIPDB_KEY) travels ONLY in the `Key` header, injected by the egress gateway from
 * the vault (the manifest's `secrets` binding — pinned mode, ADR-08 §7); the transform never
 * sees or embeds it. The request sends ONLY the `ipAddress` query parameter — the source's
 * optional `maxAgeInDays` and `verbose` parameters are deliberately NOT sent: the per-provider
 * query allowlist is a closed list narrower than the provider's documented surface on purpose
 * (fail-closed; the same pattern as urlscan's `q`-only allowlist). Without `verbose` the
 * response carries no per-report comments or reporter identities — the minimum data that
 * serves the purpose.
 *
 * Source verified against the official docs (docs.abuseipdb.com, the /api/v2/check endpoint,
 * 2026-10-17): the abuse confidence score is a 0..100 number the docs describe as a nonbinary
 * basis for action; the daily quota (1,000/day on the standard tier) is enforced by the source
 * with 429 — no per-minute limit is documented, so the manifest's rps 1 is OUR declared bound.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { isIpv4, isIpv6, parseJson, expectStatus } from "./util.ts";

const ABUSEIPDB_CHECK = "https://api.abuseipdb.com/api/v2/check";

export interface Tr044Input {
  /** An IPv4 or IPv6 address (catalog ipv4 / ipv6). */
  readonly ip: string;
}

interface AbuseIpDbData {
  readonly ipAddress?: string;
  readonly abuseConfidenceScore?: number;
  readonly isTor?: boolean;
  readonly usageType?: string;
  readonly isp?: string;
  readonly domain?: string;
  readonly hostnames?: readonly string[];
  readonly countryCode?: string;
}

/** A string that is non-empty after trimming and not longer than a registrable domain. */
function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (v === "" || v.length > max) return undefined;
  return v;
}

/** The abuse-confidence claim on the IP itself — only when the source reports a non-zero score
 *  (0 is a clean report, not a claim). */
function abuseScoreFinding(data: AbuseIpDbData, ip: string, objectType: string, requestId: number): TransformFinding | undefined {
  const score = data.abuseConfidenceScore;
  if (typeof score !== "number" || score <= 0 || score > 100) return undefined;
  return {
    predicate: "has_abuse_score",
    evidence: [requestId],
    objectType,
    objectValue: ip,
    confidence: score / 100,
    explanation: `AbuseIPDB: ${ip} has an abuse confidence score of ${score}%`,
  };
}

/** One finding per present, valid context item (Tor marker, ISP, reverse domain, hostnames, country). */
function contextFindings(data: AbuseIpDbData, ip: string, objectType: string, requestId: number): TransformFinding[] {
  const findings: TransformFinding[] = [];
  if (data.isTor === true) {
    findings.push({
      predicate: "is_tor_exit",
      evidence: [requestId],
      objectType,
      objectValue: ip,
      confidence: 0.9,
      explanation: `AbuseIPDB: ${ip} is a Tor exit node`,
    });
  }
  const isp = cleanText(data.isp, 200);
  if (isp !== undefined) {
    findings.push({
      predicate: "hosted_by",
      evidence: [requestId],
      objectType: "organization",
      objectValue: isp,
      confidence: 0.9,
      explanation: `AbuseIPDB: ${ip} is operated by ${isp}`,
    });
  }
  const domain = cleanText(data.domain, 253);
  if (domain !== undefined) {
    findings.push({
      predicate: "has_domain",
      evidence: [requestId],
      objectType: "domain",
      objectValue: domain,
      confidence: 0.9,
      explanation: `AbuseIPDB: ${ip} has the reverse domain ${domain}`,
    });
  }
  for (const hostname of data.hostnames ?? []) {
    const h = cleanText(hostname, 253);
    if (h === undefined) continue;
    findings.push({
      predicate: "has_hostname",
      evidence: [requestId],
      objectType: "hostname",
      objectValue: h,
      confidence: 0.9,
      explanation: `AbuseIPDB: ${ip} has the hostname ${h}`,
    });
  }
  const country = cleanText(data.countryCode, 2);
  if (country !== undefined && /^[A-Z]{2}$/.test(country)) {
    findings.push({
      predicate: "located_in_country",
      evidence: [requestId],
      objectType: "country",
      objectValue: country,
      confidence: 0.7,
      explanation: `AbuseIPDB: ${ip} is located in ${country}`,
    });
  }
  return findings;
}

export const abuseIpDbCheck = defineTransform<Tr044Input>(
  {
    id: "TR-044",
    version: "1.0.0",
    inputs: ["ip"],
    outputs: ["ipv4", "ipv6", "organization", "domain", "hostname", "country"],
    network: { mode: "pinned", allow: ["api.abuseipdb.com"] },
    secrets: ["ABUSEIPDB_KEY"],
    // Our declared bound (the source documents a daily quota, no per-minute limit).
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-C",
  },
  async (input, ctx) => {
    if (input.ip === undefined || input.ip === null) throw new Error("TR-044: ip is required");
    const ip = input.ip.trim();
    if (ip === "" || (!isIpv4(ip) && !isIpv6(ip))) throw new Error(`TR-044: "${input.ip}" is not a valid IP address`);
    const objectType = isIpv4(ip) ? "ipv4" : "ipv6";
    // The docs require URL-encoding: IPv6 addresses contain colons, reserved in URIs.
    const res = await ctx.http.get(`${ABUSEIPDB_CHECK}?ipAddress=${encodeURIComponent(ip)}`);
    expectStatus(res, [200], "AbuseIPDB check");
    const parsed = parseJson(res.body, "AbuseIPDB check") as { data?: AbuseIpDbData };
    const data = parsed.data ?? {};
    const score = abuseScoreFinding(data, ip, objectType, res.requestId);
    const findings = contextFindings(data, ip, objectType, res.requestId);
    if (score !== undefined) findings.unshift(score);
    return { findings };
  },
);
