/**
 * P2-037 — `ir run --network` end to end for the public connector batch (TR-001, TR-002, TR-003, TR-004, TR-006,
 * TR-011), deterministically. Everything is the production path except the two edges that would touch the
 * internet — the DNS answer and the socket:
 *
 *   CLI registry -> subject/input check -> T-SBX sandbox (bwrap + seccomp) -> IPC -> createProductionEgress
 *   (opt-in, explicit host list, address classification of EVERY resolved address, pinned connection, content
 *   inventory, redirect policy, size/time/rate limits, cancellation) -> synthetic edge -> case (evidence per request,
 *   findings bound to their own evidence, entities/claims/edges, audit chain of every gateway decision).
 *
 * The TLS suite replaces only the socket edge with the real pinned node transport against a local TLS server: the
 * gateway's pinned address is checked, and the certificate is verified for the source's hostname (a certificate for
 * another name fails the run).
 *
 * No live network: the live variant stays in live-network.test.ts (TR-010 only, opt-in).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { canonicalKey, manualClock } from "@ir/core";
import { createNodeTransport, type DnsResolver, type EgressLimits, type EgressTransport } from "@ir/egress";
import { project, projectionHash } from "@ir/ledger/projections";
import { openCase, verifyCase } from "@ir/store";
import { probeIsolation } from "@ir/transform-sandbox";
import * as F from "../../transforms/src/fixtures/public-sources.ts";
import { main, type CliOptions } from "./ir.ts";
import { registered } from "./registry.ts";

const ON = { IR_ENABLE_NETWORK: "1" };
const CASE_ARGS = ["--purpose", "تحقيق في بنية تحتية عامة لحادث أمني مصرح به", "--legal-basis", "security_incident"];
/** Burst high enough that the gateway's per-host budget does not interfere where it is not under test. */
const LIMITS: EgressLimits = { rateLimitBurst: 32 };

/** Synthetic public DNS: every source host resolves to a distinct public address. */
const DNS: Readonly<Record<string, string[]>> = {
  "dns.google": ["8.8.8.8", "2001:4860:4860::8888"],
  "data.iana.org": ["192.0.47.59"],
  "rdap.verisign.com": ["72.13.58.10"],
  "rdap.arin.net": ["199.71.0.150"],
  "crt.sh": ["91.199.212.73"],
  "web.archive.org": ["207.241.237.3"],
};

type Resp = Awaited<ReturnType<EgressTransport["fetch"]>>;
type Routes = Readonly<Record<string, Resp>>;
const json = (body: string, status = 200): Resp => ({ status, body, headers: { "content-type": "application/json" } });

interface Spec {
  readonly id: string;
  readonly subject: readonly [string, string];
  /** A value the transform must refuse before any lookup or request. */
  readonly bad: readonly [string, string];
  /** The explicit host list the operator approves for this transform. */
  readonly hosts: readonly string[];
  readonly routes: Routes;
  /** Answers that carry no finding (a genuine negative). */
  readonly negative: Routes;
  /** The request that a source failure (503) is injected into. */
  readonly failUrl: string;
  /** Identifier findings expected as graph edges: predicate -> canonical keys of the objects. */
  readonly edges: Readonly<Record<string, readonly string[]>>;
  /** Literal attributes expected on the subject node: predicate -> values. */
  readonly attributes?: Readonly<Record<string, readonly string[]>>;
  /** Which request URL each predicate's evidence must be (a substring of the evidence URL). */
  readonly boundTo: Readonly<Record<string, string>>;
  /** Strings that must never reach the case (e.g. natural-person RDAP data). */
  readonly never?: readonly string[];
}

const rpsOf = (id: string): number => {
  const e = registered(id);
  if (!e) throw new Error(id);
  return e.transform.manifest.limits.rps;
};
const doh = (name: string, type: number) => `https://dns.google/resolve?name=${name}&type=${type}`;
const CDX = (u: string) =>
  `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(u)}&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&limit=100`;
const DNS_TYPES = [1, 28, 15, 2, 16, 5];

const SPECS: readonly Spec[] = [
  {
    id: "TR-001",
    subject: ["domain", "example.com"],
    bad: ["domain", "exa mple..com"],
    hosts: ["dns.google"],
    routes: Object.fromEntries(DNS_TYPES.map((t) => [doh("example.com", t), json(F.DNS_EXAMPLE[t])])),
    negative: Object.fromEntries(DNS_TYPES.map((t) => [doh("example.com", t), json(F.DNS_NXDOMAIN)])),
    failUrl: doh("example.com", 15),
    edges: {
      resolves_to: ["ipv4:93.184.216.34", "ipv6:2606:2800:220:1:248:1893:25c8:1946"],
      has_mail_server: ["mx_record:10 mail.example.com", "mx_record:20 mx2.example.net"],
      has_name_server: ["hostname:a.iana-servers.net", "hostname:b.iana-servers.net"],
      has_txt_record: ['txt_record:"v=spf1 -all"', 'txt_record:"google-site-verification=abc123"'],
    },
    boundTo: { has_mail_server: "type=15", has_name_server: "type=2", has_txt_record: "type=16" },
  },
  {
    id: "TR-002",
    subject: ["domain", "example.com"],
    bad: ["domain", "-bad-.com"],
    hosts: ["data.iana.org", "rdap.verisign.com"],
    routes: {
      "https://data.iana.org/rdap/dns.json": json(F.IANA_DNS),
      "https://rdap.verisign.com/com/v1/domain/example.com": json(F.RDAP_DOMAIN_EXAMPLE),
    },
    negative: {
      "https://data.iana.org/rdap/dns.json": json(F.IANA_DNS),
      "https://rdap.verisign.com/com/v1/domain/example.com": json('{"errorCode":404}', 404),
    },
    failUrl: "https://rdap.verisign.com/com/v1/domain/example.com",
    edges: { has_name_server: ["hostname:a.iana-servers.net", "hostname:b.iana-servers.net"] },
    attributes: {
      registered_with: ["RESERVED-Internet Assigned Numbers Authority"],
      registered_on: ["1995-08-14T04:00:00Z"],
      expires_on: ["2027-08-13T04:00:00Z"],
    },
    boundTo: { has_name_server: "rdap.verisign.com", registered_with: "rdap.verisign.com" },
    never: ["Jane Doe", "Abuse Contact"],
  },
  {
    id: "TR-003",
    subject: ["ipv4", "8.8.8.8"],
    bad: ["ipv4", "300.1.2.3"],
    hosts: ["data.iana.org", "rdap.arin.net"],
    routes: {
      "https://data.iana.org/rdap/ipv4.json": json(F.IANA_IPV4),
      "https://rdap.arin.net/registry/ip/8.8.8.8": json(F.RDAP_IP_8888),
    },
    negative: {
      "https://data.iana.org/rdap/ipv4.json": json(F.IANA_IPV4),
      "https://rdap.arin.net/registry/ip/8.8.8.8": json("{}", 404),
    },
    failUrl: "https://rdap.arin.net/registry/ip/8.8.8.8",
    edges: { in_network: ["cidr:8.8.8.0/24"] },
    attributes: { network_named: ["GOGL"], owned_by: ["Google LLC"] },
    boundTo: { in_network: "rdap.arin.net", owned_by: "rdap.arin.net" },
  },
  {
    id: "TR-004",
    subject: ["domain", "example.com"],
    bad: ["domain", "bad_domain"],
    hosts: ["crt.sh"],
    routes: { "https://crt.sh/?q=%25.example.com&output=json": json(F.CRT_EXAMPLE) },
    negative: { "https://crt.sh/?q=%25.example.com&output=json": json("[]") },
    failUrl: "https://crt.sh/?q=%25.example.com&output=json",
    edges: { has_subdomain: ["hostname:www.example.com", "hostname:api.example.com"] },
    boundTo: { has_subdomain: "crt.sh" },
    never: ["evilexample.com", "ssl_cert_hash", "03ab5c1f0e2d"],
  },
  {
    id: "TR-006",
    subject: ["ipv4", "8.8.8.8"],
    bad: ["ipv4", "8.8.8"],
    hosts: ["dns.google"],
    routes: { [doh("8.8.8.8.origin.asn.cymru.com", 16)]: json(F.CYMRU_8888) },
    negative: { [doh("8.8.8.8.origin.asn.cymru.com", 16)]: json(F.DNS_NXDOMAIN) },
    failUrl: doh("8.8.8.8.origin.asn.cymru.com", 16),
    edges: { has_asn: ["asn:AS15169"], in_prefix: ["bgp_prefix:8.8.8.0/24"] },
    boundTo: { has_asn: "origin.asn.cymru.com", in_prefix: "origin.asn.cymru.com" },
  },
  {
    id: "TR-011",
    subject: ["url", "https://example.com/"],
    bad: ["url", "ftp://example.com/"],
    hosts: ["web.archive.org"],
    routes: { [CDX("https://example.com/")]: json(F.CDX_EXAMPLE) },
    negative: { [CDX("https://example.com/")]: json("[]") },
    failUrl: CDX("https://example.com/"),
    edges: {
      has_archive_snapshot: [
        "url:https://web.archive.org/web/20200101000000/https://example.com/",
        "url:https://web.archive.org/web/20210615123456/https://example.com/",
      ],
    },
    boundTo: { has_archive_snapshot: "cdx/search" },
  },
];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(tag: string): string {
  const d = mkdtempSync(path.join(tmpdir(), `ir-conn-${tag}-`));
  dirs.push(d);
  return d;
}

interface Edge {
  readonly resolver: DnsResolver;
  readonly transport: EgressTransport;
  readonly calls: Array<{ url: string; host: string; pinnedIp: string }>;
  readonly lookups: string[];
}

/** The synthetic network edge: DNS answers and a transport that serves `routes` (anything else is a 404). */
function edge(
  routes: Routes,
  dns: Readonly<Record<string, string[]>> = DNS,
  serve?: (url: string, signal?: AbortSignal) => Promise<Resp>,
): Edge {
  const calls: Edge["calls"] = [];
  const lookups: string[] = [];
  return {
    calls,
    lookups,
    resolver: {
      async resolve(host) {
        lookups.push(host);
        const a = dns[host];
        if (!a) throw new Error("NXDOMAIN");
        return a;
      },
    },
    transport: {
      async fetch(r) {
        calls.push({ url: r.url, host: r.host, pinnedIp: r.pinnedIp });
        if (serve) return serve(r.url, r.signal);
        return routes[r.url] ?? { status: 404, body: "no route" };
      },
    },
  };
}

async function run(argv: string[], opts: CliOptions) {
  const out: string[] = [];
  const err: string[] = [];
  // A virtual clock for the transform rate limiter: a wait advances it instead of passing real time (the gateway's
  // own per-host budget keeps real time; LIMITS raises its burst where it is not under test).
  let t = 0;
  const code = await main(
    argv,
    (s) => out.push(s),
    (s) => err.push(s),
    {
      clock: manualClock("2026-10-14T09:00:00.000Z"),
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      ...opts,
    },
  );
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const argsFor = (s: Spec, dir: string, hosts: readonly string[] = s.hosts, subject: readonly [string, string] = s.subject) => [
  "run",
  dir,
  s.id,
  subject[0],
  subject[1],
  "--network",
  ...hosts.flatMap((h) => ["--allow-host", h]),
  ...CASE_ARGS,
  "--json",
];

interface CaseView {
  entries: ReturnType<ReturnType<typeof openCase>["entries"]>;
  evidence: Map<
    string,
    {
      id: string;
      fetchedAt: string;
      sha256: string;
      transformId: string;
      version: string;
      request: { url: string; method: string; status?: number };
    }
  >;
  observations: Array<{ claimId?: string; entityId?: string; evidenceId: string; kind: string; note?: string }>;
  audit: Array<{ action: string; target: string; detail: unknown }>;
  p: ReturnType<typeof project>;
  raw: string;
}

function readCase(dir: string): CaseView {
  const c = openCase(dir, { actor: "test" });
  try {
    const entries = c.entries();
    const evidence = new Map(
      entries
        .filter((e) => e.kind === "evidence.stored")
        .map((e) => {
          const p = e.payload as CaseView["evidence"] extends Map<string, infer V> ? V : never;
          return [p.id, p];
        }),
    );
    const observations = entries.filter((e) => e.kind === "observation.added").map((e) => e.payload as CaseView["observations"][number]);
    return {
      entries,
      evidence,
      observations,
      audit: c.auditTrail() as CaseView["audit"],
      p: project(entries),
      raw: JSON.stringify(entries),
    };
  } finally {
    c.close();
  }
}

const host = await probeIsolation();

describe("P2-037 connectors: input checks before the sandbox or the network (every host)", () => {
  for (const s of SPECS) {
    it(`${s.id}: an invalid ${s.bad[0]} is refused before any lookup, request or case write`, async () => {
      const x = edge(s.routes);
      const dir = tempDir("bad");
      const r = await run(argsFor(s, dir, s.hosts, s.bad), {
        network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
      });
      expect(r.code).toBe(2);
      expect(x.lookups).toEqual([]);
      expect(x.calls).toEqual([]);
    });

    it(`${s.id}: a subject type the transform does not declare is refused before the network`, async () => {
      const x = edge(s.routes);
      const wrong: readonly [string, string] = s.subject[0] === "domain" ? ["ipv4", "8.8.8.8"] : ["domain", "example.com"];
      const r = await run(argsFor(s, tempDir("type"), s.hosts, wrong), {
        network: { env: ON, resolver: x.resolver, transport: x.transport },
      });
      expect(r.code).toBe(2);
      expect(r.err).toContain(`${s.id} does not accept subject type "${wrong[0]}"`);
      expect(x.calls).toEqual([]);
    });
  }

  it("an unregistered transform id never runs (no in-process fallback)", async () => {
    const x = edge({});
    const r = await run(["run", tempDir("unk"), "TR-005", "ipv4", "8.8.8.8", "--network", "--allow-host", "stat.ripe.net", ...CASE_ARGS], {
      network: { env: ON, resolver: x.resolver, transport: x.transport },
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain('unknown transform "TR-005"');
    expect(x.calls).toEqual([]);
  });
});

describe.skipIf(!host.full)("P2-037 connectors end to end: sandbox -> IPC -> gateway -> case", () => {
  for (const s of SPECS) {
    describe(s.id, () => {
      it("runs isolated; evidence per request; each finding bound to its own request; entities, claims and edges correct", async () => {
        const x = edge(s.routes);
        const dir = tempDir("ok");
        const r = await run(argsFor(s, dir), { network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS } });
        expect(r.err).toBe("");
        expect(r.code).toBe(0);
        const out = JSON.parse(r.out) as { network: unknown; requests: Array<{ requestId: number; evidenceId: string; url: string }> };
        expect(out.network).toEqual({ mode: "real", allowedHosts: [...s.hosts], isolated: true });

        // Every request went to an approved host, pinned to an address the synthetic DNS returned for that host.
        expect(x.calls.length).toBe(Object.keys(s.routes).length);
        for (const call of x.calls) {
          expect(s.hosts).toContain(call.host);
          expect(DNS[call.host]).toContain(call.pinnedIp);
          expect(Object.keys(s.routes)).toContain(call.url);
        }

        const k = readCase(dir);
        // One evidence record per request: URL, status, fetch time, content hash, transform id and version.
        expect(k.evidence.size).toBe(x.calls.length);
        for (const ev of k.evidence.values()) {
          expect(ev.request.status).toBe(200);
          expect(ev.fetchedAt).toBe("2026-10-14T09:00:00.000Z");
          expect(ev.sha256).toMatch(/^[0-9a-f]{64}$/);
          expect(ev.transformId).toBe(s.id.toLowerCase());
          expect(ev.version).toMatch(/^1\.1\.0$/);
        }
        expect(out.requests.map((q) => q.url).sort()).toEqual(Object.keys(s.routes).sort());

        // Every gateway decision is in the audit chain: one allowed decision per request, on an approved host.
        const allowed = k.audit.filter((a) => a.action === "egress.allowed");
        expect(allowed).toHaveLength(x.calls.length);
        for (const a of allowed) expect(s.hosts).toContain(a.target);

        // The graph: one canonical node per identifier, an edge from the subject per expected identifier finding.
        const subjectKey = canonicalKey(s.subject[0], s.subject[1]);
        const subject = k.p.graph.nodes.find((n) => n.canonicalKey === subjectKey);
        expect(subject).toBeDefined();
        for (const [predicate, keys] of Object.entries(s.edges)) {
          const targets = k.p.graph.edges
            .filter((e) => e.source === subject?.id && e.predicate === predicate)
            .map((e) => k.p.graph.nodes.find((n) => n.id === e.target)?.canonicalKey);
          expect(targets.sort(), predicate).toEqual([...keys].sort());
        }
        for (const [predicate, vals] of Object.entries(s.attributes ?? {})) {
          const got = (subject?.attributes ?? []).filter((a) => a.predicate === predicate).map((a) => String(a.value));
          expect(got.sort(), predicate).toEqual([...vals].sort());
        }
        // Each claim's positive observation cites the evidence of the request that produced it.
        const claims = k.entries.filter((e) => e.kind === "claim.added").map((e) => e.payload as { id: string; predicate: string });
        expect(claims.length).toBeGreaterThan(0);
        for (const claim of claims) {
          const obs = k.observations.filter((o) => o.claimId === claim.id);
          expect(obs.map((o) => o.kind)).toEqual(["positive"]);
          const want = s.boundTo[claim.predicate];
          if (want) expect(k.evidence.get(obs[0].evidenceId)?.request.url, claim.predicate).toContain(want);
        }
        for (const banned of s.never ?? []) expect(k.raw).not.toContain(banned);
        expect(k.p.issues).toEqual([]);

        // The chain verifies and the graph rebuilds from it.
        const hash = projectionHash(k.p);
        expect(verifyCase(dir).ok).toBe(true);
        expect(projectionHash(readCase(dir).p)).toBe(hash);
      });

      it("a genuine negative is recorded per response checked — no claim, not a failure", async () => {
        const x = edge(s.negative);
        const dir = tempDir("neg");
        const r = await run(argsFor(s, dir), { network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS } });
        expect(r.err).toBe("");
        expect(r.code).toBe(0);
        const k = readCase(dir);
        expect(k.entries.some((e) => e.kind === "claim.added")).toBe(false);
        const negatives = k.observations.filter((o) => o.kind === "negative");
        expect(negatives).toHaveLength(x.calls.length);
        expect(new Set(negatives.map((o) => o.evidenceId)).size).toBe(x.calls.length);
      });

      it("a source failure (HTTP 503) is a recorded error citing the failed response, never an empty success", async () => {
        const routes = { ...s.routes, [s.failUrl]: json("busy", 503) };
        const x = edge(routes);
        const dir = tempDir("fail");
        const r = await run(argsFor(s, dir), { network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS } });
        expect(r.code).toBe(1);
        expect(r.err).toMatch(/HTTP 503/);
        const k = readCase(dir);
        expect(k.entries.some((e) => e.kind === "claim.added")).toBe(false);
        const errors = k.observations.filter((o) => o.kind === "error");
        expect(errors).toHaveLength(1);
        // The validation/transform failure has no failed transport request: it cites the run record, which lists
        // every response received — including the 503 one.
        const cited = k.evidence.get(errors[0].evidenceId);
        expect(cited?.request.url).toBe("local://ir-run");
        expect(k.observations.some((o) => o.kind === "negative")).toBe(false);
      });

      it("a required host missing from --allow-host is refused before DNS or connection, with a clear message and audit", async () => {
        const missing = s.hosts[s.hosts.length - 1];
        const x = edge(s.routes);
        const dir = tempDir("offlist");
        const r = await run(argsFor(s, dir, s.hosts.slice(0, -1).length > 0 ? s.hosts.slice(0, -1) : ["example.org"]), {
          network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
        });
        expect(r.code).toBe(1);
        expect(r.err).toContain("host_not_allowed");
        expect(r.err).toContain(`refused before connecting: ${missing} not on --allow-host`);
        expect(x.lookups).not.toContain(missing);
        expect(x.calls.map((c) => c.host)).not.toContain(missing);
        const k = readCase(dir);
        expect(k.audit.some((a) => a.action === "egress.denied" && a.target === missing)).toBe(true);
        expect(k.observations.filter((o) => o.kind === "error")).toHaveLength(1);
        expect(k.entries.some((e) => e.kind === "claim.added")).toBe(false);
      });

      it("every resolved address is classified: an approved host answering with a private address is refused", async () => {
        const target = s.hosts[s.hosts.length - 1];
        const x = edge(s.routes, { ...DNS, [target]: [...(DNS[target] ?? []), "10.1.2.3"] });
        const dir = tempDir("private");
        const r = await run(argsFor(s, dir), { network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS } });
        expect(r.code).toBe(1);
        expect(r.err).toContain("address_class");
        expect(x.calls.map((c) => c.host)).not.toContain(target);
        expect(
          readCase(dir).audit.some((a) => a.action === "egress.denied" && (a.detail as { reason?: string }).reason === "address_class"),
        ).toBe(true);
      });

      it("a redirect off the host list is refused; nothing is sent to it", async () => {
        const routes = { ...s.routes, [s.failUrl]: { status: 302, headers: { location: "https://evil.example.net/x" } } };
        const x = edge(routes, { ...DNS, "evil.example.net": ["93.184.216.34"] });
        const r = await run(argsFor(s, tempDir("redir")), {
          network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
        });
        expect(r.code).toBe(1);
        expect(r.err).toContain("host_not_allowed");
        expect(x.calls.map((c) => c.host)).not.toContain("evil.example.net");
      });

      it("a redirect to another approved host that carries undeclared data (an e-mail address) is refused", async () => {
        // The operator approved a second host; the source redirects there with data the transform never declared.
        const routes = {
          ...s.routes,
          [s.failUrl]: { status: 302, headers: { location: "https://mirror.example.net/x?who=alice%40example.org" } },
        };
        const x = edge(routes, { ...DNS, "mirror.example.net": ["93.184.216.34"] });
        const r = await run(argsFor(s, tempDir("undeclared"), [...s.hosts, "mirror.example.net"]), {
          network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
        });
        expect(r.code).toBe(1);
        expect(r.err).toContain("undeclared_data");
        expect(x.calls.map((c) => c.host)).not.toContain("mirror.example.net");
      });

      it("a same-host redirect carrying a natural-person identifier (a US SSN) is refused", async () => {
        const self = new URL(s.failUrl).host;
        const routes = { ...s.routes, [s.failUrl]: { status: 302, headers: { location: `https://${self}/x?ssn=123-45-6789` } } };
        const x = edge(routes);
        const r = await run(argsFor(s, tempDir("np")), {
          network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
        });
        expect(r.code).toBe(1);
        expect(r.err).toContain("natural_person");
        expect(x.calls.some((c) => c.url.includes("123-45-6789"))).toBe(false);
      });

      it("size limit: a response over the gateway cap is refused, not truncated, and recorded as a failure", async () => {
        const big = { ...s.routes, [s.failUrl]: json(JSON.stringify({ pad: "x".repeat(4096) })) };
        const x = edge(big);
        const dir = tempDir("size");
        const r = await run(argsFor(s, dir), {
          network: { env: ON, resolver: x.resolver, transport: x.transport, limits: { ...LIMITS, maxSizeBytes: 1024 } },
        });
        expect(r.code).toBe(1);
        expect(r.err).toMatch(/size/);
        const k = readCase(dir);
        expect(k.entries.some((e) => e.kind === "claim.added")).toBe(false);
        expect(k.observations.filter((o) => o.kind === "error")).toHaveLength(1);
      });

      it("time limit: a source that never answers is cut at the gateway deadline and recorded as a failure", async () => {
        const x = edge(s.routes, DNS, (url, signal) =>
          url === s.failUrl
            ? new Promise<never>((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))
            : Promise.resolve(s.routes[url] ?? { status: 404, body: "" }),
        );
        const dir = tempDir("timeout");
        const r = await run(argsFor(s, dir), {
          network: { env: ON, resolver: x.resolver, transport: x.transport, limits: { ...LIMITS, timeoutMs: 200, connectTimeoutMs: 100 } },
        });
        expect(r.code).toBe(1);
        expect(r.err).toMatch(/timeout|time/i);
        expect(readCase(dir).observations.filter((o) => o.kind === "error")).toHaveLength(1);
      });

      it("cancellation: aborting the run stops the pending request and records the cancellation", async () => {
        const ac = new AbortController();
        let aborted = false;
        const x = edge(s.routes, DNS, (url, signal) =>
          url === s.failUrl
            ? new Promise<never>((_, reject) => {
                setTimeout(() => ac.abort(), 20);
                signal?.addEventListener(
                  "abort",
                  () => {
                    aborted = true;
                    reject(new Error("aborted"));
                  },
                  { once: true },
                );
              })
            : Promise.resolve(s.routes[url] ?? { status: 404, body: "" }),
        );
        const dir = tempDir("cancel");
        const r = await run(argsFor(s, dir), {
          signal: ac.signal,
          network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
        });
        expect(r.code).toBe(1);
        expect(aborted).toBe(true);
        const k = readCase(dir);
        expect(k.entries.some((e) => e.kind === "claim.added")).toBe(false);
        expect(k.observations.filter((o) => o.kind === "error")).toHaveLength(1);
      });

      it("rate: the transform's declared rate is enforced between its requests", async () => {
        const waits: number[] = [];
        let clock = 0;
        const x = edge(s.routes);
        const r = await run(argsFor(s, tempDir("rate")), {
          now: () => clock,
          sleep: async (ms) => {
            waits.push(ms);
            clock += ms;
          },
          network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
        });
        expect(r.code).toBe(0);
        // The limiter is a token bucket holding `rps` tokens: n requests in one run wait at least n - rps times, and
        // the virtual time they span is at least (n - rps) / rps seconds.
        const rps = rpsOf(s.id);
        const n = x.calls.length;
        expect(waits.length).toBeGreaterThanOrEqual(Math.max(0, n - rps));
        expect(clock).toBeGreaterThanOrEqual((Math.max(0, n - rps) / rps) * 1000 - 1);
      });
    });
  }

  it("TR-001: the gateway's per-host budget refuses a burst beyond it (rate_limited), recorded as a failure", async () => {
    const s = SPECS[0];
    const x = edge(s.routes);
    const dir = tempDir("gwrate");
    const r = await run(argsFor(s, dir), {
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: { rateLimitPerHostPerSecond: 1, rateLimitBurst: 2 } },
    });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/rate/);
    expect(x.calls.length).toBe(2);
    const k = readCase(dir);
    expect(k.audit.some((a) => a.action === "egress.rate_limited")).toBe(true);
    expect(k.entries.some((e) => e.kind === "claim.added")).toBe(false);
  });

  it("TR-002: an RDAP server named by the bootstrap but not approved by the operator is refused before connecting", async () => {
    const s = SPECS[1];
    const x = edge(s.routes);
    const dir = tempDir("rdaphost");
    const r = await run(argsFor(s, dir, ["data.iana.org"]), {
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
    });
    expect(r.code).toBe(1);
    expect(r.err).toContain("rdap.verisign.com not on --allow-host");
    expect(r.err).toContain("data.iana.org/rdap/dns.json");
    expect(x.calls.map((c) => c.host)).toEqual(["data.iana.org"]);
    expect(x.lookups).not.toContain("rdap.verisign.com");
  });

  it("TR-003: an ASN subject is fed as the transform's own input field and resolves through the ASN bootstrap", async () => {
    const routes: Routes = {
      "https://data.iana.org/rdap/asn.json": json(F.IANA_ASN),
      "https://rdap.arin.net/registry/autnum/15169": json(F.RDAP_AS15169),
    };
    const x = edge(routes);
    const dir = tempDir("asn");
    const r = await run(argsFor(SPECS[2], dir, SPECS[2].hosts, ["asn", "as15169"]), {
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: LIMITS },
    });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const k = readCase(dir);
    const subject = k.p.graph.nodes.find((n) => n.canonicalKey === "asn:AS15169");
    expect(subject?.attributes.find((a) => a.predicate === "asn_named")?.value).toBe("GOOGLE");
  });

  it("D-019: TR-001 and TR-004 on one domain share one canonical node per identifier and keep every edge", async () => {
    const dir = tempDir("graph");
    // TR-004 discovers www.example.com; TR-001's answers point at a.iana-servers.net; both runs share the subject.
    const x1 = edge(SPECS[0].routes);
    expect(
      (await run(argsFor(SPECS[0], dir), { network: { env: ON, resolver: x1.resolver, transport: x1.transport, limits: LIMITS } })).code,
    ).toBe(0);
    const x2 = edge(SPECS[3].routes);
    expect(
      (await run(argsFor(SPECS[3], dir), { network: { env: ON, resolver: x2.resolver, transport: x2.transport, limits: LIMITS } })).code,
    ).toBe(0);
    const x3 = edge(SPECS[1].routes);
    expect(
      (await run(argsFor(SPECS[1], dir), { network: { env: ON, resolver: x3.resolver, transport: x3.transport, limits: LIMITS } })).code,
    ).toBe(0);
    const k = readCase(dir);
    const nodes = k.p.graph.nodes.filter((n) => n.canonicalKey === "domain:example.com");
    expect(nodes).toHaveLength(1);
    // a.iana-servers.net is found by TR-001 (DNS NS) and TR-002 (RDAP nameservers): one node, two edges, two
    // observations from different sources (not merged into one "independent" confirmation).
    const ns = k.p.graph.nodes.filter((n) => n.canonicalKey === "hostname:a.iana-servers.net");
    expect(ns).toHaveLength(1);
    const nsEdges = k.p.graph.edges.filter((e) => e.target === ns[0].id && e.predicate === "has_name_server");
    expect(nsEdges).toHaveLength(2);
    expect(k.p.issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Real TLS on the socket edge: the gateway's pinned address is used and the certificate is verified for the
// source hostname. The local server stands in for the internet; only the IP:port of the connection is redirected.
// ---------------------------------------------------------------------------------------------------------------

function makeCert(names: readonly string[]): { cert: string; key: string } {
  const d = mkdtempSync(path.join(tmpdir(), "ir-conn-tls-"));
  try {
    const crt = path.join(d, "c.crt");
    const key = path.join(d, "c.key");
    const san = names.map((n) => `DNS:${n}`).join(",");
    const r = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-keyout",
        key,
        "-out",
        crt,
        "-days",
        "1",
        "-nodes",
        "-subj",
        `/CN=${names[0]}`,
        "-addext",
        `subjectAltName=${san}`,
      ],
      { encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error(`openssl failed: ${r.stderr}`);
    return { cert: readFileSync(crt, "utf8"), key: readFileSync(key, "utf8") };
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

const opensslAvailable = spawnSync("openssl", ["version"]).status === 0;

describe.skipIf(!host.full || !opensslAvailable)(
  "P2-037 connectors over real TLS (pinned connection, hostname-verified certificate)",
  () => {
    const ALL = [...new Set(SPECS.flatMap((s) => s.hosts))];
    const ROUTES: Routes = Object.assign({}, ...SPECS.map((s) => s.routes));
    let good: { cert: string; key: string };
    let wrong: { cert: string; key: string };
    let server: https.Server;
    let port = 0;
    let serverCert = "";

    beforeAll(async () => {
      good = makeCert(ALL);
      wrong = makeCert(["not-the-source.example"]);
      server = https.createServer({ cert: good.cert, key: good.key, SNICallback: undefined }, (req, res) => {
        const hostHeader = String(req.headers.host ?? "").replace(/:\d+$/, "");
        const r = ROUTES[`https://${hostHeader}${req.url ?? "/"}`] ?? { status: 404, body: "no route" };
        res.writeHead(r.status, r.headers ?? {});
        res.end(r.body ?? "");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const addr = server.address();
      port = typeof addr === "object" && addr ? addr.port : 0;
      serverCert = good.cert;
    });
    afterAll(() => server?.close());

    /** The real pinned node transport, connected to the local server instead of the pinned public address. */
    function tlsEdge(ca: string) {
      const node = createNodeTransport({ tlsOptions: { ca } });
      const pinned: Array<{ host: string; pinnedIp: string }> = [];
      const transport: EgressTransport = {
        async fetch(r) {
          pinned.push({ host: r.host, pinnedIp: r.pinnedIp });
          const u = new URL(r.url);
          u.port = String(port);
          return node.fetch({ ...r, url: u.toString(), host: `${r.host}:${port}`, pinnedIp: "127.0.0.1" });
        },
      };
      const resolver: DnsResolver = { resolve: async (h) => DNS[h] ?? Promise.reject(new Error("NXDOMAIN")) };
      return { transport, resolver, pinned };
    }

    for (const s of SPECS) {
      it(`${s.id}: succeeds over TLS verified for ${s.hosts.join(", ")}; every connection pinned to a classified address`, async () => {
        const t = tlsEdge(serverCert);
        const dir = tempDir("tls");
        const r = await run(argsFor(s, dir), { network: { env: ON, resolver: t.resolver, transport: t.transport, limits: LIMITS } });
        expect(r.err).toBe("");
        expect(r.code).toBe(0);
        expect(t.pinned.length).toBe(Object.keys(s.routes).length);
        for (const p of t.pinned) expect(DNS[p.host]).toContain(p.pinnedIp);
        expect(readCase(dir).entries.some((e) => e.kind === "claim.added")).toBe(true);
      });
    }

    it("a certificate that is not valid for the source hostname fails the run (recorded, nothing claimed)", async () => {
      const mismatch = https.createServer({ cert: wrong.cert, key: wrong.key }, (_req, res) => res.end("{}"));
      await new Promise<void>((resolve) => mismatch.listen(0, "127.0.0.1", () => resolve()));
      const addr = mismatch.address();
      const mport = typeof addr === "object" && addr ? addr.port : 0;
      try {
        const node = createNodeTransport({ tlsOptions: { ca: wrong.cert } });
        const transport: EgressTransport = {
          fetch: (r) => {
            const u = new URL(r.url);
            u.port = String(mport);
            return node.fetch({ ...r, url: u.toString(), host: `${r.host}:${mport}`, pinnedIp: "127.0.0.1" });
          },
        };
        const dir = tempDir("tlsbad");
        const r = await run(argsFor(SPECS[3], dir), {
          network: { env: ON, resolver: { resolve: async (h) => DNS[h] ?? [] }, transport, limits: LIMITS },
        });
        expect(r.code).toBe(1);
        const k = readCase(dir);
        expect(k.entries.some((e) => e.kind === "claim.added")).toBe(false);
        expect(k.observations.filter((o) => o.kind === "error")).toHaveLength(1);
      } finally {
        mismatch.close();
      }
    });
  },
);
