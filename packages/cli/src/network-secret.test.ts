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
import { runTransform, recordingTransport, RateLimiter, type TransformEvidence } from "@ir/transforms";
import { shodanHost, urlscanSearch } from "@ir/transforms";
import { planNetworkRun, type NetworkDeps } from "./network.ts";
import type { RegisteredTransform } from "./registry.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const MODULE = fileURLToPath(import.meta.url); // exists; the plan only checks existence

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

  it("COMPOSITION (runner + recording + case evidence): the real TR-009 request construction is refused by the query policy and the secret never reaches any persisted record", async () => {
    const c = newCase();
    const d = deps(fakeVault({ urlscan: "n_urlscan_composition_key" }));
    const plan = planNetworkRun(c, urlscanEntry, "url", ["urlscan.io"], d);
    if ("error" in plan) throw new Error(plan.error);
    // The runner's real composition: the recording transport around the plan's transport (the
    // same wrapper runTransform uses), then the REAL transform code — its actual request
    // construction (GET /api/v1/search/?q=domain:...) is what the policy refuses.
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
    await expect(runTransform(urlscanSearch, { transport: recorded, input: { url: "https://example.com" }, signal })).rejects.toThrowError(
      /secret_host_mismatch/,
    );
    // the failure is recorded as evidence with the URL the transform asked for — and no secret anywhere
    const persisted = JSON.stringify(evidence) + JSON.stringify(d.calls);
    expect(persisted).not.toContain("n_urlscan_composition_key");
    expect(d.calls).toHaveLength(0); // the transport was never reached (refused before DNS)
    // the case's audit chain carries the refusal, also without the secret
    const audit = JSON.stringify(c.auditTrail());
    expect(audit).not.toContain("n_urlscan_composition_key");
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
