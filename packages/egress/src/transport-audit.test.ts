/**
 * P2-014 (T-ETH-006) — transport-level audit: every ACTUAL transport call is one `transport` audit
 * event, recorded at the `opts.transport.fetch` boundary itself (not at policy decision points):
 * the first hop, every redirect hop, and attempts that FAIL are all rows. Allow/deny decisions
 * stay separate (`egress.allowed`/`egress.denied`); a `transport` row proves an attempt was made,
 * never that it was allowed or that it succeeded.
 *
 * Red first: written before the recording existed; on the pre-change tree these tests fail
 * because no `transport` event is ever emitted.
 */
import { describe, expect, it } from "vitest";
import { createEgressGateway, type DnsResolver, type EgressTransport, type EgressAuditEvent } from "./egress";

/** Fake resolver the tests control. */
function fakeResolver(map: Record<string, string[]>): DnsResolver {
  return { resolve: async (host) => map[host] ?? [] };
}

const PUBLIC_IP = "93.184.216.34";

function collect(): { events: EgressAuditEvent[]; sink: { record: (e: EgressAuditEvent) => void } } {
  const events: EgressAuditEvent[] = [];
  return { events, sink: { record: (e) => events.push(e) } };
}

/**
 * A transport the test controls per URL: answers with the first matching rule, records every call.
 * A call to a URL starting with `fail:` throws (a failed attempt).
 */
function scriptedTransport(
  rules: Array<{ match: string; status: number; headers?: Record<string, string>; body?: string }>,
): EgressTransport & { calls: string[] } {
  const t = {
    calls: [] as string[],
    async fetch(req: { url: string }) {
      t.calls.push(req.url);
      const fail = rules.find((r) => r.match.startsWith("fail:") && req.url.startsWith(r.match.slice(5)));
      if (fail) throw new Error("connection reset by peer");
      const rule = rules.find((r) => !r.match.startsWith("fail:") && req.url.startsWith(r.match));
      const r: { status: number; body?: string; headers?: Record<string, string> } = rule ?? { status: 200 };
      return { status: r.status, body: r.body ?? "", headers: r.headers };
    },
  } as EgressTransport & { calls: string[] };
  return t;
}

const BASE = {
  caseId: "c1",
  purposeRef: "p1",
  transform: "tr.test@1",
  url: "https://source.example/page",
  sends: ["domain"],
  sensitivity: "normal" as const,
};

describe("P2-014: every actual transport call is one transport audit event", () => {
  it("a redirect chain emits one transport event per call, in call order, with url and status", async () => {
    const { events, sink } = collect();
    const t = scriptedTransport([
      { match: "https://source.example/page", status: 302, headers: { location: "https://alt.example/moved" } },
      { match: "https://alt.example/moved", status: 200, body: "ok" },
    ]);
    const g = createEgressGateway({
      resolver: fakeResolver({ "source.example": [PUBLIC_IP], "alt.example": [PUBLIC_IP] }),
      transport: t,
      auditSink: sink,
      allowedHosts: ["source.example", "alt.example"],
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
    });
    const r = await g.request({ ...BASE });
    expect(r.ok).toBe(true);
    // what the transport actually observed, in order:
    expect(t.calls).toEqual(["https://source.example/page", "https://alt.example/moved"]);
    // ...is exactly what the transport rows say, row for row (order and multiplicity):
    const rows = events.filter((e) => e.kind === "transport");
    expect(rows.map((e) => e.url)).toEqual(t.calls);
    expect(rows[0]).toMatchObject({ url: "https://source.example/page", status: 302 });
    expect(rows[1]).toMatchObject({ url: "https://alt.example/moved", status: 200 });
  });

  it("a FAILED transport attempt is still a row — with the error, never silently absent", async () => {
    const { events, sink } = collect();
    const t = scriptedTransport([
      { match: "fail:https://source.example/", status: 0 },
      { match: "https://source.example/page", status: 302, headers: { location: "https://source.example/dead" } },
    ]);
    const g = createEgressGateway({
      resolver: fakeResolver({ "source.example": [PUBLIC_IP] }),
      transport: t,
      auditSink: sink,
      allowedHosts: ["source.example"],
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
    });
    const r = await g.request({ ...BASE });
    expect(r.ok).toBe(false); // the run fails closed…
    // …but the attempt it made is visible:
    const rows = events.filter((e) => e.kind === "transport");
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe("https://source.example/page");
    expect(rows[0].error).toContain("connection reset");
  });

  it("a transport whose fetch() throws SYNCHRONOUSLY was still invoked — one row with the error", async () => {
    const { events, sink } = collect();
    // not async: throws synchronously inside fetch (the call was made; the attempt is real)
    const t = {
      calls: [] as string[],
      fetch(req: { url: string }) {
        t.calls.push(req.url);
        throw new Error("sync transport blowup");
      },
    } as unknown as EgressTransport & { calls: string[] };
    const g = createEgressGateway({
      resolver: fakeResolver({ "source.example": [PUBLIC_IP] }),
      transport: t,
      auditSink: sink,
      allowedHosts: ["source.example"],
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
    });
    const r = await g.request({ ...BASE });
    expect(r.ok).toBe(false);
    expect(t.calls).toEqual(["https://source.example/page"]);
    const rows = events.filter((e) => e.kind === "transport");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ url: "https://source.example/page", error: "sync transport blowup" });
  });

  it("no raw secret ever appears in any audit event, including transport rows (redirect echoing the secret)", async () => {
    const SECRET = "hunter2-token-value";
    const { events, sink } = collect();
    // the transport echoes the secret back in the redirect's query — a hostile/echoing origin
    const t = scriptedTransport([
      {
        match: "https://provider.example/api?token=",
        status: 200,
        body: "echoed",
      },
      {
        match: "https://provider.example/api",
        status: 302,
        headers: { location: `https://provider.example/api?token=${SECRET}` },
      },
    ]);
    const g = createEgressGateway({
      resolver: fakeResolver({ "provider.example": [PUBLIC_IP] }),
      transport: t,
      auditSink: sink,
      allowedHosts: ["provider.example"],
      providerHosts: { vault: ["provider.example"] },
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
    });
    const r = await g.request({
      ...BASE,
      url: "https://provider.example/api",
      secret: SECRET,
      secretProvider: "vault",
      pinnedHost: "provider.example",
    });
    // the redirect is allowed (no providerPaths restriction is configured) — the leak vector is the
    // AUDIT CHAIN, not the policy: a hostile origin echoing the secret back must never reach it…
    expect(r.ok).toBe(true);
    // …so no audit event of any kind — decision, transport, error — contains the raw secret:
    const raw = JSON.stringify(events);
    expect(raw).not.toContain(SECRET);
    // the redirect-target row exists and its URL carries the redacted placeholder, never the raw secret
    const rows = events.filter((e) => e.kind === "transport");
    expect(rows.map((e) => e.url)).toEqual(["https://provider.example/api", "https://provider.example/api?token=[secret]"]);
  });
});
