/**
 * TR-010 — HTTP scan (P2-004 example transform).
 *
 * Fetches a URL over the egress gateway and reports the HTTP status plus any
 * technology fingerprint it can read from response headers (server, x-powered-by,
 * x-generator, x-aspnet-version). It is a *self-hosted* transform: it talks only to
 * the destination the caller names, through the gateway, with no third-party API
 * and no secret. License LC-B (attribution required — see the manifest).
 *
 * This is the reference implementation of the P2-004 SDK: a full manifest, network
 * only via `ctx.http`, URLs built with `URL`, outputs that pass the Zod schema, and
 * every response saved as evidence by the runner (T-RULE-01..05).
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import type { TransformContext } from "../transform.ts";

export interface HttpScanInput {
  /** The URL to scan (http/https). */
  url: string;
}

const TECH_HEADERS: ReadonlyArray<{ header: string; label: string }> = [
  { header: "server", label: "server" },
  { header: "x-powered-by", label: "x-powered-by" },
  { header: "x-generator", label: "x-generator" },
  { header: "x-aspnet-version", label: "x-aspnet-version" },
];

export const httpScan = defineTransform<HttpScanInput>(
  {
    id: "TR-010",
    version: "1.0.0",
    inputs: ["url"],
    outputs: ["http_response", "technology"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 2, timeoutMs: 10_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-B",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "B",
      credibility: 3,
      rationale:
        "قياس مباشر ذاتي الاستضافة: الطلب يذهب إلى الخادم الهدف نفسه عبر البوابة — الاستجابة حقيقية من الهدف لكن بلا تحقق هوية مسبق",
    },
  },
  async (input, ctx: TransformContext) => {
    // T-RULE-02: URLs are built with URL only.
    const url = new URL(input.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`TR-010: unsupported protocol "${url.protocol}"`);
    }
    const res = await ctx.http.get(url.toString());
    const findings: TransformFinding[] = [
      {
        predicate: "has_http_response",
        evidence: [res.requestId],
        objectType: "http_status",
        objectValue: String(res.status),
        confidence: 1,
        explanation: `HTTP ${res.status} from ${url.host}`,
      },
    ];
    for (const { header, label } of TECH_HEADERS) {
      const value = res.headers[header] ?? res.headers[header.toLowerCase()];
      if (value) {
        findings.push({
          predicate: "has_technology",
          evidence: [res.requestId],
          objectType: "technology",
          objectValue: `${label}: ${value}`,
          confidence: 0.9,
          explanation: `Response header ${header} from ${url.host}`,
        });
      }
    }
    return { findings };
  },
);
