/**
 * P2-010 — TR-012: local WARC archive (URL → content hash + snapshot).
 *
 * Source: self-hosted (the transform fetches the page through `ctx.http` and
 * computes a content hash; the WARC file serialization is a local
 * post-processing step outside the transform — the transform itself never
 * writes files, per the SDK contract). LC-B, normal.
 *
 * The transform fetches the page body, computes a SHA-256 content hash with
 * Web Crypto (no external service), and emits a finding for the hash and the
 * fetched URL. All network I/O goes through `ctx.http` (egress gateway in
 * production, ADR-08).
 *
 * Limits: rps 1, timeoutMs 15s, maxBytes 5MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";

const MAX_BYTES = 5_000_000;

export const warcArchive = defineTransform<{ url: string }>(
  {
    id: "TR-012",
    version: "1.1.0",
    inputs: ["url"],
    outputs: ["sha256_hash", "url"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: MAX_BYTES },
    sensitivity: "normal",
    license: "LC-B",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "B",
      credibility: 3,
      rationale: "أرشفة ذاتية الاستضافة داخل القضية — اللقطة جُلبت عبر البوابة بمصدر وهوية موثقين في سجل القضية نفسها",
    },
  },
  async (input, ctx) => {
    let target: string;
    try {
      target = new URL(input.url).toString();
    } catch {
      throw new Error(`TR-012: invalid URL "${input.url}"`);
    }
    const res = await ctx.http.get(target);
    const body = res.body;
    if (body.length > MAX_BYTES) {
      throw new Error(`TR-012: response exceeds ${MAX_BYTES} bytes`);
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const findings: TransformFinding[] = [
      {
        predicate: "has_content_hash",
        evidence: [res.requestId],
        objectType: "sha256_hash",
        objectValue: hash,
        confidence: 1,
        explanation: `WARC: SHA-256 of fetched body of ${target}`,
      },
      {
        predicate: "has_archive_snapshot",
        evidence: [res.requestId],
        // P3-020/UC-06: the snapshot claim carries the capture TIMESTAMP as a literal
        // attribute (iso_datetime is not a catalog identifier type, so the ledger renders
        // it as the URL node's attribute — never an edge). The old shape (objectType url,
        // objectValue the target itself) self-looped on the subject and rendered nowhere.
        objectType: "iso_datetime",
        objectValue: new Date().toISOString(),
        observedAt: new Date().toISOString(),
        confidence: 1,
        explanation: `WARC: fetched ${target} (${body.length} bytes)`,
      },
    ];
    return { findings };
  },
);
