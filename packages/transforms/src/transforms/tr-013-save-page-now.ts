/**
 * P2-010 — TR-013: request public archive (URL → snapshot in Wayback).
 *
 * Source: Wayback Machine Save Page Now (`web.archive.org`), public, no key
 * (LC-C). The transform triggers a save via the GET-based endpoint
 * `web.archive.org/save/{url}` and emits a finding for the resulting snapshot
 * URL.
 *
 * NOTE (documented limitation): the key-based SPN2 API (`web.archive.org/save`,
 * POST with JSON body) is not reachable through the current engine transport,
 * which is GET/HEAD only (ADR-08). This transform uses the GET-based save
 * endpoint, which performs the same archiving action without a key. The
 * key-based path is a documented follow-up when the transport gains POST.
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 1, timeoutMs 30s, maxBytes 2MB.
 */
import { defineTransform } from "../manifest.ts";

const SAVE = "https://web.archive.org/save";

export const savePageNow = defineTransform<{ url: string }>(
  {
    id: "TR-013",
    version: "1.0.0",
    inputs: ["url"],
    outputs: ["url"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 30_000, maxBytes: 2_000_000 },
    sensitivity: "normal",
    license: "LC-C",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "C",
      credibility: 4,
      rationale: "خدمة حفظ الصفحات العامة في أرشيف الإنترنت — نتيجة الحفظ عرضة لطوابير الخدمة ولا تضمن اكتمال اللقطة",
    },
  },
  async (input, ctx) => {
    let target: string;
    try {
      target = new URL(input.url).toString();
    } catch {
      throw new Error(`TR-013: invalid URL "${input.url}"`);
    }
    const res = await ctx.http.get(`${SAVE}/${encodeURIComponent(target)}`);
    // The save endpoint responds with the snapshot URL in the Location header
    // (or a 200 page). Prefer the Location header; fall back to the canonical
    // snapshot URL form.
    const location = res.headers["location"] ?? res.headers["Location"];
    const snapshot = location && location.startsWith("http") ? location : `https://web.archive.org/web/2/${target}`;
    return {
      findings: [
        {
          predicate: "has_archive_snapshot",
          evidence: [res.requestId],
          objectType: "url",
          objectValue: snapshot,
          confidence: 0.9,
          explanation: `Save Page Now: archived ${target} (status ${res.status})`,
        },
      ],
    };
  },
);
