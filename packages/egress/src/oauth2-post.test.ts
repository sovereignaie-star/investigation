import { describe, expect, it } from "vitest";
import { createEgressGateway, type DnsResolver, type EgressTransport, type EgressAuditSink } from "./egress";

/** ADR-27 — the OAuth2 client-credentials token POST policy (host pin + fixed body shape). */

function fakeResolver(map: Record<string, string[]>): DnsResolver {
  return { resolve: async (host) => map[host] ?? [] };
}

/** Records every call including the ADR-27 body. */
function recordingTransport(): EgressTransport & { calls: Array<{ url: string; method: string; body?: string }> } {
  const t = {
    calls: [] as Array<{ url: string; method: string; body?: string }>,
    async fetch(req: { url: string; method: string; body?: string }) {
      t.calls.push({ url: req.url, method: req.method, body: req.body });
      return { status: 200, body: JSON.stringify({ access_token: "t" }) };
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

const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const BODY = "grant_type=client_credentials&client_id=investigation&client_secret=sky-secret-2026";
const BASE = { caseId: "c1", purposeRef: "p1", transform: "tr-040@1", sends: ["domain"], sensitivity: "normal" };

function gateway(t: EgressTransport, audit?: EgressAuditSink) {
  return createEgressGateway({
    resolver: fakeResolver({ "auth.opensky-network.org": ["93.184.216.34"] }),
    transport: t,
    oauth2AuthHosts: ["auth.opensky-network.org"],
    auditSink: audit,
    limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
  });
}

describe("ADR-27: the OAuth2 token POST is a pinned POST kind", () => {
  it("a well-formed token POST to the pinned host passes and the body reaches the transport", async () => {
    const t = recordingTransport();
    const audit = collectingAudit();
    const r = await gateway(t, audit).request({ ...BASE, url: TOKEN_URL, method: "POST", body: BODY });
    expect(r.ok).toBe(true);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].method).toBe("POST");
    expect(t.calls[0].body).toBe(BODY);
    // The body (and its secret) never appears in any audit event.
    expect(JSON.stringify(audit.events)).not.toContain("sky-secret-2026");
    expect(JSON.stringify(audit.events)).not.toContain("grant_type");
  });

  it("a POST without a body is refused before DNS (the policy is host-routed, marker-free)", async () => {
    const t = recordingTransport();
    const r = await gateway(t).request({ ...BASE, url: TOKEN_URL, method: "POST" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_request");
    expect(r.transportCalls).toBe(0);
  });

  it("a POST to a host that is neither a pinned token host nor a pinned screening host is refused before DNS", async () => {
    const t = recordingTransport();
    const r = await gateway(t).request({
      ...BASE,
      url: "https://evil.example/token",
      method: "POST",
      body: BODY,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_request");
    expect(r.transportCalls).toBe(0);
  });

  it("a body whose shape is not exactly grant_type/client_id/client_secret is refused", async () => {
    for (const body of [
      "grant_type=client_credentials&client_id=a&client_secret=b&extra=1",
      "grant_type=password&client_id=a&client_secret=b",
      "client_id=a&client_secret=b",
      "not a form body",
    ]) {
      const t = recordingTransport();
      const r = await gateway(t).request({ ...BASE, url: TOKEN_URL, method: "POST", body });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("invalid_request");
      expect(r.transportCalls).toBe(0);
    }
  });

  it("a GET or HEAD with a body is refused before DNS", async () => {
    const t = recordingTransport();
    const g = gateway(t);
    const r1 = await g.request({ ...BASE, url: TOKEN_URL, method: "GET", body: BODY });
    expect(r1.ok).toBe(false);
    expect(r1.reason).toBe("invalid_request");
    const r2 = await g.request({ ...BASE, url: TOKEN_URL, body: BODY });
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe("invalid_request");
    expect(t.calls).toHaveLength(0);
  });

  it("the natural-person backstop applies to the body: a natural-person identifier in client_id is refused", async () => {
    // The body is inventoried as parsed form pairs ("client_id AB123456"), exactly like the query
    // surface — so a natural-person identifier value in the body refuses like one in a query.
    const t = recordingTransport();
    const r = await gateway(t).request({
      ...BASE,
      url: TOKEN_URL,
      method: "POST",
      body: "grant_type=client_credentials&client_id=AB123456&client_secret=x",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("natural_person");
    expect(r.transportCalls).toBe(0);
  });

  it("an empty oauth2AuthHosts list allows no token POST (fail-closed)", async () => {
    const t = recordingTransport();
    const g = createEgressGateway({
      resolver: fakeResolver({ "auth.opensky-network.org": ["93.184.216.34"] }),
      transport: t,
      oauth2AuthHosts: [],
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
    });
    const r = await g.request({ ...BASE, url: TOKEN_URL, method: "POST", body: BODY });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_request");
    expect(t.calls).toHaveLength(0);
  });

  it("an OAuth2 token body sent to the screening host is refused (each pinned host takes only its own POST shape)", async () => {
    const t = recordingTransport();
    const g = createEgressGateway({
      resolver: fakeResolver({ "api.opensanctions.org": ["93.184.216.34"] }),
      transport: t,
      oauth2AuthHosts: ["auth.opensky-network.org"],
      screeningPostHosts: ["api.opensanctions.org"],
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
    });
    const r = await g.request({ ...BASE, url: "https://api.opensanctions.org/match/default", method: "POST", body: BODY });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_request");
    expect(r.transportCalls).toBe(0);
  });
});
