/**
 * TR-048 — SecurityTrails DNS history (P2-026, the path_parameter batch — owner decision
 * 2026-10-17).
 *
 * Value: https://api.securitytrails.com — the historical DNS database. The transform looks up the
 * DNS record history of one host name for ONE record type (default a) and emits each historical
 * record as a finding on the host — the value (an address, a mail host, a name server, a TXT
 * string) with its first/last-seen window in the explanation. An A-record value is itself an IP:
 * the finding expands the graph (the host resolved to it).
 *
 * THE HOST NAME AND THE RECORD TYPE BOTH TRAVEL IN THE REQUEST PATH —
 * /v1/history/{hostname}/dns/{type}. This is the P2-026 path_template case: the gateway enforces
 * the closed template row (the provider registry entry securitytrails + the policy table in
 * packages/egress/providers/post-policies.ts) — the type parameter is a closed enum (a, aaaa, mx,
 * ns, soa, txt — the source's own documented list) and the host name is a domain type with a
 * declared max length. The transform's own job is to validate the subject and the type BEFORE
 * the request (so an undeclared type is refused locally too, not just at the gateway) and to
 * attribute the response fail-closed.
 *
 * The key (SECURITYTRAILS_KEY) travels ONLY in the `apikey` header, injected by the egress gateway
 * from the vault (pinned mode, ADR-08 §7); the transform never sees or embeds it.
 *
 * Source verified against the official docs (docs.securitytrails.com, the DNS-history-by-record-type
 * reference, 2026-10-17): the response carries `records` (each with `values` and `first_seen` /
 * `last_seen` dates) and `host` (the echoed subject). The API is read-only, 100 records per page —
 * OUR declared bound is one page (no pagination), and at most 100 record values emitted per run.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { parseJson, expectStatus } from "./util.ts";

const ST_BASE = "https://api.securitytrails.com/v1/history";

/** The source's own closed list (docs: "allowed values: a, aaaa, mx, ns, soa or txt"). */
const DNS_TYPES = ["a", "aaaa", "mx", "ns", "soa", "txt"] as const;
export type StDnsType = (typeof DNS_TYPES)[number];

/** OUR declared bounds: one page (the source's page size is 100) and no more values emitted. */
const MAX_RECORDS = 100;

export interface Tr048Input {
  /** A host name (catalog hostname/domain). */
  readonly domain: string;
  /** The DNS record type — the source's closed list; defaults to `a`. */
  readonly type?: StDnsType;
}

interface StRecord {
  readonly values?: ReadonlyArray<{ value?: unknown }>;
  readonly first_seen?: string;
  readonly last_seen?: string;
}

interface StHistory {
  readonly host?: string;
  readonly type?: string;
  readonly records?: readonly StRecord[];
}

/** A short clean string from the source — skipped, never emitted, when absent or malformed. */
function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (v === "" || v.length > max) return undefined;
  return v;
}

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function isIpv4Value(v: string): boolean {
  if (!IPV4.test(v)) return false;
  return v.split(".").every((o) => Number(o) <= 255);
}

/** The seen window string of one historical record (first/last seen from the source). */
function seenWindow(record: StRecord): string {
  const firstSeen = cleanText(record.first_seen, 40);
  const lastSeen = cleanText(record.last_seen, 40);
  return firstSeen !== undefined || lastSeen !== undefined ? ` (seen ${firstSeen ?? "?"} to ${lastSeen ?? "?"})` : "";
}

/** One record's findings, per the record type: a/aaaa values are address objects (graph nodes),
 *  mx/ns values are host names (the priority prefix is stripped), soa/txt values are free-form text
 *  carried in the explanation as a claim on the host itself. A malformed value is skipped, never
 *  emitted (D-018). */
function addressFinding(value: string, hostname: string, type: StDnsType, window: string, requestId: number): TransformFinding | undefined {
  const isV4 = isIpv4Value(value);
  const isV6 = !isV4 && IPV6.test(value);
  if (!isV4 && !isV6) return undefined; // a malformed address is skipped, never emitted (D-018)
  return {
    predicate: "resolves_to",
    evidence: [requestId],
    objectType: isV4 ? "ipv4" : "ipv6",
    objectValue: value,
    confidence: 0.9,
    explanation: `SecurityTrails: ${hostname} had a ${type.toUpperCase()} record for ${value}${window}`,
  };
}

function hostFinding(value: string, hostname: string, type: StDnsType, window: string, requestId: number): TransformFinding | undefined {
  // MX values can carry a priority prefix ("10 mail.example.com") — the host name is the value.
  const host = value.split(/\s+/).pop() ?? "";
  if (!HOSTNAME.test(host)) return undefined;
  return {
    predicate: type === "mx" ? "has_mail_server" : "has_nameserver",
    evidence: [requestId],
    objectType: "hostname",
    objectValue: host,
    confidence: 0.9,
    explanation: `SecurityTrails: ${hostname} had the ${type.toUpperCase()} record ${host}${window}`,
  };
}

function textFinding(value: string, hostname: string, type: StDnsType, window: string, requestId: number): TransformFinding {
  // soa / txt: the value is free-form text — carried in the explanation, a claim on the host.
  return {
    predicate: type === "soa" ? "has_soa_record" : "has_txt_record",
    evidence: [requestId],
    objectType: "hostname",
    objectValue: hostname,
    confidence: 0.9,
    explanation: `SecurityTrails: ${hostname} had a ${type.toUpperCase()} record "${value}"${window}`,
  };
}

function recordFindings(record: StRecord, hostname: string, type: StDnsType, requestId: number): TransformFinding[] {
  const window = seenWindow(record);
  const findings: TransformFinding[] = [];
  for (const v of record.values ?? []) {
    const value = cleanText(v?.value, 500);
    if (value === undefined) continue;
    const finding =
      type === "a" || type === "aaaa"
        ? addressFinding(value, hostname, type, window, requestId)
        : type === "mx" || type === "ns"
          ? hostFinding(value, hostname, type, window, requestId)
          : textFinding(value, hostname, type, window, requestId);
    if (finding !== undefined) findings.push(finding);
  }
  return findings;
}

export const securityTrailsDnsHistory = defineTransform<Tr048Input>(
  {
    id: "TR-048",
    version: "1.0.0",
    inputs: ["domain", "hostname"],
    outputs: ["domain", "hostname", "ipv4", "ipv6"],
    network: { mode: "pinned", allow: ["api.securitytrails.com"] },
    secrets: ["SECURITYTRAILS_KEY"],
    // OUR declared bound within the read-only API's page model.
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-D",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "C",
      credibility: 3,
      rationale: "SecurityTrails قاعدة DNS تاريخية تجارية — أرشيف تجاري منهجي لكنه وسيط غير رسمي",
    },
  },
  async (input, ctx) => {
    if (input.domain === undefined || input.domain === null) throw new Error("TR-048: domain is required");
    const hostname = input.domain.trim().toLowerCase();
    if (hostname === "" || hostname.length > 253 || !HOSTNAME.test(hostname)) {
      throw new Error(`TR-048: "${input.domain}" is not a valid host name`);
    }
    const type = input.type ?? "a";
    if (!DNS_TYPES.includes(type)) {
      throw new Error(`TR-048: "${input.type}" is not one of the allowed record types (${DNS_TYPES.join(", ")})`);
    }
    const res = await ctx.http.get(`${ST_BASE}/${encodeURIComponent(hostname)}/dns/${type}`);
    expectStatus(res, [200], "SecurityTrails DNS history");
    const parsed = parseJson(res.body, "SecurityTrails DNS history") as StHistory;
    // The record must be about the requested host — never attributed otherwise (fail-closed).
    if (parsed.host !== undefined && parsed.host.toLowerCase() !== hostname) {
      throw new Error(`TR-048: SecurityTrails returned a different host (${parsed.host}) than requested (${hostname})`);
    }
    const records = Array.isArray(parsed.records) ? parsed.records.slice(0, MAX_RECORDS) : [];
    const findings: TransformFinding[] = [];
    for (const record of records) {
      for (const finding of recordFindings(record, hostname, type, res.requestId)) findings.push(finding);
    }
    return { findings };
  },
);
