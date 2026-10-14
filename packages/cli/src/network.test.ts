/**
 * `ir run --network` end to end, deterministically (P2-003). Everything is the production path except the two
 * edges that would touch the internet: the DNS answer and the socket. The transform (TR-010) runs in the real T-SBX
 * sandbox, its `ctx.http` crosses the IPC channel to the real `@ir/egress` gateway built by `createProductionEgress`
 * (opt-in, host list, address classification, content inventory, redirect policy, limits), and the result is
 * written to a real case: evidence (URL, status, fetchedAt, sha256), audit chain (every gateway decision), and
 * ledger findings linked to the evidence. The live variant (real DNS, real TLS) is live-network.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { manualClock } from "@ir/core";
import type { DnsResolver, EgressTransport } from "@ir/egress";
import { project } from "@ir/ledger/projections";
import { openCase } from "@ir/store";
import { probeIsolation } from "@ir/transform-sandbox";
import { main, type CliOptions } from "./ir.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const PUBLIC_IP = "93.184.216.34";
const ON = { IR_ENABLE_NETWORK: "1" };
const CASE_ARGS = ["--purpose", "security assessment of an authorised public web source", "--legal-basis", "security_incident"];

interface Fake {
  readonly resolver: DnsResolver;
  readonly transport: EgressTransport;
  readonly calls: Array<{ url: string; host: string; pinnedIp: string; headers?: Record<string, string> }>;
  /** robots.txt requests (answered by `robots`, default 404 = no file), kept apart from the page requests. */
  readonly robotsCalls: string[];
  readonly lookups: string[];
}

type Resp = Awaited<ReturnType<EgressTransport["fetch"]>>;

function fake(
  answers: Record<string, string[]>,
  respond: (n: number, url: string) => Resp | Promise<never>,
  robots: Resp = { status: 404, body: "" },
): Fake {
  const calls: Fake["calls"] = [];
  const robotsCalls: string[] = [];
  const lookups: string[] = [];
  return {
    calls,
    robotsCalls,
    lookups,
    resolver: {
      async resolve(host) {
        lookups.push(host);
        const a = answers[host];
        if (!a) throw new Error("NXDOMAIN");
        return a;
      },
    },
    transport: {
      async fetch(r) {
        if (new URL(r.url).pathname === "/robots.txt") {
          robotsCalls.push(r.url);
          return robots;
        }
        calls.push({ url: r.url, host: r.host, pinnedIp: r.pinnedIp, ...(r.headers ? { headers: r.headers } : {}) });
        return respond(calls.length, r.url);
      },
    },
  };
}

async function run(argv: string[], opts: CliOptions) {
  const lines: string[] = [];
  const errs: string[] = [];
  const code = await main(
    argv,
    (s) => lines.push(s),
    (s) => errs.push(s),
    {
      clock: manualClock("2026-10-14T09:00:00.000Z"),
      ...opts,
    },
  );
  return { code, out: lines.join("\n"), err: errs.join("\n") };
}

function tempDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `ir-net-${tag}-`));
  dirs.push(dir);
  return dir;
}

function readCase(dir: string) {
  const c = openCase(dir, { actor: "test" });
  try {
    const entries = c.entries();
    const evidence = entries.filter((e) => e.kind === "evidence.stored").map((e) => e.payload as Record<string, unknown>);
    const audit = c.auditTrail();
    const p = project(entries);
    const observations = entries
      .filter((e) => e.kind === "observation.added")
      .map((e) => e.payload as { claimId?: string; evidenceId: string; kind: string });
    return { info: c.info(), evidence, audit, p, observations };
  } finally {
    c.close();
  }
}

// Policy refusals happen before the sandbox starts, so they run on every host; the full path needs the sandbox.
describe("ir run --network: refusals before anything is sent (P2-003)", () => {
  const f = () => fake({ "source.example": [PUBLIC_IP] }, () => ({ status: 200, body: "ok" }));

  it("is off without IR_ENABLE_NETWORK=1, even with --network and a host list", async () => {
    const x = f();
    const r = await run(
      ["run", tempDir("off"), "TR-010", "url", "https://source.example/", "--network", "--allow-host", "source.example", ...CASE_ARGS],
      {
        network: { env: {}, resolver: x.resolver, transport: x.transport },
      },
    );
    expect(r.code).toBe(2);
    expect(r.err).toContain("IR_ENABLE_NETWORK=1");
    expect(x.lookups).toEqual([]);
    expect(x.calls).toEqual([]);
  });

  it("IR_OFFLINE=1 wins over IR_ENABLE_NETWORK=1", async () => {
    const x = f();
    const r = await run(
      ["run", tempDir("offline"), "TR-010", "url", "https://source.example/", "--network", "--allow-host", "source.example", ...CASE_ARGS],
      {
        network: { env: { IR_ENABLE_NETWORK: "1", IR_OFFLINE: "1" }, resolver: x.resolver, transport: x.transport },
      },
    );
    expect(r.code).toBe(2);
    expect(r.err).toContain("IR_OFFLINE=1");
    expect(x.calls).toEqual([]);
  });

  it("is never global: no --allow-host, or an IP / wildcard / port entry, is refused", async () => {
    for (const hosts of [[], ["93.184.216.34"], ["*.example"], ["source.example:443"], ["source.example/path"], ["localhost"]]) {
      const x = f();
      const args = hosts.flatMap((h) => ["--allow-host", h]);
      const r = await run(["run", tempDir("global"), "TR-010", "url", "https://source.example/", "--network", ...args, ...CASE_ARGS], {
        network: { env: ON, resolver: x.resolver, transport: x.transport },
      });
      expect(r.code, JSON.stringify(hosts)).toBe(2);
      expect(x.calls).toEqual([]);
    }
  });

  it("a simulation case (training_simulation) is refused for a real network run", async () => {
    const dir = tempDir("simcase");
    const x = f();
    // creates the sim case (exit 1: no sim rule matches, recorded as an error observation)
    expect((await run(["run", dir, "TR-010", "url", "https://source.example/"], {})).code).toBe(1);
    const r = await run(["run", dir, "TR-010", "url", "https://source.example/", "--network", "--allow-host", "source.example"], {
      network: { env: ON, resolver: x.resolver, transport: x.transport },
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("simulation case");
    expect(x.calls).toEqual([]);
  });

  it("a new case needs a stated purpose and a real legal basis", async () => {
    const x = f();
    const base = ["run", tempDir("purpose"), "TR-010", "url", "https://source.example/", "--network", "--allow-host", "source.example"];
    const opts = { network: { env: ON, resolver: x.resolver, transport: x.transport } };
    expect((await run(base, opts)).code).toBe(2);
    expect((await run([...base, "--purpose", "short", "--legal-basis", "security_incident"], opts)).code).toBe(2);
    expect((await run([...base, "--purpose", "a long enough purpose", "--legal-basis", "training_simulation"], opts)).code).toBe(2);
    expect((await run([...base, "--purpose", "a long enough purpose", "--legal-basis", "anything"], opts)).code).toBe(2);
    expect(x.calls).toEqual([]);
  });

  it("a natural-person subject type is refused (public data only until P2-013)", async () => {
    const x = f();
    const r = await run(
      ["run", tempDir("np"), "TR-010", "passport_sa", "A1234567", "--network", "--allow-host", "source.example", ...CASE_ARGS],
      {
        network: { env: ON, resolver: x.resolver, transport: x.transport },
      },
    );
    expect(r.code).toBe(2);
    expect(x.calls).toEqual([]);
  });

  it("a transform without a sandbox module is refused (network runs are isolated only)", async () => {
    const x = f();
    const r = await run(
      ["run", tempDir("nomod"), "TR-010", "url", "https://source.example/", "--network", "--allow-host", "source.example", ...CASE_ARGS],
      {
        network: { env: ON, resolver: x.resolver, transport: x.transport, isolatedModules: {} },
      },
    );
    expect(r.code).toBe(2);
    expect(r.err).toContain("isolated only");
    expect(x.calls).toEqual([]);
  });

  it("--network and --sim are exclusive", async () => {
    const r = await run(["run", tempDir("excl"), "TR-010", "url", "https://source.example/", "--network", "--sim", "x.json"], {});
    expect(r.code).toBe(2);
  });
});

const host = await probeIsolation();
const fullAvailable = host.full;

describe.skipIf(!fullAvailable)("ir run --network end to end: isolated transform -> gateway -> case (P2-003)", () => {
  it("fetches an authorised source, stores evidence (URL, status, fetchedAt) and links the findings to it", async () => {
    const dir = tempDir("ok");
    const x = fake({ "source.example": [PUBLIC_IP, "2606:2800:220:1:248:1893:25c8:1946"] }, () => ({
      status: 200,
      headers: { "content-type": "text/html", server: "nginx" },
      body: "<html>ok</html>",
    }));
    const r = await run(
      ["run", dir, "TR-010", "url", "https://source.example/", "--network", "--allow-host", "source.example", ...CASE_ARGS, "--json"],
      {
        network: { env: ON, resolver: x.resolver, transport: x.transport },
      },
    );
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const json = JSON.parse(r.out) as { network: unknown; requestCount: number; findings: Array<{ predicate: string }> };
    expect(json.network).toEqual({ mode: "real", allowedHosts: ["source.example"], isolated: true });
    expect(json.requestCount).toBe(1);
    expect(json.findings.map((f) => f.predicate).sort()).toEqual(["has_http_response", "has_technology"]);
    // the gateway pinned a classified address; the transport was called exactly once
    expect(x.calls).toEqual([{ url: "https://source.example/", host: "source.example", pinnedIp: PUBLIC_IP }]);

    const k = readCase(dir);
    expect(k.info.legalBasis).toBe("security_incident");
    expect(k.evidence).toHaveLength(1);
    const ev = k.evidence[0] as { id: string; fetchedAt: string; request: { url: string; status: number; method: string }; sha256: string };
    expect(ev.request).toMatchObject({ method: "GET", url: "https://source.example/", status: 200 });
    expect(ev.fetchedAt).toBe("2026-10-14T09:00:00.000Z");
    expect(ev.sha256).toMatch(/^[0-9a-f]{64}$/);
    // each finding is a claim on the subject node, and each claim's observation points at that evidence
    const node = k.p.graph.nodes.find((n) => n.canonicalKey.startsWith("url:"));
    expect(node?.attributes.map((a) => a.predicate).sort()).toEqual(["has_http_response", "has_technology"]);
    for (const a of node?.attributes ?? []) {
      const obs = k.observations.filter((o) => o.claimId === a.claimId);
      expect(obs.map((o) => [o.kind, o.evidenceId])).toEqual([["positive", ev.id]]);
    }
    // the gateway decision is in the case audit chain
    // the gateway decisions are in the case audit chain: robots.txt first (RFC 9309), then the page
    expect(x.robotsCalls).toEqual(["https://source.example/robots.txt"]);
    const allowed = k.audit.filter((a) => a.action === "egress.allowed");
    expect(allowed.map((a) => a.target)).toEqual(["source.example", "source.example"]);
    expect(k.audit.find((a) => a.action === "robots.policy")?.detail).toEqual({ basis: "no_file" });
  });

  it("an authorised host that resolves to a private address is refused before the transport, and the refusal is recorded", async () => {
    const dir = tempDir("private");
    const x = fake({ "source.example": [PUBLIC_IP, "10.0.0.5"] }, () => ({ status: 200, body: "never" }));
    const r = await run(
      ["run", dir, "TR-010", "url", "https://source.example/", "--network", "--allow-host", "source.example", ...CASE_ARGS],
      {
        network: { env: ON, resolver: x.resolver, transport: x.transport },
      },
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain("address_class");
    expect(x.calls).toEqual([]);
    const k = readCase(dir);
    expect(k.audit.some((a) => a.action === "egress.denied" && (a.detail as { reason?: string }).reason === "address_class")).toBe(true);
    expect(k.p.counts.observations).toBe(1); // the error observation (D3: failures are recorded, not dropped)
  });

  it("a host that is not on --allow-host is refused before DNS", async () => {
    const dir = tempDir("offlist");
    const x = fake({ "other.example": [PUBLIC_IP] }, () => ({ status: 200, body: "never" }));
    const r = await run(
      ["run", dir, "TR-010", "url", "https://other.example/", "--network", "--allow-host", "source.example", ...CASE_ARGS],
      {
        network: { env: ON, resolver: x.resolver, transport: x.transport },
      },
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain("host_not_allowed");
    expect(x.lookups).toEqual([]);
    expect(x.calls).toEqual([]);
  });

  it("a redirect to a host outside the list is refused after the first hop; nothing is sent to it", async () => {
    const dir = tempDir("redirect");
    const x = fake({ "source.example": [PUBLIC_IP], "evil.example": [PUBLIC_IP] }, () => ({
      status: 302,
      headers: { location: "https://evil.example/" },
    }));
    const r = await run(
      ["run", dir, "TR-010", "url", "https://source.example/", "--network", "--allow-host", "source.example", ...CASE_ARGS],
      {
        network: { env: ON, resolver: x.resolver, transport: x.transport },
      },
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain("host_not_allowed");
    expect(x.calls.map((c) => c.host)).toEqual(["source.example"]);
  });

  it("a redirect carrying undeclared data to another authorised host is refused (P2-032 on the production path)", async () => {
    const dir = tempDir("redircontent");
    const x = fake({ "source.example": [PUBLIC_IP], "cdn.example": [PUBLIC_IP] }, () => ({
      status: 302,
      headers: { location: "https://cdn.example/?who=alice%40example.org" },
    }));
    const r = await run(
      [
        "run",
        dir,
        "TR-010",
        "url",
        "https://source.example/",
        "--network",
        "--allow-host",
        "source.example",
        "--allow-host",
        "cdn.example",
        ...CASE_ARGS,
      ],
      { network: { env: ON, resolver: x.resolver, transport: x.transport } },
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain("undeclared_data");
    expect(x.calls.map((c) => c.host)).toEqual(["source.example"]);
  });

  it("undeclared data in the subject URL itself is refused; only the origin's robots.txt (no subject data) was requested", async () => {
    const dir = tempDir("undeclared");
    const x = fake({ "source.example": [PUBLIC_IP] }, () => ({ status: 200, body: "never" }));
    const r = await run(
      [
        "run",
        dir,
        "TR-010",
        "url",
        "https://source.example/u/alice@example.org",
        "--network",
        "--allow-host",
        "source.example",
        ...CASE_ARGS,
      ],
      { network: { env: ON, resolver: x.resolver, transport: x.transport } },
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain("undeclared_data");
    expect(x.robotsCalls).toEqual(["https://source.example/robots.txt"]);
    expect(x.calls).toEqual([]);
  });

  it("a response larger than the size limit is refused, not truncated", async () => {
    const dir = tempDir("size");
    const x = fake({ "source.example": [PUBLIC_IP] }, () => ({ status: 200, contentLength: 10_000, body: "x".repeat(10_000) }));
    const r = await run(
      ["run", dir, "TR-010", "url", "https://source.example/", "--network", "--allow-host", "source.example", ...CASE_ARGS],
      {
        network: { env: ON, resolver: x.resolver, transport: x.transport, limits: { maxSizeBytes: 1024 } },
      },
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain("size_limit");
    expect(readCase(dir).evidence.every((e) => (e as { request: { status?: number } }).request.status !== 200)).toBe(true);
  });

  it("a source that never answers is cut at the gateway deadline", async () => {
    const dir = tempDir("timeout");
    const x = fake({ "source.example": [PUBLIC_IP] }, () => new Promise<never>(() => {}));
    const r = await run(
      ["run", dir, "TR-010", "url", "https://source.example/", "--network", "--allow-host", "source.example", ...CASE_ARGS],
      {
        network: { env: ON, resolver: x.resolver, transport: x.transport, limits: { timeoutMs: 300, connectTimeoutMs: 300 } },
      },
    );
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/timeout/);
    expect(x.calls).toHaveLength(1);
  });

  it("robots.txt (RFC 9309): a disallowed page is refused before it is requested; the decision is audited", async () => {
    const dir = tempDir("robots-deny");
    const x = fake({ "source.example": [PUBLIC_IP] }, () => ({ status: 200, body: "never" }), {
      status: 200,
      body: "User-agent: *\nDisallow: /private\n",
    });
    const r = await run(
      ["run", dir, "TR-010", "url", "https://source.example/private/page", "--network", "--allow-host", "source.example", ...CASE_ARGS],
      {
        network: { env: ON, resolver: x.resolver, transport: x.transport },
      },
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain("robots.txt");
    expect(x.robotsCalls).toEqual(["https://source.example/robots.txt"]);
    expect(x.calls).toEqual([]);
    const k = readCase(dir);
    expect(k.audit.some((a) => a.action === "robots.disallowed" && a.target === "source.example")).toBe(true);
  });

  it("robots.txt: an allowed page is fetched; a group for our token overrides *", async () => {
    const dir = tempDir("robots-allow");
    const x = fake({ "source.example": [PUBLIC_IP] }, () => ({ status: 200, body: "ok" }), {
      status: 200,
      body: "User-agent: *\nDisallow: /\n\nUser-agent: InvestigationRoom\nDisallow: /admin\n",
    });
    const r = await run(
      ["run", dir, "TR-010", "url", "https://source.example/docs", "--network", "--allow-host", "source.example", ...CASE_ARGS],
      {
        network: { env: ON, resolver: x.resolver, transport: x.transport },
      },
    );
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(x.calls.map((c) => c.url)).toEqual(["https://source.example/docs"]);
    expect(readCase(dir).audit.find((a) => a.action === "robots.policy")?.detail).toEqual({ basis: "parsed" });
  });

  it("robots.txt: a 5xx answer means complete disallow (nothing fetched)", async () => {
    const dir = tempDir("robots-5xx");
    const x = fake({ "source.example": [PUBLIC_IP] }, () => ({ status: 200, body: "never" }), { status: 503, body: "" });
    const r = await run(
      ["run", dir, "TR-010", "url", "https://source.example/", "--network", "--allow-host", "source.example", ...CASE_ARGS],
      {
        network: { env: ON, resolver: x.resolver, transport: x.transport },
      },
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain("robots.txt");
    expect(x.calls).toEqual([]);
  });
});
