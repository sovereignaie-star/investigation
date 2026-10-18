/**
 * P2-028 — investigator privacy layer (ADR-31 item هـ), red-first: the proxy LIVENESS checks + jitter.
 *
 * ADR-31: fail-closed + liveness at start/rotation + optional jitter. The gateway PROACTIVELY probes the
 * configured proxy (the transport's `probeProxy`) and records an `egress.liveness` event on every check:
 *  - at startup (the first proxied request) — or at ROTATION when the case's proxy config changed since
 *    the last run (the CLI passes `rotated`),
 *  - every interval (default 30s, configurable) while requests flow,
 *  - at FAILURE (a proxied request fails — the proxy is recorded dead; there is NO fallback to direct).
 * A dead proxy at a check is FAIL-CLOSED: the request is denied (proxy_unreachable), nothing falls back.
 * Jitter (optional, default off): a random 0..jitterMs delay before each PROXIED request (traffic-analysis
 * resistance); direct requests are never jittered.
 */
import { describe, expect, it } from "vitest";
import { createEgressGateway, type DnsResolver, type EgressTransport } from "./egress.ts";

/** A fake resolver the tests control. */
function recordingResolver(map: Record<string, string[]>) {
  const asked: string[] = [];
  const resolver: DnsResolver = {
    async resolve(host) {
      asked.push(host);
      return map[host] ?? [];
    },
  };
  return { resolver, asked };
}

/** What the probe saw, and what the liveness event should carry. */
type ProbeCall = { kind: string; proxyIp: string; proxyPort: number };

/**
 * A fake transport whose proxy probe is controllable: alive/dead, a latency, and a record of the probes.
 * The probe sees the PROXY's pinned address (never the target — it is a proxy-level check).
 */
function probeTransport(opts: { alive?: boolean; latencyMs?: number; error?: string; failFetch?: boolean } = {}) {
  const state = {
    probes: [] as ProbeCall[],
    sleeps: [] as number[],
    async fetch() {
      if (opts.failFetch) throw new Error("proxy tunnel failed");
      return { status: 200, body: "ok", headers: {} };
    },
    async probeProxy(proxy: ProbeCall) {
      state.probes.push({ ...proxy });
      if (opts.alive === false) return { alive: false, error: opts.error ?? "connect ECONNREFUSED" };
      return { alive: true, latencyMs: opts.latencyMs ?? 12 };
    },
  };
  return state as unknown as EgressTransport & typeof state;
}

const BASE = {
  caseId: "c1",
  purposeRef: "p1",
  transform: "web.fetch@1",
  url: "https://example.com/x",
  sends: ["domain"],
  sensitivity: "normal",
};
const PROXY = { host: "proxy.example.net", port: 1080 };
const RESOLVER_MAP = { "example.com": ["93.184.216.34"], "proxy.example.net": ["8.8.4.4"] };

function sink() {
  const events: Array<Record<string, unknown>> = [];
  return { events, record: (e: unknown) => events.push({ ...(e as Record<string, unknown>) }) };
}

/** The routing for a strict SOCKS5 proxy (the liveness applies to every proxied route). */
const ROUTING = { route: "proxy-socks5" as const, proxy: PROXY };

/** The gateway options with the manual clock (the tests control time) and the injected sleep. */
function gatewayOpts(
  t: ReturnType<typeof probeTransport>,
  s: ReturnType<typeof sink>,
  now: () => number,
  extra: Record<string, unknown> = {},
) {
  return {
    resolver: recordingResolver(RESOLVER_MAP).resolver,
    transport: t,
    limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
    routing: ROUTING,
    auditSink: { record: s.record },
    now,
    ...extra,
  };
}

/** The liveness events the sink recorded. */
function livenessEvents(s: ReturnType<typeof sink>) {
  return s.events.filter((e) => e.kind === "liveness");
}

describe("P2-028 liveness: the gateway probes the configured proxy and records egress.liveness events", () => {
  it("T-P2028-L01: at startup — the FIRST proxied request probes the proxy and records a liveness event (alive, route, trigger startup)", async () => {
    const t = probeTransport({ latencyMs: 23 });
    const s = sink();
    let clock = 0;
    const g = createEgressGateway(gatewayOpts(t, s, () => clock++));
    const r = await g.request({ ...BASE });
    expect(r.ok).toBe(true);
    // the probe ran ONCE, before the request, and saw the PROXY's pinned address (not the target)
    expect(t.probes).toHaveLength(1);
    expect(t.probes[0]).toMatchObject({ kind: "socks5", proxyIp: "8.8.4.4", proxyPort: 1080 });
    // the event: kind liveness, alive, the route, the proxy, the latency, the trigger
    const ev = livenessEvents(s);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      kind: "liveness",
      alive: true,
      route: "proxy-socks5",
      trigger: "startup",
      proxyHost: "proxy.example.net",
      proxyPort: 1080,
      latencyMs: 23,
    });
  });

  it("T-P2028-L02: a dead proxy at startup is FAIL-CLOSED — the request is denied (proxy_unreachable), no direct fallback, the event records the death", async () => {
    const t = probeTransport({ alive: false, error: "connect ECONNREFUSED 8.8.4.4:1080" });
    const s = sink();
    const g = createEgressGateway(gatewayOpts(t, s, () => 0));
    const r = await g.request({ ...BASE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("proxy_unreachable");
    // NOTHING left through the proxy (the probe failed before the tunnel) and nothing went direct
    // the liveness event records the death with the error
    const ev = livenessEvents(s);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: "liveness", alive: false, trigger: "startup", route: "proxy-socks5" });
    expect(String(ev[0].error)).toContain("ECONNREFUSED");
  });

  it("T-P2028-L03: every 30s by default (configurable) — a request after the interval probes AGAIN (trigger interval); before it does not", async () => {
    const t = probeTransport();
    const s = sink();
    let clock = 0;
    const g = createEgressGateway(gatewayOpts(t, s, () => clock));
    expect((await g.request({ ...BASE })).ok).toBe(true); // startup probe
    clock = 5_000; // 5s later: within the default 30s interval — NO new probe
    expect((await g.request({ ...BASE, url: "https://example.com/y" })).ok).toBe(true);
    expect(t.probes).toHaveLength(1);
    clock = 40_000; // 40s after the startup probe: past the interval — a NEW probe
    expect((await g.request({ ...BASE, url: "https://example.com/z" })).ok).toBe(true);
    expect(t.probes).toHaveLength(2);
    const ev = livenessEvents(s);
    expect(ev).toHaveLength(2);
    expect(ev[1]).toMatchObject({ kind: "liveness", trigger: "interval", alive: true, route: "proxy-socks5" });
    // configurable: a 2s interval probes again after 2s
    const t2 = probeTransport();
    const s2 = sink();
    let clock2 = 0;
    const g2 = createEgressGateway(gatewayOpts(t2, s2, () => clock2, { liveness: { intervalMs: 2_000 } }));
    expect((await g2.request({ ...BASE })).ok).toBe(true);
    clock2 = 3_000;
    expect((await g2.request({ ...BASE })).ok).toBe(true);
    expect(t2.probes).toHaveLength(2); // the custom interval elapsed — probed again
    expect(livenessEvents(s2)[1]).toMatchObject({ trigger: "interval" });
  });

  it("T-P2028-L04: at rotation — when the CLI passes rotated (the case's proxy config changed since the last run) the first check's trigger is rotation", async () => {
    const t = probeTransport();
    const s = sink();
    const g = createEgressGateway(gatewayOpts(t, s, () => 0, { liveness: { rotated: true } }));
    expect((await g.request({ ...BASE })).ok).toBe(true);
    const ev = livenessEvents(s);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: "liveness", trigger: "rotation", alive: true, route: "proxy-socks5" });
  });

  it("T-P2028-L05: at failure — a proxied request that fails records a liveness event with trigger failure (the proxy is dead; fail-closed, no direct fallback)", async () => {
    const t = probeTransport({ failFetch: true });
    const s = sink();
    const g = createEgressGateway(gatewayOpts(t, s, () => 0));
    const r = await g.request({ ...BASE });
    expect(r.ok).toBe(false);
    // the startup probe succeeded (alive), then the request failed — a FAILURE liveness event follows
    const ev = livenessEvents(s);
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ trigger: "startup", alive: true });
    expect(ev[1]).toMatchObject({ kind: "liveness", trigger: "failure", alive: false, route: "proxy-socks5" });
  });

  it("T-P2028-L06: jitter — optional (default off), a random 0..jitterMs delay before each PROXIED request; direct requests are never jittered", async () => {
    // default: OFF — no sleep at all
    const tOff = probeTransport();
    const sOff = sink();
    const sleepsOff: number[] = [];
    const gOff = createEgressGateway({
      ...gatewayOpts(tOff, sOff, () => 0),
      sleep: async (ms) => {
        sleepsOff.push(ms);
      },
    });
    expect((await gOff.request({ ...BASE })).ok).toBe(true);
    expect(sleepsOff).toHaveLength(0);
    // on: a proxied request sleeps a random 0..jitterMs BEFORE the transport call
    const t = probeTransport();
    const s = sink();
    const sleeps: number[] = [];
    const rngValues = [0.99, 0.5];
    const g = createEgressGateway({
      ...gatewayOpts(t, s, () => 0),
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100, jitterMs: 1_000 },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      rng: () => rngValues.shift() ?? 0,
    });
    expect((await g.request({ ...BASE })).ok).toBe(true);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBe(990); // floor(0.99 * 1000)
    // direct requests are never jittered
    const tDirect = probeTransport();
    const sDirect = sink();
    const sleepsDirect: number[] = [];
    const gDirect = createEgressGateway({
      resolver: recordingResolver(RESOLVER_MAP).resolver,
      transport: tDirect,
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100, jitterMs: 1_000 },
      auditSink: { record: sDirect.record },
      now: () => 0,
      sleep: async (ms) => {
        sleepsDirect.push(ms);
      },
    });
    expect((await gDirect.request({ ...BASE })).ok).toBe(true);
    expect(sleepsDirect).toHaveLength(0);
  });

  it("T-P2028-L07: the liveness events carry the route — EVERY network event, no exception", async () => {
    const t = probeTransport();
    const s = sink();
    const g = createEgressGateway(gatewayOpts(t, s, () => 0));
    expect((await g.request({ ...BASE })).ok).toBe(true);
    for (const e of s.events) expect(e.route).toBe("proxy-socks5");
  });
});
