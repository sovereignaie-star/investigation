/**
 * P2-016 (D-031): secret injection at the trusted adapter boundary. The key travels ONLY in the
 * provider registry's header — never in the URL — and the sandboxed transform never sees it.
 * The adapter resolves the credential per request (a planning-time snapshot would go stale) and
 * refuses fail-closed when it is unavailable, before the gateway and transport are touched.
 *
 * SIMULATION ONLY: fake resolver, fake transport, fake vault reader. No real DNS, no sockets.
 */
import { describe, expect, it } from "vitest";
import { createEgressGateway, type DnsResolver, type EgressTransport } from "@ir/egress";
import { createEgressHttpTransport, type SecretBinding } from "./egress-adapter.ts";

const PUBLIC_IP = "93.184.216.34";
const RESOLVER: DnsResolver = {
  resolve: async (host) => (host === "urlscan.io" || host === "example.com" ? [PUBLIC_IP] : []),
};

interface Wire {
  readonly transport: EgressTransport;
  readonly calls: Array<{ url: string; headers?: Record<string, string> }>;
}

/** A transport that records every call's URL and headers, answering 200 (or echoing headers). */
function wire(echo?: Record<string, string>): Wire {
  const calls: Wire["calls"] = [];
  return {
    calls,
    transport: {
      async fetch(req) {
        calls.push({ url: req.url, ...(req.headers ? { headers: req.headers } : {}) });
        return { status: 200, body: "{}", ...(echo ? { headers: echo } : {}) };
      },
    },
  };
}

const PATHS = ["/api/v1/search/"] as const;

const BINDING: SecretBinding = {
  secretProvider: "urlscan",
  hosts: ["urlscan.io"],
  secretHeader: "api-key",
  requestPaths: PATHS,
  readSecret: () => "n_urlscan_test_key",
};

function gateway(w: Wire) {
  // The gateway is configured exactly as the CLI network run will configure it: the provider's
  // hosts and request paths come from the registry entry (fail-closed: no registry, no secret
  // request can pass).
  return createEgressGateway({
    resolver: RESOLVER,
    transport: w.transport,
    // Two back-to-back requests on one host: the generous injected rate keeps the test about the
    // credential, not the operational default (the same pattern as network.test.ts LIMITS).
    limits: { rateLimitPerHostPerSecond: 100, rateLimitBurst: 100 },
    providerHosts: { urlscan: BINDING.hosts },
    providerPaths: { urlscan: PATHS },
  });
}

const BASE = { caseId: "case-1", purposeRef: "case:case-1", transform: "TR-009@1.0.0", sends: ["url", "domain"], sensitivity: "normal" };

describe("P2-016: secret injection at the adapter (key in the registry header, never the URL)", () => {
  it("injects the vault key into the provider's header on a request to the provider host, and the URL stays clean", async () => {
    const w = wire();
    const transport = createEgressHttpTransport({ gateway: gateway(w), baseRequest: BASE, secretBinding: BINDING });
    const res = await transport.fetch({ method: "GET", url: "https://urlscan.io/api/v1/search/" }, new AbortController().signal);
    expect(res.status).toBe(200);
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]?.headers?.["api-key"]).toBe("n_urlscan_test_key");
    expect(w.calls[0]?.url).not.toContain("n_urlscan_test_key");
    expect(w.calls[0]?.url).not.toContain("key=");
  });

  it("a transform cannot override or strip the injected header (case-insensitive: API-Key / Api-Key)", async () => {
    for (const hostile of ["API-Key", "Api-Key", "aPi-kEy"]) {
      const w = wire();
      const transport = createEgressHttpTransport({ gateway: gateway(w), baseRequest: BASE, secretBinding: BINDING });
      const res = await transport.fetch(
        { method: "GET", url: "https://urlscan.io/api/v1/search/", headers: { [hostile]: "attacker-value", accept: "application/json" } },
        new AbortController().signal,
      );
      expect(res.status).toBe(200);
      // exactly ONE api-key header, carrying the registry's key — the transform's value is gone
      const keys = Object.keys(w.calls[0]?.headers ?? {});
      expect(keys.filter((k) => k.toLowerCase() === "api-key")).toHaveLength(1);
      expect(w.calls[0]?.headers?.["api-key"]).toBe("n_urlscan_test_key");
    }
  });

  it("the credential is resolved per request (a vault change between requests is honored)", async () => {
    let value = "first-key";
    const w = wire();
    const transport = createEgressHttpTransport({
      gateway: gateway(w),
      baseRequest: BASE,
      secretBinding: { ...BINDING, readSecret: () => value },
    });
    await transport.fetch({ method: "GET", url: "https://urlscan.io/api/v1/search/" }, new AbortController().signal);
    value = "second-key";
    await transport.fetch({ method: "GET", url: "https://urlscan.io/api/v1/search/" }, new AbortController().signal);
    expect(w.calls.map((c) => c.headers?.["api-key"])).toEqual(["first-key", "second-key"]);
  });

  it("a reader that THROWS refuses the request fail-closed, and the reader's own error text never surfaces", async () => {
    const w = wire();
    const transport = createEgressHttpTransport({
      gateway: gateway(w),
      baseRequest: BASE,
      secretBinding: {
        ...BINDING,
        readSecret: () => {
          throw new Error("reader exploded with n_urlscan_test_key inside");
        },
      },
    });
    await expect(
      transport.fetch({ method: "GET", url: "https://urlscan.io/api/v1/search/" }, new AbortController().signal),
    ).rejects.toThrowError(/secret for urlscan is unavailable/i);
    expect(w.calls).toHaveLength(0);
  });

  it("an unavailable credential refuses the request fail-closed, before the gateway touches the transport", async () => {
    const w = wire();
    const transport = createEgressHttpTransport({
      gateway: gateway(w),
      baseRequest: BASE,
      secretBinding: { ...BINDING, readSecret: () => undefined },
    });
    await expect(
      transport.fetch({ method: "GET", url: "https://urlscan.io/api/v1/search/" }, new AbortController().signal),
    ).rejects.toThrowError(/secret for urlscan is unavailable/i);
    expect(w.calls).toHaveLength(0);
  });

  it("a request to a host outside the binding is REFUSED — a credentialed run stays pinned to its provider, never a keyless request", async () => {
    const w = wire();
    const transport = createEgressHttpTransport({ gateway: gateway(w), baseRequest: BASE, secretBinding: BINDING });
    await expect(transport.fetch({ method: "GET", url: "https://example.com/docs" }, new AbortController().signal)).rejects.toThrowError(
      /outside the pinned provider hosts/i,
    );
    expect(w.calls).toHaveLength(0);
  });

  it("a provider response echoing the secret back — in ANY header or the body — is REFUSED outright (canary: the credential never reaches the sandbox or evidence)", async () => {
    for (const echo of [
      { headers: { "Api-Key": "n_urlscan_test_key" } }, // header echo (any case/name)
      { headers: { "x-echo": "leak:n_urlscan_test_key" } }, // arbitrary header carrying the value
      { body: '{"note":"n_urlscan_test_key"}' }, // body echo
    ]) {
      const spy = {
        calls: [],
        transport: { fetch: async (_req: { url: string; headers?: Record<string, string> }) => ({ status: 200, ...echo }) },
      };
      const transport = createEgressHttpTransport({ gateway: gateway(spy as never), baseRequest: BASE, secretBinding: BINDING });
      await expect(
        transport.fetch({ method: "GET", url: "https://urlscan.io/api/v1/search/" }, new AbortController().signal),
      ).rejects.toThrowError(/echoed the credential/i);
    }
  });

  it("a clean provider response passes the reflection guard (no false positives on ordinary bodies)", async () => {
    const w = wire({ "content-type": "application/json" });
    const transport = createEgressHttpTransport({ gateway: gateway(w), baseRequest: BASE, secretBinding: BINDING });
    const res = await transport.fetch({ method: "GET", url: "https://urlscan.io/api/v1/search/" }, new AbortController().signal);
    expect(res.status).toBe(200);
    expect(res.headers?.["content-type"]).toBe("application/json");
  });

  it("redirect containment: a redirect to a host outside the provider's registry never receives the secret (the gateway refuses the hop)", async () => {
    // first hop: 302 to an outside host; the gateway must refuse the redirect hop (the secret
    // stays bound to the provider's hosts on EVERY hop — T-SEC-SSRF-042 per-hop path check).
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    const redirectTransport = {
      async fetch(req: { url: string; headers?: Record<string, string> }) {
        calls.push({ url: req.url, ...(req.headers ? { headers: req.headers } : {}) });
        if (calls.length === 1) {
          return { status: 302, headers: { location: "https://example.com/steal" } };
        }
        return { status: 200, body: "{}" };
      },
    };
    const transport = createEgressHttpTransport({
      gateway: createEgressGateway({
        resolver: RESOLVER,
        transport: redirectTransport,
        providerHosts: { urlscan: BINDING.hosts },
        providerPaths: { urlscan: PATHS },
        limits: { rateLimitPerHostPerSecond: 100, rateLimitBurst: 100, maxRedirects: 2 },
      }),
      baseRequest: BASE,
      secretBinding: BINDING,
    });
    await expect(
      transport.fetch({ method: "GET", url: "https://urlscan.io/api/v1/search/" }, new AbortController().signal),
    ).rejects.toThrowError(/secret_host_mismatch|host_not_allowed|redirect/i);
    // the only transport call is the first hop to the provider; the outside host was never contacted
    expect(calls.map((c) => c.url)).toEqual(["https://urlscan.io/api/v1/search/"]);
  });

  it("DOCUMENTED CONFLICT (P2-016): TR-009's real search request carries a query, and the query policy refuses secret-bearing requests — the injection is refused by T-SEC-SSRF-042 until the owner decides on a registry-driven query allowlist", async () => {
    const w = wire();
    const transport = createEgressHttpTransport({ gateway: gateway(w), baseRequest: BASE, secretBinding: BINDING });
    await expect(
      transport.fetch({ method: "GET", url: "https://urlscan.io/api/v1/search/?q=domain:example.com" }, new AbortController().signal),
    ).rejects.toThrowError(/secret_host_mismatch/);
    expect(w.calls).toHaveLength(0);
  });
});
