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
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEgressGateway, type EgressAuditEvent, type EgressRequest } from "./egress";
import { BASE_REQUEST, executeCase, mismatches, SSRF_CASES } from "./ssrf-cases";
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

describe("T-SEC-SSRF-023", () => {
  afterEach(() => vi.useRealTimers());
  it("a server that trickles past the total deadline is cut at timeoutMs (fake clock) and reported timeout_total", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const g = createEgressGateway({
      resolver,
      limits: { timeoutMs: 15_000, connectTimeoutMs: 5_000 },
      transport: {
        // redirects keep the request alive hop after hop; each hop takes 4.9 s (under the per-hop limit)
        fetch: (r) =>
          new Promise((resolve) => {
            signals.push(r.signal as AbortSignal);
            setTimeout(() => resolve({ status: 302, headers: { location: `https://example.com/${signals.length}` } }), 4_900);
          }),
      },
    });
    const p = g.request({ ...BASE_REQUEST, url: "https://example.com/0" });
    await vi.advanceTimersByTimeAsync(16_000);
    const r = await p;
    expect(r).toMatchObject({ ok: false, reason: "timeout_total" });
    // 3 full hops (14.7 s) + the 4th cut by the 15 s deadline
    expect(signals).toHaveLength(4);
    expect(signals[3]?.aborted).toBe(true);
  });

  it("a resolver that never answers is bounded by the same deadline (no hanging request)", async () => {
    vi.useFakeTimers();
    let transportCalls = 0;
    const g = createEgressGateway({
      resolver: { resolve: () => new Promise<string[]>(() => {}) },
      limits: { timeoutMs: 15_000, connectTimeoutMs: 5_000 },
      transport: {
        fetch: async () => {
          transportCalls++;
          return { status: 200 };
        },
      },
    });
    const p = g.request({ ...BASE_REQUEST });
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await p).toMatchObject({ ok: false, reason: "timeout_total", transportCalls: 0 });
    expect(transportCalls).toBe(0);
  });
});

describe("T-SEC-SSRF-034", () => {
  afterEach(() => vi.useRealTimers());
  it("a server that never completes the connection is cut at the 5 s connect timeout (fake clock)", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const g = createEgressGateway({
      resolver,
      transport: {
        fetch: (r) =>
          new Promise((_resolve, reject) => {
            signal = r.signal;
            r.signal?.addEventListener("abort", () => reject(new Error("connect aborted")));
          }),
      },
    });
    const p = g.request({ ...BASE_REQUEST });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toMatchObject({ ok: false, reason: "timeout_connect", transportCalls: 1 });
    expect(signal?.aborted).toBe(true);
  });

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
    const cap = createVaultKeyValidationCapability({ ipinfo: "ipinfo.io" }, sink);
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
      ),
    );
    return { cap, g };
  }
  const sys = {
    systemContext: true as const,
    purposeRef: "vault-key-validation",
    transform: "vault.test@1",
    url: "https://ipinfo.io/8.8.8.8",
    sends: ["domain"],
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
    const cap = createVaultKeyValidationCapability({ ipinfo: "ipinfo.io" }, sink);
    expect(Object.getOwnPropertySymbols(cap).some((s) => s === Symbol.for("ir.egress.vaultKeyValidation"))).toBe(false);
    expect(Object.isFrozen(cap)).toBe(true);
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
