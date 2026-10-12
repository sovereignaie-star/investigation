/**
 * Egress adapter integration tests (P2-001 / P2-003). Proves that the engine's
 * `HttpTransport` port can be satisfied entirely by the egress gateway, with no
 * direct network path and with every denial surfacing as a typed TransportError.
 *
 * SIMULATION ONLY: fake resolver, fake transport, fake clock. No real DNS, no
 * real sockets, no env var that enables the network.
 */
import { describe, expect, it } from "vitest";
import { createEgressGateway, type DnsResolver, type EgressTransport } from "@ir/egress";
import { createEgressHttpTransport } from "./egress-adapter.ts";
import { RunEngine } from "./run.ts";

function fakeResolver(map: Record<string, string[]>): DnsResolver {
  return { resolve: async (host) => map[host] ?? [] };
}

function fakeTransport(
  responses: Array<{ status: number; body?: string; headers?: Record<string, string> }> = [],
): EgressTransport & { calls: Array<{ url: string; host: string; pinnedIp: string; method: string }> } {
  const t = {
    calls: [] as Array<{ url: string; host: string; pinnedIp: string; method: string }>,
    async fetch(req: { url: string; host: string; pinnedIp: string; method: string }) {
      t.calls.push({ ...req });
      const r = responses[t.calls.length - 1] ?? { status: 200, body: "" };
      return { status: r.status, body: r.body ?? "", headers: r.headers };
    },
  } as EgressTransport & { calls: Array<{ url: string; host: string; pinnedIp: string; method: string }> };
  return t;
}

interface TestBase {
  caseId: string;
  purposeRef: string;
  transform: string;
  sends: string[];
  sensitivity: string;
}

const BASE: TestBase = {
  caseId: "case-1",
  purposeRef: "purpose-1",
  transform: "web.fetch@1",
  sends: ["domain"],
  sensitivity: "normal",
};

const CAPS = { maxNodes: 10, maxDepth: 2, maxRequests: 5, maxCostEstimate: 1000, maxElapsedMs: 10_000 };

describe("engine + egress gateway integration (simulated)", () => {
  it("rejects a run whose URL is a literal loopback with a typed transport:ssrf-blocked error", async () => {
    const gateway = createEgressGateway({ resolver: fakeResolver({}), transport: fakeTransport() });
    const transport = createEgressHttpTransport({ gateway, baseRequest: { ...BASE } });
    const engine = new RunEngine({ transport, caps: CAPS, now: () => 0, random: () => "seed", maxRetries: 0 });
    const h = engine.submit({ kind: "lookup", canonicalInput: "https://127.0.0.1/x" });
    await engine.drain();
    const res = engine.result(h.runId);
    expect(res?.phase).toBe("failed");
    expect(res?.failure?.kind).toBe("transport");
    if (res?.failure?.kind !== "transport") throw new Error("unreachable");
    expect(res.failure.kindDetail).toBe("transport:ssrf-blocked");
    expect(res.transportAttempts).toBe(1); // the engine counts the attempt; the gateway rejected it before any network I/O
  });

  it("rejects a run with a rate-limit error when the same host is exhausted", async () => {
    const nowMs = 0;
    const t = fakeTransport([{ status: 200 }, { status: 200 }]);
    const gateway = createEgressGateway({
      resolver: fakeResolver({ "example.com": ["93.184.216.34"] }),
      transport: t,
      limits: { rateLimitPerHostPerSecond: 1, rateLimitBurst: 1 },
      now: () => nowMs,
    });
    const transport = createEgressHttpTransport({ gateway, baseRequest: { ...BASE } });
    const engine = new RunEngine({ transport, caps: CAPS, now: () => nowMs, random: () => "seed", concurrency: 1 });
    const h1 = engine.submit({ kind: "lookup", canonicalInput: "https://example.com/a" });
    const h2 = engine.submit({ kind: "lookup", canonicalInput: "https://example.com/b" });
    await engine.drain();
    const r1 = engine.result(h1.runId);
    const r2 = engine.result(h2.runId);
    // First request succeeds (200), second is denied by the per-host rate limiter.
    const kinds = [r1, r2].map((r) => (r?.failure?.kind === "transport" ? r.failure.kindDetail : r?.failure?.kind));
    expect(kinds).toContain("transport:rate-limit");
    // The transport was called at most once (the other attempt was denied before transport).
    expect(t.calls.length).toBeLessThanOrEqual(1);
  });

  it("denies an unknown request field via the gateway (the engine cannot widen the contract)", async () => {
    const gateway = createEgressGateway({ resolver: fakeResolver({}), transport: fakeTransport() });
    const transport = createEgressHttpTransport({ gateway, baseRequest: { ...BASE } });
    // The adapter is the only path; adding a field here must be rejected by the
    // gateway. We simulate that by calling the transport directly with an
    // extra field on the baseRequest — which is typed, so instead we test the
    // gateway's own behavior:
    const bad = await gateway.request({ ...BASE, url: "https://example.com/x", extra: 1 } as never);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("unknown_field");
    void transport;
  });

  it("charges every transport attempt against the requests budget", async () => {
    const t = fakeTransport([{ status: 200 }]);
    const gateway = createEgressGateway({ resolver: fakeResolver({ "example.com": ["93.184.216.34"] }), transport: t });
    const transport = createEgressHttpTransport({ gateway, baseRequest: { ...BASE } });
    const engine = new RunEngine({ transport, caps: { ...CAPS, maxRequests: 1 }, now: () => 0, random: () => "seed", maxRetries: 0 });
    const h = engine.submit({ kind: "lookup", canonicalInput: "https://example.com/x" });
    await engine.drain();
    const res = engine.result(h.runId);
    // The first attempt succeeded at the gateway (the fake transport returned 200)
    // and the adapter now forwards the response body, so the run succeeds and the
    // budget shows 1 request used.
    expect(res?.phase).toBe("succeeded");
    expect(res?.transportAttempts).toBe(1);
    expect(res?.budget.requests).toBe(1);
  });

  it("cancellation reaches the gateway path and fails the run with kind=cancel", async () => {
    const t = fakeTransport();
    const gateway = createEgressGateway({ resolver: fakeResolver({ "example.com": ["93.184.216.34"] }), transport: t });
    const transport = createEgressHttpTransport({ gateway, baseRequest: { ...BASE } });
    const engine = new RunEngine({ transport, caps: CAPS, now: () => 0, random: () => "seed", maxRetries: 0 });
    const h = engine.submit({ kind: "lookup", canonicalInput: "https://example.com/x" });
    h.cancel("user pressed stop");
    await engine.drain();
    const res = engine.result(h.runId);
    expect(res?.phase).toBe("cancelled");
    expect(res?.failure?.kind).toBe("cancel");
    expect(res?.transportAttempts).toBe(0);
  });

  it("the adapter forwards the gateway's successful response body to the engine (no sentinel path)", async () => {
    const t = fakeTransport([{ status: 200, body: "ok" }]);
    const gateway = createEgressGateway({ resolver: fakeResolver({ "example.com": ["93.184.216.34"] }), transport: t });
    const transport = createEgressHttpTransport({ gateway, baseRequest: { ...BASE } });
    const engine = new RunEngine({ transport, caps: CAPS, now: () => 0, random: () => "seed", maxRetries: 0 });
    const h = engine.submit({ kind: "lookup", canonicalInput: "https://example.com/x" });
    await engine.drain();
    const res = engine.result(h.runId);
    expect(res?.phase).toBe("succeeded");
    expect(res?.processed).toBe(1);
    expect(res?.transportAttempts).toBe(1);
  });

  it("a secret without a pin is rejected before any transport", async () => {
    const t = fakeTransport();
    const gateway = createEgressGateway({ resolver: fakeResolver({}), transport: t });
    const transport = createEgressHttpTransport({ gateway, baseRequest: { ...BASE, secret: "s" } });
    const engine = new RunEngine({ transport, caps: CAPS, now: () => 0, random: () => "seed", maxRetries: 0 });
    const h = engine.submit({ kind: "lookup", canonicalInput: "https://example.com/x" });
    await engine.drain();
    const res = engine.result(h.runId);
    expect(res?.failure?.kind).toBe("transport");
    if (res?.failure?.kind !== "transport") throw new Error("unreachable");
    expect(res.failure.kindDetail).toBe("transport:ssrf-blocked");
    expect(t.calls).toHaveLength(0);
  });
});
