/**
 * TR-044 (P2-026): the AbuseIPDB provider registry entry — the actual data file
 * (packages/egress/providers/abuseipdb.ts) driven through the gateway exactly as the CLI network
 * run configures it (hosts + paths + the closed query allowlist). Fail-closed: a secret-bearing
 * request only passes on the registered host, the registered path, with an allowlisted query.
 *
 * SIMULATION ONLY: fake resolver, fake transport. No real DNS, no sockets.
 */
import { describe, expect, it } from "vitest";
import { createEgressGateway, type DnsResolver, type EgressTransport } from "./egress.ts";
import { abuseipdb } from "../providers/abuseipdb.ts";

const PUBLIC_IP = "93.184.216.34";
const RESOLVER: DnsResolver = { resolve: async (host) => (host === "api.abuseipdb.com" ? [PUBLIC_IP] : []) };

function gateway() {
  const calls: string[] = [];
  const transport: EgressTransport = {
    async fetch(req) {
      calls.push(req.url);
      return { status: 200, body: "{}" };
    },
  };
  const g = createEgressGateway({
    resolver: RESOLVER,
    transport,
    limits: { rateLimitPerHostPerSecond: 100, rateLimitBurst: 100 },
    // Exactly the maps the CLI derives from the registry entry (resolveSecretBinding -> openGateway).
    providerHosts: { [abuseipdb.name]: abuseipdb.hosts },
    providerPaths: { [abuseipdb.name]: abuseipdb.requestPaths },
    providerQueries: { [abuseipdb.name]: abuseipdb.queryAllowlist ?? [] },
  });
  return { calls, g };
}

const SECRET = "n_abuseipdb_test_key";
function req(url: string) {
  return {
    caseId: "case-1",
    purposeRef: "case:case-1",
    transform: "TR-044@1.0.0",
    url,
    sends: ["ip"],
    sensitivity: "normal" as const,
    pinnedHost: "api.abuseipdb.com",
    headers: { key: SECRET },
    secret: SECRET,
    secretProvider: "abuseipdb",
  };
}

describe("TR-044: the AbuseIPDB registry entry (data file) through the gateway", () => {
  it("control: the registered path with the ipAddress query reaches the transport (the key in the header, the query intact)", async () => {
    const { calls, g } = gateway();
    expect(await g.request(req("https://api.abuseipdb.com/api/v2/check?ipAddress=8.8.8.8"))).toMatchObject({ ok: true });
    expect(calls).toEqual(["https://api.abuseipdb.com/api/v2/check?ipAddress=8.8.8.8"]);
  });

  it("the source's other documented parameters (maxAgeInDays, verbose) are refused — the closed list is narrower than the provider's surface on purpose", async () => {
    for (const query of ["maxAgeInDays=90", "verbose", "maxAgeInDays=90&ipAddress=8.8.8.8", "ipAddress=8.8.8.8&verbose="]) {
      const { calls, g } = gateway();
      expect(await g.request(req(`https://api.abuseipdb.com/api/v2/check?${query}`))).toMatchObject({
        ok: false,
        reason: "secret_host_mismatch",
        transportCalls: 0,
      });
      expect(calls).toEqual([]);
    }
  });

  it("an ipAddress value over the declared maxLength (45) is refused before any transport call (the content inventory fires first: undeclared_data)", async () => {
    const { calls, g } = gateway();
    const long = "1".repeat(46);
    expect(await g.request(req(`https://api.abuseipdb.com/api/v2/check?ipAddress=${long}`))).toMatchObject({
      ok: false,
      transportCalls: 0,
    });
    expect(calls).toEqual([]);
  });

  it("a path outside the entry's requestPaths is refused before any transport call (the content inventory fires first: undeclared_data)", async () => {
    const { calls, g } = gateway();
    expect(await g.request(req("https://api.abuseipdb.com/api/v2/check-block?ipAddress=8.8.8.8"))).toMatchObject({
      ok: false,
      transportCalls: 0,
    });
    expect(calls).toEqual([]);
  });

  it("a host outside the entry's hosts is refused before any transport call", async () => {
    const { calls, g } = gateway();
    expect(await g.request(req("https://evil.example.com/api/v2/check?ipAddress=8.8.8.8"))).toMatchObject({
      ok: false,
      transportCalls: 0,
    });
    expect(calls).toEqual([]);
  });

  it("the entry data is self-consistent: one host, one path, one allowlisted parameter, the secret bound to the manifest name", () => {
    expect(abuseipdb.hosts).toEqual(["api.abuseipdb.com"]);
    expect(abuseipdb.requestPaths).toEqual(["/api/v2/check"]);
    expect(abuseipdb.secretHeader).toBe("key");
    expect(abuseipdb.manifestSecretNames).toEqual(["ABUSEIPDB_KEY"]);
    expect(abuseipdb.queryAllowlist).toEqual([{ param: "ipAddress", type: "string", maxLength: 45 }]);
  });
});
