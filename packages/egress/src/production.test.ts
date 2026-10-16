/**
 * P2-003: the real resolver (system-resolver.ts) and the production composition (production.ts).
 * Deterministic: the lookup is injected, except the `localhost` cases which use the real `node:dns` lookup of a
 * name that never leaves the host (/etc/hosts), to show the real resolver feeds every address to the classifier.
 */
import { describe, expect, it } from "vitest";
import { createEgressGateway, type EgressTransport } from "./egress.ts";
import { createProductionEgress, validAllowedHost } from "./production.ts";
import { createSystemResolver, type LookupAll } from "./system-resolver.ts";

const BASE: { caseId?: string; purposeRef: string; transform: string; sends: string[]; sensitivity: string } = {
  caseId: "c1",
  purposeRef: "p1",
  transform: "TR-010@1.0.0",
  sends: ["url"],
  sensitivity: "normal",
};

function lookupOf(map: Record<string, Array<{ address: string; family: number }>>): LookupAll & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (host: string) => {
    calls.push(host);
    const a = map[host];
    if (!a) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    return a;
  }) as unknown as LookupAll & { calls: string[] };
  fn.calls = calls;
  return fn;
}

function recordingTransport(): EgressTransport & { calls: Array<{ host: string; pinnedIp: string }> } {
  const calls: Array<{ host: string; pinnedIp: string }> = [];
  return {
    calls,
    async fetch(r) {
      calls.push({ host: r.host, pinnedIp: r.pinnedIp });
      return { status: 200, body: "ok" };
    },
  };
}

describe("createSystemResolver (P2-003)", () => {
  it("returns EVERY address (A and AAAA, resolver order, de-duplicated) so the gateway can classify all of them", async () => {
    const lookup = lookupOf({
      "source.example": [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
        { address: "93.184.216.34", family: 4 },
      ],
    });
    const r = createSystemResolver({ lookup });
    expect(await r.resolve("source.example")).toEqual(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]);
    expect(lookup.calls).toEqual(["source.example"]);
  });

  it("rejects an empty answer, a non-IP answer, too many answers, and a literal IP passed as a hostname", async () => {
    const r = createSystemResolver({
      maxAddresses: 2,
      lookup: lookupOf({
        empty: [],
        weird: [{ address: "not-an-ip", family: 4 }],
        many: [
          { address: "1.1.1.1", family: 4 },
          { address: "1.0.0.1", family: 4 },
          { address: "8.8.8.8", family: 4 },
        ],
      }),
    });
    await expect(r.resolve("empty")).rejects.toThrow("no addresses");
    await expect(r.resolve("weird")).rejects.toThrow("non-IP");
    await expect(r.resolve("many")).rejects.toThrow("more than 2");
    await expect(r.resolve("93.184.216.34")).rejects.toThrow("not a hostname");
    await expect(r.resolve("nx.example")).rejects.toThrow("ENOTFOUND");
  });

  it("through the gateway: one private address among public ones refuses the whole request before the transport", async () => {
    const t = recordingTransport();
    const g = createEgressGateway({
      resolver: createSystemResolver({
        lookup: lookupOf({
          "split.example": [
            { address: "93.184.216.34", family: 4 },
            { address: "10.0.0.5", family: 4 },
          ],
        }),
      }),
      transport: t,
    });
    const r = await g.request({ ...BASE, url: "https://split.example/" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("address_class");
    expect(r.transportCalls).toBe(0);
    expect(t.calls).toEqual([]);
  });

  it("through the gateway: a lookup failure is address_class (fail-closed), never a fallback", async () => {
    const t = recordingTransport();
    const g = createEgressGateway({ resolver: createSystemResolver({ lookup: lookupOf({}) }), transport: t });
    const r = await g.request({ ...BASE, url: "https://nx.example/" });
    expect(r.reason).toBe("address_class");
    expect(t.calls).toEqual([]);
  });

  it("real node:dns: `localhost` resolves to loopback and the gateway refuses it before any connection", async () => {
    const t = recordingTransport();
    const real = createSystemResolver();
    const addrs = await real.resolve("localhost");
    expect(addrs.length).toBeGreaterThan(0);
    expect(addrs.every((a) => a === "::1" || a.startsWith("127."))).toBe(true);
    const g = createEgressGateway({ resolver: real, transport: t });
    const r = await g.request({ ...BASE, url: "https://localhost/" });
    expect(r.ok).toBe(false);
    expect(t.calls).toEqual([]);
  });
});

describe("createProductionEgress (P2-003): off by default, never global", () => {
  const t = () => recordingTransport();
  const lookup = lookupOf({
    "source.example": [{ address: "93.184.216.34", family: 4 }],
    "other.example": [{ address: "93.184.216.35", family: 4 }],
  });

  it("is off without IR_ENABLE_NETWORK=1 (unset, 0, true, yes)", () => {
    for (const env of [{}, { IR_ENABLE_NETWORK: "0" }, { IR_ENABLE_NETWORK: "true" }, { IR_ENABLE_NETWORK: "yes" }]) {
      const d = createProductionEgress({ allowedHosts: ["source.example"], env });
      expect(d.enabled, JSON.stringify(env)).toBe(false);
    }
  });

  it("IR_OFFLINE=1 wins", () => {
    const d = createProductionEgress({ allowedHosts: ["source.example"], env: { IR_ENABLE_NETWORK: "1", IR_OFFLINE: "1" } });
    expect(d).toEqual({ enabled: false, reason: "IR_OFFLINE=1: the network is disabled" });
  });

  it("an empty host list never enables the network", () => {
    expect(createProductionEgress({ allowedHosts: [], env: { IR_ENABLE_NETWORK: "1" } }).enabled).toBe(false);
  });

  it("host list entries are hostnames only", () => {
    for (const bad of [
      "93.184.216.34",
      "[::1]",
      "*.example",
      "source.example:443",
      "source.example/x",
      "localhost",
      "a..b",
      "-a.example",
      "x.123",
      "",
    ]) {
      expect(validAllowedHost(bad), bad).toBeNull();
      expect(createProductionEgress({ allowedHosts: [bad], env: { IR_ENABLE_NETWORK: "1" } }).enabled, bad).toBe(false);
    }
    expect(validAllowedHost(" Source.Example. ")).toBe("source.example");
  });

  it("enabled: the listed host goes through the gateway with a pinned classified address", async () => {
    const tr = t();
    const d = createProductionEgress({
      allowedHosts: ["Source.Example"],
      env: { IR_ENABLE_NETWORK: "1" },
      resolver: createSystemResolver({ lookup }),
      transport: tr,
    });
    if (!d.enabled) throw new Error(d.reason);
    expect(d.allowedHosts).toEqual(["source.example"]);
    const r = await d.gateway.request({ ...BASE, url: "https://source.example/" });
    expect(r.ok).toBe(true);
    expect(tr.calls).toEqual([{ host: "source.example", pinnedIp: "93.184.216.34" }]);
  });

  it("enabled: a host off the list is refused before DNS, and every gateway rule still applies", async () => {
    const tr = t();
    const l = lookupOf({ "other.example": [{ address: "93.184.216.35", family: 4 }] });
    const d = createProductionEgress({
      allowedHosts: ["source.example"],
      env: { IR_ENABLE_NETWORK: "1" },
      resolver: createSystemResolver({ lookup: l }),
      transport: tr,
    });
    if (!d.enabled) throw new Error(d.reason);
    const off = await d.gateway.request({ ...BASE, url: "https://other.example/" });
    expect(off.reason).toBe("host_not_allowed");
    expect(l.calls).toEqual([]);
    const http = await d.gateway.request({ ...BASE, url: "http://source.example/" });
    expect(http.reason).toBe("scheme");
    const noCase = await d.gateway.request({ ...BASE, caseId: undefined, url: "https://source.example/" });
    expect(noCase.reason).toBe("no_case");
    expect(tr.calls).toEqual([]);
  });

  it("enabled: the composition wires the ADR-28 screening POST host by default (a well-formed /match POST passes, another listed host's POST refuses)", async () => {
    const tr = t();
    const d = createProductionEgress({
      allowedHosts: ["api.opensanctions.org", "source.example"],
      env: { IR_ENABLE_NETWORK: "1" },
      resolver: createSystemResolver({
        lookup: lookupOf({
          "api.opensanctions.org": [{ address: "93.184.216.34", family: 4 }],
          "source.example": [{ address: "93.184.216.34", family: 4 }],
        }),
      }),
      transport: tr,
    });
    if (!d.enabled) throw new Error(d.reason);
    // The screening POST to the pinned host+path passes — the production composition includes
    // DEFAULT_SCREENING_POST_HOSTS without any caller-side wiring (ADR-28; TR-025).
    const screening = await d.gateway.request({
      ...BASE,
      sends: ["person_name"],
      url: "https://api.opensanctions.org/match/default",
      method: "POST",
      body: JSON.stringify({ queries: { q: { schema: "Person", properties: { firstName: ["Aleksandr"], lastName: ["Zacharov"] } } } }),
    });
    expect(screening.ok, screening.reason).toBe(true);
    expect(tr.calls).toHaveLength(1);
    // A POST to a listed-but-unpinned host is still refused: the allow-list never opens POST.
    const other = await d.gateway.request({ ...BASE, url: "https://source.example/collect", method: "POST", body: "x=y" });
    expect(other.reason).toBe("invalid_request");
    expect(tr.calls).toHaveLength(1);
  });
});
