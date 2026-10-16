import { describe, expect, it } from "vitest";
import { createEgressGateway, type DnsResolver, type EgressTransport, type EgressAuditSink } from "./egress";
import { threatfoxSearchPolicy } from "../providers/post-policies.ts";

/** ADR-29 — the ThreatFox IOC-search POST policy (host+path pin + fixed JSON body schema). */

function fakeResolver(map: Record<string, string[]>): DnsResolver {
  return { resolve: async (host) => map[host] ?? [] };
}

function recordingTransport(): EgressTransport & { calls: Array<{ url: string; method: string; body?: string }> } {
  const t = {
    calls: [] as Array<{ url: string; method: string; body?: string }>,
    async fetch(req: { url: string; method: string; body?: string }) {
      t.calls.push({ url: req.url, method: req.method, body: req.body });
      return { status: 200, body: JSON.stringify({ query_status: "ok", data: [] }) };
    },
  } as EgressTransport & { calls: Array<{ url: string; method: string; body?: string }> };
  return t;
}

function collectingAudit(): EgressAuditSink & { events: unknown[] } {
  const sink = { events: [] as unknown[] } as EgressAuditSink & { events: unknown[] };
  sink.record = (e) => {
    sink.events.push(e);
    return Promise.resolve();
  };
  return sink;
}

const THREATFOX_URL = "https://threatfox-api.abuse.ch/api/v1/";
const BASE = {
  caseId: "c1",
  purposeRef: "p1",
  transform: "tr-047@1",
  sends: ["ip"],
  sensitivity: "normal",
};

function gateway(t: EgressTransport, audit?: EgressAuditSink, hosts?: string[]) {
  return createEgressGateway({
    resolver: fakeResolver({ "threatfox-api.abuse.ch": ["185.42.209.203"] }),
    transport: t,
    postPolicies: hosts === undefined ? [threatfoxSearchPolicy] : [],
    auditSink: audit,
    limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
  });
}

function iocBody(query: string, search_term: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({ query, search_term, ...extra });
}

describe("ADR-30 (migrated from ADR-29): the ThreatFox IOC-search POST", () => {
  it("a well-formed IOC-search POST to the pinned host+path passes and reaches the transport", async () => {
    const t = recordingTransport();
    const audit = collectingAudit();
    const body = iocBody("search_ioc", "139.180.203.104");
    const r = await gateway(t, audit).request({ ...BASE, url: THREATFOX_URL, method: "POST", body });
    expect(r.ok).toBe(true);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].url).toBe(THREATFOX_URL);
    expect(t.calls[0].method).toBe("POST");
    expect(t.calls[0].body).toBe(body);
  });

  it("refuses a body with an extra field before DNS (condition 1: no additional fields)", async () => {
    const t = recordingTransport();
    const r = await gateway(t).request({
      ...BASE,
      url: THREATFOX_URL,
      method: "POST",
      body: iocBody("search_ioc", "139.180.203.104", { exact_match: true }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_request");
    expect(t.calls).toHaveLength(0);
  });

  it("refuses a query outside the closed operation set before DNS (condition 1: typed query)", async () => {
    const t = recordingTransport();
    const r = await gateway(t).request({
      ...BASE,
      url: THREATFOX_URL,
      method: "POST",
      body: iocBody("search_tag", "ransomware"),
    });
    expect(r.ok).toBe(false);
    expect(t.calls).toHaveLength(0);
  });

  it("refuses a search_term longer than 256 characters before DNS (condition 1)", async () => {
    const t = recordingTransport();
    const long = "a".repeat(257);
    const r = await gateway(t).request({
      ...BASE,
      url: THREATFOX_URL,
      method: "POST",
      body: iocBody("search_ioc", long),
    });
    expect(r.ok).toBe(false);
    expect(t.calls).toHaveLength(0);
  });

  it("refuses a non-JSON body before DNS (condition 1: the fixed schema)", async () => {
    const t = recordingTransport();
    const r = await gateway(t).request({
      ...BASE,
      url: THREATFOX_URL,
      method: "POST",
      body: "not json at all",
    });
    expect(r.ok).toBe(false);
    expect(t.calls).toHaveLength(0);
  });

  it("refuses a body over the 4KB cap before DNS (condition 4)", async () => {
    const t = recordingTransport();
    const big = iocBody("search_ioc", "139.180.203.104").replace("139.180.203.104", "139.180.203.104" + " ".repeat(4200));
    const r = await gateway(t).request({ ...BASE, url: THREATFOX_URL, method: "POST", body: big });
    expect(r.ok).toBe(false);
    expect(t.calls).toHaveLength(0);
  });

  it("refuses a POST to the pinned host on a different path (condition: the exact /api/v1/ path)", async () => {
    const t = recordingTransport();
    for (const path of ["/api/v1", "/api/v1/search", "/api/v2/"]) {
      const r = await gateway(t).request({
        ...BASE,
        url: `https://threatfox-api.abuse.ch${path}`,
        method: "POST",
        body: iocBody("search_ioc", "139.180.203.104"),
      });
      expect(r.ok).toBe(false);
    }
    expect(t.calls).toHaveLength(0);
  });

  it("refuses a POST to a host outside the pinned list (the host pin)", async () => {
    const t = recordingTransport();
    const r = await gateway(t).request({
      ...BASE,
      url: "https://urlhaus-api.abuse.ch/api/v1/",
      method: "POST",
      body: iocBody("search_ioc", "139.180.203.104"),
    });
    expect(r.ok).toBe(false);
    expect(t.calls).toHaveLength(0);
  });

  it("refuses every ThreatFox-shaped POST when no host is pinned (fail-closed)", async () => {
    const t = recordingTransport();
    const r = await gateway(t, undefined, []).request({
      ...BASE,
      url: THREATFOX_URL,
      method: "POST",
      body: iocBody("search_ioc", "139.180.203.104"),
    });
    expect(r.ok).toBe(false);
    expect(t.calls).toHaveLength(0);
  });

  it("never echoes the body values into a denial detail (condition 3)", async () => {
    const t = recordingTransport();
    const r = await gateway(t).request({
      ...BASE,
      url: THREATFOX_URL,
      method: "POST",
      body: JSON.stringify({ query: "search_ioc", search_term: "SECRET-VALUE-12345", evil: true }),
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("SECRET-VALUE-12345");
  });
});
