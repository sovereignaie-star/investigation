/**
 * TR-052 — Common Crawl index presence (P2-026, batch 5; the last executable unit).
 *
 * Value: https://commoncrawl.org — the open web crawl. The transform answers «does this domain
 * appear in the open archive, and what pages of it were captured?» — an appearance history that
 * predates and outlives the live site.
 *
 * Keyless (LC-B, public — no secret, no provider registry entry: the registry exists for
 * header-injected secrets). Two documented requests, both on index.commoncrawl.org:
 *  1. GET /collinfo.json — the fixed collection list (newest first per the source's docs);
 *  2. GET {newest cdx-api}?url=<domain>&matchType=domain&output=json&filter=status:200&limit=100 —
 *     the CDXJ answer: one JSON line per capture ("<urlkey> <timestamp> {json}").
 *
 * The collection list is read from the source — the collection id changes monthly and is NEVER
 * hardcoded. A cdx-api on any host other than index.commoncrawl.org is refused fail-closed
 * (never followed). An empty CDX body is the source's documented "no captures" answer — a real
 * negative (empty findings), not an error. Malformed rows are skipped (D-018); malformed collinfo
 * shapes are source errors. Bounded collection: limit=100, only status 200 captures.
 *
 * Limits: rps 1, timeoutMs 15s, maxBytes 2MB (the TR-011 precedent).
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { normalizeDomain, parseJson, expectStatus } from "./util.ts";

const COLLINFO = "https://index.commoncrawl.org/collinfo.json";
const INDEX_HOST = "index.commoncrawl.org";

export interface Tr052Input {
  /** A registrable domain (catalog domain). */
  readonly domain: string;
}

interface CollInfoEntry {
  readonly id?: string;
  readonly "cdx-api"?: string;
}

/** One parsed CDXJ capture row: "<urlkey> <timestamp> {json}" — the JSON must carry url and
 *  timestamp, or the row is skipped (D-018). */
interface CdxCapture {
  readonly url: string;
  readonly timestamp: string;
  readonly status?: string;
  readonly mime?: string;
}

/** One parsed CDXJ capture row. The documented line shape is "<urlkey> <timestamp> {json}": the
 *  timestamp lives in the HEADER part before the JSON dictionary, the url inside the dictionary.
 *  With output=json each line arrives as a JSON string wrapping that record. A row without both
 *  a 14-digit timestamp and a parseable url is skipped (D-018). */
function parseCdxLine(line: string): CdxCapture | undefined {
  let outer: unknown;
  try {
    outer = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof outer === "object" && outer !== null && !Array.isArray(outer)) {
    // An object line (some deployments): url and timestamp are fields.
    const rec = outer as { url?: unknown; timestamp?: unknown };
    if (typeof rec.url === "string" && typeof rec.timestamp === "string" && /^\d{14}$/.test(rec.timestamp)) {
      return { url: rec.url, timestamp: rec.timestamp };
    }
    return undefined;
  }
  if (typeof outer !== "string") return undefined;
  // "<urlkey> <timestamp> {json}" — the timestamp from the header, the url from the dictionary.
  const start = outer.indexOf("{");
  if (start === -1) return undefined;
  const header = outer.slice(0, start).trim();
  const stamped = header.match(/(\d{14})\s*$/);
  if (stamped === null) return undefined;
  let record: unknown;
  try {
    record = JSON.parse(outer.slice(start));
  } catch {
    return undefined;
  }
  if (typeof record !== "object" || record === null) return undefined;
  const url = (record as { url?: unknown }).url;
  if (typeof url !== "string") return undefined;
  return { url, timestamp: stamped[1] };
}

/** The newest collection's CDX API — validated against the documented shape, host-pinned. */
function newestCdxApi(body: string): string {
  const parsed = parseJson(body, "Common Crawl collinfo") as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("TR-052: Common Crawl collinfo is not a non-empty list");
  }
  const first = parsed[0] as CollInfoEntry;
  const api = first["cdx-api"];
  if (typeof api !== "string" || api === "") {
    throw new Error("TR-052: Common Crawl collinfo has no cdx-api on its newest entry");
  }
  let url: URL;
  try {
    url = new URL(api);
  } catch {
    throw new Error("TR-052: Common Crawl collinfo cdx-api is not a URL");
  }
  if (url.host !== INDEX_HOST) {
    throw new Error(`TR-052: Common Crawl collinfo cdx-api points at a different host (${url.host}) — refused`);
  }
  return `${url.origin}${url.pathname}`;
}

function captureFindings(rows: readonly string[], requestId: number, collection: string): TransformFinding[] {
  const findings: TransformFinding[] = [];
  const seen = new Set<string>();
  for (const line of rows) {
    const capture = parseCdxLine(line);
    if (capture === undefined) continue;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(capture.url);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(parsedUrl.protocol)) continue;
    const key = `${capture.url} ${capture.timestamp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      predicate: "has_crawl_capture",
      evidence: [requestId],
      objectType: "url",
      objectValue: capture.url,
      confidence: 1,
      explanation: `Common Crawl ${collection}: captured ${capture.timestamp}`,
    });
  }
  return findings;
}

export const commonCrawlIndex = defineTransform<Tr052Input>(
  {
    id: "TR-052",
    version: "1.0.0",
    inputs: ["domain"],
    outputs: ["url"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 2_000_000 },
    sensitivity: "normal",
    license: "LC-B",
  },
  async (input, ctx) => {
    if (input.domain === undefined || input.domain === null) throw new Error("TR-052: domain is required");
    const domain = normalizeDomain(input.domain);
    if (domain === "" || !domain.includes(".")) throw new Error(`TR-052: "${input.domain}" is not a registrable domain`);
    // 1. The documented collection list — newest first; the collection id is never hardcoded.
    const info = await ctx.http.get(COLLINFO);
    expectStatus(info, [200], "Common Crawl collinfo");
    const cdxApi = newestCdxApi(info.body);
    const collection = cdxApi.split("/").pop() ?? "";
    // 2. The documented CDX query for the domain — bounded (limit=100), successful captures only.
    const res = await ctx.http.get(`${cdxApi}?url=${encodeURIComponent(domain)}&matchType=domain&output=json&filter=status:200&limit=100`);
    expectStatus(res, [200], "Common Crawl index");
    // An empty body is the documented no-captures answer — a real negative, not an error.
    if (res.body.trim() === "") return { findings: [] };
    const findings = captureFindings(res.body.split("\n"), res.requestId, collection);
    return { findings };
  },
);
