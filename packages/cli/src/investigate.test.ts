/**
 * P2-038 — `ir investigate`: registered connectors driven by entity type from one seed, through the real sandbox,
 * IPC and production gateway (synthetic DNS + transport at the edge, as in connectors.test.ts).
 *
 * The world: example.com resolves to 8.8.8.8 and names a.iana-servers.net as a name server (DNS and RDAP both say
 * so); crt.sh lists www/api.example.com; 8.8.8.8 is in 8.8.8.0/24 (RDAP) announced by AS15169 (Team Cymru).
 * P2-039: host names are expanded by TR-001 — www.example.com resolves to 8.8.8.8 again (a second parent of the
 * same node, not a second run), the name servers resolve to their own addresses (depth 2), api.example.com to nothing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { manualClock } from "@ir/core";
import { EgressTransportError, type DnsResolver, type EgressLimits, type EgressTransport } from "@ir/egress";
import { project, projectionHash } from "@ir/ledger/projections";
import { openCase, verifyCase } from "@ir/store";
import { probeIsolation } from "@ir/transform-sandbox";
import * as F from "../../transforms/src/fixtures/public-sources.ts";
import { corroboration, type CoverageRecord, type InvestigationResult } from "./investigate.ts";
import { main, type CliOptions } from "./ir.ts";

const ON = { IR_ENABLE_NETWORK: "1" };
const CASE_ARGS = ["--purpose", "تحقيق في بنية تحتية عامة لحادث أمني مصرح به", "--legal-basis", "security_incident"];
const LIMITS: EgressLimits = { rateLimitBurst: 64 };
const HOSTS = ["dns.google", "data.iana.org", "rdap.verisign.com", "rdap.arin.net", "crt.sh"];
const DNS: Readonly<Record<string, string[]>> = {
  "dns.google": ["8.8.8.8"],
  "data.iana.org": ["192.0.47.59"],
  "rdap.verisign.com": ["72.13.58.10"],
  "rdap.arin.net": ["199.71.0.150"],
  "crt.sh": ["91.199.212.73"],
};

type Resp = Awaited<ReturnType<EgressTransport["fetch"]>>;
const json = (body: string, status = 200): Resp => ({ status, body, headers: { "content-type": "application/json" } });
const q = (name: string, type: number) => `https://dns.google/resolve?name=${name}&type=${type}`;

/** DoH answers for a host name (P2-039): an A record when given, every other queried type empty. */
const hostAnswers = (name: string, a?: string): Record<string, Resp> =>
  Object.fromEntries(
    [1, 28, 15, 2, 16, 5].map((t) => [q(name, t), json(F.doh(0, t === 1 && a ? [{ name: `${name}.`, type: 1, data: a }] : []))]),
  );

const WORLD: Readonly<Record<string, Resp>> = {
  ...hostAnswers("www.example.com", "8.8.8.8"),
  ...hostAnswers("api.example.com"),
  ...hostAnswers("a.iana-servers.net", "199.43.135.53"),
  ...hostAnswers("b.iana-servers.net", "199.43.133.53"),
  [q("example.com", 1)]: json(F.doh(0, [{ name: "example.com.", type: 1, data: "8.8.8.8" }])),
  [q("example.com", 28)]: json(F.doh(0)),
  [q("example.com", 15)]: json(F.doh(0)),
  [q("example.com", 2)]: json(F.doh(0, [{ name: "example.com.", type: 2, data: "a.iana-servers.net." }])),
  [q("example.com", 16)]: json(F.doh(0)),
  [q("example.com", 5)]: json(F.doh(0)),
  "https://data.iana.org/rdap/dns.json": json(F.IANA_DNS),
  "https://rdap.verisign.com/com/v1/domain/example.com": json(F.RDAP_DOMAIN_EXAMPLE),
  "https://crt.sh/?q=%25.example.com&output=json": json(F.CRT_EXAMPLE),
  "https://data.iana.org/rdap/ipv4.json": json(F.IANA_IPV4),
  "https://rdap.arin.net/registry/ip/8.8.8.8": json(F.RDAP_IP_8888),
  [q("8.8.8.8.origin.asn.cymru.com", 16)]: json(F.CYMRU_8888),
  "https://data.iana.org/rdap/asn.json": json(F.IANA_ASN),
  "https://rdap.arin.net/registry/autnum/15169": json(F.RDAP_AS15169),
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), "ir-inv-"));
  dirs.push(d);
  return d;
};

type EdgeReq = Parameters<EgressTransport["fetch"]>[0];
function edge(world: Readonly<Record<string, Resp>> = WORLD, serve?: (url: string, signal?: AbortSignal, req?: EdgeReq) => Promise<Resp>) {
  const calls: Array<{ url: string; host: string; pinnedIp: string }> = [];
  const resolver: DnsResolver = {
    async resolve(host) {
      const a = DNS[host];
      if (!a) throw new Error("NXDOMAIN");
      return a;
    },
  };
  const transport: EgressTransport = {
    async fetch(r) {
      calls.push({ url: r.url, host: r.host, pinnedIp: r.pinnedIp });
      if (serve) return serve(r.url, r.signal, r);
      return world[r.url] ?? { status: 404, body: "no route" };
    },
  };
  return { calls, resolver, transport };
}

async function investigate(dir: string, extra: string[], opts: CliOptions & { hosts?: readonly string[]; seed?: [string, string] } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const pacing: number[] = [];
  let t = 0;
  const [type, value] = opts.seed ?? ["domain", "example.com"];
  const code = await main(
    [
      "investigate",
      dir,
      type,
      value,
      "--network",
      ...(opts.hosts ?? HOSTS).flatMap((h) => ["--allow-host", h]),
      ...CASE_ARGS,
      "--json",
      ...extra,
    ],
    (s) => out.push(s),
    (s) => err.push(s),
    {
      clock: manualClock("2026-10-14T10:00:00.000Z"),
      now: () => t,
      sleep: async (ms) => {
        pacing.push(ms);
        t += ms;
      },
      ...opts,
    },
  );
  const result =
    out.length > 0 ? (JSON.parse(out.join("\n")) as InvestigationResult & { corroboration: ReturnType<typeof corroboration> }) : undefined;
  return { code, err: err.join("\n"), result, pacing };
}

const cell = (cov: readonly CoverageRecord[], transformId: string, entityKey: string) =>
  cov.filter((r) => r.transformId === transformId && r.entityKey === entityKey);
const stateOf = (cov: readonly CoverageRecord[], transformId: string, entityKey: string) => cell(cov, transformId, entityKey)[0]?.state;
const covOf = (r: { result?: { coverage: CoverageRecord[] } }): CoverageRecord[] => r.result?.coverage ?? [];

function readCase(dir: string) {
  const c = openCase(dir, { actor: "test" });
  try {
    return { entries: c.entries(), audit: c.auditTrail() as Array<{ action: string; target: string; detail: Record<string, unknown> }> };
  } finally {
    c.close();
  }
}

const host = await probeIsolation();

describe("P2-038 ir investigate: usage refusals before the network", () => {
  it("requires --network (an investigation runs only isolated, through the gateway)", async () => {
    const x = edge();
    const r = await main(
      ["investigate", tempDir(), "domain", "example.com", ...CASE_ARGS],
      () => {},
      () => {},
      {
        network: { env: ON, resolver: x.resolver, transport: x.transport },
      },
    );
    expect(r).toBe(2);
    expect(x.calls).toEqual([]);
  });

  it("an unregistered --transform is refused (no in-process fallback)", async () => {
    const x = edge();
    const r = await investigate(tempDir(), ["--transform", "TR-005"], {
      network: { env: ON, resolver: x.resolver, transport: x.transport },
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain('unknown transform "TR-005"');
    expect(x.calls).toEqual([]);
  });

  it("a seed type no selected transform accepts is refused", async () => {
    const x = edge();
    const r = await investigate(tempDir(), ["--transform", "TR-006"], {
      network: { env: ON, resolver: x.resolver, transport: x.transport },
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain('no selected transform accepts subject type "domain"');
    expect(x.calls).toEqual([]);
  });

  it("a budget flag that is not a non-negative integer is refused", async () => {
    const x = edge();
    const r = await investigate(tempDir(), ["--max-runs", "-1"], { network: { env: ON, resolver: x.resolver, transport: x.transport } });
    expect(r.code).toBe(2);
    expect(x.calls).toEqual([]);
  });
});

describe.skipIf(!host.full)("P2-038 ir investigate end to end (sandbox -> IPC -> one gateway -> case)", () => {
  it("selects transforms by entity type, expands to depth 1, records coverage for every (entity, transform)", async () => {
    const dir = tempDir();
    const x = edge();
    const r = await investigate(dir, ["--max-depth", "1", "--max-runs", "20", "--max-requests", "100"], {
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
    });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const cov = covOf(r);
    // depth 0: the domain transforms; depth 1: the ipv4 transforms on 8.8.8.8 (found by TR-001).
    expect(stateOf(cov, "TR-001", "domain:example.com")).toBe("found");
    expect(stateOf(cov, "TR-002", "domain:example.com")).toBe("found");
    expect(stateOf(cov, "TR-004", "domain:example.com")).toBe("found");
    expect(stateOf(cov, "TR-003", "ipv4:8.8.8.8")).toBe("found");
    expect(stateOf(cov, "TR-006", "ipv4:8.8.8.8")).toBe("found");
    // P2-039: the host names found at depth 0 are expanded by TR-001 at depth 1.
    for (const h of ["a.iana-servers.net", "b.iana-servers.net", "www.example.com"]) {
      expect(stateOf(cov, "TR-001", `hostname:${h}`), h).toBe("found");
    }
    expect(stateOf(cov, "TR-001", "hostname:api.example.com")).toBe("none");
    // depth 2 (AS15169 from TR-006) is past maxDepth: recorded as not_run with the reason, in the case audit too.
    const asn = cell(cov, "TR-003", "asn:AS15169");
    expect(asn).toHaveLength(1);
    expect(asn[0]).toMatchObject({ state: "not_run", depth: 2 });
    expect(asn[0].reason).toMatch(/depth 2 > maxDepth 1/);
    const k = readCase(dir);
    expect(k.audit.some((a) => a.action === "investigate.not_run" && a.target === "asn:AS15169")).toBe(true);
    expect(k.audit.some((a) => a.action === "investigate.completed")).toBe(true);
    // Types no registered transform accepts are listed, not silently dropped.
    expect(r.result?.unexpandable).toEqual(expect.arrayContaining(["cidr:8.8.8.0/24"]));
    expect((r.result?.unexpandable ?? []).filter((k) => k.startsWith("hostname:"))).toEqual([]);
    // Every request was on the operator's list; the list was never widened.
    for (const c of x.calls) expect(HOSTS).toContain(c.host);
    // Each (transform, identifier) ran once: 3 domain runs, 2 on 8.8.8.8, 4 TR-001 runs on host names.
    expect(r.result?.runs).toBe(9);
    // Consecutive runs are paced by one gateway token interval (rate 1/s).
    expect(r.pacing.filter((ms) => ms === 1000).length).toBeGreaterThanOrEqual(4);
    expect(verifyCase(dir).ok).toBe(true);
  });

  it("one canonical node per identifier, every edge from every source kept; repeats from one source are not independent", async () => {
    const dir = tempDir();
    const net = () => {
      const x = edge();
      return { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS };
    };
    const first = await investigate(dir, ["--max-depth", "0", "--transform", "TR-001", "--transform", "TR-002"], { network: net() });
    expect(first.code).toBe(0);
    // a.iana-servers.net: named by DNS (TR-001) and RDAP (TR-002) for the same parent — one node, two edges.
    const p = project(readCase(dir).entries);
    const ns = p.graph.nodes.filter((n) => n.canonicalKey === "hostname:a.iana-servers.net");
    expect(ns).toHaveLength(1);
    expect(p.graph.edges.filter((e) => e.target === ns[0].id && e.predicate === "has_name_server")).toHaveLength(2);
    const nsSupport = first.result?.corroboration.find((g) => g.object === "hostname:a.iana-servers.net");
    expect(nsSupport?.sources.map((s) => `${s.transformId}@${s.host}`).sort()).toEqual(["tr-001@dns.google", "tr-002@rdap.verisign.com"]);

    // A second investigation re-observes resolves_to 8.8.8.8 from the same source: two observations, ONE source.
    const second = await investigate(dir, ["--max-depth", "0", "--transform", "TR-001"], { network: net() });
    expect(second.code).toBe(0);
    const a = second.result?.corroboration.find((g) => g.predicate === "resolves_to" && g.object === "ipv4:8.8.8.8");
    expect(a?.observations).toBe(2);
    expect(a?.sources).toHaveLength(1);
    expect(a?.sources[0]).toMatchObject({ transformId: "tr-001", host: "dns.google", observations: 2 });
    const p2 = project(readCase(dir).entries);
    expect(p2.graph.nodes.filter((n) => n.canonicalKey === "domain:example.com")).toHaveLength(1);
    expect(p2.graph.nodes.filter((n) => n.canonicalKey === "ipv4:8.8.8.8")).toHaveLength(1);
    expect(p2.issues).toEqual([]);
    expect(projectionHash(project(readCase(dir).entries))).toBe(projectionHash(p2));
  });

  it("budget: runs — the investigation stops after maxRuns and records every remaining pair as not_run", async () => {
    const dir = tempDir();
    const x = edge();
    const r = await investigate(dir, ["--max-runs", "2"], {
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
    });
    expect(r.code).toBe(1);
    expect(r.result?.runs).toBe(2);
    expect(r.result?.stopReason).toBe("runs");
    const notRun = covOf(r).filter((k) => k.state === "not_run");
    // TR-004 on the seed, the two ipv4 transforms on 8.8.8.8 and TR-001 on the name servers (queued from the
    // findings of TR-001 and TR-002 before the stop).
    expect(notRun.map((k) => `${k.transformId} ${k.entityKey}`)).toEqual([
      "TR-004 domain:example.com",
      "TR-003 ipv4:8.8.8.8",
      "TR-006 ipv4:8.8.8.8",
      "TR-001 hostname:a.iana-servers.net",
      "TR-001 hostname:b.iana-servers.net",
    ]);
    for (const k of notRun) expect(k.reason).toBe("budget: runs");
  });

  it("budget: requests — enforced per request inside a run; the cut run is failed, never an empty success", async () => {
    const dir = tempDir();
    const x = edge();
    const r = await investigate(dir, ["--max-requests", "3", "--transform", "TR-001"], {
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
    });
    expect(r.code).toBe(1);
    expect(x.calls).toHaveLength(3);
    const k = cell(covOf(r), "TR-001", "domain:example.com")[0];
    expect(k.state).toBe("failed");
    expect(k.reason).toMatch(/request budget exhausted/);
    expect(readCase(dir).entries.some((e) => e.kind === "claim.added")).toBe(false);
  });

  it("budget: bytes — once exhausted, no further run and no further request is started", async () => {
    // TR-001's six DoH answers fit; crt.sh's answer (426 bytes) does not fit in the 100 bytes left.
    const x = edge();
    const max = String(tr001Bytes("example.com") + 100);
    const r = await investigate(tempDir(), ["--max-bytes", max, "--transform", "TR-001", "--transform", "TR-004", "--max-depth", "0"], {
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
    });
    expect(r.code).toBe(1);
    expect(r.result?.stopReason).toBe("bytes");
    expect(r.result?.bytes).toBeLessThanOrEqual(Number(max));
    expect(stateOf(covOf(r), "TR-001", "domain:example.com")).toBe("found");
    const crt = cell(covOf(r), "TR-004", "domain:example.com")[0];
    expect(crt).toMatchObject({ state: "failed" });
    expect(crt?.reason).toMatch(/byte_budget/);
  });

  it("budget: time — the run in progress at the deadline is cancelled and recorded as failed; the rest not_run", async () => {
    const x = edge(WORLD, (url, signal) =>
      url.includes("crt.sh")
        ? new Promise<never>((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))
        : Promise.resolve(WORLD[url] ?? { status: 404, body: "" }),
    );
    const r = await investigate(tempDir(), ["--max-time-ms", "1500", "--transform", "TR-004", "--transform", "TR-001"], {
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
    });
    expect(r.code).toBe(1);
    expect(r.result?.stopReason).toBe("time");
    // Registry order: TR-001 first (runs), then TR-004 (hangs, cut at the deadline).
    expect(cell(covOf(r), "TR-004", "domain:example.com")[0]).toMatchObject({ state: "failed" });
    expect(cell(covOf(r), "TR-004", "domain:example.com")[0].reason).toMatch(/time budget reached/);
  });

  it("cancellation stops the running run (failed: cancelled) and everything after it (not_run: cancelled)", async () => {
    const ac = new AbortController();
    const x = edge(WORLD, (url, signal) => {
      if (url.includes("data.iana.org/rdap/dns.json")) {
        setTimeout(() => ac.abort(), 20);
        return new Promise<never>((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      }
      return Promise.resolve(WORLD[url] ?? { status: 404, body: "" });
    });
    const dir = tempDir();
    const r = await investigate(dir, [], {
      signal: ac.signal,
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
    });
    expect(r.code).toBe(1);
    expect(r.result?.stopReason).toBe("cancelled");
    const cov = covOf(r);
    expect(cell(cov, "TR-002", "domain:example.com")[0]).toMatchObject({ state: "failed" });
    expect(cell(cov, "TR-004", "domain:example.com")[0]).toMatchObject({ state: "not_run", reason: "cancelled" });
    expect(x.calls.some((c) => c.host === "crt.sh")).toBe(false);
  });

  it("a source the operator did not approve fails that run only; the host list is never widened", async () => {
    const x = edge();
    const r = await investigate(tempDir(), ["--max-depth", "0"], {
      hosts: ["dns.google", "data.iana.org", "crt.sh"],
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
    });
    expect(r.code).toBe(1);
    const cov = covOf(r);
    expect(cell(cov, "TR-002", "domain:example.com")[0].state).toBe("failed");
    expect(cell(cov, "TR-002", "domain:example.com")[0].reason).toContain("host_not_allowed");
    expect(cell(cov, "TR-001", "domain:example.com")[0].state).toBe("found");
    expect(cell(cov, "TR-004", "domain:example.com")[0].state).toBe("found");
    expect(x.calls.map((c) => c.host)).not.toContain("rdap.verisign.com");
  });

  it("ran with nothing found is coverage `none` (negative observations), distinct from failed and not_run", async () => {
    const dir = tempDir();
    const world = { ...WORLD, "https://crt.sh/?q=%25.example.com&output=json": json("[]") };
    const x = edge(world);
    const r = await investigate(dir, ["--max-depth", "0", "--transform", "TR-004"], {
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
    });
    expect(r.code).toBe(0);
    expect(cell(covOf(r), "TR-004", "domain:example.com")[0]).toMatchObject({ state: "none", findings: 0, requests: 1 });
    const p = project(readCase(dir).entries);
    expect(p.coverage.cells.find((c) => c.transformId === "tr-004")).toMatchObject({ negative: 1, positive: 0, error: 0 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// P2-039 — one seed producing a host name, an IP address and a subdomain, end to end; host names into TR-001; the byte
// budget enforced while each response is received.
// ---------------------------------------------------------------------------------------------------------------------

const isolatedRuns = vi.hoisted(() => ({ modules: [] as string[] }));
vi.mock("../../transforms/src/isolated.ts", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../transforms/src/isolated.ts")>();
  return {
    ...m,
    runTransformIsolated: (mod: string, ...rest: Parameters<typeof m.runTransformIsolated> extends [string, ...infer R] ? R : never) => {
      isolatedRuns.modules.push(mod);
      return m.runTransformIsolated(mod, ...rest);
    },
  };
});

/** A transport that streams `body` through the gateway's meter in `chunk`-byte pieces, as the node transport does. */
async function streamed(req: EdgeReq | undefined, resp: Resp, chunk = 256, onChunk?: (n: number) => Promise<void>): Promise<Resp> {
  const bytes = Buffer.byteLength(resp.body ?? "");
  let sent = 0;
  while (sent < bytes) {
    const k = Math.min(chunk, bytes - sent);
    if (req?.maxBodyBytes !== undefined && sent + k > req.maxBodyBytes) throw new EgressTransportError("size_limit", "cap");
    if (req?.meter && !req.meter(k)) throw new EgressTransportError("byte_budget", "egress byte_budget: stopped while receiving");
    sent += k;
    if (onChunk) await onChunk(sent);
  }
  return resp;
}

/** Bytes TR-001 receives for one name in WORLD (its six DoH answers). */
const tr001Bytes = (name: string) => [1, 28, 15, 2, 16, 5].reduce((n, t) => n + Buffer.byteLength(WORLD[q(name, t)]?.body ?? ""), 0);

const evidenceUrls = (entries: ReturnType<typeof readCase>["entries"]) =>
  new Map(
    entries
      .filter((e) => e.kind === "evidence.stored")
      .map((e) => {
        const p = e.payload as { id: string; request: { url: string } };
        return [p.id, p.request.url];
      }),
  );

describe("P2-039 TR-001 accepts host names (registry input builder)", () => {
  it.skipIf(!host.full)("a valid host name is accepted, normalised and resolved by TR-001 through the isolated run", async () => {
    const ok = edge();
    const r = await investigate(tempDir(), ["--transform", "TR-001", "--max-depth", "0"], {
      seed: ["hostname", "WWW.Example.COM."],
      network: { env: ON, resolver: ok.resolver, transport: ok.transport, limits: LIMITS },
    });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.result?.seedKey).toBe("hostname:www.example.com");
    expect(stateOf(covOf(r), "TR-001", "hostname:www.example.com")).toBe("found");
    expect(ok.calls.every((c) => c.url.includes("name=www.example.com&"))).toBe(true);
  });

  it("invalid names and values that are not host names are refused before any request (no isolation needed)", async () => {
    for (const bad of ["bad_host.example.com", "-a.example.com", "a..example.com", "*.example.com", `${"a".repeat(64)}.example.com`]) {
      const x = edge();
      const b = await investigate(tempDir(), ["--transform", "TR-001"], {
        seed: ["hostname", bad],
        network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
      });
      // refused as a seed by the catalog (code 2), or by TR-001's input builder (coverage not_run, with the reason)
      const k = covOf(b).filter((c) => c.transformId === "TR-001");
      if (b.code !== 2) {
        expect(
          k.map((c) => c.state),
          bad,
        ).toEqual(["not_run"]);
        expect(k[0]?.reason, bad).toMatch(/input refused: .*not a valid host name/);
      }
      expect(x.calls, bad).toEqual([]);
    }
    for (const notAHost of ["8.8.8.8", "intranet", "https://example.com/", "user@example.com"]) {
      const x = edge();
      const b = await investigate(tempDir(), ["--transform", "TR-001"], {
        seed: ["hostname", notAHost],
        network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
      });
      // refused as a seed (code 2) or by the input builder (not_run); never run, never a request
      const ranStates = covOf(b).filter((c) => c.state !== "not_run");
      expect(b.code === 2 || covOf(b).some((c) => /input refused/.test(c.reason ?? "")), notAHost).toBe(true);
      expect(ranStates, notAHost).toEqual([]);
      expect(x.calls, notAHost).toEqual([]);
    }
  });
});

describe.skipIf(!host.full)("P2-039 ir investigate end to end: host name, IP and subdomain from one seed", () => {
  it("type-driven selection, isolation per run, evidence per finding, one node per entity, budgets, no host widening, verifyCase", async () => {
    isolatedRuns.modules.length = 0;
    const dir = tempDir();
    const x = edge();
    const r = await investigate(dir, ["--max-depth", "1", "--max-runs", "20", "--max-requests", "100"], {
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
    });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const cov = covOf(r);
    const ran = cov.filter((k) => k.state === "found" || k.state === "none" || k.state === "failed");

    // Selection by entity type: domain -> TR-001/002/004; ipv4 -> TR-003/006; hostname -> TR-001 only.
    const byType = (t: string) => [...new Set(ran.filter((k) => k.entityKey.startsWith(`${t}:`)).map((k) => k.transformId))].sort();
    expect(byType("domain")).toEqual(["TR-001", "TR-002", "TR-004"]);
    expect(byType("ipv4")).toEqual(["TR-003", "TR-006"]);
    expect(byType("hostname")).toEqual(["TR-001"]);
    // The seed produced a host name (name server), an IP address and a subdomain (certificate name).
    for (const k of ["hostname:a.iana-servers.net", "ipv4:8.8.8.8", "hostname:www.example.com"]) {
      expect(
        ran.some((c) => c.entityKey === k),
        k,
      ).toBe(true);
    }

    // Every run went through the sandbox (one isolated child per run, the registry module), IPC and the gateway:
    // the only transport is the gateway's, and each run's request count matches what reached it.
    expect(isolatedRuns.modules).toHaveLength(r.result?.runs ?? -1);
    for (const m of isolatedRuns.modules) expect(m).toMatch(/transforms\/src\/transforms\/tr-00[1-6]-[a-z-]+\.ts$/);
    expect(ran.reduce((n, k) => n + k.requests, 0)).toBe(x.calls.length);

    // found / none / not_run are distinct (failed is covered below and in the budget tests).
    expect(stateOf(cov, "TR-001", "hostname:api.example.com")).toBe("none");
    expect(cell(cov, "TR-003", "ipv4:199.43.135.53")[0]).toMatchObject({ state: "not_run", depth: 2 });

    // One canonical node per entity; 8.8.8.8 has two parents (example.com and www.example.com) and ran once.
    const k = readCase(dir);
    const p = project(k.entries);
    const ip = p.graph.nodes.filter((n) => n.canonicalKey === "ipv4:8.8.8.8");
    expect(ip).toHaveLength(1);
    const parents = p.graph.edges
      .filter((e) => e.target === ip[0].id && e.predicate === "resolves_to")
      .map((e) => p.graph.nodes.find((n) => n.id === e.source)?.canonicalKey)
      .sort();
    expect(parents).toEqual(["domain:example.com", "hostname:www.example.com"]);
    expect(cell(cov, "TR-003", "ipv4:8.8.8.8")).toHaveLength(1);
    expect(cell(cov, "TR-006", "ipv4:8.8.8.8")).toHaveLength(1);
    const www = p.graph.nodes.filter((n) => n.canonicalKey === "hostname:www.example.com");
    expect(www).toHaveLength(1);

    // Each edge cites the evidence of the request that produced it (the DoH query for its own subject).
    const urls = evidenceUrls(k.entries);
    for (const e of p.graph.edges.filter((g) => g.predicate === "resolves_to")) {
      const src = p.graph.nodes.find((n) => n.id === e.source)?.canonicalKey ?? "";
      const name = src.slice(src.indexOf(":") + 1);
      expect(e.evidenceIds.length, src).toBeGreaterThan(0);
      for (const id of e.evidenceIds) expect(urls.get(id), src).toBe(q(name, 1));
    }

    // Two observations of resolves_to 8.8.8.8 come from ONE source (dns.google via TR-001): not independent.
    const sup = r.result?.corroboration.filter((g) => g.predicate === "resolves_to" && g.object === "ipv4:8.8.8.8") ?? [];
    for (const g of sup) expect(g.sources).toHaveLength(1);

    // Discovered names never become network permissions: no request to any discovered host.
    for (const c of x.calls) expect(HOSTS).toContain(c.host);
    for (const h of ["a.iana-servers.net", "b.iana-servers.net", "www.example.com", "api.example.com"]) {
      expect(x.calls.some((c) => c.host === h)).toBe(false);
    }

    // TR-003 ran with sends [ip, asn] only: the bootstrap file names were not a reason to declare "domain".
    expect(stateOf(cov, "TR-003", "ipv4:8.8.8.8")).toBe("found");

    expect(verifyCase(dir).ok).toBe(true);
    expect(projectionHash(project(readCase(dir).entries))).toBe(projectionHash(p));
    expect(p.issues).toEqual([]);
  });

  it("depth and run budgets record not_run for every pair they stop, with the reason", async () => {
    const x = edge();
    const r = await investigate(tempDir(), ["--max-depth", "1", "--max-runs", "6", "--max-requests", "100"], {
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
    });
    expect(r.result?.runs).toBe(6);
    expect(r.result?.stopReason).toBe("runs");
    const notRun = covOf(r).filter((k) => k.state === "not_run");
    expect(notRun.length).toBeGreaterThan(0);
    for (const k of notRun) expect(k.reason).toMatch(/budget: runs|depth \d+ > maxDepth 1/);
    // every queued host name is accounted for (ran or not_run), none silently dropped
    for (const h of ["a.iana-servers.net", "b.iana-servers.net", "www.example.com", "api.example.com"]) {
      expect(cell(covOf(r), "TR-001", `hostname:${h}`), h).toHaveLength(1);
    }
  });

  it("bytes: a response larger than what is left stops WHILE streaming; failed with evidence, not an empty success; nothing after", async () => {
    const dir = tempDir();
    let crtChunks = 0;
    const x = edge(WORLD, (url, _signal, req) => {
      const resp = WORLD[url] ?? { status: 404, body: "" };
      return streamed(req, resp, 128, async () => {
        if (url.includes("crt.sh")) crtChunks++;
      });
    });
    const crtSize = Buffer.byteLength(WORLD["https://crt.sh/?q=%25.example.com&output=json"]?.body ?? "");
    const max = tr001Bytes("example.com") + 200; // TR-001 fits; crt.sh (426 bytes) is cut after 128 bytes
    const r = await investigate(
      dir,
      ["--max-bytes", String(max), "--transform", "TR-001", "--transform", "TR-004", "--transform", "TR-002"],
      {
        network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
      },
    );
    expect(r.code).toBe(1);
    expect(r.result?.stopReason).toBe("bytes");
    expect(r.result?.bytes).toBeLessThanOrEqual(max);
    // TR-001 consumed part of the budget; TR-004's response was cut mid-stream, before its whole body was read.
    const cov = covOf(r);
    expect(stateOf(cov, "TR-001", "domain:example.com")).toBe("found");
    const t4 = cell(cov, "TR-004", "domain:example.com")[0];
    expect(t4?.state).toBe("failed");
    expect(t4?.reason).toMatch(/byte_budget/);
    expect(crtChunks * 128).toBeLessThan(crtSize);
    // After exhaustion: TR-002 and every queued pair are not_run (bytes); no request after the cut one.
    expect(cell(cov, "TR-002", "domain:example.com")[0]).toMatchObject({ state: "not_run", reason: "budget: bytes" });
    const lastCall = x.calls[x.calls.length - 1];
    expect(lastCall?.host).toBe("crt.sh");
    // The failure is recorded with evidence (an error observation), never as a "none".
    const k = readCase(dir);
    const errs = k.entries.filter((e) => e.kind === "observation.added" && (e.payload as { kind: string }).kind === "error");
    expect(errs.length).toBeGreaterThan(0);
    expect(verifyCase(dir).ok).toBe(true);
  });

  it("bytes: several responses consume the budget gradually; the run that would pass it fails, later runs never start", async () => {
    const x = edge(WORLD, (url, _s, req) => streamed(req, WORLD[url] ?? { status: 404, body: "" }, 64));
    // TR-001 and TR-004 on example.com, then TR-001 on a.iana-servers.net, fit; TR-001 on www.example.com passes the
    // budget partway through its six responses; api.example.com is never started.
    const crt = Buffer.byteLength(WORLD["https://crt.sh/?q=%25.example.com&output=json"]?.body ?? "");
    const max = tr001Bytes("example.com") + crt + tr001Bytes("a.iana-servers.net") + 200;
    const r = await investigate(
      tempDir(),
      ["--max-bytes", String(max), "--transform", "TR-001", "--transform", "TR-004", "--max-depth", "1"],
      {
        network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
      },
    );
    const cov = covOf(r);
    expect(r.result?.stopReason, JSON.stringify({ max, bytes: r.result?.bytes, cov })).toBe("bytes");
    expect(r.result?.bytes).toBeLessThanOrEqual(max);
    expect(cov.filter((k) => k.state === "found").length).toBeGreaterThanOrEqual(2);
    expect(cov.filter((k) => k.state === "failed" && /byte_budget/.test(k.reason ?? "")).length).toBe(1);
    const failedAt = cov.findIndex((k) => k.state === "failed");
    expect(cov[failedAt]?.requests).toBeGreaterThan(1); // earlier responses of the cut run were received in full
    expect(cell(cov, "TR-001", "hostname:api.example.com")[0]).toMatchObject({ state: "not_run", reason: "budget: bytes" });
    for (const k of cov.slice(failedAt + 1)) expect(k).toMatchObject({ state: "not_run", reason: "budget: bytes" });
  });

  it("cancellation while a large response is being received: failed (cancelled), bytes counted, nothing after", async () => {
    const ac = new AbortController();
    const x = edge(WORLD, (url, signal, req) => {
      const resp = WORLD[url] ?? { status: 404, body: "" };
      if (!url.includes("crt.sh")) return streamed(req, resp);
      return streamed(req, { ...resp, body: "x".repeat(200_000) }, 1024, async (sent) => {
        if (sent === 4096) setTimeout(() => ac.abort(), 5);
        if (sent >= 4096) {
          await new Promise<void>((_, reject) => {
            if (signal?.aborted) reject(new Error("aborted"));
            signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        }
      });
    });
    const r = await investigate(tempDir(), ["--transform", "TR-001", "--transform", "TR-004", "--transform", "TR-002"], {
      signal: ac.signal,
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
    });
    expect(r.code).toBe(1);
    expect(r.result?.stopReason).toBe("cancelled");
    const cov = covOf(r);
    expect(stateOf(cov, "TR-004", "domain:example.com")).toBe("failed");
    expect(cell(cov, "TR-002", "domain:example.com")[0]).toMatchObject({ state: "not_run", reason: "cancelled" });
    expect(r.result?.bytes).toBeLessThan(200_000);
    expect(r.result?.bytes).toBeGreaterThanOrEqual(4096);
  });

  it("time budget reached while a large response is being received: failed, never an empty success", async () => {
    const x = edge(WORLD, (url, signal, req) => {
      const resp = WORLD[url] ?? { status: 404, body: "" };
      if (!url.includes("crt.sh")) return streamed(req, resp);
      return streamed(req, { ...resp, body: "x".repeat(100_000) }, 1024, async (sent) => {
        if (sent >= 2048) {
          await new Promise<void>((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
        }
      });
    });
    const r = await investigate(tempDir(), ["--max-time-ms", "1500", "--transform", "TR-004", "--transform", "TR-001"], {
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
    });
    expect(r.code).toBe(1);
    expect(r.result?.stopReason).toBe("time");
    const t4 = cell(covOf(r), "TR-004", "domain:example.com")[0];
    expect(t4?.state).toBe("failed");
    expect(t4?.reason).toMatch(/time budget reached/);
  });
});
