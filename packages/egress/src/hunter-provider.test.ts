/**
 * TR-051 (P2-026): the Hunter provider registry entry — the actual data file
 * (packages/egress/providers/hunter.ts) driven through the gateway exactly as the CLI network
 * run configures it (hosts + paths + the closed query allowlist). Fail-closed: a secret-bearing
 * request only passes on the registered host, the registered path, with an allowlisted query —
 * and the source's other documented parameters (limit, offset, type, ...) are refused.
 *
 * SIMULATION ONLY: fake resolver, fake transport. No real DNS, no sockets.
 */
import { describe, expect, it } from "vitest";
import { createEgressGateway, type DnsResolver, type EgressTransport } from "./egress.ts";
import { hunter } from "../providers/hunter.ts";

const PUBLIC_IP = "104.18.110.25";
const RESOLVER: DnsResolver = { resolve: async (host) => (host === "api.hunter.io" ? [PUBLIC_IP] : []) };

function gateway(overrides?: { maxLength?: number; requestPaths?: readonly string[] }) {
  const calls: string[] = [];
  const transport: EgressTransport = {
    async fetch(req) {
      calls.push(req.url);
      return { status: 200, body: "{}" };
    },
  };
  const entry = {
    ...hunter,
    ...(overrides?.maxLength !== undefined
      ? { queryAllowlist: [{ param: "domain", type: "string" as const, maxLength: overrides.maxLength }] }
      : {}),
    ...(overrides?.requestPaths !== undefined ? { requestPaths: overrides.requestPaths } : {}),
  };
  const g = createEgressGateway({
    resolver: RESOLVER,
    transport,
    limits: { rateLimitPerHostPerSecond: 100, rateLimitBurst: 100 },
    // Exactly the maps the CLI derives from the registry entry (resolveSecretBinding -> openGateway).
    providerHosts: { [entry.name]: entry.hosts },
    providerPaths: { [entry.name]: entry.requestPaths },
    providerQueries: { [entry.name]: entry.queryAllowlist ?? [] },
  });
  return { calls, g };
}

const SECRET = "hunter_test_key";
function req(url: string) {
  return {
    caseId: "case-1",
    purposeRef: "case:case-1",
    transform: "TR-051@1.0.0",
    url,
    sends: ["domain"],
    sensitivity: "normal" as const,
    pinnedHost: "api.hunter.io",
    headers: { "x-api-key": SECRET },
    secret: SECRET,
    secretProvider: "hunter",
  };
}

describe("TR-051: the Hunter registry entry (data file) through the gateway", () => {
  it("control: the registered path with the domain query reaches the transport (the key in the header, the query intact)", async () => {
    const { calls, g } = gateway();
    expect(await g.request(req("https://api.hunter.io/v2/domain-search?domain=example.com"))).toMatchObject({ ok: true });
    expect(calls).toEqual(["https://api.hunter.io/v2/domain-search?domain=example.com"]);
  });

  it("the source's other documented parameters (limit, offset, type) are refused — the closed list is narrower than the provider's surface on purpose", async () => {
    for (const query of ["limit=10", "offset=0", "limit=10&domain=example.com", "domain=example.com&type=personal"]) {
      const { calls, g } = gateway();
      expect(await g.request(req(`https://api.hunter.io/v2/domain-search?${query}`))).toMatchObject({
        ok: false,
        reason: "secret_host_mismatch",
        transportCalls: 0,
      });
      expect(calls).toEqual([]);
    }
  });

  it("an api_key sent as a query parameter is refused (the key travels ONLY in the X-API-KEY header — D-031)", async () => {
    const { calls, g } = gateway();
    expect(await g.request(req("https://api.hunter.io/v2/domain-search?domain=example.com&api_key=" + SECRET))).toMatchObject({
      ok: false,
      reason: "credentials",
      transportCalls: 0,
    });
    expect(calls).toEqual([]);
  });

  it("a host outside the entry's hosts is refused before any transport call", async () => {
    const { calls, g } = gateway();
    expect(await g.request(req("https://evil.example.com/v2/domain-search?domain=example.com"))).toMatchObject({
      ok: false,
      transportCalls: 0,
    });
    expect(calls).toEqual([]);
  });

  it("the entry data is self-consistent: one host, one path, one allowlisted parameter, the secret bound to the manifest name", () => {
    expect(hunter.hosts).toEqual(["api.hunter.io"]);
    expect(hunter.requestPaths).toEqual(["/v2/domain-search"]);
    expect(hunter.secretHeader).toBe("x-api-key");
    expect(hunter.manifestSecretNames).toEqual(["HUNTER_KEY"]);
    expect(hunter.queryAllowlist).toEqual([{ param: "domain", type: "string", maxLength: 253 }]);
  });
});

describe("TR-051: the maxLength control is reachable and is what refuses (negative control included)", () => {
  // A value the content inventory accepts as a DECLARED kind (a domain, with sends: ["domain"]) but
  // that exceeds the entry's declared maxLength (253) — the request reaches the allowlist length
  // check itself, not just the inventory refusal.
  const LONG_DOMAIN = `${"a".repeat(249)}.example.com`; // 261 chars, a well-formed shape

  it("a declared-kind value over the declared maxLength is refused by the allowlist (secret_host_mismatch), before any transport call", async () => {
    const { calls, g } = gateway();
    expect(await g.request(req(`https://api.hunter.io/v2/domain-search?domain=${LONG_DOMAIN}`))).toMatchObject({
      ok: false,
      reason: "secret_host_mismatch",
      transportCalls: 0,
    });
    expect(calls).toEqual([]);
  });

  it("negative control: the SAME request passes when the declared maxLength is widened — the length bound is what refused it", async () => {
    const { calls, g } = gateway({ maxLength: 300 });
    expect(await g.request(req(`https://api.hunter.io/v2/domain-search?domain=${LONG_DOMAIN}`))).toMatchObject({ ok: true });
    expect(calls).toEqual([`https://api.hunter.io/v2/domain-search?domain=${LONG_DOMAIN}`]);
  });
});

describe("TR-051: the path control is reachable and is what refuses (negative control included)", () => {
  // A path whose segment the content inventory accepts as a DECLARED kind (a domain, with
  // sends: ["domain"]) but that is not the entry's registered path — the request reaches the
  // provider-path check itself.
  const PATH = "/v2/www.example.com";

  it("a declared-kind path segment outside requestPaths is refused by the path check (secret_host_mismatch), before any transport call", async () => {
    const { calls, g } = gateway();
    expect(await g.request({ ...req(`https://api.hunter.io${PATH}?domain=example.com`), sends: ["domain"] })).toMatchObject({
      ok: false,
      reason: "secret_host_mismatch",
      transportCalls: 0,
    });
    expect(calls).toEqual([]);
  });

  it("negative control: the SAME request passes when the path is registered — the path allowlist is what refused it", async () => {
    const { calls, g } = gateway({ requestPaths: [PATH] });
    expect(await g.request({ ...req(`https://api.hunter.io${PATH}?domain=example.com`), sends: ["domain"] })).toMatchObject({ ok: true });
    expect(calls).toEqual([`https://api.hunter.io${PATH}?domain=example.com`]);
  });
});
