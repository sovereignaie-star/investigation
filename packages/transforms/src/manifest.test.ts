/**
 * P2-004 — manifest SDK tests. Proves that `defineTransform` validates the
 * manifest eagerly (fail-closed) and that the runner validates the output.
 */
import { describe, expect, it } from "vitest";
import { defineTransform } from "./manifest.ts";
import { runTransform } from "./runner.ts";
import type { HttpTransport } from "@ir/engine/transport";

const VALID_MANIFEST = {
  id: "TR-010",
  version: "1.0.0",
  inputs: ["url"],
  outputs: ["http_response", "technology"],
  network: { mode: "public", allow: [] },
  secrets: [],
  limits: { rps: 2, timeoutMs: 10_000, maxBytes: 1_000_000 },
  sensitivity: "normal",
  license: "LC-B",
};

function fakeTransport(responses: Array<{ status: number; body?: string; headers?: Record<string, string> }> = []): HttpTransport {
  return {
    async fetch(_req) {
      const r = responses.shift() ?? { status: 200, body: "" };
      return { status: r.status, body: r.body ?? "", headers: r.headers };
    },
  };
}

describe("defineTransform", () => {
  it("accepts a valid manifest", () => {
    const def = defineTransform(VALID_MANIFEST, async () => ({ findings: [] }));
    expect(def.manifest.id).toBe("TR-010");
  });

  it("rejects a manifest without a network mode (fail-closed)", () => {
    expect(() => defineTransform({ ...VALID_MANIFEST, network: { allow: [] } }, async () => ({ findings: [] }))).toThrow();
  });

  it("rejects a pinned manifest with an empty allow list", () => {
    expect(() => defineTransform({ ...VALID_MANIFEST, network: { mode: "pinned", allow: [] } }, async () => ({ findings: [] }))).toThrow();
  });

  it("rejects a public manifest with a non-empty allow list", () => {
    expect(() =>
      defineTransform({ ...VALID_MANIFEST, network: { mode: "public", allow: ["example.com"] } }, async () => ({ findings: [] })),
    ).toThrow();
  });
});

describe("runTransform", () => {
  it("wraps the transport into ctx.http and records evidence", async () => {
    const def = defineTransform<{ url: string }>(VALID_MANIFEST, async (input, ctx) => {
      const res = await ctx.http.get(input.url);
      return {
        findings: [
          {
            predicate: "has_http_response",
            objectType: "http_status",
            objectValue: String(res.status),
            confidence: 1,
            explanation: "test",
          },
        ],
      };
    });
    const result = await runTransform(def, {
      transport: fakeTransport([{ status: 200, body: "ok", headers: { "content-type": "text/plain" } }]),
      input: { url: "https://example.com/" },
    });
    expect(result.requestCount).toBe(1);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].url).toBe("https://example.com/");
    expect(result.evidence[0].status).toBe(200);
    expect(result.output.findings[0].objectValue).toBe("200");
  });

  it("rejects an output that fails the Zod schema (T-RULE-03)", async () => {
    const def = defineTransform(VALID_MANIFEST, async () => ({
      findings: [{ predicate: "", objectType: "", objectValue: "", confidence: 2, explanation: "" }],
    }));
    await expect(runTransform(def, { transport: fakeTransport(), input: {} })).rejects.toThrow();
  });

  it("re-validates the manifest at run time (fail-closed)", async () => {
    const def = defineTransform(VALID_MANIFEST, async () => ({ findings: [] }));
    // Drift the manifest after registration — the runner must refuse it.
    (def.manifest as { network: { mode: string; allow: string[] } }).network = { mode: "pinned", allow: [] };
    await expect(runTransform(def, { transport: fakeTransport(), input: {} })).rejects.toThrow();
  });
});
