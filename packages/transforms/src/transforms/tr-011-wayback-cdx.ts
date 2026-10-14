/**
 * P2-010 — TR-011: archive history (URL → historical snapshots).
 *
 * Source: Wayback Machine CDX API (`web.archive.org`), public, no key (LC-B).
 * The transform queries the CDX API for a URL and emits a finding per snapshot
 * (the snapshot URL, typed `url`; the timestamp is carried in the explanation).
 * All network I/O goes through `ctx.http` (the egress gateway in production,
 * ADR-08).
 *
 * Limits: rps 1, timeoutMs 15s, maxBytes 2MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { parseJson } from "./util.ts";

const CDX = "https://web.archive.org/cdx/search/cdx";

export const waybackCdx = defineTransform<{ url: string }>(
  {
    id: "TR-011",
    version: "1.0.0",
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
    const url = `${CDX}?url=${encodeURIComponent(target)}&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&limit=100`;
    const res = await ctx.http.get(url);
    const data = parseJson(res.body, "Wayback CDX") as Array<Array<string>>;

    const findings: TransformFinding[] = [];
    // CDX JSON output: first row is the header, subsequent rows are [timestamp, original, statuscode]
    for (const row of data.slice(1)) {
      const [timestamp, original] = row;
      if (!timestamp || !original) continue;
      findings.push({
        predicate: "has_archive_snapshot",
        evidence: [res.requestId],
        objectType: "url",
        objectValue: `https://web.archive.org/web/${timestamp}/${original}`,
        confidence: 1,
        explanation: `Wayback: snapshot ${timestamp} of ${original}`,
      });
    }
    return { findings };
  },
);
