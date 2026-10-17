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
import { shodanHost, urlscanSearch, abuseIpDbCheck } from "@ir/transforms";
import { recordRunSuccess, ensureSubject } from "./run-record.ts";
import { systemClock } from "@ir/core";
import { probeIsolation } from "@ir/transform-sandbox";
import { planNetworkRun, type NetworkDeps } from "./network.ts";
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
