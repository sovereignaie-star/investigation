import { describe, expect, it } from "vitest";
import { createEgressGateway, type DnsResolver, type EgressTransport, type EgressAuditSink } from "./egress";

/** ADR-28 — the OpenSanctions /match screening POST policy (host+path pin + fixed JSON body schema). */

function fakeResolver(map: Record<string, string[]>): DnsResolver {
  return { resolve: async (host) => map[host] ?? [] };
}

function recordingTransport(): EgressTransport & { calls: Array<{ url: string; method: string; body?: string }> } {
  const t = {
    calls: [] as Array<{ url: string; method: string; body?: string }>,
    async fetch(req: { url: string; method: string; body?: string }) {
      t.calls.push({ url: req.url, method: req.method, body: req.body });
      return { status: 200, body: JSON.stringify({ responses: {} }) };
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

const MATCH_URL = "https://api.opensanctions.org/match/default";
const BASE = {
  caseId: "c1",
  purposeRef: "p1",
  transform: "tr-025@1",
  sends: ["person_name"],
  sensitivity: "normal",
};

function gateway(t: EgressTransport, audit?: EgressAuditSink, hosts?: string[]) {
  return createEgressGateway({
    resolver: fakeResolver({ "api.opensanctions.org": ["93.184.216.34"] }),
    transport: t,
    screeningPostHosts: hosts ?? ["api.opensanctions.org"],
    auditSink: audit,
    limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
  });
}

function personBody(firstName: string, lastName: string): string {
  return JSON.stringify({
    queries: { q: { schema: "Person", properties: { firstName: [firstName], lastName: [lastName] } } },
  });
}

describe("ADR-28: the OpenSanctions /match screening POST", () => {
  it("a well-formed Person screening POST to the pinned host+path passes and reaches the transport", async () => {
    const t = recordingTransport();
    const audit = collectingAudit();
    const body = personBody("Aleksandr", "Zacharov");
    const r = await gateway(t, audit).request({ ...BASE, url: MATCH_URL, method: "POST", body });
    expect(r.ok).toBe(true);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].method).toBe("POST");
    expect(t.calls[0].body).toBe(body);
    // The screening subject's name (case data) never appears in any audit event.
    expect(JSON.stringify(audit.events)).not.toContain("Zacharov");
    expect(JSON.stringify(audit.events)).not.toContain("Aleksandr");
  });

  it("a well-formed Company screening POST passes", async () => {
    const t = recordingTransport();
    const body = JSON.stringify({ queries: { q: { schema: "Company", properties: { name: ["Rosbank AO"] } } } });
    const r = await gateway(t).request({ ...BASE, url: MATCH_URL, method: "POST", body });
    expect(r.ok).toBe(true);
    expect(t.calls).toHaveLength(1);
  });

  it("the subject's name on the body surface is allowed ONLY for the screening POST (ADR-28 waiver)", async () => {
    // The body is inventoried by its JSON string values, so "Aleksandr Zacharov" reads as a
    // person_name on the body surface — waived for the pinned /match screening POST only.
    const t = recordingTransport();
    const r = await gateway(t).request({ ...BASE, url: MATCH_URL, method: "POST", body: personBody("Aleksandr", "Zacharov") });
    expect(r.ok).toBe(true);
  });

  it("the same name on the URL surface is still refused (the waiver is body-only)", async () => {
    // The person_name detector requires a context keyword (catalog context.required), so the
    // query key here is "name" — the reading fires with the keyword present. The waiver applies
    // to the body surface of the pinned /match screening POST only, never to a URL surface.
    const t = recordingTransport();
    const r = await gateway(t).request({
      ...BASE,
      url: "https://api.opensanctions.org/search/default?name=Aleksandr%20Zacharov",
      method: "GET",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("natural_person");
    expect(r.transportCalls).toBe(0);
  });

  it("another natural-person identifier in the screening body still refuses", async () => {
    const t = recordingTransport();
    const body = personBody("AB123456", "Zacharov");
    const r = await gateway(t).request({ ...BASE, url: MATCH_URL, method: "POST", body });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("natural_person");
    expect(r.transportCalls).toBe(0);
  });

  it("a screening POST to a host that is not the pinned screening host is refused before DNS", async () => {
    const t = recordingTransport();
    const r = await gateway(t).request({
      ...BASE,
      url: "https://evil.example/match/default",
      method: "POST",
      body: personBody("Aleksandr", "Zacharov"),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_request");
    expect(r.transportCalls).toBe(0);
  });

  it("a screening POST with a path other than /match/{dataset} is refused", async () => {
    const t = recordingTransport();
    const r = await gateway(t).request({
      ...BASE,
      url: "https://api.opensanctions.org/search/default",
      method: "POST",
      body: personBody("Aleksandr", "Zacharov"),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_request");
    expect(r.transportCalls).toBe(0);
  });

  it("a screening POST with a query or fragment is refused", async () => {
    const t = recordingTransport();
    const g = gateway(t);
    const r1 = await g.request({ ...BASE, url: `${MATCH_URL}?limit=5`, method: "POST", body: personBody("A", "B") });
    expect(r1.ok).toBe(false);
    expect(r1.reason).toBe("invalid_request");
    const r2 = await g.request({ ...BASE, url: `${MATCH_URL}#x`, method: "POST", body: personBody("A", "B") });
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe("invalid_request");
  });

  it("a screening body larger than 4096 bytes is refused (ADR-28 size cap)", async () => {
    const t = recordingTransport();
    const body = personBody("A", "B".repeat(5000));
    const r = await gateway(t).request({ ...BASE, url: MATCH_URL, method: "POST", body });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_request");
    expect(r.transportCalls).toBe(0);
  });

  it("a body that deviates from the fixed schema in any way is refused", async () => {
    const cases: Array<{ body: unknown; why: string }> = [
      { body: "not json", why: "non-JSON body" },
      {
        body: { queries: { q: { schema: "Person", properties: { firstName: ["A"], lastName: ["B"] } } }, weights: {} },
        why: "extra top-level key",
      },
      {
        body: {
          queries: { q: { schema: "Person", properties: { firstName: ["A"] } }, q2: { schema: "Person", properties: { name: ["B"] } } },
        },
        why: "two queries",
      },
      { body: { queries: { q: { schema: "Person" } } }, why: "missing properties" },
      {
        body: { queries: { q: { schema: "Person", properties: { firstName: ["A"], lastName: ["B"] }, weights: 1 } } },
        why: "extra query key",
      },
      { body: { queries: { q: { schema: "Passport", properties: { name: ["A B"] } } } }, why: "unknown schema" },
      { body: { queries: { q: { schema: "Person", properties: { birthDate: ["1965"] } } } }, why: "non-whitelisted property" },
      { body: { queries: { q: { schema: "Person", properties: { firstName: "Aleksandr" } } } }, why: "value not an array" },
      { body: { queries: { q: { schema: "Person", properties: { firstName: ["A", "B"] } } } }, why: "two values" },
      { body: { queries: { q: { schema: "Person", properties: { firstName: [42] } } } }, why: "non-string value" },
      { body: { queries: { q: { schema: "Person", properties: { firstName: ["x".repeat(101)] } } } }, why: "value over 100 chars" },
    ];
    for (const c of cases) {
      const t = recordingTransport();
      const r = await gateway(t).request({
        ...BASE,
        url: MATCH_URL,
        method: "POST",
        body: typeof c.body === "string" ? c.body : JSON.stringify(c.body),
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("invalid_request");
      expect(r.transportCalls).toBe(0);
    }
  });

  it("a screening JSON body sent to the OAuth2 token host is refused (each pinned host takes only its own POST shape)", async () => {
    const t = recordingTransport();
    const g = createEgressGateway({
      resolver: fakeResolver({ "auth.opensky-network.org": ["93.184.216.34"] }),
      transport: t,
      oauth2AuthHosts: ["auth.opensky-network.org"],
      screeningPostHosts: ["api.opensanctions.org"],
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
    });
    const r = await g.request({
      ...BASE,
      url: "https://auth.opensky-network.org/auth/realms/x/protocol/openid-connect/token",
      method: "POST",
      body: personBody("Aleksandr", "Zacharov"),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_request");
    expect(r.transportCalls).toBe(0);
  });

  it("an empty screeningPostHosts list allows no screening POST (fail-closed)", async () => {
    const t = recordingTransport();
    const r = await gateway(t, undefined, []).request({ ...BASE, url: MATCH_URL, method: "POST", body: personBody("A", "B") });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_request");
    expect(t.calls).toHaveLength(0);
  });
});
