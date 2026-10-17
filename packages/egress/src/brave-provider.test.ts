/**
 * TR-053 (P2-026): the Brave Search API provider registry entry — the actual data file
 * (packages/egress/providers/brave.ts) driven through the gateway exactly as the CLI network run
 * configures it (hosts + paths + the closed `q` query allowlist). Fail-closed: a secret-bearing
 * request only passes on the registered host, the registered path, with an allowlisted query.
 *
 * SIMULATION ONLY: fake resolver, fake transport. No real DNS, no sockets.
 */
import { describe, expect, it } from "vitest";
import { createEgressGateway, type DnsResolver, type EgressTransport } from "./egress.ts";
import { brave } from "../providers/brave.ts";

const PUBLIC_IP = "104.16.53.111";
const RESOLVER: DnsResolver = { resolve: async (host) => (host === "api.search.brave.com" ? [PUBLIC_IP] : []) };

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
    providerHosts: { [brave.name]: brave.hosts },
    providerPaths: { [brave.name]: brave.requestPaths },
    providerQueries: { [brave.name]: brave.queryAllowlist ?? [] },
  });
  return { calls, g };
}

const SECRET = "n_brave_test_subscription_token";
function req(url: string) {
  return {
    caseId: "case-1",
    purposeRef: "case:case-1",
    transform: "TR-053@1.0.0",
    url,
    sends: ["person_name", "domain"],
    sensitivity: "normal",
    pinnedHost: "api.search.brave.com",
    headers: { "x-subscription-token": SECRET },
    secret: SECRET,
    secretProvider: "brave",
  };
}

describe("TR-053: the brave provider registry entry (the restricted-storage provider)", () => {
  it("declares the documented auth header, host, path and the closed q allowlist", () => {
    expect(brave.secretHeader).toBe("x-subscription-token");
    expect(brave.manifestSecretNames).toEqual(["BRAVE_SUBSCRIPTION_TOKEN"]);
    expect(brave.vaultEntry).toBe("brave");
    expect(brave.hosts).toEqual(["api.search.brave.com"]);
    expect(brave.requestPaths).toEqual(["/res/v1/web/search"]);
    expect(brave.queryAllowlist).toEqual([{ param: "q", type: "string", maxLength: 253 }]);
  });

  it("the web search (the literal path, the allowlisted q) passes the gateway", async () => {
    const { calls, g } = gateway();
    expect(await g.request(req("https://api.search.brave.com/res/v1/web/search?q=example.com"))).toMatchObject({
      ok: true,
    });
    expect(calls).toEqual(["https://api.search.brave.com/res/v1/web/search?q=example.com"]);
  });

  it("a query parameter outside the closed q allowlist is refused before the transport (count, offset, freshness...)", async () => {
    for (const query of ["count=20", "offset=1", "freshness=pw", "count=20&q=example.com"]) {
      const { calls, g } = gateway();
      expect(await g.request(req(`https://api.search.brave.com/res/v1/web/search?${query}`))).toMatchObject({
        ok: false,
        transportCalls: 0,
      });
      expect(calls).toEqual([]);
    }
  });

  it("a path outside the registered set is refused before the transport", async () => {
    const { calls, g } = gateway();
    expect(await g.request(req("https://api.search.brave.com/res/v1/news/search?q=x"))).toMatchObject({
      ok: false,
      transportCalls: 0,
    });
    expect(calls).toHaveLength(0);
  });
});
