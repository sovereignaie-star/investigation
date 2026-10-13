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

  describe("cancellation during an in-flight transport (AbortSignal reaches the transport)", () => {
    function slowTransport(opts: { honourSignal: boolean }) {
      const seen: { signal?: AbortSignal; abortedAtReturn?: boolean } = {};
      let started!: () => void;
      const startedP = new Promise<void>((r) => (started = r));
      const t: EgressTransport = {
        async fetch(req) {
          seen.signal = req.signal;
          started();
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 50);
            if (opts.honourSignal) {
              req.signal?.addEventListener("abort", () => {
                clearTimeout(timer);
                reject(new Error("aborted by signal"));
              });
            }
          });
          seen.abortedAtReturn = req.signal?.aborted;
          return { status: 200, body: "late success" };
        },
      };
      return { t, seen, startedP };
    }

    for (const honourSignal of [true, false]) {
      it(`a cancel while the transport is running fails the run as cancelled (transport ${honourSignal ? "honours" : "ignores"} the signal)`, async () => {
        const { t, seen, startedP } = slowTransport({ honourSignal });
        const gateway = createEgressGateway({ resolver: fakeResolver({ "example.com": ["93.184.216.34"] }), transport: t });
        const transport = createEgressHttpTransport({ gateway, baseRequest: { ...BASE } });
        const engine = new RunEngine({ transport, caps: CAPS, now: () => 0, random: () => "seed", maxRetries: 0 });
        const h = engine.submit({ kind: "lookup", canonicalInput: "https://example.com/x" });
        const drained = engine.drain();
        await startedP;
        h.cancel("user pressed stop mid-flight");
        await drained;
        const res = engine.result(h.runId);
        // the engine's signal reached the transport and was aborted by the cancel
        expect(seen.signal).toBeInstanceOf(AbortSignal);
        expect(seen.signal?.aborted).toBe(true);
        // a late "200 late success" is never reported as success
        expect(res?.phase).toBe("cancelled");
        expect(res?.failure?.kind).toBe("cancel");
        expect(res?.processed ?? 0).toBe(0);
        expect(res?.transportAttempts).toBe(1);
        if (!honourSignal) {
          // the transport finishes late (after the run was already settled as cancelled) with its signal aborted
          await new Promise((r) => setTimeout(r, 80));
          expect(seen.abortedAtReturn).toBe(true);
          expect(engine.result(h.runId)?.phase).toBe("cancelled");
        }
      });
    }
  });

  it("typed transport failures keep their reason through the adapter (size_limit, transport_error)", async () => {
    const { EgressTransportError } = await import("@ir/egress");
    for (const [thrown, expected] of [
      [new EgressTransportError("size_limit", "too big"), "size_limit"],
      [new Error("ECONNRESET"), "transport_error"],
    ] as const) {
      const t: EgressTransport = {
        fetch: async () => {
          throw thrown;
        },
      };
      const gateway = createEgressGateway({ resolver: fakeResolver({ "example.com": ["93.184.216.34"] }), transport: t });
      const transport = createEgressHttpTransport({ gateway, baseRequest: { ...BASE } });
      await expect(transport.fetch({ method: "GET", url: "https://example.com/x" }, new AbortController().signal)).rejects.toThrow(
        new RegExp(`egress denied: ${expected}`),
      );
    }
  });

  it("P2-004: the adapter forwards response headers to the engine transport", async () => {
    const t = fakeTransport([{ status: 200, body: "<html>", headers: { "content-type": "text/html", server: "nginx" } }]);
    const gateway = createEgressGateway({ resolver: fakeResolver({ "example.com": ["93.184.216.34"] }), transport: t });
    const transport = createEgressHttpTransport({ gateway, baseRequest: { ...BASE } });
    const res = await transport.fetch({ method: "GET", url: "https://example.com/" }, new AbortController().signal);
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("text/html");
    expect(res.headers).toEqual({ "content-type": "text/html", server: "nginx" });
    expect(t.calls).toHaveLength(1);
  });
});
