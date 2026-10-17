/**
 * P2-016 (D-031): the network plan builds a secret binding from the manifest's declared secret —
 * or refuses the run with a documented reason. The plan is the trusted component here: it opens the
 * vault (fail-closed) and hands the adapter a per-request reader; the sandboxed transform never
 * sees the key. SIMULATION ONLY: fake resolver/transport/vault; IR_ENABLE_NETWORK injected via deps.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { openCase, type Vault } from "@ir/store";
import { runTransform, runTransformIsolated, recordingTransport, RateLimiter, type TransformEvidence } from "@ir/transforms";
import {
  shodanHost,
  urlscanSearch,
  abuseIpDbCheck,
  hunterDomainEmails,
  commonCrawlIndex,
  virustotalReputation,
  greyNoiseClassification,
  otxPulses,
  securityTrailsDnsHistory,
  braveWebSearch,
  censysHostsCertificates,
} from "@ir/transforms";
import { openVault } from "@ir/store";
import { recordRunSuccess, ensureSubject } from "./run-record.ts";
import { systemClock } from "@ir/core";
import { probeIsolation } from "@ir/transform-sandbox";
import { planNetworkRun, type NetworkDeps } from "./network.ts";
import { project } from "@ir/ledger/projections";
import type { RegisteredTransform } from "./registry.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const MODULE = fileURLToPath(import.meta.url); // exists; the plan only checks existence
/** The REAL TR-009 source file — the sandbox bundles and executes this module (not a fixture). */
const URLSCAN_MODULE = fileURLToPath(new URL("../../transforms/src/transforms/tr-009-urlscan.ts", import.meta.url));

/** A vault double: list/has drive the plan-time check; reveal is the per-request reader. */
function fakeVault(entries: Record<string, string | undefined>): Vault {
  return {
    list: () => Object.keys(entries).map((name) => ({ name, updatedAt: "2026-10-16T00:00:00.000Z" })),
    has: (name) => name in entries,
    set: () => {
      throw new Error("not used in tests");
    },
    delete: () => false,
    reveal: (name) => entries[name],
    // P2-026 (credential_pair extension): the double serves single secrets only — a pair entry is
    // never synthesized, and kindOf reports what the double actually holds.
    setPair: () => {
      throw new Error("not used in tests");
    },
    revealPair: () => undefined,
    kindOf: (name) => (name in entries ? "secret" : undefined),
  };
}

const urlscanEntry: RegisteredTransform = {
  transform: urlscanSearch,
  module: MODULE,
  subjects: { url: (v) => ({ url: v }) },
  sends: ["url", "domain"],
  hosts: ["urlscan.io"],
  pageFetch: false,
};

const shodanEntry: RegisteredTransform = {
  transform: shodanHost,
  module: MODULE,
  subjects: { ipv4: (v) => ({ ip: v }) },
  sends: ["ip"],
  hosts: ["api.shodan.io"],
  pageFetch: false,
};

function deps(vault: Vault): NetworkDeps & { calls: Array<{ url: string; headers?: Record<string, string> }> } {
  const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
  return {
    env: { IR_ENABLE_NETWORK: "1" },
    resolver: { resolve: async (host) => (host === "urlscan.io" ? ["93.184.216.34"] : []) },
    transport: {
      async fetch(req) {
        calls.push({ url: req.url, ...(req.headers ? { headers: req.headers } : {}) });
        return { status: 200, body: "{}" };
      },
    },
    vault: () => vault,
    calls,
  };
}

function newCase() {
  const dir = mkdtempSync(path.join(tmpdir(), "ir-p2-016-"));
  dirs.push(dir);
  return openCase(dir, {
    actor: "test",
    create: { title: "P2-016", purpose: "مراجعة بنية تحتية مصرح بها", legalBasis: "security_incident" },
  });
}

describe("P2-016: the network plan binds the manifest's secret to the vault (or refuses, documented)", () => {
  it("a keyed transform whose provider has a registry entry gets the key injected into the provider header on the wire", async () => {
    const c = newCase();
    const d = deps(fakeVault({ urlscan: "n_urlscan_plan_key" }));
    const plan = planNetworkRun(c, urlscanEntry, "url", ["urlscan.io"], d);
    expect("error" in plan && plan.error).toBeFalsy();
    if ("error" in plan) throw new Error(plan.error);
    const res = await plan.transport.fetch({ method: "GET", url: "https://urlscan.io/api/v1/search/" }, new AbortController().signal);
    expect(res.status).toBe(200);
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]?.headers?.["api-key"]).toBe("n_urlscan_plan_key");
    expect(d.calls[0]?.url).not.toContain("n_urlscan_plan_key");
  });

  it("the vault entry missing => the plan is refused fail-closed with a clear reason, before any request", () => {
    const c = newCase();
    const d = deps(fakeVault({}));
    const plan = planNetworkRun(c, urlscanEntry, "url", ["urlscan.io"], d);
    expect("error" in plan).toBe(true);
    if (!("error" in plan)) throw new Error("expected a refusal");
    expect(plan.error).toMatch(/URLSCAN_KEY|urlscan/i);
    expect(d.calls).toHaveLength(0);
  });

  it("a key-in-URL-only provider (shodan, TR-008) is refused with the documented policy reason (D-031/P2-016)", () => {
    const c = newCase();
    const d = deps(fakeVault({ shodan: "n_shodan_key" }));
    const plan = planNetworkRun(c, shodanEntry, "ipv4", ["api.shodan.io"], d);
    expect("error" in plan).toBe(true);
    if (!("error" in plan)) throw new Error("expected a refusal");
    expect(plan.error).toMatch(/SHODAN_KEY/i);
    expect(d.calls).toHaveLength(0);
  });

  it("COMPOSITION (infrastructure canary, NOT a TR-009 integration): a query-free request to the registered path passes with the key in the header", async () => {
    const c = newCase();
    const d = deps(fakeVault({ urlscan: "n_urlscan_canary_key" }));
    const plan = planNetworkRun(c, urlscanEntry, "url", ["urlscan.io"], d);
    if ("error" in plan) throw new Error(plan.error);
    const evidence: TransformEvidence[] = [];
    const signal = new AbortController().signal;
    const recorded = recordingTransport(
      plan.transport,
      evidence,
      new RateLimiter(1, Date.now, (ms) => new Promise((r) => setTimeout(r, ms))),
      15_000,
      2_000_000,
      signal,
    );
    const res = await runTransform(
      // a minimal real-shaped transform whose request is query-free (the registry path) — this
      // proves the INJECTION composition only; it is not a working TR-009 integration (the real
      // search request needs a query, which the policy refuses — see the documented conflict).
      {
        ...urlscanSearch,
        run: async (_input: { url: string }, ctx: { http: { get: (url: string) => Promise<unknown> } }) => {
          await ctx.http.get("https://urlscan.io/api/v1/search/");
          return { findings: [] };
        },
      } as never,
      { transport: recorded, input: { url: "https://example.com" }, signal },
    );
    expect(res.requestCount).toBe(1);
    expect(d.calls[0]?.headers?.["api-key"]).toBe("n_urlscan_canary_key");
    expect(JSON.stringify(evidence)).not.toContain("n_urlscan_canary_key");
  });

  it("a vault that cannot be opened refuses the plan with a fixed message (no opener error text)", () => {
    const c = newCase();
    const d = deps(fakeVault({ urlscan: "k" }));
    const broken = {
      ...d,
      vault: () => {
        throw new Error("opener detail with secrets inside");
      },
    };
    const plan = planNetworkRun(c, urlscanEntry, "url", ["urlscan.io"], broken);
    expect("error" in plan).toBe(true);
    if (!("error" in plan)) throw new Error("expected a refusal");
    expect(plan.error).toMatch(/vault could not be opened/i);
    expect(plan.error).not.toContain("opener detail");
  });

  it("a manifest declaring more than one secret is refused explicitly (one binding per run, no silent pick)", () => {
    const c = newCase();
    const multi = {
      ...urlscanEntry,
      transform: { ...urlscanSearch, manifest: { ...urlscanSearch.manifest, secrets: ["URLSCAN_KEY", "EXTRA_KEY"] } },
    } as RegisteredTransform;
    const d = deps(fakeVault({ urlscan: "k", extra: "k" }));
    const plan = planNetworkRun(c, multi, "url", ["urlscan.io"], d);
    expect("error" in plan).toBe(true);
    if (!("error" in plan)) throw new Error("expected a refusal");
    expect(plan.error).toMatch(/multiple secrets/i);
  });
});

// The full sandbox (seccomp + namespaces) is probed at load time: the composition test runs where
// isolation is available and skips elsewhere (the same pattern as network.test.ts).
const host = await probeIsolation();

describe.skipIf(!host.full)("P2-016: real-sandbox composition (skipped where full isolation is unavailable)", () => {
  it(
    "COMPOSITION (REAL sandbox + persisted evidence + reopened case): the real TR-009 code runs in the real sandbox, its search query passes the per-provider allowlist (owner decision 2026-10-16), the key travels in the provider header only and never reaches any persisted record",
    { timeout: 60_000 },
    async () => {
      const c = newCase();
      const dir = dirs[dirs.length - 1];
      if (!dir) throw new Error("no case dir");
      const d = deps(fakeVault({ urlscan: "n_urlscan_sandbox_key" }));
      // the entry's module is the REAL transform source file: runTransformIsolated bundles it with
      // esbuild and executes it inside the REAL sandbox (seccomp + namespaces), its ctx.http being
      // an IPC channel to the plan's transport (adapter + gateway + fake wire) — the production shape.
      const entry = { ...urlscanEntry, module: URLSCAN_MODULE };
      const plan = planNetworkRun(c, entry, "url", ["urlscan.io"], d);
      if ("error" in plan) throw new Error(plan.error);
      const subjectId = ensureSubject(c, "url:example.com", "url", systemClock);
      // the run SUCCEEDS: the real TR-009 request (a search query) is permitted by the registry's
      // per-provider query allowlist, carried through the sandbox IPC boundary
      const result = await runTransformIsolated(URLSCAN_MODULE, {
        transport: plan.transport,
        input: { url: "https://example.com" },
        transformId: "TR-009",
      });
      // the wire saw exactly the real request: the query intact, the key in the provider header only
      expect(d.calls).toHaveLength(1);
      expect(d.calls[0]?.url).toBe("https://urlscan.io/api/v1/search/?q=domain:example.com");
      expect(d.calls[0]?.url).not.toContain("n_urlscan_sandbox_key");
      expect(d.calls[0]?.headers?.["api-key"]).toBe("n_urlscan_sandbox_key");
      // persist the successful run into the case exactly as the CLI does
      recordRunSuccess(c, subjectId, urlscanSearch, { url: "https://example.com" }, result, systemClock, "network");
      // reopen the case and verify the PERSISTED records: the request URL is recorded as evidence;
      // the key appears NOWHERE in the case or its audit trail
      const reopened = openCase(dir, { actor: "verifier", readOnly: true });
      const persisted = JSON.stringify(reopened.entries());
      expect(persisted).toContain("/api/v1/search/?q=domain:example.com");
      expect(persisted).not.toContain("n_urlscan_sandbox_key");
      const audit = JSON.stringify(reopened.auditTrail());
      expect(audit).toContain("egress.");
      expect(audit).not.toContain("n_urlscan_sandbox_key");
    },
  );
});

/** P2-026: the TR-044 entry — the REAL transform source file for the sandbox composition below. */
const ABUSEIPDB_MODULE = fileURLToPath(new URL("../../transforms/src/transforms/tr-044-abuseipdb.ts", import.meta.url));
const abuseipdbEntry: RegisteredTransform = {
  transform: abuseIpDbCheck,
  module: MODULE,
  subjects: { ipv4: (v) => ({ ip: v }), ipv6: (v) => ({ ip: v }) },
  sends: ["ip"],
  hosts: ["api.abuseipdb.com"],
  pageFetch: false,
};

describe("P2-026: TR-044 (AbuseIPDB) — the network plan wires the real transform end to end", () => {
  /** A wire that answers the check endpoint with a valid, well-formed AbuseIPDB record. */
  function abuseipdbDeps(vault: Vault) {
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    return {
      env: { IR_ENABLE_NETWORK: "1" },
      resolver: { resolve: async (host: string) => (host === "api.abuseipdb.com" ? ["93.184.216.34"] : []) },
      transport: {
        async fetch(req: { url: string; headers?: Record<string, string> }) {
          calls.push({ url: req.url, ...(req.headers ? { headers: req.headers } : {}) });
          return {
            status: 200,
            body: JSON.stringify({
              data: {
                ipAddress: "8.8.8.8",
                isPublic: true,
                ipVersion: 4,
                isWhitelisted: false,
                abuseConfidenceScore: 100,
                countryCode: "US",
                usageType: "Content Delivery Network",
                isp: "Google LLC",
                domain: "google.com",
                hostnames: ["dns.google"],
                isTor: false,
                totalReports: 2741,
                numDistinctUsers: 553,
                lastReportedAt: "2026-10-15T00:00:00Z",
              },
            }),
          };
        },
      },
      vault: () => vault,
      calls,
    };
  }

  // The full sandbox (seccomp + namespaces) is probed at load time — the composition test runs
  // where isolation is available and skips elsewhere (the TR-009 pattern: CI runners without
  // bubblewrap/cgroup delegation cannot host the real sandbox; the plan-level refusals below
  // still run everywhere).
  it.skipIf(!host.full)(
    "COMPOSITION (REAL sandbox + persisted evidence + reopened case): the real TR-044 code runs in the real sandbox, its ipAddress query passes the per-provider allowlist, the key travels in the provider header only and never reaches any persisted record",
    { timeout: 60_000 },
    async () => {
      const c = newCase();
      const dir = dirs[dirs.length - 1];
      if (!dir) throw new Error("no case dir");
      const d = abuseipdbDeps(fakeVault({ abuseipdb: "n_abuseipdb_sandbox_key" }));
      // the entry's module is the REAL transform source file: runTransformIsolated bundles it with
      // esbuild and executes it inside the REAL sandbox, its ctx.http being an IPC channel to the
      // plan's transport (adapter + gateway + fake wire) — the production shape.
      const entry = { ...abuseipdbEntry, module: ABUSEIPDB_MODULE };
      const plan = planNetworkRun(c, entry, "ipv4", ["api.abuseipdb.com"], d);
      if ("error" in plan) throw new Error(plan.error);
      const subjectId = ensureSubject(c, "ipv4:8.8.8.8", "ipv4", systemClock);
      const result = await runTransformIsolated(ABUSEIPDB_MODULE, {
        transport: plan.transport,
        input: { ip: "8.8.8.8" },
        transformId: "TR-044",
      });
      // the run SUCCEEDS: the real TR-044 request (the ipAddress query) is permitted by the
      // registry's per-provider query allowlist, carried through the sandbox IPC boundary
      expect(result.requestCount).toBe(1);
      expect(result.output.findings.length).toBeGreaterThan(0);
      // the wire saw exactly the real request: the query intact, the key in the provider header only
      expect(d.calls).toHaveLength(1);
      expect(d.calls[0]?.url).toBe("https://api.abuseipdb.com/api/v2/check?ipAddress=8.8.8.8");
      expect(d.calls[0]?.url).not.toContain("n_abuseipdb_sandbox_key");
      expect(d.calls[0]?.headers?.key).toBe("n_abuseipdb_sandbox_key");
      // persist the successful run into the case exactly as the CLI does
      recordRunSuccess(c, subjectId, abuseIpDbCheck, { ip: "8.8.8.8" }, result, systemClock, "network");
      // reopen the case and verify the PERSISTED records: the request URL is recorded as evidence;
      // the findings are bound to that evidence; the key appears NOWHERE in the case or its audit trail
      const reopened = openCase(dir, { actor: "verifier", readOnly: true });
      const persisted = JSON.stringify(reopened.entries());
      expect(persisted).toContain("/api/v2/check?ipAddress=8.8.8.8");
      expect(persisted).toContain("has_abuse_score");
      expect(persisted).not.toContain("n_abuseipdb_sandbox_key");
      const audit = JSON.stringify(reopened.auditTrail());
      expect(audit).toContain("egress.");
      expect(audit).not.toContain("n_abuseipdb_sandbox_key");
    },
  );

  it("the vault entry missing => the TR-044 plan is refused fail-closed with the documented reason, before any request", () => {
    const c = newCase();
    const d = abuseipdbDeps(fakeVault({}));
    const plan = planNetworkRun(c, abuseipdbEntry, "ipv4", ["api.abuseipdb.com"], d);
    expect("error" in plan).toBe(true);
    if (!("error" in plan)) throw new Error("expected a refusal");
    expect(plan.error).toMatch(/ABUSEIPDB_KEY|abuseipdb/i);
    expect(d.calls).toHaveLength(0);
  });
});

/** P2-026: the TR-051 entry — the REAL transform source file for the sandbox composition below. */
const HUNTER_MODULE = fileURLToPath(new URL("../../transforms/src/transforms/tr-051-hunter-emails.ts", import.meta.url));
const hunterEntry: RegisteredTransform = {
  transform: hunterDomainEmails,
  module: MODULE,
  subjects: { domain: (v) => ({ domain: v }) },
  sends: ["domain"],
  hosts: ["api.hunter.io"],
  pageFetch: false,
};

/** P2-026: the TR-052 entry — the REAL transform source file for the sandbox composition below. */
const COMMONCRAWL_MODULE = fileURLToPath(new URL("../../transforms/src/transforms/tr-052-common-crawl.ts", import.meta.url));
const commonCrawlEntry: RegisteredTransform = {
  transform: commonCrawlIndex,
  module: MODULE,
  subjects: { domain: (v) => ({ domain: v }) },
  sends: ["domain"],
  hosts: ["index.commoncrawl.org"],
  pageFetch: false,
};

describe("P2-026: TR-052 (Common Crawl, keyless) — the network plan wires the real transform end to end", () => {
  /** A wire that answers the two documented requests: the collinfo collection list, then the newest CDX API. */
  function commonCrawlDeps() {
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    return {
      env: { IR_ENABLE_NETWORK: "1" },
      resolver: { resolve: async (host: string) => (host === "index.commoncrawl.org" ? ["93.184.216.34"] : []) },
      transport: {
        async fetch(req: { url: string; headers?: Record<string, string> }) {
          calls.push({ url: req.url, ...(req.headers ? { headers: req.headers } : {}) });
          if (req.url === "https://index.commoncrawl.org/collinfo.json") {
            // The real collinfo shape: a list of collections, newest first, each with its cdx-api.
            return {
              status: 200,
              body: JSON.stringify([{ id: "CC-MAIN-2026-39", "cdx-api": "https://index.commoncrawl.org/CC-MAIN-2026-39-index" }]),
            };
          }
          // The newest collection's CDX API: one CDXJ record of an https capture (the capture URL
          // carries a distinctive marker path proving the finding derives from the answer, not a guess).
          return {
            status: 200,
            body: JSON.stringify(
              'com,example)/ 20260812000000 {"url": "https://www.example.com/marker-capture-path", "mime": "text/html", "status": "200", "digest": "sha1:marker-digest"}',
            ),
          };
        },
      },
      vault: () => fakeVault({}),
      calls,
    };
  }

  // The full sandbox (seccomp + namespaces) is probed at load time — the composition test runs
  // where isolation is available and skips elsewhere (the TR-009 pattern; CI runners without
  // bubblewrap/cgroup delegation cannot host the real sandbox).
  it.skipIf(!host.full)(
    "COMPOSITION (REAL sandbox + persisted evidence + reopened case): the keyless TR-052 runs in the real sandbox, sends exactly the two documented requests and never needs a vault",
    { timeout: 60_000 },
    async () => {
      const c = newCase();
      const dir = dirs[dirs.length - 1];
      if (!dir) throw new Error("no case dir");
      const d = commonCrawlDeps();
      // the entry's module is the REAL transform source file: runTransformIsolated bundles it with
      // esbuild and executes it inside the REAL sandbox, its ctx.http being an IPC channel to the
      // plan's transport (adapter + gateway + fake wire) — the production shape.
      const entry = { ...commonCrawlEntry, module: COMMONCRAWL_MODULE };
      const plan = planNetworkRun(c, entry, "domain", ["index.commoncrawl.org"], d);
      if ("error" in plan) throw new Error(plan.error);
      const subjectId = ensureSubject(c, "domain:example.com", "domain", systemClock);
      const result = await runTransformIsolated(COMMONCRAWL_MODULE, {
        transport: plan.transport,
        input: { domain: "example.com" },
        transformId: "TR-052",
      });
      // the run SUCCEEDS: exactly the two documented requests — the collection list first, then the
      // newest collection's CDX API with the domain query (both on index.commoncrawl.org).
      expect(result.requestCount).toBe(2);
      expect(result.output.findings.length).toBeGreaterThan(0);
      expect(d.calls).toHaveLength(2);
      expect(d.calls[0]?.url).toBe("https://index.commoncrawl.org/collinfo.json");
      expect(d.calls[1]?.url).toBe(
        "https://index.commoncrawl.org/CC-MAIN-2026-39-index?url=example.com&matchType=domain&output=json&filter=status:200&limit=100",
      );
      // the collection id is read from the wire answer — never hardcoded into the request
      expect(d.calls[1]?.url).toContain("CC-MAIN-2026-39");
      // persist the successful run into the case exactly as the CLI does
      recordRunSuccess(c, subjectId, commonCrawlIndex, { domain: "example.com" }, result, systemClock, "network");
      // reopen the case and verify the PERSISTED records: the capture URL (the marker path proves the
      // finding derives from the wire answer) is recorded as evidence and the finding is bound to it.
      const reopened = openCase(dir, { actor: "verifier", readOnly: true });
      const persisted = JSON.stringify(reopened.entries());
      expect(persisted).toContain("marker-capture-path");
      expect(persisted).toContain("has_crawl_capture");
      // STRUCTURAL evidence binding (not just text): the has_crawl_capture claim cites the evidence of
      // the CDX request itself — every cited evidence id resolves to the CDX query URL on the wire.
      const proj = project(reopened.entries());
      const edge = proj.graph.edges.find((e) => e.predicate === "has_crawl_capture");
      expect(edge).toBeDefined();
      expect((edge?.evidenceIds ?? []).length).toBeGreaterThan(0);
      const urls = new Map(
        reopened
          .entries()
          .filter((e) => e.kind === "evidence.stored")
          .map((e) => {
            const p = e.payload as { id: string; request: { url: string } };
            return [p.id, p.request.url];
          }),
      );
      for (const id of edge?.evidenceIds ?? []) {
        expect(urls.get(id)).toContain("CC-MAIN-2026-39-index?url=example.com");
      }
    },
  );

  it("TR-052 is KEYLESS: the plan builds with an EMPTY vault — no secret binding exists to refuse (the TR-011 wayback pattern, not the TR-047 keyed one)", () => {
    const c = newCase();
    const d = commonCrawlDeps();
    const plan = planNetworkRun(c, commonCrawlEntry, "domain", ["index.commoncrawl.org"], d);
    expect("error" in plan).toBe(false);
  });
});

describe("P2-026: TR-051 (Hunter) — the network plan wires the real transform end to end", () => {
  /** A wire that answers the domain-search endpoint with a valid, well-formed Hunter record. */
  function hunterDeps(vault: Vault) {
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    return {
      env: { IR_ENABLE_NETWORK: "1" },
      resolver: { resolve: async (host: string) => (host === "api.hunter.io" ? ["104.18.110.25"] : []) },
      transport: {
        async fetch(req: { url: string; headers?: Record<string, string> }) {
          calls.push({ url: req.url, ...(req.headers ? { headers: req.headers } : {}) });
          return {
            status: 200,
            body: JSON.stringify({
              data: {
                domain: "example.com",
                disposable: false,
                webmail: false,
                accept_all: false,
                pattern: "{first}",
                organization: "Example",
                linked_domains: [],
                emails: [
                  {
                    value: "contact@example.com",
                    type: "generic",
                    confidence: 98,
                    sources: [],
                    // Distinctive personal fields the transform must NOT turn into findings or
                    // persisted case records (minimal collection — the raw response is evidence
                    // like any source response, but no finding derives from these fields).
                    first_name: "MarkerFirstName",
                    last_name: "MarkerLastName",
                    phone_number: "+1-555-MARKER-PHONE",
                    linkedin: "https://linkedin.com/in/marker-profile",
                  },
                ],
              },
              meta: { results: 1, results_approximate: false, limit: 10, offset: 0 },
            }),
          };
        },
      },
      vault: () => vault,
      calls,
    };
  }

  // The full sandbox (seccomp + namespaces) is probed at load time — the composition test runs
  // where isolation is available and skips elsewhere (the TR-009 pattern; CI runners without
  // bubblewrap/cgroup delegation cannot host the real sandbox).
  it.skipIf(!host.full)(
    "COMPOSITION (REAL sandbox + persisted evidence + reopened case): the real TR-051 code runs in the real sandbox, its domain query passes the per-provider allowlist, the key travels in the X-API-KEY header only and never reaches any persisted record",
    { timeout: 60_000 },
    async () => {
      const c = newCase();
      const dir = dirs[dirs.length - 1];
      if (!dir) throw new Error("no case dir");
      const d = hunterDeps(fakeVault({ hunter: "hunter_sandbox_key" }));
      // the entry's module is the REAL transform source file: runTransformIsolated bundles it with
      // esbuild and executes it inside the REAL sandbox, its ctx.http being an IPC channel to the
      // plan's transport (adapter + gateway + fake wire) — the production shape.
      const entry = { ...hunterEntry, module: HUNTER_MODULE };
      const plan = planNetworkRun(c, entry, "domain", ["api.hunter.io"], d);
      if ("error" in plan) throw new Error(plan.error);
      const subjectId = ensureSubject(c, "domain:example.com", "domain", systemClock);
      const result = await runTransformIsolated(HUNTER_MODULE, {
        transport: plan.transport,
        input: { domain: "example.com" },
        transformId: "TR-051",
      });
      // the run SUCCEEDS: the real TR-051 request (the domain query) is permitted by the
      // registry's per-provider query allowlist, carried through the sandbox IPC boundary
      expect(result.requestCount).toBe(1);
      expect(result.output.findings.length).toBeGreaterThan(0);
      // the wire saw exactly the real request: the query intact, the key in the X-API-KEY header only
      expect(d.calls).toHaveLength(1);
      expect(d.calls[0]?.url).toBe("https://api.hunter.io/v2/domain-search?domain=example.com");
      expect(d.calls[0]?.url).not.toContain("hunter_sandbox_key");
      expect(d.calls[0]?.headers?.["x-api-key"]).toBe("hunter_sandbox_key");
      // persist the successful run into the case exactly as the CLI does
      recordRunSuccess(c, subjectId, hunterDomainEmails, { domain: "example.com" }, result, systemClock, "network");
      // reopen the case and verify the PERSISTED records: the request URL is recorded as evidence;
      // the findings are bound to that evidence; the key appears NOWHERE in the case or its audit trail
      const reopened = openCase(dir, { actor: "verifier", readOnly: true });
      const persisted = JSON.stringify(reopened.entries());
      expect(persisted).toContain("/v2/domain-search?domain=example.com");
      expect(persisted).toContain("has_public_email");
      expect(persisted).not.toContain("hunter_sandbox_key");
      // Minimal collection, proven on the wire record: the response's personal fields (name, phone,
      // social profile) reach NO persisted case record — findings, runs, coverage — only the email
      // values and the domain pattern do. (The raw response body is stored as evidence exactly like
      // every source response — that is the evidence design, not a finding.)
      expect(persisted).not.toContain("MarkerFirstName");
      expect(persisted).not.toContain("MarkerLastName");
      expect(persisted).not.toContain("MARKER-PHONE");
      expect(persisted).not.toContain("marker-profile");
      const audit = JSON.stringify(reopened.auditTrail());
      expect(audit).toContain("egress.");
      expect(audit).not.toContain("hunter_sandbox_key");
    },
  );

  it("the vault entry missing => the TR-051 plan is refused fail-closed with the documented reason, before any request", () => {
    const c = newCase();
    const d = hunterDeps(fakeVault({}));
    const plan = planNetworkRun(c, hunterEntry, "domain", ["api.hunter.io"], d);
    expect("error" in plan).toBe(true);
    if (!("error" in plan)) throw new Error("expected a refusal");
    expect(plan.error).toMatch(/HUNTER_KEY|hunter/i);
    expect(d.calls).toHaveLength(0);
  });

  it("E-02: TR-051 (a natural_person_gate manifest — the RESPONSE carries people's emails) is refused on a case with no stated purpose, before any request — the same rule the subject-level check applies to natural-person subjects", () => {
    // A purpose-less case cannot be created through the store (E-01 refuses it at creation), so this
    // exercises the gate through a legacy-database double: `info().purpose === ""` is exactly the
    // pre-P1-028 shape the subject-level check in planNetworkRun guards against. The positive
    // control is the composition test above: the SAME entry on a real purpose-stating case builds
    // the plan and the run succeeds (the case purpose IS the E-02 confirmation).
    const legacy = { info: () => ({ id: "case-legacy", purpose: "" }) } as unknown as ReturnType<typeof newCase>;
    const d = hunterDeps(fakeVault({ hunter: "hunter_sandbox_key" }));
    const plan = planNetworkRun(legacy, hunterEntry, "domain", ["api.hunter.io"], d);
    expect("error" in plan).toBe(true);
    if (!("error" in plan)) throw new Error("expected a refusal");
    expect(plan.error).toMatch(/natural-person|E-01\/E-02|stated purpose/);
    expect(d.calls).toHaveLength(0);
  });
});

describe("P2-026 (owner decision 2026-10-17): the path_parameter batch — the network plan wires the central path templates end to end", () => {
  /** The registry entries for the four transforms (the real transforms; the module path is swapped
   *  for the composition run). Subjects per the CLI registration. */
  const vtEntry: RegisteredTransform = {
    transform: virustotalReputation,
    module: MODULE,
    subjects: { ipv4: (v) => ({ ip: v }), domain: (v) => ({ domain: v }) },
    sends: ["ip", "domain"],
    hosts: ["www.virustotal.com"],
    pageFetch: false,
  };
  const gnEntry: RegisteredTransform = {
    transform: greyNoiseClassification,
    module: MODULE,
    subjects: { ipv4: (v) => ({ ip: v }) },
    sends: ["ip"],
    hosts: ["api.greynoise.io"],
    pageFetch: false,
  };
  const otxEntry: RegisteredTransform = {
    transform: otxPulses,
    module: MODULE,
    subjects: { ipv4: (v) => ({ ip: v }) },
    sends: ["ip"],
    hosts: ["otx.alienvault.com"],
    pageFetch: false,
  };
  const stEntry: RegisteredTransform = {
    transform: securityTrailsDnsHistory,
    module: MODULE,
    subjects: { domain: (v) => ({ domain: v }) },
    sends: ["domain"],
    hosts: ["api.securitytrails.com"],
    pageFetch: false,
  };
  const VT_MODULE = fileURLToPath(new URL("../../transforms/src/transforms/tr-043-virustotal.ts", import.meta.url));

  /** A wire that answers the VT ip_addresses template path with a valid, well-formed record. */
  function vtDeps(vault: Vault) {
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    return {
      env: { IR_ENABLE_NETWORK: "1" },
      resolver: { resolve: async (host: string) => (host === "www.virustotal.com" ? ["93.184.216.34"] : []) },
      transport: {
        async fetch(req: { url: string; headers?: Record<string, string> }) {
          calls.push({ url: req.url, ...(req.headers ? { headers: req.headers } : {}) });
          return {
            status: 200,
            body: JSON.stringify({
              data: {
                id: "8.8.8.8",
                type: "ip_address",
                attributes: {
                  reputation: 12,
                  last_analysis_stats: { harmless: 80, malicious: 8, suspicious: 2, undetected: 10, timeout: 0 },
                },
              },
            }),
          };
        },
      },
      vault: () => vault,
      calls,
    };
  }

  // The full sandbox (seccomp + namespaces) is probed at load time — the composition test runs
  // where isolation is available and skips elsewhere (the TR-009/TR-044 pattern).
  it.skipIf(!host.full)(
    "COMPOSITION (REAL sandbox + persisted evidence + reopened case): the real TR-043 code runs in the real sandbox, its PATH-CARRYING request passes the central path-template check, the key travels in the provider header only and never reaches any persisted record",
    { timeout: 60_000 },
    async () => {
      const c = newCase();
      const dir = dirs[dirs.length - 1];
      if (!dir) throw new Error("no case dir");
      const d = vtDeps(fakeVault({ virustotal: "n_vt_sandbox_key" }));
      const entry = { ...vtEntry, module: VT_MODULE };
      const plan = planNetworkRun(c, entry, "ipv4", ["www.virustotal.com"], d);
      if ("error" in plan) throw new Error(plan.error);
      const subjectId = ensureSubject(c, "ipv4:8.8.8.8", "ipv4", systemClock);
      const result = await runTransformIsolated(VT_MODULE, {
        transport: plan.transport,
        input: { ip: "8.8.8.8" },
        transformId: "TR-043",
      });
      // the run SUCCEEDS: the real TR-043 request (the subject in the PATH) is permitted by the
      // central path-template row — the closed ip type — carried through the sandbox IPC boundary
      expect(result.requestCount).toBe(1);
      expect(result.output.findings.length).toBeGreaterThan(0);
      // the wire saw exactly the real request: the subject in the path, the key in the header only
      expect(d.calls).toHaveLength(1);
      expect(d.calls[0]?.url).toBe("https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8");
      expect(d.calls[0]?.url).not.toContain("n_vt_sandbox_key");
      expect(d.calls[0]?.headers?.["x-apikey"]).toBe("n_vt_sandbox_key");
      // persist the successful run into the case exactly as the CLI does
      recordRunSuccess(c, subjectId, virustotalReputation, { ip: "8.8.8.8" }, result, systemClock, "network");
      // reopen the case and verify the PERSISTED records: the request URL is recorded as evidence;
      // the findings are bound to that evidence; the key appears NOWHERE in the case or its audit trail
      const reopened = openCase(dir, { actor: "verifier", readOnly: true });
      const persisted = JSON.stringify(reopened.entries());
      expect(persisted).toContain("/api/v3/ip_addresses/8.8.8.8");
      expect(persisted).toContain("has_threat_verdict");
      expect(persisted).not.toContain("n_vt_sandbox_key");
      const audit = JSON.stringify(reopened.auditTrail());
      expect(audit).toContain("egress.");
      expect(audit).not.toContain("n_vt_sandbox_key");
    },
  );

  it("COMPOSITION (plan level, no sandbox needed): the plan carries the provider's path templates to the gateway — a template-matching path is permitted and an off-template path is refused before DNS", async () => {
    const c = newCase();
    const d = vtDeps(fakeVault({ virustotal: "n_vt_plan_key" }));
    const plan = planNetworkRun(c, vtEntry, "ipv4", ["www.virustotal.com"], d);
    if ("error" in plan) throw new Error(plan.error);
    // the registered template path passes (the composition above proves it end to end); here the
    // gateway's own decision is pinned directly: an off-template path on the same host is refused
    // BEFORE any transport call, while the template path is allowed.
    const signal = new AbortController().signal;
    // the template path passes and the wire sees exactly it (the key injected in the header)
    const ok = await plan.transport.fetch({ url: "https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8", method: "GET" }, signal);
    expect(ok.status).toBe(200);
    expect(d.calls.filter((x) => x.url.endsWith("/api/v3/ip_addresses/8.8.8.8"))).toHaveLength(1);
    expect(d.calls[0]?.headers?.["x-apikey"]).toBe("n_vt_plan_key");
    // the off-template path is refused BEFORE the transport (the adapter throws the gateway's
    // denial). A SECOND plan: a fresh gateway, so the rps-1 rate budget of the first fetch
    // cannot mask WHICH rule refused the off-template request (the operational default, ADR-08).
    const c2 = newCase();
    const d2 = vtDeps(fakeVault({ virustotal: "n_vt_plan_key" }));
    const plan2 = planNetworkRun(c2, vtEntry, "ipv4", ["www.virustotal.com"], d2);
    if ("error" in plan2) throw new Error(plan2.error);
    await expect(plan2.transport.fetch({ url: "https://www.virustotal.com/api/v3/users/me", method: "GET" }, signal)).rejects.toThrow(
      /egress denied: secret_host_mismatch/,
    );
    expect(d2.calls.filter((x) => x.url.includes("users/me"))).toHaveLength(0);
  });

  it("the vault entry missing => the TR-043 plan is refused fail-closed with the documented reason, before any request", () => {
    const c = newCase();
    const d = vtDeps(fakeVault({}));
    const plan = planNetworkRun(c, vtEntry, "ipv4", ["www.virustotal.com"], d);
    expect("error" in plan).toBe(true);
    expect((plan as { error: string }).error).toMatch(/VIRUSTOTAL_KEY but the vault has no entry "virustotal"/);
    expect(d.calls).toHaveLength(0);
  });

  it("the same fail-closed key refusal holds for TR-045 (greynoise), TR-046 (otx) and TR-048 (securitytrails) — each vault entry documented", () => {
    const c = newCase();
    const gn = planNetworkRun(c, gnEntry, "ipv4", ["api.greynoise.io"], vtDeps(fakeVault({})));
    expect("error" in gn).toBe(true);
    expect((gn as { error: string }).error).toMatch(/GREYNOISE_KEY but the vault has no entry "greynoise"/);
    const otx = planNetworkRun(c, otxEntry, "ipv4", ["otx.alienvault.com"], vtDeps(fakeVault({})));
    expect("error" in otx).toBe(true);
    expect((otx as { error: string }).error).toMatch(/OTX_KEY but the vault has no entry "otx"/);
    const st = planNetworkRun(c, stEntry, "domain", ["api.securitytrails.com"], vtDeps(fakeVault({})));
    expect("error" in st).toBe(true);
    expect((st as { error: string }).error).toMatch(/SECURITYTRAILS_KEY but the vault has no entry "securitytrails"/);
  });
});

describe("P2-026 (owner decision 2026-10-17 — the vault credential_pair extension): TR-049 (Censys) — the network plan wires the PAIR credential end to end", () => {
  const censysEntry: RegisteredTransform = {
    transform: censysHostsCertificates,
    module: MODULE,
    subjects: { ipv4: (v) => ({ ip: v }), domain: (v) => ({ domain: v }) },
    sends: ["ip", "domain"],
    hosts: ["search.censys.io"],
    pageFetch: false,
  };
  const CENSYS_MODULE = fileURLToPath(new URL("../../transforms/src/transforms/tr-049-censys.ts", import.meta.url));
  const PAIR_ID = "censys-api-id-01234567";
  // P2-026 (gitleaks): synthetic low-entropy fixture value (repo style) — not a real secret.
  const PAIR_SECRET = "n_censys_pair_secret";

  /** A REAL vault (the real sealed-file code path) holding the Censys credential PAIR. */
  function pairVault(): { vault: Vault; dir: string } {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-censys-"));
    dirs.push(dir);
    const v = openVault(path.join(dir, "vault.json"), { key: new Uint8Array(32).fill(7) });
    v.setPair("censys", PAIR_ID, PAIR_SECRET);
    return { vault: v, dir };
  }

  /** A wire that answers the host view with a valid, well-formed Censys record. */
  function censysDeps(vault: Vault) {
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    return {
      env: { IR_ENABLE_NETWORK: "1" },
      resolver: { resolve: async (host: string) => (host === "search.censys.io" ? ["104.16.53.111"] : []) },
      transport: {
        async fetch(req: { url: string; headers?: Record<string, string> }) {
          calls.push({ url: req.url, ...(req.headers ? { headers: req.headers } : {}) });
          return {
            status: 200,
            body: JSON.stringify({
              code: 200,
              status: "OK",
              result: {
                ip: "45.83.66.10",
                services: [{ port: 443, transport_protocol: "TCP", service_name: "HTTPS" }],
              },
            }),
          };
        },
      },
      vault: () => vault,
      calls,
    };
  }

  it("PLAN LEVEL (no sandbox needed): the pair entry builds the Basic auth header value on the wire — the credential NEVER appears in the URL or as a raw single secret", async () => {
    const c = newCase();
    const pv = pairVault();
    const d = censysDeps(pv.vault);
    const plan = planNetworkRun(c, censysEntry, "ipv4", ["search.censys.io"], d);
    if ("error" in plan) throw new Error(plan.error);
    const signal = new AbortController().signal;
    const ok = await plan.transport.fetch({ url: "https://search.censys.io/v2/hosts/45.83.66.10", method: "GET" }, signal);
    expect(ok.status).toBe(200);
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]?.url).toBe("https://search.censys.io/v2/hosts/45.83.66.10");
    // the pair travels as the documented Basic value in the authorization header ONLY
    const expected = `Basic ${Buffer.from(`${PAIR_ID}:${PAIR_SECRET}`, "utf8").toString("base64")}`;
    expect(d.calls[0]?.headers?.["authorization"]).toBe(expected);
    expect(d.calls[0]?.url).not.toContain(PAIR_ID);
    expect(d.calls[0]?.url).not.toContain(PAIR_SECRET);
  });

  it('a SINGLE-SECRET entry under "censys" is refused fail-closed (the pair kind is documented in the registry row — no half-credential run)', () => {
    const c = newCase();
    const d = censysDeps(fakeVault({ censys: "a-single-secret" }));
    const plan = planNetworkRun(c, censysEntry, "ipv4", ["search.censys.io"], d);
    expect("error" in plan).toBe(true);
    expect((plan as { error: string }).error).toMatch(/CENSYS_API_ID as a credential PAIR/);
    expect(d.calls).toHaveLength(0);
  });

  it("the vault entry missing => the TR-049 plan is refused fail-closed with the documented reason, before any request", () => {
    const c = newCase();
    const d = censysDeps(fakeVault({}));
    const plan = planNetworkRun(c, censysEntry, "ipv4", ["search.censys.io"], d);
    expect("error" in plan).toBe(true);
    expect((plan as { error: string }).error).toMatch(/CENSYS_API_ID but the vault has no entry "censys"/);
    expect(d.calls).toHaveLength(0);
  });

  // The full sandbox (seccomp + namespaces) is probed at load time — the composition test runs
  // where isolation is available and skips elsewhere (the TR-009/TR-044/TR-051 pattern).
  it.skipIf(!host.full)(
    "COMPOSITION (REAL sandbox + persisted evidence + reopened case): the real TR-049 code runs in the real sandbox, its PATH-CARRYING request passes the central path-template check, the PAIR travels as the Basic value in the authorization header only and never reaches any persisted record",
    { timeout: 60_000 },
    async () => {
      const c = newCase();
      const dir = dirs[dirs.length - 1];
      if (!dir) throw new Error("no case dir");
      const pv = pairVault();
      const d = censysDeps(pv.vault);
      const entry = { ...censysEntry, module: CENSYS_MODULE };
      const plan = planNetworkRun(c, entry, "ipv4", ["search.censys.io"], d);
      if ("error" in plan) throw new Error(plan.error);
      const subjectId = ensureSubject(c, "ipv4:45.83.66.10", "ipv4", systemClock);
      const result = await runTransformIsolated(CENSYS_MODULE, {
        transport: plan.transport,
        input: { ip: "45.83.66.10" },
        transformId: "TR-049",
      });
      // the run SUCCEEDS: the real TR-049 request (the subject in the PATH) is permitted by the
      // central path-template row — the closed ip type — carried through the sandbox IPC boundary
      expect(result.requestCount).toBe(1);
      expect(result.output.findings.length).toBeGreaterThan(0);
      // the wire saw exactly the real request: the subject in the path, the pair as the Basic value
      expect(d.calls).toHaveLength(1);
      expect(d.calls[0]?.url).toBe("https://search.censys.io/v2/hosts/45.83.66.10");
      const expected = `Basic ${Buffer.from(`${PAIR_ID}:${PAIR_SECRET}`, "utf8").toString("base64")}`;
      expect(d.calls[0]?.headers?.["authorization"]).toBe(expected);
      expect(d.calls[0]?.url).not.toContain(PAIR_ID);
      expect(d.calls[0]?.url).not.toContain(PAIR_SECRET);
      // persist the successful run into the case exactly as the CLI does
      recordRunSuccess(c, subjectId, censysHostsCertificates, { ip: "45.83.66.10" }, result, systemClock, "network");
      // reopen the case and verify the PERSISTED records: the request URL is recorded as evidence;
      // the findings are bound to that evidence; the pair (both parts, raw and Basic-encoded)
      // appears NOWHERE in the case or its audit trail
      const reopened = openCase(dir, { actor: "verifier", readOnly: true });
      const persisted = JSON.stringify(reopened.entries());
      expect(persisted).toContain("/v2/hosts/45.83.66.10");
      expect(persisted).toContain("exposes_service");
      expect(persisted).not.toContain(PAIR_ID);
      expect(persisted).not.toContain(PAIR_SECRET);
      expect(persisted).not.toContain(expected);
      const audit = JSON.stringify(reopened.auditTrail());
      expect(audit).toContain("egress.");
      expect(audit).not.toContain(PAIR_ID);
      expect(audit).not.toContain(PAIR_SECRET);
    },
  );
});

describe("P2-026 (owner decision 2026-10-17 — the restricted-storage provider): TR-053 (Brave web search) — the plan wires the key, and the RAW RESPONSE never reaches a persisted record", () => {
  const braveEntry: RegisteredTransform = {
    transform: braveWebSearch,
    module: MODULE,
    subjects: { person_name: (v) => ({ name: v }), domain: (v) => ({ domain: v }) },
    sends: ["person_name", "domain"],
    hosts: ["api.search.brave.com"],
    pageFetch: false,
  };
  const BRAVE_MODULE = fileURLToPath(new URL("../../transforms/src/transforms/tr-053-brave-web-search.ts", import.meta.url));

  /** A wire whose raw response carries content markers that must NEVER reach a persisted record. */
  function braveDeps(vault: Vault) {
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    return {
      env: { IR_ENABLE_NETWORK: "1" },
      resolver: { resolve: async (host: string) => (host === "api.search.brave.com" ? ["104.16.53.111"] : []) },
      transport: {
        async fetch(req: { url: string; headers?: Record<string, string> }) {
          calls.push({ url: req.url, ...(req.headers ? { headers: req.headers } : {}) });
          return {
            status: 200,
            body: JSON.stringify({
              web: {
                results: [
                  { url: "https://example.com/about", title: "MARKER-RAW-TITLE", description: "MARKER-RAW-DESC" },
                  { url: "https://news.example.org/story", title: "T2", description: "MARKER-RAW-DESC-2" },
                ],
              },
            }),
          };
        },
      },
      vault: () => vault,
      calls,
    };
  }

  it("PLAN LEVEL (no sandbox needed): the key travels in the X-Subscription-Token header only and the q query passes the closed allowlist", async () => {
    const c = newCase();
    const d = braveDeps(fakeVault({ brave: "n_brave_plan_key" }));
    const plan = planNetworkRun(c, braveEntry, "domain", ["api.search.brave.com"], d);
    if ("error" in plan) throw new Error(plan.error);
    const signal = new AbortController().signal;
    const ok = await plan.transport.fetch({ url: "https://api.search.brave.com/res/v1/web/search?q=example.com", method: "GET" }, signal);
    expect(ok.status).toBe(200);
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]?.url).toBe("https://api.search.brave.com/res/v1/web/search?q=example.com");
    expect(d.calls[0]?.headers?.["x-subscription-token"]).toBe("n_brave_plan_key");
    expect(d.calls[0]?.url).not.toContain("n_brave_plan_key");
  });

  it("the vault entry missing => the TR-053 plan is refused fail-closed with the documented reason, before any request", () => {
    const c = newCase();
    const d = braveDeps(fakeVault({}));
    const plan = planNetworkRun(c, braveEntry, "domain", ["api.search.brave.com"], d);
    expect("error" in plan).toBe(true);
    expect((plan as { error: string }).error).toMatch(/BRAVE_SUBSCRIPTION_TOKEN but the vault has no entry "brave"/);
    expect(d.calls).toHaveLength(0);
  });

  it("E-02: TR-053 (a natural_person_gate manifest — web results about people) is refused on a case with no stated purpose, before any request", () => {
    // E-01 makes a purpose-less case impossible through the store — the documented test double
    // (the TR-051 precedent: the legacy case with an empty purpose).
    const legacy = { info: () => ({ id: "case-legacy", purpose: "" }) } as unknown as ReturnType<typeof newCase>;
    const d = braveDeps(fakeVault({ brave: "n_brave_plan_key" }));
    const plan = planNetworkRun(legacy, braveEntry, "domain", ["api.search.brave.com"], d);
    expect("error" in plan).toBe(true);
    if (!("error" in plan)) throw new Error("expected a refusal");
    expect(plan.error).toMatch(/natural-person|E-01\/E-02|stated purpose/);
    expect(d.calls).toHaveLength(0);
  });

  // The full sandbox (seccomp + namespaces) is probed at load time — the composition test runs
  // where isolation is available and skips elsewhere (the TR-009/TR-044/TR-051 pattern).
  it.skipIf(!host.full)(
    "COMPOSITION (REAL sandbox + persisted evidence + reopened case): the real TR-053 code runs in the real sandbox, the key travels in the X-Subscription-Token header only, and the RAW RESPONSE never reaches any persisted record — the evidence is the sha256 digest envelope and the links are the findings",
    { timeout: 60_000 },
    async () => {
      const c = newCase();
      const dir = dirs[dirs.length - 1];
      if (!dir) throw new Error("no case dir");
      const d = braveDeps(fakeVault({ brave: "n_brave_sandbox_key" }));
      const entry = { ...braveEntry, module: BRAVE_MODULE };
      const plan = planNetworkRun(c, entry, "domain", ["api.search.brave.com"], d);
      if ("error" in plan) throw new Error(plan.error);
      const subjectId = ensureSubject(c, "domain:example.com", "domain", systemClock);
      const result = await runTransformIsolated(BRAVE_MODULE, {
        transport: plan.transport,
        input: { domain: "example.com" },
        transformId: "TR-053",
      });
      // the run SUCCEEDS and the findings are the result LINKS (the only content claimed)
      expect(result.requestCount).toBe(1);
      expect(result.output.findings).toHaveLength(2);
      expect(result.output.findings[0]?.objectValue).toBe("https://example.com/about");
      // the wire saw exactly the real request: the q query, the key in the header only
      expect(d.calls).toHaveLength(1);
      expect(d.calls[0]?.url).toBe("https://api.search.brave.com/res/v1/web/search?q=example.com");
      expect(d.calls[0]?.headers?.["x-subscription-token"]).toBe("n_brave_sandbox_key");
      // the in-run evidence record is the DIGEST ENVELOPE, not the raw body
      const ev = result.evidence[0];
      const envelope = JSON.parse(ev.body ?? "") as { sha256: string; bytes: number };
      expect(envelope.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(envelope.bytes).toBeGreaterThan(0);
      expect(ev.body).not.toContain("MARKER-RAW");
      // persist the successful run into the case exactly as the CLI does
      recordRunSuccess(c, subjectId, braveWebSearch, { domain: "example.com" }, result, systemClock, "network");
      // reopen the case and verify the PERSISTED records: the query URL is recorded; the findings
      // (the links) are bound to the digest evidence; the raw response content and the key appear
      // NOWHERE — only the sha256 envelope is stored
      const reopened = openCase(dir, { actor: "verifier", readOnly: true });
      const entries = reopened.entries() as unknown as Array<{ kind?: string; payload?: { blobRef?: string } }>;
      const persisted = JSON.stringify(entries);
      expect(persisted).toContain("/res/v1/web/search?q=example.com");
      expect(persisted).toContain("mentioned_in");
      expect(persisted).toContain("https://example.com/about");
      expect(persisted).not.toContain("MARKER-RAW-TITLE");
      expect(persisted).not.toContain("MARKER-RAW-DESC");
      expect(persisted).not.toContain("n_brave_sandbox_key");
      // the stored evidence BLOB is the digest envelope itself — proven cryptographically: the
      // evidence record's own sha256 is the hash of the ENVELOPE string (the in-run evidence
      // body), so the stored blob cannot be the raw response (whose hash differs)
      const storedEntry = entries.find((e) => e.kind === "evidence.stored")?.payload as { sha256?: string; size?: number } | undefined;
      expect(storedEntry?.sha256).toBe(
        createHash("sha256")
          .update(ev.body ?? "")
          .digest("hex"),
      );
      expect(storedEntry?.size).toBe(ev.body?.length);
      // the blob is encrypted at rest (the case policy) — the raw markers and the key are absent
      // from every persisted ledger record and the audit trail (asserted above and below)
      const audit = JSON.stringify(reopened.auditTrail());
      expect(audit).toContain("egress.");
      expect(audit).not.toContain("n_brave_sandbox_key");
      expect(audit).not.toContain("MARKER-RAW-DESC");
    },
  );
});
