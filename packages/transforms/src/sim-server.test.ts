/**
 * P2-008 — deterministic simulation scenarios (T-SIM).
 *
 * Proves the sim exercises transform behaviour with deterministic responses and
 * no external connections: success, failure, redirects, timeouts, resource
 * limits, and invalid data. Every scenario runs a real transform through
 * `runTransform` with the sim as the transport — the same contract the engine
 * uses — and asserts the exact outcome. No real sockets, no DNS, no network.
 */
import { describe, expect, it } from "vitest";
import { defineTransform } from "./manifest.ts";
import { runTransform, TransformRunError } from "./runner.ts";
import { createSimServer } from "@ir/sim/server";

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

function scanTransform() {
  return defineTransform<{ url: string }>(MANIFEST, async (input, ctx) => {
    const res = await ctx.http.get(input.url);
    return {
      findings: [
        {
          predicate: "has_http_response",
          evidence: [res.requestId],
          objectType: "http_status",
          objectValue: String(res.status),
          confidence: 1,
          explanation: `HTTP ${res.status}`,
        },
      ],
    };
  });
}

describe("T-SIM deterministic scenarios", () => {
  it("success: a scripted 200 response produces the expected finding", async () => {
    const sim = createSimServer([
      { match: "https://sim.test/ok", response: { status: 200, body: "<html></html>", headers: { server: "nginx" } } },
    ]);
    const result = await runTransform(scanTransform(), { transport: sim.transport, input: { url: "https://sim.test/ok" } });
    expect(result.output.findings[0]).toMatchObject({ objectValue: "200" });
    expect(result.evidence[0].status).toBe(200);
    expect(sim.requestCount()).toBe(1);
  });

  it("failure: a scripted network error fails the run with stage request and kind transport:network", async () => {
    const sim = createSimServer([
      { match: "https://sim.test/down", response: { kind: "transport:network", message: "sim: connection refused" } },
    ]);
    const err = await runTransform(scanTransform(), { transport: sim.transport, input: { url: "https://sim.test/down" } }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("request");
    expect(err.evidence[0].error?.kind).toBe("transport:network");
  });

  it("redirect: a scripted 302 is returned as-is (redirects are the gateway's job, not the sim's)", async () => {
    const sim = createSimServer([{ match: "https://sim.test/moved", response: { status: 302, location: "https://sim.test/ok" } }]);
    const result = await runTransform(scanTransform(), { transport: sim.transport, input: { url: "https://sim.test/moved" } });
    expect(result.output.findings[0]).toMatchObject({ objectValue: "302" });
    expect(result.evidence[0].headers?.location).toBe("https://sim.test/ok");
  });

  it("timeout: a scripted delay beyond the manifest timeout fails with kind timeout", async () => {
    const sim = createSimServer([{ match: "https://sim.test/slow", response: { status: 200, body: "late", delayMs: 200 } }]);
    const def = defineTransform<{ url: string }>(
      { ...MANIFEST, limits: { rps: 100, timeoutMs: 50, maxBytes: 1_000_000 } },
      async (input, ctx) => {
        await ctx.http.get(input.url);
        return { findings: [] };
      },
    );
    const err = await runTransform(def, { transport: sim.transport, input: { url: "https://sim.test/slow" } }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("request");
    expect(err.evidence[0].error?.kind).toBe("timeout");
  });

  it("resource limit: a scripted oversized body fails with kind size_limit", async () => {
    const sim = createSimServer([{ match: "https://sim.test/big", response: { status: 200, body: "x".repeat(5000) } }]);
    const def = defineTransform<{ url: string }>(
      { ...MANIFEST, limits: { rps: 100, timeoutMs: 10_000, maxBytes: 100 } },
      async (input, ctx) => {
        await ctx.http.get(input.url);
        return { findings: [] };
      },
    );
    const err = await runTransform(def, { transport: sim.transport, input: { url: "https://sim.test/big" } }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("request");
    expect(err.evidence[0].error?.kind).toBe("size_limit");
  });

  it("invalid data: a scripted 500 with a malformed body still records evidence and fails cleanly", async () => {
    const sim = createSimServer([{ match: "https://sim.test/500", response: { status: 500, body: "<html>oops" } }]);
    const result = await runTransform(scanTransform(), { transport: sim.transport, input: { url: "https://sim.test/500" } });
    // A 500 is a valid HTTP response: the transform reports it, evidence records it.
    expect(result.output.findings[0]).toMatchObject({ objectValue: "500" });
    expect(result.evidence[0].status).toBe(500);
  });

  it("unmatched URL fails loudly (the sim never guesses)", async () => {
    const sim = createSimServer([{ match: "https://sim.test/ok", response: { status: 200, body: "" } }]);
    const err = await runTransform(scanTransform(), { transport: sim.transport, input: { url: "https://other.test/x" } }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("request");
    expect(err.evidence[0].error?.kind).toBe("transport:network");
    expect(err.evidence[0].error?.message).toContain("no rule matches");
  });

  it("glob matching and request logging support multi-URL scenarios", async () => {
    const sim = createSimServer([
      { match: "https://sim.test/*", response: { status: 200, body: "ok" } },
      { match: "https://sim.test/blocked", response: { kind: "transport:ssrf-blocked", message: "sim: blocked" } },
    ]);
    const def = defineTransform<{ url: string }>(MANIFEST, async (input, ctx) => {
      await ctx.http.get(input.url);
      return { findings: [] };
    });
    const result = await runTransform(def, { transport: sim.transport, input: { url: "https://sim.test/anything" } });
    expect(result.evidence[0].status).toBe(200);
    expect(sim.requests.map((r) => r.url)).toEqual(["https://sim.test/anything"]);
  });
});
