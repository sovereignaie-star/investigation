/**
 * P2-028 (ADR-31) — the investigator proxy wiring (red-first): `ir proxy` records the case's proxy
 * configuration on its own audit chain (patterned after P2-029's `ir source`), the routing is read
 * from the chain before every network run, the credentials come from the VAULT (a credential_pair
 * entry — username + password — never in the event), and `--via-tor` is the explicit per-invocation
 * Tor activation. The invariants under test:
 *
 * 1. The proxy.set event carries route/host/port/secretName ONLY — no credential material.
 * 2. A configured strict proxy routes the case's requests through it (the transport sees the tunnel
 *    with the PINNED target IP and the vault credentials).
 * 3. Fail-closed, twice: a proxy whose vault entry is missing (or not a credential pair) refuses
 *    BEFORE any transport call — no request passes; a proxy host that does not resolve fails the
 *    request with proxy_unreachable — there is NO fallback to direct.
 * 4. Tor is NEVER implicit: --via-tor without a tor proxy configured for the case is a usage
 *    error; a tor config without the flag is the case's EXPLICIT activation (ADR-31's activation
 *    event); no config at all is direct.
 * 5. The tor proxy may be an IP literal (the operator's local SocksPort) — no DNS for the proxy.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { manualClock } from "@ir/core";
import { EgressTransportError, type DnsResolver, type EgressLimits, type EgressTransport } from "@ir/egress";
import { openCase, type Vault } from "@ir/store";
import * as F from "../../transforms/src/fixtures/public-sources.ts";
import { main } from "./ir.ts";
import { probeIsolation } from "@ir/transform-sandbox";

// P2-005 (the established pattern, e.g. source-control.test.ts): these tests run REAL transform
// executions, which need the "full" sandbox isolation; on hosts without bubblewrap/delegated
// cgroups (e.g. the CI gates job) they SKIP — the CI test job installs bubblewrap and runs them.
const host = await probeIsolation();

const ON = { IR_ENABLE_NETWORK: "1" };
const CASE_ARGS = ["--purpose", "تحقيق في بنية تحتية عامة لحادث أمني مصرح به", "--legal-basis", "security_incident"];
const T0 = "2026-10-18T12:00:00.000Z";

/** The investigate invocation (P2-029 pattern): the FIRST run creates the case with a real basis. */
const INVESTIGATE = (dir: string, extra: string[] = []): string[] => [
  "investigate",
  dir,
  "domain",
  "example.com",
  "--network",
  "--allow-host",
  "dns.google",
  "--allow-host",
  "data.iana.org",
  "--allow-host",
  "rdap.verisign.com",
  "--allow-host",
  "crt.sh",
  ...CASE_ARGS,
  "--json",
  "--transform",
  "TR-001",
  "--transform",
  "TR-002",
  "--transform",
  "TR-004",
  "--max-depth",
  "0",
  "--max-runs",
  "10",
  "--max-requests",
  "50",
  ...extra,
];

/** The minimal world: example.com resolves; the proxy hosts are in the map (or IP literals). */
const DNS: Readonly<Record<string, string[]>> = {
  "dns.google": ["8.8.8.8"],
  "data.iana.org": ["192.0.47.59"],
  "rdap.verisign.com": ["72.13.58.10"],
  "crt.sh": ["91.199.212.73"],
  "proxy.example.net": ["8.8.4.4"],
  "example.com": ["8.8.8.8"],
};
type Resp = Awaited<ReturnType<EgressTransport["fetch"]>>;
const json = (body: string, status = 200): Resp => ({ status, body, headers: { "content-type": "application/json" } });
const q = (name: string, type: number) => `https://dns.google/resolve?name=${name}&type=${type}`;
const hostAnswers = (name: string, a?: string): Record<string, Resp> =>
  Object.fromEntries(
    [1, 28, 15, 2, 16, 5].map((t) => [q(name, t), json(F.doh(0, t === 1 && a ? [{ name: `${name}.`, type: 1, data: a }] : []))]),
  );
const WORLD: Readonly<Record<string, Resp>> = {
  ...hostAnswers("example.com", "8.8.8.8"),
  "https://data.iana.org/rdap/dns.json": json(F.IANA_DNS),
  "https://rdap.verisign.com/com/v1/domain/example.com": json(F.RDAP_DOMAIN_EXAMPLE),
  "https://crt.sh/?q=%25.example.com&output=json": json(F.CRT_EXAMPLE),
  "https://example.com/": { status: 200, headers: { "content-type": "text/html" }, body: "<html>ok</html>" },
  // a 404 robots.txt allows every path (TR-010 fetches it before the page)
  "https://example.com/robots.txt": { status: 404, body: "", headers: {} },
};

const dirs: string[] = [];
afterEach(() => {
  for (let d = dirs.pop(); d !== undefined; d = dirs.pop()) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), "ir-p2028c-"));
  dirs.push(d);
  return d;
};

/** A fake vault: credential_pair entries (username = pair id, password = pair secret). */
function fakeVault(pairs: Readonly<Record<string, { id: string; secret: string }>> = {}): Vault {
  const names = () => Object.keys(pairs);
  return {
    list: () => names().map((name) => ({ name, updatedAt: T0 })),
    has: (name) => name in pairs,
    set: () => {
      throw new Error("not needed in tests");
    },
    delete: () => false,
    setPair: () => {
      throw new Error("not needed in tests");
    },
    reveal: (name) => (name in pairs ? "single-secret-shape" : undefined),
    revealPair: (name) => pairs[name],
    kindOf: (name) => (name in pairs ? "credential_pair" : undefined),
  };
}

/** What the fake transport saw: the URL plus the route and the tunnel of every request. */
type SeenCall = { url: string; route?: string; pinnedIp: string; proxy?: unknown };

/** The fake edge: a resolver and a transport that serve WORLD and record every call with its route. */
function edge(world: Readonly<Record<string, Resp>> = WORLD) {
  const calls: SeenCall[] = [];
  const resolved: string[] = [];
  const resolver: DnsResolver = {
    async resolve(host) {
      resolved.push(host);
      return DNS[host] ?? [];
    },
  };
  const transport: EgressTransport = {
    async fetch(r) {
      calls.push({ url: r.url, route: r.route, pinnedIp: r.pinnedIp, proxy: r.proxy });
      const hit = world[r.url];
      if (!hit) throw new EgressTransportError("transport_error", `no fixture for ${r.url}`);
      return hit;
    },
  };
  return { calls, resolved, resolver, transport };
}

/** Runs `ir ...` with the fake network (resolver/transport/limits/vault) and returns the parsed output. */
async function cli(
  args: string[],
  opts: { calls?: SeenCall[]; resolved?: string[]; world?: Readonly<Record<string, Resp>>; vault?: Vault } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const x = edge(opts.world);
  const injectedVault = opts.vault;
  let t = 0;
  const code = await main(
    args,
    (s) => out.push(s),
    (s) => err.push(s),
    {
      clock: manualClock(T0),
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      network: {
        env: ON,
        resolver: x.resolver,
        transport: x.transport,
        limits: { rateLimitBurst: 64, torRateLimitBurst: 64, torRateLimitPerHostPerSecond: 1000 } as EgressLimits,
        ...(injectedVault ? { vault: () => injectedVault } : {}),
      },
    },
  );
  // the calls are copied only AFTER the command ran — the record is the actual requests this invocation made
  if (opts.calls) opts.calls.push(...x.calls);
  if (opts.resolved) opts.resolved.push(...x.resolved);
  const text = out.join("\n").trim();
  const parsed = text.startsWith("{") || text.startsWith("[") ? (JSON.parse(text) as unknown) : undefined;
  return {
    code,
    err: err.join("\n"),
    out: text,
    json: parsed as Record<string, unknown> | undefined,
    rows: (Array.isArray(parsed) ? parsed : undefined) as Array<Record<string, unknown>> | undefined,
  };
}

function readAudit(dir: string) {
  const c = openCase(dir, { actor: "test" });
  try {
    return c.auditTrail().map((a) => ({ action: a.action, target: a.target, detail: (a.detail ?? {}) as Record<string, unknown> }));
  } finally {
    c.close();
  }
}

const VAULT = fakeVault({ "ops-proxy": { id: "opsuser", secret: "opspass" }, "tor-port": { id: "toruser", secret: "torpass" } });

describe.skipIf(!host.full)("P2-028 ir proxy: the case's proxy configuration on its audit chain", () => {
  // The FIRST investigate in a vitest worker pays a one-time cost (the transform registration +
  // sandbox warmup, ~6s) that would blow the 5s test timeout; warm it here, outside any test.
  beforeAll(async () => {
    const warm = tempDir();
    await cli(INVESTIGATE(warm));
    rmSync(warm, { recursive: true, force: true });
  }, 30000);

  it("T-P2028-C01: usage errors — no verb, unknown verb, bad route, missing flags, bad port", async () => {
    const dir = tempDir();
    const inv = await cli(INVESTIGATE(dir));
    const failedRuns = ((inv.json?.coverage ?? []) as Array<{ transformId?: string; entityKey?: string; state?: string; reason?: string }>)
      .filter((k) => k.state === "failed")
      .map((k) => `${k.transformId}/${k.entityKey}: ${k.reason}`);
    expect(inv.code, `investigate failed: ${inv.err} | failed runs: ${JSON.stringify(failedRuns)}`).toBe(0); // the first run creates the case (real basis)
    expect((await cli(["proxy", dir])).code).toBe(2);
    expect((await cli(["proxy", dir, "frobnicate"])).code).toBe(2);
    expect((await cli(["proxy", dir, "set", "bad-route", "--host", "h.example", "--port", "1080", "--secret", "s"])).code).toBe(2);
    expect((await cli(["proxy", dir, "set", "proxy-socks5", "--host", "h.example", "--port", "1080"])).code).toBe(2); // no --secret
    expect((await cli(["proxy", dir, "set", "proxy-socks5", "--host", "h.example", "--secret", "s"])).code).toBe(2); // no --port
    expect((await cli(["proxy", dir, "set", "proxy-socks5", "--port", "1080", "--secret", "s"])).code).toBe(2); // no --host
    expect((await cli(["proxy", dir, "set", "proxy-socks5", "--host", "h.example", "--port", "99999", "--secret", "s"])).code).toBe(2);
    expect((await cli(["proxy", dir, "clear", "extra"])).code).toBe(2); // clear takes no extra positional
  });

  it("T-P2028-C02: `ir proxy set` records proxy.set with route/host/port/secretName — NO credential material", async () => {
    const dir = tempDir();
    const inv = await cli(INVESTIGATE(dir));
    const failedRuns = ((inv.json?.coverage ?? []) as Array<{ transformId?: string; entityKey?: string; state?: string; reason?: string }>)
      .filter((k) => k.state === "failed")
      .map((k) => `${k.transformId}/${k.entityKey}: ${k.reason}`);
    expect(inv.code, `investigate failed: ${inv.err} | failed runs: ${JSON.stringify(failedRuns)}`).toBe(0); // create the case with a real basis
    const r = await cli([
      "proxy",
      dir,
      "set",
      "proxy-socks5",
      "--host",
      "proxy.example.net",
      "--port",
      "1080",
      "--secret",
      "ops-proxy",
      "--json",
    ]);
    expect(r.code).toBe(0);
    const audit = readAudit(dir);
    const ev = audit.find((a) => a.action === "proxy.set");
    expect(ev).toBeDefined();
    expect(ev?.target).toBe("proxy-socks5");
    expect(ev?.detail).toMatchObject({ host: "proxy.example.net", port: 1080, secretName: "ops-proxy" });
    // the credentials NEVER appear in the event — only the vault entry NAME
    expect(JSON.stringify(ev?.detail)).not.toContain("opspass");
    expect(JSON.stringify(ev?.detail)).not.toContain("opsuser");
    // the show surface reflects the config
    const show = await cli(["proxy", dir, "show", "--json"]);
    expect(show.code).toBe(0);
    expect(show.json).toMatchObject({ route: "proxy-socks5", host: "proxy.example.net", port: 1080, secretName: "ops-proxy" });
  });

  it("T-P2028-C03: `ir proxy clear` records proxy.clear and the show surface returns to direct", async () => {
    const dir = tempDir();
    const inv = await cli(INVESTIGATE(dir));
    const failedRuns = ((inv.json?.coverage ?? []) as Array<{ transformId?: string; entityKey?: string; state?: string; reason?: string }>)
      .filter((k) => k.state === "failed")
      .map((k) => `${k.transformId}/${k.entityKey}: ${k.reason}`);
    expect(inv.code, `investigate failed: ${inv.err} | failed runs: ${JSON.stringify(failedRuns)}`).toBe(0); // create the case with a real basis
    await cli(["proxy", dir, "set", "proxy-socks5", "--host", "proxy.example.net", "--port", "1080", "--secret", "ops-proxy"]);
    const r = await cli(["proxy", dir, "clear", "--json"]);
    expect(r.code).toBe(0);
    const audit = readAudit(dir);
    expect(audit.some((a) => a.action === "proxy.clear")).toBe(true);
    const show = await cli(["proxy", dir, "show", "--json"]);
    expect(show.code).toBe(0);
    expect(show.json).toMatchObject({ route: "direct" });
  });

  it("T-P2028-C04: a configured strict proxy routes the case's requests — pinned target IP + vault credentials", async () => {
    const dir = tempDir();
    const inv = await cli(INVESTIGATE(dir));
    const failedRuns = ((inv.json?.coverage ?? []) as Array<{ transformId?: string; entityKey?: string; state?: string; reason?: string }>)
      .filter((k) => k.state === "failed")
      .map((k) => `${k.transformId}/${k.entityKey}: ${k.reason}`);
    expect(inv.code, `investigate failed: ${inv.err} | failed runs: ${JSON.stringify(failedRuns)}`).toBe(0); // create the case with a real basis
    await cli(["proxy", dir, "set", "proxy-socks5", "--host", "proxy.example.net", "--port", "1080", "--secret", "ops-proxy"]);
    const calls: SeenCall[] = [];
    const r = await cli(INVESTIGATE(dir, []), {
      calls,
      vault: VAULT,
    });
    expect(r.code).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.route).toBe("proxy-socks5");
      // the transport is handed the PROXY's pinned IP, and the tunnel targets the PINNED TARGET IP
      // — the EXACT IP of THIS call's own URL host (not any IP from the run's host list)
      expect(c.pinnedIp).toBe("8.8.4.4");
      const host = new URL(c.url).hostname;
      expect(DNS[host]).toBeDefined();
      expect(c.proxy).toMatchObject({
        kind: "socks5",
        proxyIp: "8.8.4.4",
        proxyPort: 1080,
        target: { kind: "ip", ip: DNS[host][0] },
        credentials: { username: "opsuser", password: "opspass" },
      });
    }
    // the network events on the chain carry the route — EVERY egress event, no exception
    const audit = readAudit(dir);
    const egress = audit.filter((a) => a.action.startsWith("egress."));
    expect(egress.length).toBeGreaterThan(0);
    // EVERY network event on the chain carries a route (allow/deny/transport — no exception);
    // the first (direct) investigate's events carry "direct", the proxied run's carry "proxy-socks5"
    expect(egress.every((a) => typeof a.detail?.route === "string" && (a.detail.route as string) !== "")).toBe(true);
    expect(egress.some((a) => a.detail?.route === "proxy-socks5")).toBe(true);
  });

  it("T-P2028-C05: a proxy whose vault entry is MISSING refuses fail-closed BEFORE any transport call", async () => {
    const dir = tempDir();
    const inv = await cli(INVESTIGATE(dir));
    const failedRuns = ((inv.json?.coverage ?? []) as Array<{ transformId?: string; entityKey?: string; state?: string; reason?: string }>)
      .filter((k) => k.state === "failed")
      .map((k) => `${k.transformId}/${k.entityKey}: ${k.reason}`);
    expect(inv.code, `investigate failed: ${inv.err} | failed runs: ${JSON.stringify(failedRuns)}`).toBe(0); // create the case with a real basis
    await cli(["proxy", dir, "set", "proxy-socks5", "--host", "proxy.example.net", "--port", "1080", "--secret", "no-such-entry"]);
    const calls: SeenCall[] = [];
    const r = await cli(INVESTIGATE(dir, []), {
      calls,
      vault: VAULT,
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("no-such-entry");
    // fail-closed: nothing reached the transport at all
    expect(calls).toHaveLength(0);
  });

  it("T-P2028-C06: a vault entry that is NOT a credential pair refuses fail-closed (single-secret shape)", async () => {
    const dir = tempDir();
    const inv = await cli(INVESTIGATE(dir));
    const failedRuns = ((inv.json?.coverage ?? []) as Array<{ transformId?: string; entityKey?: string; state?: string; reason?: string }>)
      .filter((k) => k.state === "failed")
      .map((k) => `${k.transformId}/${k.entityKey}: ${k.reason}`);
    expect(inv.code, `investigate failed: ${inv.err} | failed runs: ${JSON.stringify(failedRuns)}`).toBe(0); // create the case with a real basis
    await cli(["proxy", dir, "set", "proxy-http-connect", "--host", "proxy.example.net", "--port", "3128", "--secret", "plain-secret"]);
    const singleShape = fakeVault();
    const calls: SeenCall[] = [];
    const r = await cli(INVESTIGATE(dir, []), {
      calls,
      vault: singleShape,
    });
    expect(r.code).toBe(2);
    expect(calls).toHaveLength(0);
  });

  it("T-P2028-C07: --via-tor without a tor proxy configured for the case is a usage error", async () => {
    const dir = tempDir();
    const inv = await cli(INVESTIGATE(dir));
    const failedRuns = ((inv.json?.coverage ?? []) as Array<{ transformId?: string; entityKey?: string; state?: string; reason?: string }>)
      .filter((k) => k.state === "failed")
      .map((k) => `${k.transformId}/${k.entityKey}: ${k.reason}`);
    expect(inv.code, `investigate failed: ${inv.err} | failed runs: ${JSON.stringify(failedRuns)}`).toBe(0); // create the case with a real basis
    const r = await cli(INVESTIGATE(dir, ["--via-tor"]), {
      vault: VAULT,
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("--via-tor");
  });

  it("T-P2028-C08: --via-tor with a configured tor proxy routes through Tor — the DOMAIN is sent, never resolved locally", async () => {
    const dir = tempDir();
    const inv = await cli(INVESTIGATE(dir));
    const failedRuns = ((inv.json?.coverage ?? []) as Array<{ transformId?: string; entityKey?: string; state?: string; reason?: string }>)
      .filter((k) => k.state === "failed")
      .map((k) => `${k.transformId}/${k.entityKey}: ${k.reason}`);
    expect(inv.code, `investigate failed: ${inv.err} | failed runs: ${JSON.stringify(failedRuns)}`).toBe(0); // create the case with a real basis
    // the tor proxy is the operator's local SocksPort — an IP literal, no DNS for the proxy itself
    await cli(["proxy", dir, "set", "tor", "--host", "127.0.0.1", "--port", "9050", "--secret", "tor-port"]);
    const calls: SeenCall[] = [];
    const resolved: string[] = [];
    const r = await cli(INVESTIGATE(dir, ["--via-tor"]), {
      calls,
      resolved, // only THIS invocation's resolutions — the first (direct) investigate resolves its own
      vault: VAULT,
    });
    expect(r.code).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.route).toBe("tor");
      // Tor: the transport connects to the PROXY (the local SocksPort) and hands it the DOMAIN
      // — the EXACT host of THIS call's own URL, never an IP, never resolved locally
      expect(c.pinnedIp).toBe("127.0.0.1");
      expect(c.proxy).toMatchObject({
        kind: "socks5",
        proxyIp: "127.0.0.1",
        proxyPort: 9050,
        target: { kind: "host", host: new URL(c.url).hostname },
      });
    }
    // the target domains are NEVER resolved locally in tor mode — the resolver saw none of them
    const resolvedHosts = resolved.join(",");
    for (const d of ["dns.google", "data.iana.org", "rdap.verisign.com", "crt.sh"]) {
      expect(resolvedHosts).not.toContain(d);
    }
  });

  it("T-P2028-C09: a tor config WITHOUT the flag is the case's EXPLICIT activation (ADR-31) — route tor", async () => {
    const dir = tempDir();
    const inv = await cli(INVESTIGATE(dir));
    const failedRuns = ((inv.json?.coverage ?? []) as Array<{ transformId?: string; entityKey?: string; state?: string; reason?: string }>)
      .filter((k) => k.state === "failed")
      .map((k) => `${k.transformId}/${k.entityKey}: ${k.reason}`);
    expect(inv.code, `investigate failed: ${inv.err} | failed runs: ${JSON.stringify(failedRuns)}`).toBe(0); // create the case with a real basis
    await cli(["proxy", dir, "set", "tor", "--host", "127.0.0.1", "--port", "9050", "--secret", "tor-port"]);
    const calls: SeenCall[] = [];
    const r = await cli(INVESTIGATE(dir, []), {
      calls,
      vault: VAULT,
    });
    expect(r.code).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.route === "tor" && c.pinnedIp === "127.0.0.1")).toBe(true);
  });

  it("T-P2028-C10: no proxy config at all — the case's requests are direct (route direct)", async () => {
    const dir = tempDir();
    const inv = await cli(INVESTIGATE(dir));
    const failedRuns = ((inv.json?.coverage ?? []) as Array<{ transformId?: string; entityKey?: string; state?: string; reason?: string }>)
      .filter((k) => k.state === "failed")
      .map((k) => `${k.transformId}/${k.entityKey}: ${k.reason}`);
    expect(inv.code, `investigate failed: ${inv.err} | failed runs: ${JSON.stringify(failedRuns)}`).toBe(0); // create the case with a real basis
    const calls: SeenCall[] = [];
    const r = await cli(INVESTIGATE(dir, []), {
      calls,
      vault: VAULT,
    });
    expect(r.code).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    // every request is direct (no tunnel), and the targets pin to their own IPs (dns.google => 8.8.8.8)
    expect(calls.every((c) => c.route === "direct" && c.proxy === undefined)).toBe(true);
    expect(calls.some((c) => c.pinnedIp === "8.8.8.8")).toBe(true);
  });

  it("T-P2028-C11: a proxy host that does not resolve fails fail-closed (proxy_unreachable) — NO direct fallback", async () => {
    const dir = tempDir();
    const inv = await cli(INVESTIGATE(dir));
    const failedRuns = ((inv.json?.coverage ?? []) as Array<{ transformId?: string; entityKey?: string; state?: string; reason?: string }>)
      .filter((k) => k.state === "failed")
      .map((k) => `${k.transformId}/${k.entityKey}: ${k.reason}`);
    expect(inv.code, `investigate failed: ${inv.err} | failed runs: ${JSON.stringify(failedRuns)}`).toBe(0); // create the case with a real basis
    // a host that is NOT in the fake resolver's map — it does not resolve
    await cli(["proxy", dir, "set", "proxy-socks5", "--host", "unreachable-proxy.invalid", "--port", "1080", "--secret", "ops-proxy"]);
    const calls: SeenCall[] = [];
    const r = await cli(INVESTIGATE(dir, []), {
      calls,
      vault: VAULT,
    });
    // the investigation ran but the requests FAILED — and nothing ever went direct to the target
    expect(r.code).toBe(1);
    expect(calls.filter((c) => c.route === "direct")).toHaveLength(0);
    const audit = readAudit(dir);
    const denied = audit.filter((a) => a.action === "egress.denied");
    expect(denied.some((a) => JSON.stringify(a.detail).includes("proxy_unreachable"))).toBe(true);
  });

  it("T-P2028-C12: `ir run --network` honours the case's proxy config too (the single-run path)", async () => {
    const dir = tempDir();
    const inv = await cli(INVESTIGATE(dir));
    const failedRuns = ((inv.json?.coverage ?? []) as Array<{ transformId?: string; entityKey?: string; state?: string; reason?: string }>)
      .filter((k) => k.state === "failed")
      .map((k) => `${k.transformId}/${k.entityKey}: ${k.reason}`);
    expect(inv.code, `investigate failed: ${inv.err} | failed runs: ${JSON.stringify(failedRuns)}`).toBe(0); // create the case with a real basis
    await cli(["proxy", dir, "set", "proxy-socks5", "--host", "proxy.example.net", "--port", "1080", "--secret", "ops-proxy"]);
    const calls: SeenCall[] = [];
    const r = await cli(["run", dir, "TR-010", "url", "https://example.com", "--network", "--allow-host", "example.com", ...CASE_ARGS], {
      calls,
      vault: VAULT,
    });
    expect(r.code).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.route === "proxy-socks5" && c.pinnedIp === "8.8.4.4")).toBe(true);
  });
});
