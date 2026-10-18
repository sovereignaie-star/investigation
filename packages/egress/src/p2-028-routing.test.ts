/**
 * P2-028 — investigator privacy layer (ADR-31), red-first: the egress gateway's routing.
 *
 * The owner-approved model (ADR-31): a strict default for HTTP CONNECT and SOCKS5 non-Tor proxies —
 * the target IP is pinned LOCALLY (local DNS + SSRF address policy), the IP (never the domain) is sent
 * to the proxy, and the proxy relays bytes only (it never resolves DNS) — and ONE explicit exception
 * for Tor: the DOMAIN is sent (the essence of Tor), a sensitive-domain blocklist is enforced,
 * a separate LOWER rate budget applies, and every request is audited with its route.
 * Fail-closed: a proxy failure is a request failure — there is NO fallback to direct.
 */
import { describe, expect, it } from "vitest";
import { createEgressGateway, type DnsResolver, type EgressTransport } from "./egress.ts";

/** A fake resolver the tests control (and that records every host it was asked for). */
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

type TunnelCall = {
  url: string;
  host: string;
  pinnedIp: string;
  method: string;
  route?: string;
  proxy?: {
    kind: string;
    proxyIp: string;
    proxyPort: number;
    target: { kind: string; ip?: string; host?: string };
  };
};

/** A fake transport that records the proxy tunnel it was handed and can fail on demand. */
function tunnelTransport(fail = false) {
  const t = {
    calls: [] as TunnelCall[],
    async fetch(req: TunnelCall) {
      t.calls.push({ ...req, proxy: req.proxy ? { ...req.proxy, target: { ...req.proxy.target } } : undefined });
      if (fail) throw new Error("proxy tunnel failed");
      return { status: 200, body: "ok", headers: {} };
    },
  } as unknown as EgressTransport & { calls: TunnelCall[] };
  return t;
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

describe("P2-028 route field: every network event records its route (ADR-31)", () => {
  it('T-P2028-001: direct by default — allowed and transport events carry route: "direct"', async () => {
    const t = tunnelTransport();
    const { resolver } = recordingResolver(RESOLVER_MAP);
    const s = sink();
    const g = createEgressGateway({
      resolver,
      transport: t,
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
      auditSink: { record: s.record },
    });
    const r = await g.request({ ...BASE });
    expect(r.ok).toBe(true);
    expect(s.events.length).toBeGreaterThan(0);
    for (const e of s.events) expect(e.route).toBe("direct");
  });
});

describe("P2-028 strict mode: HTTP CONNECT and SOCKS5 non-Tor proxies (pinned IP, bytes only)", () => {
  it("T-P2028-002: an HTTP CONNECT proxy gets the PINNED TARGET IP — the proxy never resolves DNS", async () => {
    const t = tunnelTransport();
    const { resolver, asked } = recordingResolver(RESOLVER_MAP);
    const s = sink();
    const g = createEgressGateway({
      resolver,
      transport: t,
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
      routing: { route: "proxy-http-connect", proxy: PROXY },
      auditSink: { record: s.record },
    });
    const r = await g.request({ ...BASE });
    expect(r.ok).toBe(true);
    expect(t.calls).toHaveLength(1);
    // the tunnel hands the proxy the pinned TARGET IP, not the domain
    expect(t.calls[0].proxy).toMatchObject({
      kind: "http-connect",
      proxyIp: "8.8.4.4",
      proxyPort: 1080,
      target: { kind: "ip", ip: "93.184.216.34" },
    });
    // the target DNS was resolved locally (the gateway pinned it), and so was the proxy's
    expect(asked).toContain("example.com");
    expect(asked).toContain("proxy.example.net");
    // the events carry the route
    for (const e of s.events) expect(e.route).toBe("proxy-http-connect");
  });

  it("T-P2028-003: a SOCKS5 non-Tor proxy is treated the same — pinned IP, bytes only", async () => {
    const t = tunnelTransport();
    const { resolver } = recordingResolver(RESOLVER_MAP);
    const g = createEgressGateway({
      resolver,
      transport: t,
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
      routing: { route: "proxy-socks5", proxy: PROXY },
    });
    const r = await g.request({ ...BASE });
    expect(r.ok).toBe(true);
    expect(t.calls[0].proxy).toMatchObject({ kind: "socks5", target: { kind: "ip", ip: "93.184.216.34" } });
  });

  it("T-P2028-004: the proxy itself is policy-checked — a private-address proxy is refused fail-closed", async () => {
    const t = tunnelTransport();
    const { resolver } = recordingResolver({ ...RESOLVER_MAP, "proxy.example.net": ["10.0.0.5"] });
    const s = sink();
    const g = createEgressGateway({
      resolver,
      transport: t,
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
      routing: { route: "proxy-socks5", proxy: PROXY },
      auditSink: { record: s.record },
    });
    const r = await g.request({ ...BASE });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("proxy_unreachable");
    expect(r.transportCalls).toBe(0); // fail-closed: nothing was sent
    expect(s.events.every((e) => e.route === "proxy-socks5")).toBe(true);
  });
});

describe("P2-028 Tor mode: the explicit exception (domain, blocklist, lower rate, full audit)", () => {
  it("T-P2028-005: the DOMAIN is sent to the Tor proxy — the target is never resolved locally", async () => {
    const t = tunnelTransport();
    const { resolver, asked } = recordingResolver(RESOLVER_MAP);
    const g = createEgressGateway({
      resolver,
      transport: t,
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
      routing: { route: "tor", proxy: { host: "127.0.0.1", port: 9050 } },
    });
    const r = await g.request({ ...BASE });
    expect(r.ok).toBe(true);
    expect(t.calls[0].proxy).toMatchObject({
      kind: "socks5",
      proxyIp: "127.0.0.1",
      proxyPort: 9050,
      target: { kind: "host", host: "example.com" },
    });
    // the TARGET was not resolved locally — only the proxy was (and a literal-IP proxy needs nothing)
    expect(asked).not.toContain("example.com");
  });

  it("T-P2028-006: sensitive domains are refused over Tor — blocklist, fail-closed before transport", async () => {
    const t = tunnelTransport();
    const { resolver } = recordingResolver(RESOLVER_MAP);
    const g = createEgressGateway({
      resolver,
      transport: t,
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
      routing: { route: "tor", proxy: { host: "127.0.0.1", port: 9050 } },
    });
    for (const url of [
      "https://localhost/x",
      "https://internal.corp/x",
      "https://printer.local/x",
      "https://10.5.5.5/x",
      "https://127.0.0.1/x",
      "https://192.168.1.10/x",
    ]) {
      const r = await g.request({ ...BASE, url });
      expect(r.ok, url).toBe(false);
      expect(r.reason, url).toBe("tor_blocklist");
      expect(r.transportCalls, url).toBe(0);
    }
    expect(t.calls).toHaveLength(0);
  });

  it("T-P2028-007: Tor is never implicit — without routing, requests are direct and carry no proxy", async () => {
    const t = tunnelTransport();
    const { resolver } = recordingResolver(RESOLVER_MAP);
    const g = createEgressGateway({
      resolver,
      transport: t,
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
    });
    const r = await g.request({ ...BASE });
    expect(r.ok).toBe(true);
    expect(t.calls[0].proxy).toBeUndefined();
    expect(t.calls[0].route).toBe("direct");
  });

  it("T-P2028-008: Tor has its own separate LOWER rate budget", async () => {
    const t = tunnelTransport();
    const { resolver } = recordingResolver(RESOLVER_MAP);
    // the DIRECT budget is generous (1000/s); the TOR budget is deliberately tiny (1 burst, no refill)
    const g = createEgressGateway({
      resolver,
      transport: t,
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100, torRateLimitBurst: 1, torRateLimitPerHostPerSecond: 0.001 },
      routing: { route: "tor", proxy: { host: "127.0.0.1", port: 9050 } },
    });
    const first = await g.request({ ...BASE });
    expect(first.ok).toBe(true);
    const second = await g.request({ ...BASE });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("rate_limit");
  });

  it("T-P2028-009: every Tor request is audited with its route, host and case", async () => {
    const t = tunnelTransport();
    const { resolver } = recordingResolver(RESOLVER_MAP);
    const s = sink();
    const g = createEgressGateway({
      resolver,
      transport: t,
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
      routing: { route: "tor", proxy: { host: "127.0.0.1", port: 9050 } },
      auditSink: { record: s.record },
    });
    const r = await g.request({ ...BASE });
    expect(r.ok).toBe(true);
    expect(s.events.length).toBeGreaterThan(0);
    for (const e of s.events) {
      expect(e.route).toBe("tor");
      expect(e.host).toBe("example.com");
      expect(e.caseId).toBe("c1");
    }
  });
});

describe("P2-028 fail-closed: a proxy failure is a request failure — NO fallback to direct", () => {
  it("T-P2028-010: a failing proxy tunnel fails the request; exactly one transport call, never a direct retry", async () => {
    const t = tunnelTransport(true);
    const { resolver } = recordingResolver(RESOLVER_MAP);
    const s = sink();
    const g = createEgressGateway({
      resolver,
      transport: t,
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
      routing: { route: "proxy-http-connect", proxy: PROXY },
      auditSink: { record: s.record },
    });
    const r = await g.request({ ...BASE });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("transport_error");
    // exactly ONE transport call — the failed tunnel attempt; no second (direct) call happened
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].proxy).toBeDefined();
    expect(s.events.every((e) => e.route === "proxy-http-connect")).toBe(true);
  });
});
