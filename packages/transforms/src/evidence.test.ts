/**
 * P2-004 — failure recording and stage distinction (T-RULE-04/05).
 *
 * Proves the runner records every request outcome and distinguishes the failing
 * stage: a request failure (transport error) is recorded as evidence with the
 * error kind and the run fails with stage "request"; a transform error fails
 * with stage "transform"; an invalid output fails with stage "validation".
 * A failure is never reported as an empty success.
 */
import { describe, expect, it } from "vitest";
import { defineTransform } from "./manifest.ts";
import { runTransform, TransformRunError } from "./runner.ts";
import { TransportError } from "@ir/engine/transport";
import type { HttpTransport } from "@ir/engine/transport";

const MANIFEST = {
  id: "TR-010",
  version: "1.0.0",
  inputs: ["url"],
  outputs: ["http_response"],
  network: { mode: "public", allow: [] },
  secrets: [],
  limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 },
  sensitivity: "normal",
  license: "LC-B",
};

describe("failure recording and stage distinction", () => {
  it("a transport failure is recorded as evidence and fails with stage request", async () => {
    const transport: HttpTransport = {
      async fetch() {
        throw new TransportError("transport:network", "ECONNRESET");
      },
    };
    const def = defineTransform<{ url: string }>(MANIFEST, async (input, ctx) => {
      await ctx.http.get(input.url);
      return { findings: [] };
    });
    const err = await runTransform(def, { transport, input: { url: "https://example.com/" } }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("request");
    expect(err.evidence).toHaveLength(1);
    expect(err.evidence[0].error?.kind).toBe("transport:network");
    expect(err.evidence[0].status).toBeUndefined();
  });

  it("a transform error fails with stage transform and keeps the evidence recorded so far", async () => {
    const transport: HttpTransport = {
      async fetch() {
        return { status: 200, body: "ok" };
      },
    };
    const def = defineTransform<{ url: string }>(MANIFEST, async (input, ctx) => {
      await ctx.http.get(input.url);
      throw new Error("transform bug");
    });
    const err = await runTransform(def, { transport, input: { url: "https://example.com/" } }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("transform");
    expect(err.message).toContain("transform bug");
    // The successful request before the bug is still recorded as evidence.
    expect(err.evidence).toHaveLength(1);
    expect(err.evidence[0].status).toBe(200);
  });

  it("an invalid output fails with stage validation (T-RULE-03)", async () => {
    const transport: HttpTransport = {
      async fetch() {
        return { status: 200, body: "" };
      },
    };
    const def = defineTransform(MANIFEST, async () => ({
      findings: [{ predicate: "", objectType: "", objectValue: "", confidence: 2, explanation: "" }],
    }));
    const err = await runTransform(def, { transport, input: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("validation");
  });

  it("a successful run records every request as evidence with status (T-RULE-04)", async () => {
    const transport: HttpTransport = {
      async fetch() {
        return { status: 200, body: "ok", headers: { server: "nginx" } };
      },
    };
    const def = defineTransform<{ url: string }>(MANIFEST, async (input, ctx) => {
      await ctx.http.get(input.url);
      await ctx.http.head(input.url);
      return { findings: [] };
    });
    const result = await runTransform(def, { transport, input: { url: "https://example.com/" } });
    expect(result.requestCount).toBe(2);
    expect(result.evidence).toHaveLength(2);
    for (const e of result.evidence) {
      expect(e.status).toBe(200);
      expect(e.error).toBeUndefined();
    }
  });
});
