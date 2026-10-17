/**
 * TR-043 — VirusTotal reputation (P2-026, the path_parameter batch — owner decision 2026-10-17).
 *
 * Value: https://www.virustotal.com — the multi-engine reputation database. The transform checks
 * one subject (an IP, a domain, a URL or a file hash) and emits the engines' verdict on it.
 *
 * THE SUBJECT TRAVELS IN THE REQUEST PATH — /api/v3/ip_addresses/{ip}, /domains/{domain},
 * /urls/{url_id}, /files/{hash}. This is the P2-026 path_template case: the transform does NOT
 * validate the path itself; the CENTRAL gateway enforces the closed template rows (the
 * provider registry entry virustotal + the policy table in packages/egress/providers/
 * post-policies.ts) against a closed type vocabulary — every parameter is typed and bounded
 * there. The transform's own job is to build the path from a VALIDATED subject and to attribute
 * the response fail-closed.
 *
 * The key (VIRUSTOTAL_KEY) travels ONLY in the `x-apikey` header, injected by the egress gateway
 * from the vault (pinned mode, ADR-08 §7); the transform never sees or embeds it.
 *
 * Source verified against the official docs (docs.virustotal.com, 2026-10-17): the URL identifier
 * is the unpadded URL-safe base64 of the URL (or the 64-hex sha256 of its canonicalized form —
 * this transform sends the documented base64 form); file hashes are md5/sha1/sha256; the response
 * object's `id` is the subject identifier (fail-closed identity check below). The public API's
 * quota is 500/day at 4/minute — the manifest's rps 1 is OUR declared bound within that.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { isIpv4, isIpv6, parseJson, expectStatus } from "./util.ts";

const VT_BASE = "https://www.virustotal.com/api/v3";

export interface Tr043Input {
  /** An IPv4 or IPv6 address (catalog ipv4 / ipv6). */
  readonly ip?: string;
  /** A domain (catalog domain). */
  readonly domain?: string;
  /** An http(s) URL (catalog url). */
  readonly url?: string;
  /** An md5/sha1/sha256 file hash (catalog file_hash). */
  readonly hash?: string;
}

interface VtStats {
  readonly harmless?: number;
  readonly malicious?: number;
  readonly suspicious?: number;
  readonly undetected?: number;
  readonly timeout?: number;
}

interface VtAttributes {
  readonly last_analysis_stats?: VtStats;
  /** The community reputation — a signed count (present for ip/domain/file; carried in the claim). */
  readonly reputation?: number;
}

interface VtData {
  readonly id?: string;
  readonly type?: string;
  readonly attributes?: VtAttributes;
}

/** A count from the source: a non-negative integer, or 0 when absent/malformed. */
function count(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
}

/**
 * The engines' verdict on the subject. The counts are mapped to a confidence the way TR-044/TR-047
 * map a source's own score (never invented): the share of engines that flagged the subject among
 * those that returned a verdict. A clean result (no malicious/suspicious) is a REAL result — the
 * claim is still made, carrying the full counts in its explanation; only a response with no stats
 * at all emits no claim.
 */
function verdictFinding(data: VtData, objectType: string, objectValue: string, requestId: number): TransformFinding | undefined {
  const stats = data.attributes?.last_analysis_stats;
  if (stats === undefined) return undefined;
  const harmless = count(stats.harmless);
  const malicious = count(stats.malicious);
  const suspicious = count(stats.suspicious);
  const undetected = count(stats.undetected);
  const timeout = count(stats.timeout);
  const flagged = malicious + suspicious;
  const total = harmless + malicious + suspicious + undetected + timeout;
  if (total === 0) return undefined;
  const reputation = data.attributes?.reputation;
  const rep = typeof reputation === "number" ? `; community reputation ${reputation}` : "";
  if (flagged > 0) {
    return {
      predicate: "has_threat_verdict",
      evidence: [requestId],
      objectType,
      objectValue,
      confidence: Math.min(1, flagged / total),
      explanation: `VirusTotal: ${flagged} of ${total} engines flag ${objectValue} as malicious or suspicious (malicious ${malicious}, suspicious ${suspicious}, harmless ${harmless}, undetected ${undetected})${rep}`,
    };
  }
  return {
    predicate: "has_clean_verdict",
    evidence: [requestId],
    objectType,
    objectValue,
    confidence: Math.min(1, harmless / total),
    explanation: `VirusTotal: no engine flags ${objectValue} (malicious 0, suspicious 0; harmless ${harmless}, undetected ${undetected}, of ${total} engines)${rep}`,
  };
}

/** The subject routing: exactly one of the four subject fields, validated, mapped to its template
 *  path (the closed types live in the gateway's policy rows — this is the transform's own guard)
 *  and to the identity the source echoes back (the fail-closed attribution check). */
/** The subject resolution per field — one small validator per subject kind. */
function ipSubject(raw: string): { path: string; objectType: string; objectValue: string; expectedId: string } {
  const ip = raw.trim();
  if (ip === "" || (!isIpv4(ip) && !isIpv6(ip))) throw new Error(`TR-043: "${raw}" is not a valid IP address`);
  const isV4 = isIpv4(ip);
  return {
    objectType: isV4 ? "ipv4" : "ipv6",
    objectValue: ip,
    // The path parameter: percent-encoded once (an IPv6 contains colons, reserved in URIs).
    path: `/ip_addresses/${encodeURIComponent(ip)}`,
    expectedId: ip,
  };
}

function domainSubject(raw: string): { path: string; objectType: string; objectValue: string; expectedId: string } {
  const domain = raw.trim().toLowerCase();
  if (domain === "" || domain.length > 253 || !/^[a-z0-9.-]+$/.test(domain)) {
    throw new Error(`TR-043: "${raw}" is not a valid domain`);
  }
  return { objectType: "domain", objectValue: domain, path: `/domains/${encodeURIComponent(domain)}`, expectedId: domain };
}

function urlSubject(raw: string): { path: string; objectType: string; objectValue: string; expectedId: string } {
  const url = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`TR-043: "${raw}" is not a URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("TR-043: only http(s) URLs are accepted");
  // The source's documented URL identifier: the unpadded URL-safe base64 of the URL.
  const urlId = Buffer.from(url, "utf8").toString("base64url");
  return { objectType: "url", objectValue: url, path: `/urls/${encodeURIComponent(urlId)}`, expectedId: urlId };
}

function hashSubject(raw: string | undefined): { path: string; objectType: string; objectValue: string; expectedId: string } {
  const hash = (raw ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(hash)) {
    throw new Error(`TR-043: "${raw}" is not an md5, sha1 or sha256 hash`);
  }
  return { objectType: "file_hash", objectValue: hash, path: `/files/${hash}`, expectedId: hash };
}

function vtSubject(input: Tr043Input): { path: string; objectType: string; objectValue: string; expectedId: string } {
  const set = [input.ip, input.domain, input.url, input.hash].filter((v) => v !== undefined && v !== null && v !== "");
  if (set.length === 0) throw new Error("TR-043: exactly one of ip, domain, url or hash is required");
  if (set.length > 1) throw new Error("TR-043: only one of ip, domain, url or hash may be set");
  if (input.ip !== undefined) return ipSubject(input.ip);
  if (input.domain !== undefined) return domainSubject(input.domain);
  if (input.url !== undefined) return urlSubject(input.url);
  return hashSubject(input.hash);
}

export const virustotalReputation = defineTransform<Tr043Input>(
  {
    id: "TR-043",
    version: "1.0.0",
    inputs: ["ip", "domain", "url", "file_hash"],
    outputs: ["ipv4", "ipv6", "domain", "url", "file_hash"],
    network: { mode: "pinned", allow: ["www.virustotal.com"] },
    secrets: ["VIRUSTOTAL_KEY"],
    // OUR declared bound within the source's documented 4/minute (the public API quota).
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-C",
  },
  async (input, ctx) => {
    const subject = vtSubject(input);
    const res = await ctx.http.get(`${VT_BASE}${subject.path}`);
    expectStatus(res, [200], "VirusTotal reputation");
    const parsed = parseJson(res.body, "VirusTotal reputation") as { data?: VtData };
    const data = parsed.data;
    if (data === undefined || data === null || typeof data !== "object") {
      throw new Error("TR-043: VirusTotal returned a malformed response (no data object)");
    }
    // The record must be about the requested subject — a response about a different identifier is
    // never attributed to the requested subject (fail-closed, the TR-044 precedent).
    if (typeof data.id === "string" && data.id.toLowerCase() !== subject.expectedId.toLowerCase()) {
      throw new Error(`TR-043: VirusTotal returned a different subject (${data.id}) than requested (${subject.expectedId})`);
    }
    const finding = verdictFinding(data, subject.objectType, subject.objectValue, res.requestId);
    return { findings: finding !== undefined ? [finding] : [] };
  },
);
