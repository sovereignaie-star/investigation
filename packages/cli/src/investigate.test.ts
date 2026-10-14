/**
 * P2-038 — `ir investigate`: registered connectors driven by entity type from one seed, through the real sandbox,
 * IPC and production gateway (synthetic DNS + transport at the edge, as in connectors.test.ts).
 *
 * The world: example.com resolves to 8.8.8.8 and names a.iana-servers.net as a name server (DNS and RDAP both say
 * so); crt.sh lists www/api.example.com; 8.8.8.8 is in 8.8.8.0/24 (RDAP) announced by AS15169 (Team Cymru).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { manualClock } from "@ir/core";
import type { DnsResolver, EgressLimits, EgressTransport } from "@ir/egress";
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

const WORLD: Readonly<Record<string, Resp>> = {
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

function edge(world: Readonly<Record<string, Resp>> = WORLD, serve?: (url: string, signal?: AbortSignal) => Promise<Resp>) {
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
      if (serve) return serve(r.url, r.signal);
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
    const cov = r.result?.coverage ?? [];
    // depth 0: the domain transforms; depth 1: the ipv4 transforms on 8.8.8.8 (found by TR-001).
    expect(cell(cov, "TR-001", "domain:example.com")[0]?.state).toBe("found");
    expect(cell(cov, "TR-002", "domain:example.com")[0]?.state).toBe("found");
    expect(cell(cov, "TR-004", "domain:example.com")[0]?.state).toBe("found");
    expect(cell(cov, "TR-003", "ipv4:8.8.8.8")[0]?.state).toBe("found");
    expect(cell(cov, "TR-006", "ipv4:8.8.8.8")[0]?.state).toBe("found");
    // depth 2 (AS15169 from TR-006) is past maxDepth: recorded as not_run with the reason, in the case audit too.
    const asn = cell(cov, "TR-003", "asn:AS15169");
    expect(asn).toHaveLength(1);
    expect(asn[0]).toMatchObject({ state: "not_run", depth: 2 });
    expect(asn[0].reason).toMatch(/depth 2 > maxDepth 1/);
    const k = readCase(dir);
    expect(k.audit.some((a) => a.action === "investigate.not_run" && a.target === "asn:AS15169")).toBe(true);
    expect(k.audit.some((a) => a.action === "investigate.completed")).toBe(true);
    // Types no registered transform accepts are listed, not silently dropped.
    expect(r.result?.unexpandable).toEqual(
      expect.arrayContaining(["hostname:a.iana-servers.net", "hostname:www.example.com", "cidr:8.8.8.0/24"]),
    );
    // Every request was on the operator's list; the list was never widened.
    for (const c of x.calls) expect(HOSTS).toContain(c.host);
    // Each (transform, identifier) ran once: 5 runs.
    expect(r.result?.runs).toBe(5);
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
    const notRun = (r.result?.coverage ?? []).filter((k) => k.state === "not_run");
    // TR-004 on the seed, and the two ipv4 transforms on 8.8.8.8 (queued from TR-001's finding before the stop).
    expect(notRun.map((k) => `${k.transformId} ${k.entityKey}`)).toEqual([
      "TR-004 domain:example.com",
      "TR-003 ipv4:8.8.8.8",
      "TR-006 ipv4:8.8.8.8",
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
    const k = cell(r.result?.coverage ?? [], "TR-001", "domain:example.com")[0];
    expect(k.state).toBe("failed");
    expect(k.reason).toMatch(/request budget exhausted/);
    expect(readCase(dir).entries.some((e) => e.kind === "claim.added")).toBe(false);
  });

  it("budget: bytes — checked before each run", async () => {
    const x = edge();
    const r = await investigate(tempDir(), ["--max-bytes", "100", "--transform", "TR-001", "--transform", "TR-004"], {
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
    });
    expect(r.code).toBe(1);
    expect(r.result?.stopReason).toBe("bytes");
    expect(cell(r.result?.coverage ?? [], "TR-004", "domain:example.com")[0]).toMatchObject({ state: "not_run", reason: "budget: bytes" });
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
    expect(cell(r.result?.coverage ?? [], "TR-004", "domain:example.com")[0]).toMatchObject({ state: "failed" });
    expect(cell(r.result?.coverage ?? [], "TR-004", "domain:example.com")[0].reason).toMatch(/time budget reached/);
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
    const cov = r.result?.coverage ?? [];
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
    const cov = r.result?.coverage ?? [];
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
    expect(cell(r.result?.coverage ?? [], "TR-004", "domain:example.com")[0]).toMatchObject({ state: "none", findings: 0, requests: 1 });
    const p = project(readCase(dir).entries);
    expect(p.coverage.cells.find((c) => c.transformId === "tr-004")).toMatchObject({ negative: 1, positive: 0, error: 0 });
  });
});
