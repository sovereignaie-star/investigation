/**
 * SSRF matrix (P2-003, ROADMAP 8.3.1) — gateway level. One `describe` per T-SEC-SSRF id.
 *
 * Table-driven cases come from `ssrf-cases.ts` (shared with the mutation negative controls in
 * `ssrf-mutation.test.ts`). Cases that need time control, cancellation, redaction or the vault capability are
 * written out below. Socket-level cases (025, 026, 031, 032, 033, the bomb half of 022) are in
 * `node-transport-ssrf.test.ts`; 045 is `docs/adr/reference/iana-registry.test.ts`; 046–048 are in
 * `apps/server/src/routes/vault.test.ts`.
 *
 * No real DNS and no real sockets in this file: fake resolver, fake transport.
 */
import { describe, expect, it } from "vitest";
import { createEgressGateway, type EgressAuditEvent, type EgressRequest } from "./egress";
import { BASE_REQUEST, executeCase, mismatches, SSRF_CASES } from "./ssrf-cases";
import { TIMING_CASES } from "./ssrf-timing-cases";
import { createVaultKeyValidationCapability, vaultGatewayOptions } from "./vault-capability";

const byId = new Map<string, typeof SSRF_CASES>();
for (const c of SSRF_CASES) byId.set(c.id, [...(byId.get(c.id) ?? []), c]);

for (const [id, cases] of byId) {
  describe(id, () => {
    for (const c of cases) {
      it(c.title, async () => {
        const o = await executeCase(createEgressGateway, c);
        expect(mismatches(c, o)).toEqual([]);
      });
    }
  });
}

const PUB = "93.184.216.34";
const resolver = { resolve: async () => [PUB] };

describe("T-SEC-SSRF-023 / T-SEC-SSRF-034: deadlines under a fake clock (shared with the mutation controls)", () => {
  for (const c of TIMING_CASES) {
    it(c.title, async () => {
      expect(await c.run(createEgressGateway), `${c.id} ${c.title}`).toEqual([]);
    });
  }
});

describe("T-SEC-SSRF-034", () => {
  it("cancellation during DNS settles as cancelled without reaching the transport", async () => {
    let transportCalls = 0;
    const ctrl = new AbortController();
    const g = createEgressGateway({
      resolver: { resolve: () => new Promise<string[]>(() => {}) },
      transport: {
        fetch: async () => {
          transportCalls++;
          return { status: 200 };
        },
      },
    });
    const p = g.request({ ...BASE_REQUEST, signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 5);
    expect(await p).toMatchObject({ ok: false, reason: "cancelled", transportCalls: 0 });
    expect(transportCalls).toBe(0);
  });
});

describe("T-SEC-SSRF-030", () => {
  const SECRET = "sk_live_ZZ_never_print_me";
  const base: EgressRequest = {
    ...BASE_REQUEST,
    secret: SECRET,
    secretProvider: "prov",
    pinnedHost: "example.com",
    headers: { authorization: `Bearer ${SECRET}` },
  };

  it("a transport error that echoes the secret is redacted in the result and in every audit event", async () => {
    const events: EgressAuditEvent[] = [];
    const g = createEgressGateway({
      resolver,
      providerHosts: { prov: ["example.com"] },
      auditSink: { record: (e) => events.push(e) },
      transport: {
        fetch: async (r) => {
          throw new Error(`upstream said: bad header ${r.headers?.authorization} / ${encodeURIComponent(SECRET)}`);
        },
      },
    });
    const r = await g.request(base);
    expect(r).toMatchObject({ ok: false, reason: "transport_error", transportCalls: 1 });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(JSON.stringify(r)).not.toContain(encodeURIComponent(SECRET));
    expect(r.detail).toContain("[secret]");
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(events.every((e) => e.secretDigest === undefined || /^redacted-hmac-sha256-[0-9a-f]{16}$/.test(e.secretDigest))).toBe(true);
  });

  it("every denial path for a secret-bearing request keeps the secret out of result and audit", async () => {
    const events: EgressAuditEvent[] = [];
    const g = createEgressGateway({
      resolver,
      providerHosts: { prov: ["example.com"] },
      auditSink: { record: (e) => events.push(e) },
      transport: { fetch: async () => ({ status: 200 }) },
    });
    const results = [
      await g.request({ ...base, pinnedHost: undefined }),
      await g.request({ ...base, url: "https://other.example/", pinnedHost: "other.example" }),
      await g.request({ ...base, url: `https://example.com/?k=${SECRET}` }),
      await g.request({ ...base, headers: { authorization: `Bearer ${SECRET}\r\nx: y` } }),
    ];
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(JSON.stringify(results)).not.toContain(SECRET);
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });
});

describe("T-SEC-SSRF-042", () => {
  const sink = { record: () => {} };
  function vaultGateway(calls: string[]) {
    const cap = createVaultKeyValidationCapability({ ipinfo: { hosts: "ipinfo.io", paths: ["/8.8.8.8"] } }, sink);
    const g = createEgressGateway(
      vaultGatewayOptions(
        cap,
        { resolve: async () => [PUB] },
        {
          fetch: async (r) => {
            calls.push(`${r.method} ${r.url}`);
            return { status: 302, headers: { location: "https://evil.example/" } };
          },
        },
        // These tests target the vault capability's host/path/method binding — not the operational
        // rate default (measured, ADR-08 item و): a generous injected rate keeps them independent.
        { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
      ),
    );
    return { cap, g };
  }
  const sys = {
    systemContext: true as const,
    purposeRef: "vault-key-validation",
    transform: "vault.test@1",
    url: "https://ipinfo.io/8.8.8.8",
    sends: ["ip"],
    sensitivity: "normal" as const,
    pinnedHost: "ipinfo.io",
  };

  it("a transform passing systemContext without the capability is refused (no_case)", async () => {
    const calls: string[] = [];
    const { g } = vaultGateway(calls);
    expect(await g.request({ ...sys })).toMatchObject({ ok: false, reason: "no_case", transportCalls: 0 });
    expect(calls).toEqual([]);
  });

  it("a forged capability with the same shape is refused (identity, not shape)", async () => {
    const calls: string[] = [];
    const { cap, g } = vaultGateway(calls);
    const forged = { ...cap };
    expect(await g.request({ ...sys, capability: forged })).toMatchObject({ ok: false, reason: "no_case", transportCalls: 0 });
    expect(calls).toEqual([]);
  });

  it("systemContext for any other purpose or transform is refused", async () => {
    const calls: string[] = [];
    const { cap, g } = vaultGateway(calls);
    expect(await g.request({ ...sys, capability: cap, purposeRef: "other" })).toMatchObject({ ok: false, reason: "invalid_request" });
    expect(await g.request({ ...sys, capability: cap, transform: "web.fetch@1" })).toMatchObject({ ok: false, reason: "invalid_request" });
    expect(calls).toEqual([]);
  });

  it("an unknown field next to the capability is refused", async () => {
    const calls: string[] = [];
    const { cap, g } = vaultGateway(calls);
    const r = await g.request({ ...sys, capability: cap, extra: 1 } as unknown as EgressRequest);
    expect(r).toMatchObject({ ok: false, reason: "unknown_field", transportCalls: 0 });
  });

  it("the capability cannot be used for a host outside its registry, a non-GET/HEAD method, or a redirect elsewhere", async () => {
    const calls: string[] = [];
    const { cap, g } = vaultGateway(calls);
    expect(await g.request({ ...sys, capability: cap, url: "https://evil.example/", pinnedHost: "evil.example" })).toMatchObject({
      ok: false,
      reason: "host_not_allowed",
      transportCalls: 0,
    });
    expect(await g.request({ ...sys, capability: cap, method: "POST" as unknown as "GET" })).toMatchObject({
      ok: false,
      reason: "invalid_request",
      transportCalls: 0,
    });
    expect(calls).toEqual([]);
    // the fake provider answers with a redirect to evil.example: refused at the hop, one transport call total
    expect(await g.request({ ...sys, capability: cap })).toMatchObject({ ok: false, reason: "host_not_allowed", transportCalls: 1 });
    expect(calls).toEqual(["GET https://ipinfo.io/8.8.8.8"]);
  });

  it("the capability symbol is module-local: Symbol.for cannot reach it", () => {
    const cap = createVaultKeyValidationCapability({ ipinfo: { hosts: "ipinfo.io", paths: ["/8.8.8.8"] } }, sink);
    expect(Object.getOwnPropertySymbols(cap).some((s) => s === Symbol.for("ir.egress.vaultKeyValidation"))).toBe(false);
    expect(Object.isFrozen(cap)).toBe(true);
  });
});

describe("T-SEC-SSRF-042: a provider secret only reaches that provider's registered key-test path, on every hop", () => {
  const sink = { record: () => {} };
  const SECRET = "vt-key-value-0123456789";
  const PATH = "/api/v3/ip_addresses/8.8.8.8";
  function setup(redirect?: string, withPaths = true) {
    const calls: string[] = [];
    const cap = createVaultKeyValidationCapability({ virustotal: { hosts: "www.virustotal.com", paths: [PATH] } }, sink);
    const base = vaultGatewayOptions(
      cap,
      { resolve: async () => [PUB] },
      {
        fetch: async (r) => {
          calls.push(r.url);
          return redirect !== undefined && calls.length === 1
            ? { status: 302, headers: { location: redirect } }
            : { status: 200, body: "{}" };
        },
      },
      // These tests target the vault capability's path registry — not the operational rate default
      // (measured, ADR-08 item و): a generous injected rate keeps them independent.
      { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
    );
    const opts = withPaths ? base : { ...base, providerPaths: undefined };
    return { calls, cap, g: createEgressGateway(opts) };
  }
  const req = (cap: unknown, url: string) => ({
    systemContext: true as const,
    purposeRef: "vault-key-validation",
    transform: "vault.test@1",
    url,
    sends: ["ip"],
    sensitivity: "normal" as const,
    pinnedHost: "www.virustotal.com",
    headers: { "x-apikey": SECRET },
    secret: SECRET,
    secretProvider: "virustotal",
    capability: cap,
  });
  const offPath = [
    "https://www.virustotal.com/8.8.8.8",
    "https://www.virustotal.com/api/v3/users/me",
    `https://www.virustotal.com${PATH}?x=1`,
    `https://www.virustotal.com${PATH}#f`,
    `https://www.virustotal.com${PATH}/`,
  ];

  it("control: the registered path is reached, once", async () => {
    const { calls, cap, g } = setup();
    expect(await g.request(req(cap, `https://www.virustotal.com${PATH}`))).toMatchObject({ ok: true });
    expect(calls).toEqual([`https://www.virustotal.com${PATH}`]);
  });

  for (const url of offPath) {
    it(`another path on the same host is refused before any transport call: ${url}`, async () => {
      const { calls, cap, g } = setup();
      expect(await g.request(req(cap, url))).toMatchObject({ ok: false, reason: "secret_host_mismatch", transportCalls: 0 });
      expect(calls).toEqual([]);
    });
  }

  it("a same-host redirect to another path is refused at the hop (one transport call)", async () => {
    const { calls, cap, g } = setup("/api/v3/users/me");
    expect(await g.request(req(cap, `https://www.virustotal.com${PATH}`))).toMatchObject({
      ok: false,
      reason: "secret_host_mismatch",
      transportCalls: 1,
    });
    expect(calls).toEqual([`https://www.virustotal.com${PATH}`]);
  });

  it("negative control: without the path registry the same off-path request and redirect DO reach the transport", async () => {
    const a = setup(undefined, false);
    expect(await a.g.request(req(a.cap, offPath[1] as string))).toMatchObject({ ok: true });
    expect(a.calls).toEqual([offPath[1]]);
    const b = setup("/api/v3/users/me", false);
    expect(await b.g.request(req(b.cap, `https://www.virustotal.com${PATH}`))).toMatchObject({ ok: true });
    expect(b.calls).toHaveLength(2);
  });

  it("a provider entry without an exact path cannot be registered", () => {
    expect(() => createVaultKeyValidationCapability({ v: { hosts: "www.virustotal.com", paths: [] } }, sink)).toThrow(RangeError);
    expect(() => createVaultKeyValidationCapability({ v: { hosts: "www.virustotal.com", paths: ["/a?b=1"] } }, sink)).toThrow(RangeError);
  });
});

describe("coverage bookkeeping", () => {
  it("every canonical id 001..044 except the socket/reference ones has at least one gateway-level case here", () => {
    const elsewhere = new Set(["025", "026", "031", "032", "033", "045"]);
    const custom = new Set(["023", "030", "034", "042"]);
    const missing: string[] = [];
    for (let i = 1; i <= 44; i++) {
      const n = String(i).padStart(3, "0");
      if (elsewhere.has(n) || custom.has(n)) continue;
      if (!byId.has(`T-SEC-SSRF-${n}`)) missing.push(n);
    }
    expect(missing).toEqual([]);
  });
});

describe("T-SEC-SSRF-043 redirect content policy (P2-032, ADR-08 section 4; formerly the known gap of P2-003 2026-10-13)", () => {
  // Each server-chosen hop is inventoried BEFORE it is sent, and the transform's headers go only to the host it chose.
  // The redirect content cases with mutation controls are in ssrf-cases.ts; these two are the former gap tests, flipped.
  it("a public-mode redirect to another public host whose URL carries an undeclared email address is refused before the second hop", async () => {
    const destinations: Array<{ host: string; pinnedIp: string }> = [];
    const g = createEgressGateway({
      resolver: { resolve: async () => ["93.184.216.34"] },
      transport: {
        fetch: async (r) => {
          destinations.push({ host: r.host, pinnedIp: r.pinnedIp });
          return destinations.length === 1
            ? { status: 302, headers: { location: "https://other.example/?q=alice%40example.org" } }
            : { status: 200, body: "ok" };
        },
      },
    });
    const r = await g.request({ ...BASE_REQUEST, url: "https://example.com/", sends: ["domain"] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("undeclared_data");
    expect(r.transportCalls).toBe(1);
    expect(destinations).toEqual([{ host: "example.com", pinnedIp: "93.184.216.34" }]);
  });

  it("the transform's own headers (checked for host A) are dropped on a server-chosen host B, except the safe list", async () => {
    const seen: Array<{ host: string; headers: Record<string, string> | undefined }> = [];
    const g = createEgressGateway({
      resolver: { resolve: async () => ["93.184.216.34"] },
      transport: {
        fetch: async (r) => {
          seen.push({ host: r.host, headers: r.headers });
          return seen.length === 1 ? { status: 302, headers: { location: "https://other.example/" } } : { status: 200, body: "ok" };
        },
      },
    });
    const headers = { "x-lookup": "8.8.8.8", accept: "application/json", "accept-language": "en" };
    const r = await g.request({ ...BASE_REQUEST, url: "https://example.com/", sends: ["ip"], headers });
    expect(r.ok).toBe(true);
    expect(seen.map((h) => h.host)).toEqual(["example.com", "other.example"]);
    expect(seen[0]?.headers).toEqual(headers);
    expect(seen[1]?.headers).toEqual({ accept: "application/json", "accept-language": "en" });
  });

  it("control: on a same-host redirect the transform's headers are kept unchanged", async () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const g = createEgressGateway({
      resolver: { resolve: async () => ["93.184.216.34"] },
      transport: {
        fetch: async (r) => {
          seen.push(r.headers);
          return seen.length === 1 ? { status: 301, headers: { location: "/v2/" } } : { status: 200, body: "ok" };
        },
      },
      // This control targets header handling on redirects — not the operational rate default
      // (measured, ADR-08 item و): a generous injected rate keeps it independent.
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
    });
    const headers = { "x-lookup": "8.8.8.8" };
    const r = await g.request({ ...BASE_REQUEST, url: "https://example.com/", sends: ["ip"], headers });
    expect(r.ok).toBe(true);
    expect(seen).toEqual([headers, headers]);
  });
});
