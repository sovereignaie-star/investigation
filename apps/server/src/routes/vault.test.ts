import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openVault } from "@ir/store";
import { createApp } from "../app";
import { LOOKUPS_DISABLED, lookupsEnabled, vaultRouter } from "./vault";

const SECRET = "ipinfo_token_9c1e_never_returned";
const ADMIN_TOKEN = "admin-token-123";
const ENABLED = { IR_ADMIN_TOKEN: ADMIN_TOKEN, IR_ENABLE_LOOKUPS: "1" };
const servers: Server[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function withAdmin(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${ADMIN_TOKEN}`);
  return { ...init, headers };
}

function put(secret: unknown, extra: Record<string, string> = {}): RequestInit {
  return withAdmin({
    method: "PUT",
    headers: { "content-type": "application/json", ...extra },
    body: JSON.stringify({ secret }),
  });
}

function lookup(body: Record<string, string>): RequestInit {
  return withAdmin({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function start(env: NodeJS.ProcessEnv = ENABLED, opts: { vaultTransportStatus?: number } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "ir-srv-"));
  dirs.push(dir);
  const vault = openVault(path.join(dir, "vault.json"), { key: new Uint8Array(32).fill(3) });
  const upstream: { url: string; headers: Record<string, string> }[] = [];
  const fakeFetch = async (url: string, init?: RequestInit) => {
    upstream.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    if (url.includes("haveibeenpwned")) return new Response("", { status: 404 });
    return Response.json({ ip: "8.8.8.8", city: "Mountain View" });
  };
  const vaultTestCalls: Array<{ url: string; host: string; pinnedIp: string; method: string }> = [];
  const vaultTestTransport = {
    async fetch(req: { url: string; host: string; pinnedIp: string; method: string }) {
      vaultTestCalls.push({ ...req });
      return { status: opts.vaultTransportStatus ?? 200, body: "" };
    },
  };
  const vaultTestResolver = {
    resolve: async (host: string) => (host === "ipinfo.io" || host === "www.virustotal.com" ? ["93.184.216.34"] : []),
  };
  const app = createApp(vaultRouter(() => vault, { fetch: fakeFetch, env, vaultTestTransport, vaultTestResolver }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const all: string[] = [];
  const call = async (p: string, init: RequestInit = {}) => {
    const res = await fetch(base + p, init);
    const text = await res.text();
    all.push(text, JSON.stringify([...res.headers]));
    return { status: res.status, text, headers: res.headers };
  };
  return { call, upstream, all, vault, vaultTestCalls };
}

describe("vault routes (P1-015, P1-026)", () => {
  it("stores, lists status, tests and deletes a key; no response ever contains the secret", async () => {
    const { call, upstream, all, vaultTestCalls } = await start();
    expect((await call("/vault/ipinfo", put(SECRET))).status).toBe(200);
    const list = JSON.parse((await call("/vault", withAdmin())).text) as { entries: { name: string; configured: boolean }[] };
    expect(list.entries.find((e) => e.name === "ipinfo")).toMatchObject({ configured: true });
    expect(list.entries.find((e) => e.name === "shodan")).toMatchObject({ configured: false });
    // The vault test path is now complete (P2-003 cycle 9): the shared gateway
    // is used (rate limits shared across requests), a real audit sink is wired,
    // the capability is required for the systemContext caseId exemption, and
    // the provider status is returned to the caller (200 here).
    expect(JSON.parse((await call("/vault/ipinfo/test", withAdmin({ method: "POST" }))).text)).toMatchObject({
      ok: true,
      tested: true,
    });
    expect(vaultTestCalls.length).toBe(1);
    const ip = await call("/lookup/ip", lookup({ ip: "8.8.8.8" }));
    expect(JSON.parse(ip.text)).toMatchObject({ city: "Mountain View" });
    // The key travels only server -> provider in a header, never in a URL or API response.
    expect(upstream.every((u) => !u.url.includes(SECRET))).toBe(true);
    expect(upstream.some((u) => u.headers["authorization"] === `Bearer ${SECRET}`)).toBe(true);
    expect((await call("/vault/ipinfo", withAdmin({ method: "DELETE" }))).status).toBe(204);
    expect((await call("/vault/ipinfo", withAdmin({ method: "DELETE" }))).status).toBe(404);
    expect(all.join("\n")).not.toContain(SECRET);
  });

  it("rejects bad names, bodies and lookup inputs after authentication", async () => {
    const { call } = await start();
    expect((await call("/vault/..%2Fetc", put(SECRET))).status).toBe(400);
    expect((await call("/vault/ipinfo", put(42))).status).toBe(400);
    expect((await call("/lookup/ip", lookup({ ip: "999.1.1.1" }))).status).toBe(400);
    expect((await call("/lookup/breaches", lookup({ email: "not-an-email" }))).status).toBe(400);
    expect((await call("/lookup/breaches", lookup({ email: "a@example.com" }))).status).toBe(409);
  });

  it("blocks all vault and provider-funded lookup requests without an explicitly configured bearer token", async () => {
    const configured = await start();
    expect((await configured.call("/vault")).status).toBe(401);
    expect((await configured.call("/lookup/ip", { method: "POST", body: JSON.stringify({ ip: "8.8.8.8" }) })).status).toBe(401);
    expect(configured.upstream).toHaveLength(0);

    const unconfigured = await start({});
    expect((await unconfigured.call("/vault")).status).toBe(503);
    expect((await unconfigured.call("/lookup/ip", { method: "POST", body: JSON.stringify({ ip: "8.8.8.8" }) })).status).toBe(503);
    expect(unconfigured.upstream).toHaveLength(0);
  });

  describe("P1-030 (D-2): external lookups are off unless IR_ENABLE_LOOKUPS=1", () => {
    it("only the exact value 1 enables them, and IR_OFFLINE=1 always wins", () => {
      expect(lookupsEnabled({})).toBe(false);
      for (const v of ["", "0", "true", "yes", "1 ", " 1", "on", "TRUE"]) expect(lookupsEnabled({ IR_ENABLE_LOOKUPS: v })).toBe(false);
      expect(lookupsEnabled({ IR_ENABLE_LOOKUPS: "1" })).toBe(true);
      expect(lookupsEnabled({ IR_ENABLE_LOOKUPS: "1", IR_OFFLINE: "1" })).toBe(false);
    });

    for (const [label, env] of [
      ["unset", { IR_ADMIN_TOKEN: ADMIN_TOKEN }],
      ["IR_ENABLE_LOOKUPS=true", { IR_ADMIN_TOKEN: ADMIN_TOKEN, IR_ENABLE_LOOKUPS: "true" }],
      ["IR_OFFLINE=1", { IR_ADMIN_TOKEN: ADMIN_TOKEN, IR_ENABLE_LOOKUPS: "1", IR_OFFLINE: "1" }],
    ] as const)
      it(`${label}: every lookup answers 403 and no connection is attempted, with a key stored`, async () => {
        // Two independent witnesses: the injected fetch, and the process-wide fetch, which would throw if reached.
        const realFetch = globalThis.fetch;
        let globalCalls = 0;
        const s = await start(env);
        s.vault.set("ipinfo", SECRET);
        s.vault.set("haveibeenpwned", SECRET);
        const local = (u: string) => u.startsWith("http://127.0.0.1:");
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const u = String(input instanceof Request ? input.url : input);
          if (!local(u)) {
            globalCalls++;
            throw new Error(`unexpected external connection to ${u}`);
          }
          return realFetch(input, init);
        }) as typeof fetch;
        try {
          for (const [p, body] of [
            ["/lookup/ip", { ip: "8.8.8.8" }],
            ["/lookup/ip", { ip: "999.1.1.1" }],
            ["/lookup/breaches", { email: "a@example.com" }],
            ["/lookup/anything", {}],
          ] as const) {
            const r = await s.call(p, lookup(body));
            expect(r.status, p).toBe(403);
            expect(JSON.parse(r.text)).toEqual(LOOKUPS_DISABLED);
          }
        } finally {
          globalThis.fetch = realFetch;
        }
        expect(s.upstream).toHaveLength(0);
        expect(globalCalls).toBe(0);
        // the vault routes are unaffected
        expect((await s.call("/vault", withAdmin())).status).toBe(200);
      });

    it("authentication is still checked first: without the token the answer is 401, not 403", async () => {
      const s = await start({ IR_ADMIN_TOKEN: ADMIN_TOKEN });
      expect((await s.call("/lookup/ip", { method: "POST", body: JSON.stringify({ ip: "8.8.8.8" }) })).status).toBe(401);
      expect(s.upstream).toHaveLength(0);
    });
  });

  describe("T-SEC-SSRF-045 (review log Q4): vault test cannot reach an unauthorized host", () => {
    it("a request whose pinnedHost is not a provider host is denied with host_not_allowed and no secret is sent", async () => {
      const transport = {
        calls: [] as Array<{ url: string; host: string; pinnedIp: string }>,
        async fetch(req: { url: string; host: string; pinnedIp: string }) {
          transport.calls.push(req);
          return { status: 200, body: "" };
        },
      };
      const resolver = {
        resolve: async (host: string) => (host === "evil.example" ? ["93.184.216.34"] : []),
      };
      const { createEgressGateway } = await import("@ir/egress");
      const g = createEgressGateway({ resolver, transport, allowedHosts: ["ipinfo.io", "www.virustotal.com"] });
      const r = await g.request({
        systemContext: true,
        // TEMPORARY FAIL-CLOSED: systemContext alone does not exempt the
        // request from caseId, so a caseId is supplied here (the request
        // still targets an unauthorized host to prove the allowlist works).
        caseId: "sys-test",
        purposeRef: "vault-key-validation",
        transform: "vault.test@1",
        url: "https://evil.example/8.8.8.8",
        method: "GET",
        headers: { accept: "application/json" },
        sends: ["domain"],
        sensitivity: "normal",
        secret: "k",
        pinnedHost: "evil.example",
        secretProvider: "ipinfo",
      });
      expect(r.ok).toBe(false);
      // The gateway denies any host outside the pinned provider hosts. The
      // exact reason depends on which check fires first; for a public IP
      // with a non-provider pinnedHost it is host_not_allowed.
      expect(r.reason).toBe("host_not_allowed");
      expect(transport.calls.length).toBe(0);
    });

    it("a systemContext request without a caseId is denied early with zero resolver/transport calls (P2-003 vault capability)", async () => {
      const transport = {
        calls: [] as Array<{ url: string; host: string; pinnedIp: string }>,
        async fetch(req: { url: string; host: string; pinnedIp: string }) {
          transport.calls.push(req);
          return { status: 200, body: "" };
        },
      };
      const resolver = {
        calls: 0,
        resolve: async (host: string) => {
          resolver.calls++;
          return host === "ipinfo.io" ? ["93.184.216.34"] : [];
        },
      };
      const { createEgressGateway } = await import("@ir/egress");
      const g = createEgressGateway({ resolver, transport });
      const r = await g.request({
        systemContext: true,
        purposeRef: "vault-key-validation",
        transform: "vault.test@1",
        url: "https://ipinfo.io/8.8.8.8",
        sends: ["domain"],
        sensitivity: "normal",
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("no_case");
      expect(transport.calls.length).toBe(0);
      expect(resolver.calls).toBe(0);
    });
  });

  it("does not grant a hostile origin CORS access to the vault", async () => {
    const { call } = await start();
    const response = await call("/vault", {
      method: "OPTIONS",
      headers: {
        origin: "https://attacker.example",
        "access-control-request-method": "PUT",
      },
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.status).toBe(401);
  });
});

describe("vault test result honesty (provider status is reported, never fabricated)", () => {
  it("a 401 from the provider is reported as an invalid key (ok=false, tested=true, providerStatus=401)", async () => {
    // The response contract is complete (P2-003 cycle 9): the gateway returns
    // the provider's HTTP status on the FINAL hop, and the route reports it
    // without leaking the body or the secret.
    const s = await start(ENABLED, { vaultTransportStatus: 401 });
    expect((await s.call("/vault/ipinfo", put(SECRET))).status).toBe(200);
    const r = JSON.parse((await s.call("/vault/ipinfo/test", withAdmin({ method: "POST" }))).text);
    expect(r).toMatchObject({ ok: false, tested: true, providerStatus: 401 });
  });

  it("a 500 from the provider is reported as an upstream fault (ok=false, tested=true)", async () => {
    const s = await start(ENABLED, { vaultTransportStatus: 500 });
    expect((await s.call("/vault/ipinfo", put(SECRET))).status).toBe(200);
    const r = JSON.parse((await s.call("/vault/ipinfo/test", withAdmin({ method: "POST" }))).text);
    expect(r).toMatchObject({ ok: false, tested: true, providerStatus: 500 });
  });

  it("a 200 from the provider is reported as a valid key (ok=true, tested=true, providerStatus=200)", async () => {
    const s = await start(ENABLED, { vaultTransportStatus: 200 });
    expect((await s.call("/vault/ipinfo", put(SECRET))).status).toBe(200);
    const r = JSON.parse((await s.call("/vault/ipinfo/test", withAdmin({ method: "POST" }))).text);
    expect(r).toMatchObject({ ok: true, tested: true, providerStatus: 200 });
  });
});
