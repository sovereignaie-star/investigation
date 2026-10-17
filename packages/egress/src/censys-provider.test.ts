/**
 * TR-049 (P2-026): the Censys provider registry entry — the actual data file
 * (packages/egress/providers/censys.ts) driven through the gateway exactly as the CLI network
 * run configures it (hosts + the literal certificates-search path + the closed `q` query
 * allowlist + the host-view path template). Fail-closed: a secret-bearing request only passes
 * on the registered host, the registered path, with an allowlisted query or a template path.
 *
 * SIMULATION ONLY: fake resolver, fake transport. No real DNS, no sockets.
 */
import { describe, expect, it } from "vitest";
import { createEgressGateway, type DnsResolver, type EgressTransport } from "./egress.ts";
import { censys } from "../providers/censys.ts";

const PUBLIC_IP = "104.16.53.111";
const RESOLVER: DnsResolver = { resolve: async (host) => (host === "search.censys.io" ? [PUBLIC_IP] : []) };

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
    providerHosts: { [censys.name]: censys.hosts },
    providerPaths: { [censys.name]: censys.requestPaths },
    providerQueries: { [censys.name]: censys.queryAllowlist ?? [] },
    providerPathTemplates: { [censys.name]: censys.requestPathTemplates ?? [] },
  });
  return { calls, g };
}

const SECRET = "n_censys_test_pair_header_value";
function req(url: string) {
  return {
    caseId: "case-1",
    purposeRef: "case:case-1",
    transform: "TR-049@1.0.0",
    url,
    sends: ["ip", "domain"],
    sensitivity: "normal" as const,
    pinnedHost: "search.censys.io",
    headers: { authorization: SECRET },
    secret: SECRET,
    secretProvider: "censys",
  };
}

describe("TR-049: the censys provider registry entry (the credential_pair provider)", () => {
  it("declares the pair kind, the Basic-auth header and the documented endpoints", () => {
    expect(censys.credentialKind).toBe("credential_pair");
    expect(censys.secretHeader).toBe("authorization");
    expect(censys.manifestSecretNames).toEqual(["CENSYS_API_ID"]);
    expect(censys.vaultEntry).toBe("censys");
    expect(censys.hosts).toEqual(["search.censys.io"]);
    expect(censys.requestPaths).toEqual(["/v2/certificates/search"]);
    expect(censys.requestPathTemplates?.map((t) => t.template)).toEqual(["/v2/hosts/{ip}"]);
    expect(censys.queryAllowlist).toEqual([{ param: "q", type: "string", maxLength: 253 }]);
  });

  it("the certificates search (the literal path, the allowlisted q) passes the gateway", async () => {
    const { calls, g } = gateway();
    expect(await g.request(req("https://search.censys.io/v2/certificates/search?q=example.com"))).toMatchObject({ ok: true });
    expect(calls).toEqual(["https://search.censys.io/v2/certificates/search?q=example.com"]);
  });

  it("the host view (the path template with the subject IP) passes the gateway", async () => {
    const { calls, g } = gateway();
    expect(await g.request(req("https://search.censys.io/v2/hosts/45.83.66.10"))).toMatchObject({ ok: true });
    expect(calls).toEqual(["https://search.censys.io/v2/hosts/45.83.66.10"]);
  });

  it("an off-template host-view path is refused before the transport (the subject may not smuggle a path)", async () => {
    const { calls, g } = gateway();
    expect(await g.request(req("https://search.censys.io/v2/hosts/not-an-ip"))).toMatchObject({
      ok: false,
      transportCalls: 0,
    });
    expect(calls).toHaveLength(0);
  });

  it("a query parameter outside the closed q allowlist is refused before the transport", async () => {
    const { calls, g } = gateway();
    expect(await g.request(req("https://search.censys.io/v2/certificates/search?per_page=5"))).toMatchObject({
      ok: false,
      transportCalls: 0,
    });
    expect(calls).toHaveLength(0);
  });

  it("a path outside the registered set (literal and template) is refused before the transport", async () => {
    const { calls, g } = gateway();
    expect(await g.request(req("https://search.censys.io/v2/account"))).toMatchObject({ ok: false, transportCalls: 0 });
    expect(calls).toHaveLength(0);
  });
});
