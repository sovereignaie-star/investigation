/**
 * Request content inventory (ADR-08 section 2, T-SEC-SSRF-043), P2-003.
 *
 * `sends` declares which kinds of case data a request carries. The gateway does not take that declaration on trust:
 * before DNS it runs the deterministic identifier detector of `@ir/core` (the same catalog of 371 types used for
 * case data, P1-003/P1-006) over every surface the transform controls, maps each finding to a `sends` kind, and
 * refuses the request when a finding is not declared (`undeclared_data`) or is a natural-person type, whatever the
 * request's own `sensitivity` label says (`natural_person`, no downgrade by labelling).
 *
 * Surfaces: every path segment, every query key and value, the fragment, and every header value. The request
 * contract has no body (GET/HEAD only; a `body` field is an unknown field), so there is no body surface to inspect.
 * Not inspected: the destination host itself (it is the destination, checked by the address policy), and a header
 * value that carries the request's own `secret` (checked by the secret rules; inspecting it would only find the key).
 * Redirect targets are chosen by the server, not by the transform, and are not inventoried.
 *
 * What this does NOT prove: the detector finds what the catalog can recognise. Data in a form no catalog type
 * matches (free text, an encoding the detector does not undo) is not found. Findings never include the value.
 */
import { extract, specById } from "@ir/core/identifiers";

export type ContentSurface = "path" | "query" | "fragment" | "header";

/** One reading of a detected value: its `sends` kind, catalog type and sensitivity. */
export interface ContentReading {
  /** The `sends` kind (a public kind, or the catalog type id for any other data). */
  readonly kind: string;
  readonly type: string;
  readonly sensitivity: "normal" | "natural_person_gate" | "minor";
}

/** One detected value. Ties share a pattern (D-007, D-029), so a value can have several equally likely readings. */
export interface ContentFinding {
  readonly surface: ContentSurface;
  readonly readings: readonly ContentReading[];
}

const IP_TYPES = new Set([
  "ipv4",
  "ipv6",
  "cidr",
  "bgp_prefix",
  "ip_private",
  "ip_tor_exit",
  "vpn_ip",
  "ipv4_loopback",
  "multicast_ip",
  "ipv4_apipa",
]);
const DOMAIN_TYPES = new Set(["domain", "subdomain", "hostname"]);
const URL_TYPES = new Set([
  "url",
  "url_http",
  "url_https",
  "ftp_url",
  "ssh_url",
  "git_repo",
  "url_shortener",
  "api_endpoint",
  "websocket_url",
  "rtmp_url",
]);

/** Catalog type -> `sends` kind. Anything that is not one of the public kinds keeps its own type id. */
export function sendKindOf(type: string, category: string): string {
  if (IP_TYPES.has(type)) return "ip";
  if (type === "asn") return "asn";
  if (DOMAIN_TYPES.has(type)) return "domain";
  if (URL_TYPES.has(type)) return "url";
  if (type === "ssl_cert_hash") return "certificate";
  if (category === "Hash") return "hash";
  return type;
}

/**
 * The catalog's `hostname` pattern accepts any single DNS label, so `1` in `?page=1` or `v3` in a path would be read
 * as a hostname and refuse ordinary requests. A label without a dot is not a resolvable public name and is not case
 * data the gateway can reason about, so that reading is ignored here (the catalog itself is not changed by P2-003).
 * Known limit: a bare internal host label (`intranet`) is therefore not reported as `domain` data.
 */
function isBareLabel(type: string, value: string): boolean {
  return type === "hostname" && !value.includes(".");
}

/**
 * Refusal criterion (P2-003, 2026-10-13), asymmetric on purpose:
 * - an ordinary (normal-sensitivity) reading counts only on its own evidence: it passed the type's validator
 *   (checksum, PSL, ...) or its pattern is specific (specificity >= 0.5, the bar `extract` uses for context-free
 *   candidates). A reading that is reportable ONLY because a nearby word is a context keyword does not refuse: the
 *   query key is such a word, so `?name=Bob` would otherwise read any short value as a `netbios_name`;
 * - a natural-person reading counts whenever `extract` reports it, context included (`?passport=AB123456`): the
 *   protected category stays fail-closed (ADR-08 section 2, reason precedence).
 * Known limit: an ordinary identifier the catalog can only recognise through context is not found here.
 */
const MIN_SPECIFICITY = 0.5;
function isStrongReading(c: { validated: boolean; specificity: number; sensitivity: string }): boolean {
  return c.sensitivity === "natural_person_gate" || c.validated || c.specificity >= MIN_SPECIFICITY;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s; // a malformed escape is inspected as written
  }
}

function surfaces(
  url: URL,
  headers: Readonly<Record<string, string>> | undefined,
  secret: string | undefined,
): Array<[ContentSurface, string]> {
  const out: Array<[ContentSurface, string]> = [];
  for (const seg of url.pathname.split("/")) if (seg !== "") out.push(["path", decode(seg)]);
  for (const [k, v] of url.searchParams) out.push(["query", `${k} ${v}`]);
  if (url.hash.length > 1) out.push(["fragment", decode(url.hash.slice(1))]);
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (secret !== undefined && secret !== "" && value.includes(secret)) continue;
    out.push(["header", `${name} ${value}`]);
  }
  return out;
}

/** Every detected value on the request's own surfaces, in surface order. Values are never returned. */
export function inventoryRequest(
  url: URL,
  headers: Readonly<Record<string, string>> | undefined,
  secret: string | undefined,
): ContentFinding[] {
  const out: ContentFinding[] = [];
  for (const [surface, text] of surfaces(url, headers, secret)) {
    for (const hit of extract(text)) {
      const readings = hit.candidates
        .filter((c) => c.score === hit.best.score)
        .filter((c) => !isBareLabel(c.type, hit.value))
        .filter(isStrongReading)
        .map((c) => ({ kind: sendKindOf(c.type, specById(c.type)?.category ?? ""), type: c.type, sensitivity: c.sensitivity }));
      if (readings.length > 0) out.push({ surface, readings });
    }
  }
  return out;
}

/**
 * The decision on an inventory: a natural-person reading refuses (`natural_person`, whatever the request's label);
 * a value none of whose readings is a declared kind refuses (`undeclared_data`); otherwise null.
 */
export function judgeInventory(
  findings: readonly ContentFinding[],
  sends: readonly string[],
): { reason: "natural_person" | "undeclared_data"; detail: string } | null {
  for (const f of findings) {
    const np = f.readings.find((r) => r.sensitivity === "natural_person_gate");
    if (np) return { reason: "natural_person", detail: `${f.surface} carries a natural-person identifier (${np.type})` };
  }
  for (const f of findings) {
    if (!f.readings.some((r) => sends.includes(r.kind))) {
      const kinds = [...new Set(f.readings.map((r) => r.kind))].join("|");
      return { reason: "undeclared_data", detail: `${f.surface} carries undeclared data (${kinds})` };
    }
  }
  return null;
}
