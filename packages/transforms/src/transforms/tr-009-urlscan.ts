/**
 * P2-009 — TR-009: web URL scan (link/domain → screenshots, requests).
 *
 * Source: urlscan.io (`urlscan.io`), free user key (LC-C). The transform
 * queries the search API for a domain and emits a finding per scanned URL and
 * per discovered host. The key is declared in the manifest (`secrets`), which
 * forces pinned mode: the egress gateway injects the key from the vault at
 * request time (ADR-08 §7) — the transform never sees or embeds the key.
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 1, timeoutMs 15s, maxBytes 2MB.
 */
import { defineTransform } from "../manifest.ts";
import { normalizeDomain, parseJson } from "./util.ts";

const URLSCAN = "https://urlscan.io";

export const urlscanSearch = defineTransform<{ url: string }>(
  {
    id: "TR-009",
    version: "1.0.0",
    inputs: ["url"],
    outputs: ["url", "hostname"],
    network: { mode: "pinned", allow: ["urlscan.io"] },
    secrets: ["URLSCAN_KEY"],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 2_000_000 },
    sensitivity: "normal",
    license: "LC-C",
  },
  async (input, ctx) => {
    let domain: string;
    try {
      domain = normalizeDomain(new URL(input.url).hostname);
    } catch {
      throw new Error(`TR-009: invalid URL "${input.url}"`);
    }
    const res = await ctx.http.get(`${URLSCAN}/api/v1/search/?q=domain:${encodeURIComponent(domain)}`);
    const data = parseJson(res.body, "urlscan") as {
      results?: Array<{ page?: { url?: string; domain?: string } }>;
    };

    const findings: Array<{ predicate: string; objectType: string; objectValue: string; confidence: number; explanation: string }> = [];
    const seen = new Set<string>();
    for (const result of data.results ?? []) {
      if (result.page?.url && !seen.has(result.page.url)) {
        seen.add(result.page.url);
        findings.push({
          predicate: "has_scan",
          objectType: "url",
          objectValue: result.page.url,
          confidence: 0.8,
          explanation: `urlscan: scanned ${result.page.url}`,
        });
      }
      if (result.page?.domain && result.page.domain !== domain) {
        findings.push({
          predicate: "has_subdomain",
          objectType: "hostname",
          objectValue: result.page.domain,
          confidence: 0.8,
          explanation: `urlscan: found ${result.page.domain}`,
        });
      }
    }
    return { findings };
  },
);
