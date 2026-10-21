/**
 * P2-029 — investigator source control (red-first): disable/enable a source through the case's
 * audit chain (`ir source`), the per-invocation `--exclude` flag, per-source statistics
 * (success / failure / time / measured cost: requests + bytes) in the command output AND the
 * audit chain, and the optional `keyUrl` documentation field of a registered transform.
 *
 * The acceptance criteria: a disabled source is never invoked (test), the exclusion is visible
 * in coverage as not_run with its reason, the stats land in both surfaces, and keyed transforms
 * carry a verified link to the provider's key page.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { manualClock } from "@ir/core";
import { EgressTransportError, type DnsResolver, type EgressLimits, type EgressTransport } from "@ir/egress";
import { openCase } from "@ir/store";
import * as F from "../../transforms/src/fixtures/public-sources.ts";
import { REGISTRY } from "./registry.ts";
import { main } from "./ir.ts";
import type { InvestigationResult } from "./investigate.ts";

import { probeIsolation } from "@ir/transform-sandbox";
// The module-load probe doubles as the warmup: it pays the launcher build + probe cost here,
// OUTSIDE any test's 5s timeout (the first sandboxed test would otherwise pay it and time out).
// P2-028 (owner decision): no skipIf — the tests RUN wherever this file loads; without full
// isolation they fail honestly (the CI gates job now installs bubblewrap too).
await probeIsolation();

const ON = { IR_ENABLE_NETWORK: "1" };
const CASE_ARGS = ["--purpose", "تحقيق في بنية تحتية عامة لحادث أمني مصرح به", "--legal-basis", "security_incident"];
const T0 = "2026-10-18T12:00:00.000Z";

/** The minimal world: a domain seed whose TR-001/TR-002/TR-004 requests are all answered. */
const DNS: Readonly<Record<string, string[]>> = {
  "dns.google": ["8.8.8.8"],
  "data.iana.org": ["192.0.47.59"],
  "rdap.verisign.com": ["72.13.58.10"],
  "crt.sh": ["91.199.212.73"],
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
};

const dirs: string[] = [];
afterEach(() => {
  for (let d = dirs.pop(); d !== undefined; d = dirs.pop()) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), "ir-p2029-"));
  dirs.push(d);
  return d;
};

/** The fake edge: a resolver and a transport that serve WORLD and record every call. */
function edge(world: Readonly<Record<string, Resp>> = WORLD) {
  const calls: string[] = [];
  const resolver: DnsResolver = {
    async resolve(host) {
      return DNS[host] ?? [];
    },
  };
  const transport: EgressTransport = {
    async fetch(r) {
      calls.push(r.url);
      const hit = world[r.url];
      if (!hit) throw new EgressTransportError("transport_error", `no fixture for ${r.url}`);
      return hit;
    },
  };
  return { calls, resolver, transport };
}

/** Runs `ir ...` with the fake network and a fake clock/sleep (no real waiting) and returns the parsed JSON output. */
async function cli(args: string[], opts: { calls?: string[]; world?: Readonly<Record<string, Resp>> } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const x = edge(opts.world);
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
      network: { env: ON, resolver: x.resolver, transport: x.transport, limits: { rateLimitBurst: 64 } as EgressLimits },
    },
  );
  // the calls are copied only AFTER the command ran — the record is the actual requests this invocation made
  if (opts.calls) opts.calls.push(...x.calls);
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

describe("P2-029 ir source: disable/enable a source through the case audit chain", () => {
  it("T-P2029-001: `ir source disable` records an audit event with the reason and the list reflects it", async () => {
    const dir = tempDir();
    await cli(["run", dir, "TR-010", "url", "https://example.com", ...CASE_ARGS]); // create the case
    const r = await cli(["source", dir, "disable", "TR-004", "--reason", "crt.sh rate limited for this case", "--json"]);
    expect(r.code).toBe(0);
    const audit = readAudit(dir);
    const ev = audit.find((a) => a.action === "source.disable" && a.target === "TR-004");
    expect(ev).toBeDefined();
    expect(ev?.detail).toMatchObject({ reason: "crt.sh rate limited for this case" });
    // the list surface shows the disabled state
    const list = await cli(["source", dir, "list", "--json"]);
    expect(list.code).toBe(0);
    expect(list.rows).toBeDefined();
    const t004row = list.rows?.find((r) => r.transformId === "TR-004");
    expect(t004row).toMatchObject({ state: "disabled", reason: "crt.sh rate limited for this case" });
  });

  it("T-P2029-002: `ir source enable` clears the disable — the latest event per source wins", async () => {
    const dir = tempDir();
    await cli(["run", dir, "TR-010", "url", "https://example.com", ...CASE_ARGS]);
    await cli(["source", dir, "disable", "TR-004", "--reason", "temporary"]);
    const r = await cli(["source", dir, "enable", "TR-004", "--json"]);
    expect(r.code).toBe(0);
    const audit = readAudit(dir);
    expect(audit.filter((a) => a.action === "source.disable" && a.target === "TR-004")).toHaveLength(1);
    expect(audit.filter((a) => a.action === "source.enable" && a.target === "TR-004")).toHaveLength(1);
    const list = await cli(["source", dir, "list", "--json"]);
    expect(list.code).toBe(0);
    expect(list.rows).toBeDefined();
    // the latest event wins — TR-004 is enabled again
    expect(list.rows?.find((r) => r.transformId === "TR-004")).toMatchObject({ state: "enabled" });
    expect(list.rows?.every((r) => r.state !== "disabled")).toBe(true);
  });

  it("T-P2029-003: usage errors — missing --reason, unknown transform, bad arity — exit 2", async () => {
    const dir = tempDir();
    await cli(["run", dir, "TR-010", "url", "https://example.com", ...CASE_ARGS]);
    expect((await cli(["source", dir, "disable", "TR-004"])).code).toBe(2); // no reason
    expect((await cli(["source", dir, "disable", "TR-999", "--reason", "x"])).code).toBe(2); // unregistered
    expect((await cli(["source", dir, "disable"])).code).toBe(2); // missing id
    expect((await cli(["source", dir, "frobnicate", "TR-004"])).code).toBe(2); // unknown verb
    // nothing was recorded by the refused commands
    expect(readAudit(dir).filter((a) => a.action.startsWith("source."))).toHaveLength(0);
  });
});

describe("P2-029 ir investigate: disabled and excluded sources never run", () => {
  it("T-P2029-004: a source disabled on the case is not invoked — not_run with the reason, no request to it", async () => {
    const dir = tempDir();
    const args = [
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
    ];
    // the first invocation creates the case (real basis) and runs TR-004 as usual
    expect((await cli(args)).code).toBe(0);
    // the operator disables crt.sh for this case, on the case's own audit chain
    expect((await cli(["source", dir, "disable", "TR-004", "--reason", "crt.sh excluded by policy"])).code).toBe(0);
    // the next invocation never invokes it — no request to crt.sh at all
    const calls: string[] = [];
    const r = await cli(args, { calls });
    expect(r.code).toBe(0);
    const result = r.json as unknown as InvestigationResult;
    const cov = result.coverage;
    // TR-004 is not_run with the disabled reason — on the seed entity
    const t004 = cov.filter((x) => x.transformId === "TR-004" && x.entityKey === "domain:example.com");
    expect(t004).toHaveLength(1);
    expect(t004[0].state).toBe("not_run");
    expect(t004[0].reason).toMatch(/disabled/);
    // the other two ran
    expect(cov.filter((x) => x.transformId === "TR-001" && x.state === "found")).toHaveLength(1);
    expect(cov.filter((x) => x.transformId === "TR-002" && x.state === "found")).toHaveLength(1);
    // no request ever went to crt.sh — the disabled source was never invoked
    expect(calls.every((u) => !u.includes("crt.sh"))).toBe(true);
    // the case audit chain carries the not_run with the reason
    expect(readAudit(dir).some((a) => a.action === "investigate.not_run" && JSON.stringify(a.detail).includes("disabled"))).toBe(true);
  });

  it("T-P2029-005: --exclude excludes per invocation without writing a source event", async () => {
    const dir = tempDir();
    const calls: string[] = [];
    const r = await cli(
      [
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
        "TR-004",
        "--exclude",
        "TR-004",
        "--max-depth",
        "0",
        "--max-runs",
        "10",
        "--max-requests",
        "50",
      ],
      { calls },
    );
    expect(r.code).toBe(0);
    const result = r.json as unknown as InvestigationResult;
    const t004 = result.coverage.filter((x) => x.transformId === "TR-004" && x.entityKey === "domain:example.com");
    expect(t004).toHaveLength(1);
    expect(t004[0].state).toBe("not_run");
    expect(t004[0].reason).toMatch(/exclude/i);
    expect(result.coverage.filter((x) => x.transformId === "TR-001" && x.state === "found")).toHaveLength(1);
    // the excluded source was never invoked, while the selected other source was
    expect(calls.some((u) => u.includes("crt.sh"))).toBe(false);
    expect(calls.some((u) => u.includes("dns.google"))).toBe(true);
    // the exclusion wrote no source.* event — it is per invocation only
    expect(readAudit(dir).filter((a) => a.action.startsWith("source."))).toHaveLength(0);
  });

  it("T-P2029-006: per-source stats (success/failure/time/measured cost) in the output AND the audit chain", async () => {
    const dir = tempDir();
    const r = await cli([
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
    ]);
    expect(r.code).toBe(0);
    const result = r.json as unknown as InvestigationResult & { sources?: unknown };
    expect(result.sources).toBeDefined();
    const sources = result.sources as unknown as Array<Record<string, unknown>>;
    const ids = sources.map((s) => s.transformId).sort();
    expect(ids).toEqual(["TR-001", "TR-002", "TR-004"]);
    for (const s of sources) {
      // every measured field is present: outcomes, time, and the measured cost (requests + bytes)
      for (const f of ["transformId", "runs", "found", "none", "failed", "notRun", "requests", "bytes", "elapsedMs"]) {
        expect(s[f]).toBeDefined();
      }
    }
    const t001 = sources.find((s) => s.transformId === "TR-001");
    // one executed run (found) on the seed; the depth-0 budget leaves the discovered child entities not_run
    expect(t001).toMatchObject({ runs: 1, found: 1, none: 0, failed: 0 });
    expect((t001?.notRun as number) ?? 0).toBeGreaterThanOrEqual(0);
    expect(t001?.requests).toBeGreaterThanOrEqual(1); // the DoH queries
    expect(t001?.bytes).toBeGreaterThan(0);
    expect(t001?.elapsedMs).toBeGreaterThanOrEqual(0);
    // the audit chain carries the SAME per-source stats on investigate.completed — not just a name
    const completed = readAudit(dir).find((a) => a.action === "investigate.completed");
    expect(completed).toBeDefined();
    expect((completed?.detail as { sources?: unknown }).sources).toEqual(result.sources);
  });

  it("T-P2029-008: per-source stats aggregate the three outcomes — found, none, and failed — with their cost", async () => {
    const dir = tempDir();
    // TR-001 finds (DNS), TR-004 returns an empty certificate set (none), TR-002 fails (its RDAP host is unreachable)
    const world: Record<string, Resp> = {
      ...hostAnswers("example.com", "8.8.8.8"),
      "https://data.iana.org/rdap/dns.json": json(F.IANA_DNS),
      "https://crt.sh/?q=%25.example.com&output=json": json("[]"),
    };
    const r = await cli(
      [
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
      ],
      { world },
    );
    // a run with a failed source exits 1 (documented): the failure is recorded, not hidden
    expect(r.code).toBe(1);
    const result = r.json as unknown as InvestigationResult;
    const sources = result.sources as unknown as Array<Record<string, unknown>>;
    const t002 = sources.find((x) => x.transformId === "TR-002");
    const t004 = sources.find((x) => x.transformId === "TR-004");
    // the failed run is counted as failed (with its reason on the coverage record), not silently dropped
    expect(t002).toMatchObject({ runs: 1, found: 0, none: 0, failed: 1 });
    // a source that finds nothing is "none", not "found"
    expect(t004).toMatchObject({ runs: 1, found: 0, none: 1, failed: 0 });
    // the failed source still reports its measured cost (the bootstrap request it made before failing)
    expect(t002?.requests).toBeGreaterThanOrEqual(1);
    // runs = found + none + failed for every source
    for (const x of sources) expect(x.runs).toBe((x.found as number) + (x.none as number) + (x.failed as number));
  });
});

describe("P2-029 keyUrl: the verified link to each provider's key page", () => {
  it("T-P2029-007: keyed registered transforms carry a keyUrl; keyless ones carry none", () => {
    const keyed = REGISTRY.filter((r) => r.transform.manifest.secrets.length > 0);
    expect(keyed.length).toBeGreaterThanOrEqual(10);
    for (const r of keyed) expect(r.keyUrl, `${r.transform.manifest.id} must document where its key comes from`).toMatch(/^https:\/\//);
    // spot-check the verified links (provider-documented pages)
    const by = (id: string) => REGISTRY.find((r) => r.transform.manifest.id === id);
    expect(by("TR-009")?.keyUrl).toBe("https://urlscan.io/user/profile/");
    expect(by("TR-043")?.keyUrl).toBe("https://www.virustotal.com/gui/my-apikey");
    // a keyless transform carries no keyUrl
    expect(by("TR-001")?.keyUrl).toBeUndefined();
  });
});

describe("P4-002 ir source list: the documented Admiralty grade of every transform", () => {
  it("T-P4002-001: every listed source carries its admiralty grade (json) and the human surface shows it (text)", async () => {
    const dir = tempDir();
    await cli(["run", dir, "TR-010", "url", "https://example.com", ...CASE_ARGS]); // create the case
    const list = await cli(["source", dir, "list", "--json"]);
    expect(list.code).toBe(0);
    expect(list.rows).toBeDefined();
    // every registered row carries the documented grade with its written rationale
    const ungraded = (list.rows ?? []).filter((r) => {
      const a = r.admiralty as { reliability?: unknown; credibility?: unknown; rationale?: unknown } | undefined;
      return !(
        a !== undefined &&
        typeof a.reliability === "string" &&
        typeof a.credibility === "number" &&
        typeof a.rationale === "string" &&
        a.rationale.length >= 10
      );
    });
    expect(ungraded.map((r) => r.transformId)).toEqual([]);
    // the documented anchor case: Google DoH is a B-grade source with default credibility 3
    expect(list.rows?.find((r) => r.transformId === "TR-001")?.admiralty).toMatchObject({ reliability: "B", credibility: 3 });
    // the human-readable surface shows the grade next to the state
    const text = await cli(["source", dir, "list"]);
    expect(text.code).toBe(0);
    expect(text.out).toMatch(/TR-001: enabled — r=B k=3/);
  });
});
