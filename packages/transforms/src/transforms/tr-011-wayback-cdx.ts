/**
 * P2-010 — TR-011: archive history (URL → historical snapshots).
 *
 * Source: Wayback Machine CDX API (`web.archive.org`), public, no key (LC-B).
 * The transform queries the CDX API for a URL and emits a finding per snapshot
 * (the snapshot URL, typed `url`; the timestamp is carried in the explanation).
 * All network I/O goes through `ctx.http` (the egress gateway in production,
 * ADR-08).
 *
 * P2-037 (1.1.0): only http(s) URLs are accepted; a non-200 answer fails the run; an empty body (CDX's answer for
 * "no captures" on some paths) is a genuine negative, a non-list body fails; the header row is checked instead of
 * assumed; a timestamp must be 14 digits and the snapshot URL must parse, or the row is skipped. Each finding cites
 * the CDX response.
 *
 * Limits: rps 1, timeoutMs 15s, maxBytes 2MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { expectStatus, parseJson } from "./util.ts";

const CDX = "https://web.archive.org/cdx/search/cdx";

export const waybackCdx = defineTransform<{ url: string }>(
  {
    id: "TR-011",
    version: "1.1.0",
    inputs: ["url"],
    outputs: ["url"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 2_000_000 },
    sensitivity: "normal",
    license: "LC-B",
  },
  async (input, ctx) => {
    let target: string;
    try {
      target = new URL(input.url).toString();
    } catch {
      throw new Error(`TR-011: invalid URL "${input.url}"`);
    }
    if (!/^https?:\/\//.test(target)) throw new Error(`TR-011: only http(s) URLs are archived ("${input.url}")`);
    const url = `${CDX}?url=${encodeURIComponent(target)}&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&limit=100`;
    const res = await ctx.http.get(url);
    expectStatus(res, [200], "Wayback CDX");
    if (res.body.trim() === "") return { findings: [] };
    const data = parseJson(res.body, "Wayback CDX");
    if (!Array.isArray(data)) throw new Error("Wayback CDX: answer is not a list");
    if (data.length === 0) return { findings: [] };
    const header = data[0] as unknown;
    if (!Array.isArray(header) || header[0] !== "timestamp" || header[1] !== "original") {
      throw new Error("Wayback CDX: unexpected header row");
    }

    const findings: TransformFinding[] = snapshots(data.slice(1)).map(([snapshot, timestamp, original]) => ({
      predicate: "has_archive_snapshot",
      evidence: [res.requestId],
      objectType: "url",
      objectValue: snapshot,
      confidence: 1,
      explanation: `Wayback: snapshot ${timestamp} of ${original}`,
    }));
    return { findings };
  },
);

/**
 * CDX rows [timestamp, original, statuscode] -> distinct [snapshotUrl, timestamp, original]. A row whose timestamp
 * is not 14 digits or whose snapshot URL does not parse is skipped.
 */
function snapshots(rows: unknown[]): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const [timestamp, original] = row as unknown[];
    if (typeof timestamp !== "string" || !/^\d{14}$/.test(timestamp) || typeof original !== "string") continue;
    let snapshot: string;
    try {
      snapshot = new URL(`https://web.archive.org/web/${timestamp}/${original}`).toString();
    } catch {
      continue;
    }
    if (seen.has(snapshot)) continue;
    seen.add(snapshot);
    out.push([snapshot, timestamp, original]);
  }
  return out;
}
