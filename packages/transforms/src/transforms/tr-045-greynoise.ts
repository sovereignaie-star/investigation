/**
 * TR-045 — GreyNoise community IP classification (P2-026, the path_parameter batch — owner
 * decision 2026-10-17).
 *
 * Value: https://api.greynoise.io — the internet-scanner database. The transform checks one IPv4
 * address and emits the source's classification of it (benign service, mass scanner, or unknown)
 * plus its context (the named service, the last-seen date).
 *
 * THE SUBJECT TRAVELS IN THE REQUEST PATH — /v3/community/{ip}. This is the P2-026 path_template
 * case: the gateway enforces the closed template row (the provider registry entry greynoise +
 * the policy table in packages/egress/providers/post-policies.ts) — an IPv4-only closed type
 * with a declared max length. The transform's own job is to validate the subject (IPv4 only —
 * the source returns 400 for a non-routable IPv4, and the Community API does not take IPv6) and
 * to attribute the response fail-closed.
 *
 * The key (GREYNOISE_KEY) travels ONLY in the `key` header, injected by the egress gateway from
 * the vault (pinned mode, ADR-08 §7); the transform never sees or embeds it.
 *
 * Source verified against the official docs (docs.greynoise.io, the Community API reference,
 * 2026-10-17): the response carries `noise` (the IP has been seen scanning the internet), `riot`
 * (a known benign common service), `classification` (benign / malicious / unknown), `name` (the
 * service's name when known), `last_seen` (an ISO date), and `ip` (the echoed subject — the
 * fail-closed identity check below). The free tier is 50 lookups/week — the manifest's rps 1 is
 * OUR declared bound within that.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { isIpv4, parseJson, expectStatus } from "./util.ts";

export interface Tr045Input {
  /** An IPv4 address (catalog ipv4 — the Community API takes IPv4 only). */
  readonly ip: string;
}

interface GreyNoiseData {
  readonly ip?: string;
  readonly noise?: boolean;
  readonly riot?: boolean;
  readonly classification?: string;
  readonly name?: string;
  readonly link?: string;
  readonly last_seen?: string;
  readonly message?: string;
}

/** A short clean string from the source — skipped, never emitted, when absent or malformed. */
function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (v === "" || v.length > max) return undefined;
  return v;
}

/** The findings mapping — the source's own classification/noise/riot labels, never invented:
 *  a classification claim only for malicious/benign (unknown emits nothing), the noise claim as
 *  a mass-scanner marker, and the RIOT service name as an organization object. */
function greyNoiseFindings(data: GreyNoiseData, ip: string, requestId: number): TransformFinding[] {
  const findings: TransformFinding[] = [];
  const classification = cleanText(data.classification, 20);
  const name = cleanText(data.name, 200);
  const lastSeen = cleanText(data.last_seen, 40);
  const seen = lastSeen !== undefined ? `; last seen ${lastSeen}` : "";
  if (classification === "malicious" || classification === "benign") {
    findings.push({
      predicate: classification === "malicious" ? "is_classified_malicious" : "is_classified_benign",
      evidence: [requestId],
      objectType: "ipv4",
      objectValue: ip,
      confidence: 0.8,
      explanation:
        `GreyNoise: ${ip} is classified ${classification}${name !== undefined ? ` (${name})` : ""}${seen}` +
        (classification === "benign" && data.riot === true ? " — a Rulebook-Verified common service (RIOT)" : ""),
    });
  }
  if (data.noise === true) {
    findings.push({
      predicate: "is_mass_scanner",
      evidence: [requestId],
      objectType: "ipv4",
      objectValue: ip,
      confidence: 0.9,
      explanation: `GreyNoise: ${ip} has been seen scanning the internet (noise)${seen}`,
    });
  }
  if (data.riot === true && name !== undefined) {
    findings.push({
      predicate: "operates_service",
      evidence: [requestId],
      objectType: "organization",
      objectValue: name,
      confidence: 0.9,
      explanation: `GreyNoise: ${ip} is the named common service ${name} (RIOT)${seen}`,
    });
  }
  return findings;
}

export const greyNoiseClassification = defineTransform<Tr045Input>(
  {
    id: "TR-045",
    version: "1.0.0",
    inputs: ["ipv4"],
    outputs: ["ipv4", "organization"],
    network: { mode: "pinned", allow: ["api.greynoise.io"] },
    secrets: ["GREYNOISE_KEY"],
    // OUR declared bound (the source documents a weekly free-tier quota, no per-minute limit).
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 100_000 },
    sensitivity: "normal",
    license: "LC-C",
  },
  async (input, ctx) => {
    if (input.ip === undefined || input.ip === null) throw new Error("TR-045: ip is required");
    const ip = input.ip.trim();
    if (ip === "" || !isIpv4(ip)) throw new Error(`TR-045: "${input.ip}" is not an IPv4 address (the Community API takes IPv4 only)`);
    const res = await ctx.http.get(`https://api.greynoise.io/v3/community/${encodeURIComponent(ip)}`);
    expectStatus(res, [200], "GreyNoise community");
    const parsed = parseJson(res.body, "GreyNoise community") as GreyNoiseData;
    if (parsed.ip !== undefined && parsed.ip !== ip) {
      throw new Error(`TR-045: GreyNoise returned a different address (${parsed.ip}) than requested (${ip})`);
    }
    return { findings: greyNoiseFindings(parsed, ip, res.requestId) };
  },
);
