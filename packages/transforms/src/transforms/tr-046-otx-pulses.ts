/**
 * TR-046 — AlienVault OTX threat pulses (P2-026, the path_parameter batch — owner decision
 * 2026-10-17).
 *
 * Value: https://otx.alienvault.com — the open threat-exchange community. The transform checks one
 * indicator (an IPv4/IPv6 address, a domain, a hostname or a file hash) and emits the pulses that
 * reference it — a pulse is a curated threat report (a set of related indicators with a name and
 * an author), so "referenced in N pulses" is the community's corroboration that the indicator is
 * part of a known threat.
 *
 * THE SUBJECT TRAVELS IN THE REQUEST PATH — /api/v1/indicators/{type}/{indicator}/general. This
 * is the P2-026 path_template case: the gateway enforces the closed template rows (the provider
 * registry entry otx + the policy table in packages/egress/providers/post-policies.ts). The `url`
 * indicator type is deliberately NOT accepted: its path segment is a percent-encoded full URL,
 * which no closed type in the vocabulary takes (documented for the owner — an architectural
 * decision, not forced through the template mechanism).
 *
 * The key (OTX_KEY) travels ONLY in the `X-OTX-API-KEY` header, injected by the egress gateway
 * from the vault (pinned mode, ADR-08 §7); the transform never sees or embeds it.
 *
 * Source verified against the official docs (otx.alienvault.com, the external API reference,
 * 2026-10-17): the general section's response carries `pulse_info` with `count` (the total pulses
 * referencing the indicator) and `pulses` (the pulse objects — id, name, author). The identity
 * check below uses the echoed `indicator` field. 10,000 requests/hour with a key — the manifest's
 * rps 1 is OUR declared bound far within that.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { isIpv4, isIpv6, parseJson, expectStatus } from "./util.ts";

const OTX_BASE = "https://otx.alienvault.com/api/v1/indicators";

/** OUR declared bound: at most this many pulse findings per run (the API pages; we take one page —
 *  the general section's first page — and never paginate into a flood; documented in STATUS). */
const MAX_PULSE_FINDINGS = 10;

export interface Tr046Input {
  /** An IPv4 or IPv6 address (catalog ipv4 / ipv6). */
  readonly ip?: string;
  /** A domain (catalog domain). */
  readonly domain?: string;
  /** A hostname (catalog hostname). */
  readonly hostname?: string;
  /** An md5/sha1/sha256 file hash (catalog file_hash). */
  readonly hash?: string;
}

interface OtxPulse {
  readonly id?: string;
  readonly name?: string;
  readonly author_name?: string;
}

interface OtxGeneral {
  readonly indicator?: string;
  readonly pulse_info?: {
    readonly count?: number;
    readonly pulses?: readonly OtxPulse[];
  };
}

/** A short clean string from the source — skipped, never emitted, when absent or malformed. */
function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (v === "" || v.length > max) return undefined;
  return v;
}

/** The subject routing: exactly one of the four subject fields, validated, mapped to the OTX
 *  indicator type segment and the catalog object type. The `url` indicator type is deliberately
 *  absent (a percent-encoded full URL fits no closed type — documented for the owner). */
function otxIpSubject(raw: string): { typeSegment: string; objectType: string; objectValue: string } {
  const ip = raw.trim();
  if (ip === "" || (!isIpv4(ip) && !isIpv6(ip))) throw new Error(`TR-046: "${raw}" is not a valid IP address`);
  const isV4 = isIpv4(ip);
  return { typeSegment: isV4 ? "IPv4" : "IPv6", objectType: isV4 ? "ipv4" : "ipv6", objectValue: ip };
}

function otxNameSubject(raw: string, kind: "domain" | "hostname"): { typeSegment: string; objectType: string; objectValue: string } {
  const name = raw.trim().toLowerCase();
  if (name === "" || name.length > 253 || !/^[a-z0-9.-]+$/.test(name)) {
    throw new Error(`TR-046: "${raw}" is not a valid ${kind === "domain" ? "domain" : "host name"}`);
  }
  return { typeSegment: kind, objectType: kind, objectValue: name };
}

function otxHashSubject(raw: string | undefined): { typeSegment: string; objectType: string; objectValue: string } {
  const hash = (raw ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(hash)) {
    throw new Error(`TR-046: "${raw}" is not an md5, sha1 or sha256 hash`);
  }
  return { typeSegment: "file", objectType: "file_hash", objectValue: hash };
}

function otxSubject(input: Tr046Input): { typeSegment: string; objectType: string; objectValue: string } {
  const set = [input.ip, input.domain, input.hostname, input.hash].filter((v) => v !== undefined && v !== null && v !== "");
  if (set.length === 0) throw new Error("TR-046: exactly one of ip, domain, hostname or hash is required");
  if (set.length > 1) throw new Error("TR-046: only one of ip, domain, hostname or hash may be set");
  if (input.ip !== undefined) return otxIpSubject(input.ip);
  if (input.domain !== undefined) return otxNameSubject(input.domain, "domain");
  if (input.hostname !== undefined) return otxNameSubject(input.hostname, "hostname");
  return otxHashSubject(input.hash);
}

/** One referenced_in_pulse finding per pulse, bounded at our declared emission bound, with the
 *  source's own total carried when it exceeds it (the run never silently under-reports). */
function pulseFindings(
  pulses: readonly OtxPulse[],
  totalCount: number,
  objectType: string,
  objectValue: string,
  requestId: number,
): TransformFinding[] {
  const findings: TransformFinding[] = [];
  const emitted = pulses.slice(0, MAX_PULSE_FINDINGS);
  for (const pulse of emitted) {
    const name = cleanText(pulse.name, 300);
    const author = cleanText(pulse.author_name, 200);
    const id = cleanText(pulse.id, 64);
    if (name === undefined && id === undefined) continue;
    findings.push({
      predicate: "referenced_in_pulse",
      evidence: [requestId],
      objectType,
      objectValue,
      confidence: 0.8,
      explanation:
        `OTX: ${objectValue} is referenced in the pulse "${name ?? id}"` +
        (author !== undefined ? ` by ${author}` : "") +
        (id !== undefined ? ` (pulse id ${id})` : ""),
    });
  }
  if (totalCount > emitted.length && findings.length > 0) {
    findings[findings.length - 1].explanation +=
      ` — and ${totalCount - emitted.length} more pulses (our emission bound is ${MAX_PULSE_FINDINGS})`;
  }
  return findings;
}

export const otxPulses = defineTransform<Tr046Input>(
  {
    id: "TR-046",
    version: "1.0.0",
    inputs: ["ipv4", "ipv6", "domain", "hostname", "file_hash"],
    outputs: ["ipv4", "ipv6", "domain", "hostname", "file_hash"],
    network: { mode: "pinned", allow: ["otx.alienvault.com"] },
    secrets: ["OTX_KEY"],
    // OUR declared bound far within the source's documented 10,000/hour.
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-C",
  },
  async (input, ctx) => {
    const subject = otxSubject(input);
    const res = await ctx.http.get(`${OTX_BASE}/${subject.typeSegment}/${encodeURIComponent(subject.objectValue)}/general`);
    expectStatus(res, [200], "OTX indicator pulses");
    const parsed = parseJson(res.body, "OTX indicator pulses") as OtxGeneral;
    // The record must be about the requested indicator — never attributed otherwise (fail-closed).
    if (parsed.indicator !== undefined && parsed.indicator !== subject.objectValue) {
      throw new Error(`TR-046: OTX returned a different indicator (${parsed.indicator}) than requested (${subject.objectValue})`);
    }
    const info = parsed.pulse_info;
    const totalCount = typeof info?.count === "number" && Number.isInteger(info.count) && info.count >= 0 ? info.count : 0;
    const pulses = Array.isArray(info?.pulses) ? (info?.pulses as OtxPulse[]) : [];
    return { findings: pulseFindings(pulses, totalCount, subject.objectType, subject.objectValue, res.requestId) };
  },
);
