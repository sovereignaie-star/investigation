/**
 * TR-049 — Censys exposed assets and certificates (P2-026, batch 5).
 *
 * Value: https://search.censys.io — the internet-wide scan index. The transform checks ONE
 * subject (an IP or a domain) and emits what Censys observed for it:
 *   - an IP subject => the services observed on that address (the host view,
 *     GET /v2/hosts/{ip} — the subject travels in the REQUEST PATH, the closed template row
 *     in the policy table, enforced centrally by the gateway);
 *   - a domain subject => the certificates whose parsed names cover that domain
 *     (GET /v2/certificates/search?q=... — the subject travels in the ALLOWLISTED `q` query
 *     parameter, the only permitted one).
 *
 * The credential (CENSYS_API_ID) is a PAIR — an API ID + secret — per the source's documented
 * HTTP Basic authentication (verified against the official docs, docs.censys.com / the Legacy
 * Search API reference, 2026-10-17: "Every API call requires authentication with HTTP basic
 * auth using the API ID and secret"). The pair is stored as ONE vault entry of the P2-026
 * credential_pair kind (vault entry "censys"); the CLI builds `Authorization: Basic
 * base64(id:secret)` from it and the gateway injects that header — the transform never sees
 * or embeds any part of the credential.
 *
 * Minimal collection: the transform reads ONLY the fields it claims (the host's services; the
 * certificates' fingerprints and parsed names) — the host view's location and banner details
 * and the certificates' issuer/subject DNs are deliberately not read. A hit whose parsed
 * names do not cover the requested domain is not claimed (the search engine may match other
 * fields; attribution stays on the exact requested domain). A host with no observed services
 * or a search with no covering hits is a true negative — no claims, no error.
 *
 * Source facts (verified 2026-10-17): the v2 envelope is {code, status, result} with code 200
 * on success; the host view echoes the requested IP in result.ip (the fail-closed identity
 * check below). The free/community tier is quota-limited by the source — the manifest's rps 1
 * is OUR declared bound.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { isIpv4, isIpv6, parseJson, expectStatus } from "./util.ts";

const CENSYS_HOSTS_VIEW = "https://search.censys.io/v2/hosts";
const CENSYS_CERTS_SEARCH = "https://search.censys.io/v2/certificates/search";

export interface Tr049Input {
  /** An IPv4 or IPv6 address (catalog ipv4 / ipv6) — the host-view subject. */
  readonly ip?: string;
  /** A DNS domain (catalog domain) — the certificate-search subject. */
  readonly domain?: string;
}

interface CensysService {
  readonly port?: unknown;
  readonly transport_protocol?: unknown;
  readonly service_name?: unknown;
}

interface CensysHostResult {
  readonly ip?: unknown;
  readonly services?: unknown;
}

interface CensysCertHit {
  readonly fingerprint_sha256?: unknown;
  readonly parsed?: { readonly names?: unknown };
}

/** A trimmed non-empty string not longer than the declared bound. */
function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return v === "" || v.length > max ? undefined : v;
}

/** The validated subject: exactly one of ip or domain, each with its own validation. */
type CensysSubject = { kind: "ip"; value: string } | { kind: "domain"; value: string };
function censysSubject(input: Tr049Input): CensysSubject {
  const ipSet = input.ip !== undefined && input.ip !== null && input.ip !== "";
  const domainSet = input.domain !== undefined && input.domain !== null && input.domain !== "";
  if (!ipSet && !domainSet) throw new Error("TR-049: exactly one of ip or domain is required");
  if (ipSet && domainSet) throw new Error("TR-049: only one of ip or domain may be set");
  return ipSet
    ? { kind: "ip", value: validateIpSubject(input.ip ?? "") }
    : { kind: "domain", value: validateDomainSubject(input.domain ?? "") };
}

/** An IPv4 or IPv6 address, trimmed. */
function validateIpSubject(raw: string): string {
  const ip = raw.trim();
  if (ip === "" || (!isIpv4(ip) && !isIpv6(ip))) {
    throw new Error(`TR-049: "${raw}" is not a valid IP address`);
  }
  return ip;
}

/** A DNS domain: LDH labels, at most 253 characters, at least one dot. */
function validateDomainSubject(raw: string): string {
  const domain = raw.trim().toLowerCase();
  if (domain === "" || domain.length > 253 || !/^[a-z0-9.-]+$/.test(domain) || !domain.includes(".")) {
    throw new Error(`TR-049: "${raw}" is not a valid domain`);
  }
  return domain;
}

/** The documented v2 envelope: code 200 and a result object, fail-closed otherwise. */
function censysEnvelope(parsed: { code?: unknown; result?: unknown }, what: string): unknown {
  if (parsed.code !== 200) {
    throw new Error(`TR-049: Censys returned a non-OK envelope (code ${String(parsed.code)})`);
  }
  if (parsed.result === undefined || parsed.result === null || typeof parsed.result !== "object") {
    throw new Error(`TR-049: Censys ${what} returned a malformed response (no result object)`);
  }
  return parsed.result;
}

/** The host view (the IP subject): one exposes_service claim per observed service. */
function censysIpFindings(ip: string, result: CensysHostResult, requestId: number): TransformFinding[] {
  if (result.ip !== undefined && result.ip !== ip) {
    throw new Error(`TR-049: Censys returned a different address (${String(result.ip)}) than requested (${ip})`);
  }
  if (result.services !== undefined && !Array.isArray(result.services)) {
    throw new Error("TR-049: Censys host view returned a malformed response (services is not an array)");
  }
  const findings: TransformFinding[] = [];
  for (const raw of (result.services as readonly unknown[]) ?? []) {
    if (raw === null || typeof raw !== "object") continue;
    const service = raw as CensysService;
    if (typeof service.port !== "number" || !Number.isInteger(service.port) || service.port < 1 || service.port > 65535) continue;
    const transport = cleanText(service.transport_protocol, 10) ?? "TCP";
    const name = cleanText(service.service_name, 100);
    findings.push({
      predicate: "exposes_service",
      evidence: [requestId],
      objectType: "service",
      objectValue: `${transport.toUpperCase()}/${service.port}`,
      confidence: 0.9,
      explanation: `Censys: ${ip} exposes ${name === undefined ? "a service" : name} on ${transport.toUpperCase()} port ${service.port}`,
    });
  }
  return findings;
}

/** The certificates search (the domain subject): one has_certificate claim per covering hit. */
function censysDomainFindings(domain: string, result: { hits?: unknown }, requestId: number): TransformFinding[] {
  const hits = result.hits;
  if (hits !== undefined && !Array.isArray(hits)) {
    throw new Error("TR-049: Censys certificates search returned a malformed response (hits is not an array)");
  }
  const findings: TransformFinding[] = [];
  for (const raw of (hits as readonly unknown[]) ?? []) {
    if (raw === null || typeof raw !== "object") continue;
    const hit = raw as CensysCertHit;
    // A claimed certificate must carry a valid sha256 fingerprint — a hit without one is
    // malformed for our purpose and is skipped, never guessed (D-018).
    const fingerprint = typeof hit.fingerprint_sha256 === "string" ? hit.fingerprint_sha256.trim().toLowerCase() : "";
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) continue;
    const names = hit.parsed?.names;
    if (!Array.isArray(names)) continue;
    // Attribution stays on the exact requested domain: only a hit whose parsed names cover
    // the domain is claimed — the search engine may match other fields.
    if (!names.some((n) => typeof n === "string" && n.trim().toLowerCase() === domain)) continue;
    findings.push({
      predicate: "has_certificate",
      evidence: [requestId],
      objectType: "certificate",
      objectValue: fingerprint,
      confidence: 0.9,
      explanation: `Censys: a certificate covering ${domain} was observed (sha256 fingerprint ${fingerprint})`,
    });
  }
  return findings;
}

export const censysHostsCertificates = defineTransform<Tr049Input>(
  {
    id: "TR-049",
    version: "1.0.0",
    inputs: ["ip", "domain"],
    outputs: ["ipv4", "ipv6", "domain", "certificate"],
    network: { mode: "pinned", allow: ["search.censys.io"] },
    secrets: ["CENSYS_API_ID"],
    // OUR declared bound within the source's tier quota.
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-D",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: { reliability: "B", credibility: 3, rationale: "Censys مسح منهجي واسع النطاق — ملاحظات مسح فعلية بشهادات وخدمات مكشوفة" },
  },
  async (input, ctx) => {
    const subject = censysSubject(input);
    if (subject.kind === "ip") {
      const ip = subject.value;
      const res = await ctx.http.get(`${CENSYS_HOSTS_VIEW}/${ip}`);
      expectStatus(res, [200], "Censys host view");
      const parsed = parseJson(res.body, "Censys host view") as { code?: unknown; result?: unknown };
      const host = censysEnvelope(parsed, "host view") as CensysHostResult;
      // The identity check and the malformed checks live in the helper (fail-closed, never
      // silent misattribution).
      return { findings: censysIpFindings(ip, host, res.requestId) };
    }

    const domain = subject.value;
    const res = await ctx.http.get(`${CENSYS_CERTS_SEARCH}?q=${encodeURIComponent(domain)}`);
    expectStatus(res, [200], "Censys certificates search");
    const parsed = parseJson(res.body, "Censys certificates search") as { code?: unknown; result?: unknown };
    const result = censysEnvelope(parsed, "certificates search");
    return { findings: censysDomainFindings(domain, result as { hits?: unknown }, res.requestId) };
  },
);
