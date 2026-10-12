/**
 * Runtime limits enforcement in the egress gateway: strict option validation,
 * timeouts (connect + total) via injected `now`, rate-limit, streaming size cap
 * (reject on first hop whose reported byte count exceeds the ceiling), secret
 * redaction in the audit sink, and literal-IP handling (including `::1`).
 *
 * All of this is SIMULATION ONLY: no real DNS, no real transport, no real clock.
 */
import { describe, expect, it } from "vitest";
import { createEgressGateway, type DnsResolver, type EgressTransport, type EgressAuditEvent } from "./egress";

function fakeResolver(map: Record<string, string[]>): DnsResolver {
  return { resolve: async (host) => map[host] ?? [] };
}

type RecordedCall = { url: string; host: string; pinnedIp: string; method: string; signal?: AbortSignal };

function fakeTransport(
  responses: Array<{ status: number; body?: string; headers?: Record<string, string>; contentLength?: number } | Error> = [],
): EgressTransport & { calls: RecordedCall[] } {
  const t = {
    calls: [] as RecordedCall[],
    async fetch(req: Parameters<EgressTransport["fetch"]>[0]) {
      t.calls.push({ ...req });
      const next = responses[t.calls.length - 1] ?? { status: 200, body: "" };
      if (next instanceof Error) throw next;
      return { status: next.status, body: next.body ?? "", headers: next.headers, contentLength: next.contentLength };
    },
  } as EgressTransport & { calls: RecordedCall[] };
  return t;
}

interface TestBase {
  caseId: string;
  purposeRef: string;
  transform: string;
  url: string;
  sends: string[];
  sensitivity: string;
}

const BASE: TestBase = {
  caseId: "c1",
  purposeRef: "p1",
  transform: "web.fetch@1",
  url: "https://example.com/x",
  sends: ["domain"],
  sensitivity: "normal",
};

describe("strict limits validation", () => {
  it("throws on unknown limit fields", () => {
    expect(() =>
      createEgressGateway({
        resolver: fakeResolver({}),
        transport: fakeTransport(),
        limits: { notALimit: 1 } as never,
      }),
    ).toThrow(RangeError);
  });
  it("throws on negative / non-finite / non-integer limits", () => {
    for (const bad of [-1, 0, 1.5, NaN, Infinity]) {
      expect(() => createEgressGateway({ resolver: fakeResolver({}), transport: fakeTransport(), limits: { maxRedirects: bad } })).toThrow(
        RangeError,
      );
    }
  });
  it("throws when connectTimeoutMs > timeoutMs", () => {
    expect(() =>
      createEgressGateway({ resolver: fakeResolver({}), transport: fakeTransport(), limits: { timeoutMs: 1000, connectTimeoutMs: 2000 } }),
    ).toThrow(RangeError);
  });
  it("freezes the limits object it returns", () => {
    const g = createEgressGateway({ resolver: fakeResolver({}), transport: fakeTransport() });
    expect(Object.isFrozen(g.limits)).toBe(true);
  });
});

describe("runtime contract validation (unknown fields, missing, wrong type)", () => {
  it("rejects unknown fields before DNS", async () => {
    const t = fakeTransport();
    const g = createEgressGateway({ resolver: fakeResolver({}), transport: t });
    const r = await g.request({ ...BASE, extra: "x" } as never);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unknown_field");
    expect(r.transportCalls).toBe(0);
  });
  it("rejects a non-string transform", async () => {
    const t = fakeTransport();
    const g = createEgressGateway({ resolver: fakeResolver({}), transport: t });
    const r = await g.request({ ...BASE, transform: 42 as never });
    expect(r.reason).toBe("invalid_request");
    expect(r.transportCalls).toBe(0);
  });
  it("rejects non-string header values", async () => {
    const t = fakeTransport();
    const g = createEgressGateway({ resolver: fakeResolver({}), transport: t });
    const r = await g.request({ ...BASE, headers: { "x-a": 5 as never } });
    expect(r.reason).toBe("invalid_request");
    expect(r.transportCalls).toBe(0);
  });
  it("rejects a missing caseId even when the request otherwise looks fine", async () => {
    const t = fakeTransport();
    const g = createEgressGateway({ resolver: fakeResolver({ "example.com": ["93.184.216.34"] }), transport: t });
    const r = await g.request({ ...BASE, caseId: undefined, purposeRef: "p1" });
    expect(r.reason).toBe("no_case");
    expect(r.transportCalls).toBe(0);
  });
});

describe("literal IP classification (no DNS round-trip)", () => {
  it("rejects https://[::1]/x with address_class even when the resolver would resolve it to a public address", async () => {
    const t = fakeTransport();
    // A resolver that lies: ::1 is a loopback, never a public address.
    const g = createEgressGateway({ resolver: fakeResolver({ "::1": ["93.184.216.34"] }), transport: t });
    const r = await g.request({ ...BASE, url: "https://[::1]/x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("address_class");
    expect(r.transportCalls).toBe(0); // rejected before transport
  });
  it("rejects a literal 127.0.0.1 with address_class", async () => {
    const t = fakeTransport();
    const g = createEgressGateway({ resolver: fakeResolver({}), transport: t });
    const r = await g.request({ ...BASE, url: "https://127.0.0.1/x" });
    expect(r.reason).toBe("address_class");
    expect(r.transportCalls).toBe(0);
  });
  it("allows a literal public IP and pins it for the transport", async () => {
    const t = fakeTransport();
    const g = createEgressGateway({ resolver: fakeResolver({}), transport: t });
    const r = await g.request({ ...BASE, url: "https://93.184.216.34/x" });
    expect(r.ok).toBe(true);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].pinnedIp).toBe("93.184.216.34");
  });
});

describe("DNS rebinding / resolved-address pinning", () => {
  it("pins the FIRST allowed address and rejects the request if ANY resolved address is denied", async () => {
    const t = fakeTransport();
    // Rebinding: public on first lookup, loopback on second.
    const g = createEgressGateway({ resolver: fakeResolver({ "example.com": ["93.184.216.34", "127.0.0.1"] }), transport: t });
    const r = await g.request({ ...BASE, url: "https://example.com/x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("address_class");
    expect(r.transportCalls).toBe(0);
  });
  it("pins the literal for a hostname whose resolver returns a single public address", async () => {
    const t = fakeTransport();
    const g = createEgressGateway({ resolver: fakeResolver({ "example.com": ["93.184.216.34"] }), transport: t });
    const r = await g.request({ ...BASE, url: "https://example.com/x" });
    expect(r.ok).toBe(true);
    expect(t.calls[0].pinnedIp).toBe("93.184.216.34");
  });
});

describe("redirect handling (policy, not just hop count)", () => {
  it("rejects a redirect to a different host when pinnedHost is set", async () => {
    const t = fakeTransport([{ status: 302, headers: { location: "https://other.com/y" } }]);
    const g = createEgressGateway({
      resolver: fakeResolver({ "example.com": ["93.184.216.34"], "other.com": ["93.184.216.35"] }),
      transport: t,
    });
    const r = await g.request({ ...BASE, url: "https://example.com/x", pinnedHost: "example.com" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("host_not_allowed");
    expect(t.calls).toHaveLength(1); // only the first hop fired
  });
  it("allows a redirect within the pinned host", async () => {
    const t = fakeTransport([
      { status: 302, headers: { location: "https://example.com/y" } },
      { status: 200, body: "ok" },
    ]);
    const g = createEgressGateway({ resolver: fakeResolver({ "example.com": ["93.184.216.34"] }), transport: t });
    const r = await g.request({ ...BASE, url: "https://example.com/x", pinnedHost: "example.com" });
    expect(r.ok).toBe(true);
    expect(t.calls).toHaveLength(2);
  });
});

describe("timeouts (injected clock)", () => {
  it("denies with timeout_total when the total deadline passes", async () => {
    let nowMs = 0;
    const t = fakeTransport();
    const g = createEgressGateway({
      resolver: fakeResolver({ "example.com": ["93.184.216.34"] }),
      transport: t,
      limits: { timeoutMs: 100, connectTimeoutMs: 50 },
      now: () => (nowMs += 200), // every `now()` call advances the clock past the deadline
    });
    const r = await g.request({ ...BASE, url: "https://example.com/x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("timeout_total");
  });
  it("denies with timeout_connect when a single hop exceeds connectTimeoutMs", async () => {
    let nowMs = 0;
    const t = fakeTransport();
    const g = createEgressGateway({
      resolver: fakeResolver({ "example.com": ["93.184.216.34"] }),
      transport: t,
      limits: { timeoutMs: 10_000, connectTimeoutMs: 100 },
      now: () => (nowMs += 500), // every `now()` advances 500ms — 5x the connect budget
    });
    const r = await g.request({ ...BASE, url: "https://example.com/x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("timeout_connect");
  });
  it("denies with timeout_connect when the transport throws an abort error from the hop timer", async () => {
    const nowMs = 0;
    const clock = () => nowMs; // clock does NOT advance
    // The hop timer path uses AbortController internally; the injected sleep is
    // not needed here because the transport is what observes the abort. We
    // simulate the transport waiting for an abort.
    const abortingSleep = async (ms: number, signal: AbortSignal) => {
      void ms;
      void signal;
      await Promise.resolve();
    };
    // The transport must be the one that gets an aborted signal; make it wait.
    const slowTransport: EgressTransport = {
      fetch: (req) =>
        new Promise((_, reject) => {
          const signal = req.signal;
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    };
    const g2b = createEgressGateway({
      resolver: fakeResolver({ "example.com": ["93.184.216.34"] }),
      transport: slowTransport,
      limits: { timeoutMs: 10_000, connectTimeoutMs: 100 },
      now: clock,
      sleep: abortingSleep,
    });
    const r = await g2b.request({ ...BASE, url: "https://example.com/x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("timeout_connect");
  });
});

describe("rate limit (per host)", () => {
  it("denies with rate_limit when the same host is requested repeatedly", async () => {
    const nowMs = 0;
    const t = fakeTransport();
    const g = createEgressGateway({
      resolver: fakeResolver({ "example.com": ["93.184.216.34"] }),
      transport: t,
      limits: { rateLimitPerHostPerSecond: 1, rateLimitBurst: 2 },
      now: () => nowMs, // frozen clock
    });
    // 2 requests: burst allows 2. 3rd should be rate limited.
    const r1 = await g.request({ ...BASE });
    const r2 = await g.request({ ...BASE });
    const r3 = await g.request({ ...BASE });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(false);
    expect(r3.reason).toBe("rate_limit");
  });
  it("refills the bucket when time passes", async () => {
    let nowMs = 0;
    const t = fakeTransport();
    const g = createEgressGateway({
      resolver: fakeResolver({ "example.com": ["93.184.216.34"] }),
      transport: t,
      limits: { rateLimitPerHostPerSecond: 10, rateLimitBurst: 1 },
      now: () => nowMs,
    });
    const r1 = await g.request({ ...BASE });
    nowMs += 200; // 0.2s * 10/s = 2 tokens refilled
    const r2 = await g.request({ ...BASE });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });
  it("does not rate-limit a different host when one is exhausted", async () => {
    const nowMs = 0;
    const t = fakeTransport();
    const g = createEgressGateway({
      resolver: fakeResolver({ "example.com": ["93.184.216.34"], "other.com": ["93.184.216.35"] }),
      transport: t,
      limits: { rateLimitPerHostPerSecond: 1, rateLimitBurst: 1 },
      now: () => nowMs,
    });
    const first = await g.request({ ...BASE, url: "https://example.com/a" });
    const second = await g.request({ ...BASE, url: "https://example.com/b" });
    const other = await g.request({ ...BASE, url: "https://other.com/c" });
    expect(first.ok).toBe(true);
    expect(second.reason).toBe("rate_limit");
    expect(other.ok).toBe(true);
  });
});

describe("streaming size cap", () => {
  it("denies with size_limit when the transport reports a contentLength over the ceiling", async () => {
    const t = fakeTransport([{ status: 200, body: "x".repeat(100), contentLength: 6 * 1024 * 1024 }]);
    const g = createEgressGateway({
      resolver: fakeResolver({ "example.com": ["93.184.216.34"] }),
      transport: t,
      limits: { maxSizeBytes: 5 * 1024 * 1024 },
    });
    const r = await g.request({ ...BASE, url: "https://example.com/x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("size_limit");
  });
  it("denies with size_limit when the body string itself exceeds the ceiling (fallback when contentLength is missing)", async () => {
    const t = fakeTransport([{ status: 200, body: "x".repeat(5 * 1024 * 1024 + 1) }]);
    const g = createEgressGateway({
      resolver: fakeResolver({ "example.com": ["93.184.216.34"] }),
      transport: t,
      limits: { maxSizeBytes: 5 * 1024 * 1024 },
    });
    const r = await g.request({ ...BASE, url: "https://example.com/x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("size_limit");
  });
});

describe("audit sink + secret redaction", () => {
  function collect() {
    const events: EgressAuditEvent[] = [];
    return { events, sink: { record: (e: EgressAuditEvent) => events.push(e) } };
  }

  it("records allowed and denied events, never the raw secret", async () => {
    const t = fakeTransport([{ status: 200, body: "ok" }]);
    const c = collect();
    const g = createEgressGateway({
      resolver: fakeResolver({ "example.com": ["93.184.216.34"] }),
      transport: t,
      auditSink: c.sink,
    });
    await g.request({ ...BASE, url: "https://example.com/x", secret: "topsecret", pinnedHost: "example.com", secretProvider: "prov1" });
    await g.request({ ...BASE, url: "https://example.com/y", secret: "topsecret", pinnedHost: "other.com", secretProvider: "prov1" });
    expect(c.events).toHaveLength(2);
    const allowedEv = c.events[0];
    const deniedEv = c.events[1];
    expect(allowedEv.kind).toBe("allowed");
    expect(allowedEv.secretDigest).toMatch(/^redacted-[0-9a-f]{8}$/);
    expect(allowedEv.secretDigest).not.toContain("topsecret");
    expect(deniedEv.kind).toBe("denied");
    expect(deniedEv.reason).toBe("host_not_allowed");
  });
  it("records a transport_error event when the transport throws", async () => {
    const t = fakeTransport([new Error("network unreachable")]);
    const c = collect();
    const g = createEgressGateway({
      resolver: fakeResolver({ "example.com": ["93.184.216.34"] }),
      transport: t,
      auditSink: c.sink,
    });
    const r = await g.request({ ...BASE, url: "https://example.com/x" });
    expect(r.ok).toBe(false);
    expect(c.events).toHaveLength(1);
    expect(c.events[0].kind).toBe("transport_error");
    expect(c.events[0].detail).toBe("network unreachable");
  });
  it("records a rate_limited event", async () => {
    const nowMs = 0;
    const t = fakeTransport();
    const c = collect();
    const g = createEgressGateway({
      resolver: fakeResolver({ "example.com": ["93.184.216.34"] }),
      transport: t,
      limits: { rateLimitPerHostPerSecond: 1, rateLimitBurst: 1 },
      now: () => nowMs,
      auditSink: c.sink,
    });
    await g.request({ ...BASE, url: "https://example.com/a" });
    const r = await g.request({ ...BASE, url: "https://example.com/b" });
    expect(r.reason).toBe("rate_limit");
    expect(c.events.some((e) => e.kind === "rate_limited")).toBe(true);
  });
  it("does NOT put the raw secret in the deny detail even when the secret-host check fails", async () => {
    const t = fakeTransport();
    const g = createEgressGateway({ resolver: fakeResolver({}), transport: t });
    const r = await g.request({
      ...BASE,
      url: "https://example.com/x",
      secret: "SUPERSECRET123",
      pinnedHost: "other.com",
      secretProvider: "prov1",
    });
    expect(r.detail).not.toContain("SUPERSECRET123");
  });
});

describe("secrets require a pin AND a provider", () => {
  it("rejects a secret with no pinnedHost", async () => {
    const t = fakeTransport();
    const g = createEgressGateway({ resolver: fakeResolver({}), transport: t });
    const r = await g.request({ ...BASE, url: "https://example.com/x", secret: "s", secretProvider: "prov1" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("secret_host_mismatch");
  });
  it("rejects a secret with no secretProvider", async () => {
    const t = fakeTransport();
    const g = createEgressGateway({ resolver: fakeResolver({}), transport: t });
    const r = await g.request({ ...BASE, url: "https://example.com/x", secret: "s", pinnedHost: "example.com" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("secret_host_mismatch");
  });
  it("rejects a request whose host is outside pinnedHost", async () => {
    const t = fakeTransport();
    const g = createEgressGateway({ resolver: fakeResolver({}), transport: t });
    const r = await g.request({ ...BASE, url: "https://example.com/x", pinnedHost: "api.other.com" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("host_not_allowed");
  });
});

describe("systemContext + audit sink (review log Q4, T-SEC-SSRF-044)", () => {
  const baseSys = {
    systemContext: true,
    purposeRef: "vault-key-validation",
    transform: "vault.test@1",
    url: "https://ipinfo.io/8.8.8.8",
    method: "GET" as const,
    headers: { accept: "application/json" },
    sends: ["domain"],
    sensitivity: "normal",
    secret: "SUPER-SECRET-KEY-12345",
    pinnedHost: "ipinfo.io",
    secretProvider: "ipinfo",
  };

  it("records systemContext=true and a redacted digest; the raw secret never reaches the sink", async () => {
    const events: Array<Record<string, unknown>> = [];
    const g = createEgressGateway({
      resolver: { resolve: async () => ["93.184.216.34"] },
      transport: { fetch: async () => ({ status: 200, body: "" }) },
      auditSink: { record: (e) => events.push({ ...e }) },
    });
    // TEMPORARY FAIL-CLOSED: systemContext alone does NOT exempt the request
    // from caseId until the Q4 conditions are met, so the caller must supply
    // a caseId for the request to proceed.
    const r = await g.request({ ...baseSys, caseId: "sys-0" });
    expect(r.ok).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.every((e) => e["systemContext"] === true)).toBe(true);
    expect(JSON.stringify(events)).not.toContain("SUPER-SECRET-KEY-12345");
    expect(events.some((e) => typeof e["secretDigest"] === "string")).toBe(true);
  });

  it("TEMPORARY FAIL-CLOSED: systemContext without caseId is denied (Q4 conditions incomplete)", async () => {
    const resolverCalls: string[] = [];
    const transportCalls: string[] = [];
    const g = createEgressGateway({
      resolver: {
        resolve: async (h) => {
          resolverCalls.push(h);
          return ["93.184.216.34"];
        },
      },
      transport: {
        fetch: async (r: { url: string; host: string; pinnedIp: string }) => {
          transportCalls.push(r.url);
          return { status: 200, body: "" };
        },
      },
      auditSink: { record: () => {} },
      allowedHosts: ["ipinfo.io"],
    });
    const r = await g.request(baseSys);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_case");
    expect(resolverCalls.length).toBe(0);
    expect(transportCalls.length).toBe(0);
  });

  it("a non-system request without caseId is still denied (no_case)", async () => {
    const g = createEgressGateway({
      resolver: { resolve: async () => ["93.184.216.34"] },
      transport: { fetch: async () => ({ status: 200, body: "" }) },
    });
    const { systemContext: _drop, ...noSys } = baseSys;
    void _drop;
    const r = await g.request(noSys);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_case");
  });

  it("systemContext must be a boolean (runtime type check)", async () => {
    const g = createEgressGateway({
      resolver: { resolve: async () => ["93.184.216.34"] },
      transport: { fetch: async () => ({ status: 200, body: "" }) },
    });
    const r = await g.request({ ...baseSys, systemContext: "yes" as unknown as boolean });
    expect(r.ok).toBe(false);
  });
});

describe("systemContext is narrowly scoped to the vault path (review log Q4)", () => {
  const sysRes = { resolve: async () => ["93.184.216.34"] };
  const sysTra = { fetch: async () => ({ status: 200, body: "" }) };

  it("a systemContext request with a different purposeRef is denied (invalid_request)", async () => {
    const g = createEgressGateway({ resolver: sysRes, transport: sysTra });
    const r = await g.request({
      systemContext: true,
      purposeRef: "some-other-purpose",
      transform: "vault.test@1",
      url: "https://ipinfo.io/8.8.8.8",
      method: "GET",
      sends: ["domain"],
      sensitivity: "normal",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_request");
  });

  it("a systemContext request with a different transform is denied (invalid_request)", async () => {
    const g = createEgressGateway({ resolver: sysRes, transport: sysTra });
    const r = await g.request({
      systemContext: true,
      purposeRef: "vault-key-validation",
      transform: "other.transform@1",
      url: "https://ipinfo.io/8.8.8.8",
      method: "GET",
      sends: ["domain"],
      sensitivity: "normal",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_request");
  });
});
