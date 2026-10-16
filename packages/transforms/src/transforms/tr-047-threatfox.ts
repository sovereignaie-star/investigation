/**
 * TR-047 — abuse.ch ThreatFox IOC search (P2-026, batch 5).
 *
 * Value: https://threatfox-api.abuse.ch — the community IOC database. The transform searches
 * an indicator (IP / domain / URL / file hash) and emits a finding per reported IOC with its
 * threat type, malware family and confidence.
 *
 * ADR-29 (owner decision 2026-10-17) governs the POST:
 * - the IOC search goes ONLY to threatfox-api.abuse.ch/api/v1/ (pinned host+path), with a body
 *   built from the FIXED schema {query, search_term} — query is the closed operation
 *   `search_ioc`, search_term is the IOC (a string of at most 256 characters). The source's
 *   other documented operation (search_hash, whose body uses a different field name `hash`)
 *   is NOT used: it is outside the ADR-29 fixed schema, and search_ioc's search_term is
 *   documented as "IOC you want to search for" (type-unrestricted — the docs' example uses an
 *   IP; a file hash is an IOC). The optional exact_match field is deliberately NOT sent
 *   (ADR-29 condition 1: no additional fields).
 * - the key (THREATFOX_AUTH_KEY) travels ONLY in the Auth-Key header, injected by the egress
 *   adapter from the vault (the manifest's `secrets` binding — pinned mode, ADR-08 §7); the
 *   transform never sees or embeds it.
 * - the body and the response never enter evidence, the audit trail, traceback or CI outputs
 *   (the recording transport records {url, method, status} only for a POST); what reaches the
 *   findings is the product (the reported IOCs) after the catalog-type validation.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { matchesSpec, specById } from "@ir/core/identifiers";
import { expectStatus, parseJson } from "./util.ts";

const THREATFOX_API = "https://threatfox-api.abuse.ch/api/v1/";
/** ADR-29 condition 1: search_term is a string of at most 256 characters. */
const SEARCH_TERM_MAX_CHARS = 256;

export interface Tr047Input {
  /** An IPv4 address (catalog ipv4) — the IOC to search. */
  readonly ip?: string;
  /** A domain (catalog domain) — the IOC to search. */
  readonly domain?: string;
  /** A URL (catalog url) — the IOC to search. */
  readonly url?: string;
  /** A file hash (catalog md5_hash / sha256_hash) — the IOC to search. */
  readonly hash?: string;
}

/** The catalog type of an IOC value, or null when it matches no catalog spec. */
function iocType(value: string): string | null {
  for (const type of ["ipv4", "domain", "url", "md5_hash", "sha256_hash"]) {
    const spec = specById(type);
    if (spec !== undefined && matchesSpec(spec, value).pattern === true) return type;
  }
  return null;
}

interface ThreatFoxEntry {
  readonly ioc?: string;
  readonly threat_type?: string;
  readonly malware_printable?: string;
  readonly confidence_level?: number;
}

/** Exactly one input field must be set; the IOC is validated against the catalog types. */
function resolveIoc(input: Tr047Input): string {
  const fields = [
    ["ip", input.ip],
    ["domain", input.domain],
    ["url", input.url],
    ["hash", input.hash],
  ] as const;
  const set = fields.filter(([, v]) => v !== undefined);
  if (set.length !== 1) {
    throw new Error("TR-047: exactly one of ip / domain / url / hash is required");
  }
  const ioc = (set[0][1] ?? "").trim();
  if (ioc === "" || ioc.length > SEARCH_TERM_MAX_CHARS) {
    throw new Error(`TR-047: the IOC must be a non-empty string of at most ${SEARCH_TERM_MAX_CHARS} characters`);
  }
  if (iocType(ioc) === null) {
    throw new Error("TR-047: the value does not match a catalog IOC type (ipv4/domain/url/md5_hash/sha256_hash)");
  }
  return ioc;
}

/** One finding per reported IOC (deduplicated, catalog-validated), with its threat context. */
function threatFoxFindings(entries: readonly ThreatFoxEntry[], requestId: number): TransformFinding[] {
  const findings: TransformFinding[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const value = entry.ioc;
    if (typeof value !== "string" || value === "" || seen.has(value)) continue;
    const objectType = iocType(value);
    if (objectType === null) continue;
    seen.add(value);
    findings.push({
      predicate: "flagged_in_threatfox",
      objectType,
      objectValue: value,
      confidence: validConfidence(entry.confidence_level) ?? 0.5,
      explanation: `ThreatFox: ${value} reported as ${entry.threat_type ?? "unknown threat"} (${entry.malware_printable ?? "unspecified malware"})`,
      evidence: [requestId],
    });
  }
  return findings;
}

function validConfidence(level: unknown): number | undefined {
  if (typeof level !== "number" || level < 0 || level > 100) return undefined;
  return level / 100;
}

export const threatfoxSearch = defineTransform<Tr047Input>(
  {
    id: "TR-047",
    version: "1.0.0",
    inputs: ["ip", "domain", "url", "hash"],
    outputs: ["ipv4", "domain", "url", "md5_hash", "sha256_hash"],
    network: { mode: "pinned", allow: ["threatfox-api.abuse.ch"] },
    secrets: ["THREATFOX_AUTH_KEY"],
    // ADR-29 condition 4: the declared rate cap — rps 1 (no burst); the community Auth-Key
    // tier is the operational bound.
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 2_000_000 },
    sensitivity: "normal",
    license: "LC-C",
  },
  async (input, ctx) => {
    const ioc = resolveIoc(input);
    // ADR-29 condition 1: the fixed body schema — exactly {query, search_term}, nothing else.
    const body = JSON.stringify({ query: "search_ioc", search_term: ioc });
    const res = await ctx.http.post(THREATFOX_API, { accept: "application/json" }, body);
    expectStatus(res, [200], "ThreatFox IOC search");
    const parsed = parseJson(res.body, "ThreatFox IOC search") as {
      query_status?: string;
      data?: readonly ThreatFoxEntry[];
    };
    // The source's no-result state is an empty finding set, not an error.
    if (parsed.query_status === "no_result") return { findings: [] };
    if (parsed.query_status !== "ok") {
      throw new Error(`TR-047: ThreatFox query failed (status: ${parsed.query_status ?? "unknown"})`);
    }
    return { findings: threatFoxFindings(parsed.data ?? [], res.requestId) };
  },
);
