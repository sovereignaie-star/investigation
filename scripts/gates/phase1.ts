/**
 * Phase 1 exit gates G-08..G-13 (ROADMAP 12.2), measured, not inferred from "tests are green" (P1-027).
 *
 *   pnpm run build && pnpm run gates:phase1            # human report, exit 1 if any gate fails
 *   pnpm run gates:phase1 -- --json coverage/gates.json # also writes the machine-readable report
 *
 * Every number comes from a run in this process or a child process started here: the full Vitest suite with
 * coverage (JSON reporter), the identifier catalog, the golden set, and the built server and web bundle. Nothing
 * leaves the machine: the server is started on 127.0.0.1 with a temporary data directory and no network lookups.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, platform, release, tmpdir } from "node:os";
import path from "node:path";
import {
  IDENTIFIER_SPECS,
  detect,
  expandExample,
  extract,
  matchesSpec,
  specById,
  type Extracted,
} from "../../packages/core/src/identifiers/index.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;
const BIN = (name: string) => path.join(ROOT, "node_modules", ".bin", name);

type Result = {
  id: string;
  title: string;
  pass: boolean;
  partial?: boolean;
  criterion: string;
  measured: Record<string, unknown>;
  blocker?: string;
};
const results: Result[] = [];
/** Files under dir whose name matches re, skipping node_modules and dist; entry types come from readdir itself. */
function listFiles(dir: string, re: RegExp, skip: readonly string[] = ["node_modules", "dist"]): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!skip.includes(e.name)) walk(p);
      } else if (e.isFile() && re.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}
const SOURCE = /^(?!.*\.test\.tsx?$).*\.tsx?$/;
const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((10_000 * a) / b) / 100);

function env() {
  const git = (a: string[]) => spawnSync("git", a, { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { packageManager: string };
  return {
    commit: git(["rev-parse", "HEAD"]),
    dirty: git(["status", "--porcelain"]).length > 0,
    node: process.version,
    packageManager: pkg.packageManager,
    os: `${platform()} ${release()}`,
    cpu: `${cpus()[0]?.model ?? "?"} x${cpus().length}`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// One Vitest run with coverage feeds G-10, G-11, G-12, G-13, the determinism checks and the performance tests.
interface VitestJson {
  numTotalTests: number;
  numFailedTests: number;
  testResults: { name: string; assertionResults: { fullName: string; title: string; status: string; duration?: number }[] }[];
}
function runVitest(): { tests: { file: string; name: string; status: string; ms: number }[]; total: number; failed: number } {
  // outside coverage/: Vitest cleans that directory before it writes the coverage report
  const out = path.join(mkdtempSync(path.join(tmpdir(), "ir-gate-vitest-")), "results.json");
  const r = spawnSync(BIN("vitest"), ["run", "--coverage", "--reporter=json", `--outputFile=${out}`], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) throw r.error;
  const j = JSON.parse(readFileSync(out, "utf8")) as VitestJson;
  const tests = j.testResults.flatMap((f) =>
    f.assertionResults.map((a) => ({
      file: path.relative(ROOT, f.name),
      name: a.fullName,
      status: a.status,
      ms: Math.round(a.duration ?? 0),
    })),
  );
  return { tests, total: j.numTotalTests, failed: j.numFailedTests };
}

// ---------------------------------------------------------------------------------------------------------------
function g08() {
  let total = 0,
    accepted = 0,
    detected = 0;
  const failures: string[] = [];
  for (const s of IDENTIFIER_SPECS)
    for (const raw of s.examples.positive) {
      const ex = expandExample(raw);
      total++;
      const m = matchesSpec(s, ex);
      const ok = m.pattern && m.valid !== false && (!s.validator || m.valid === true);
      if (ok) accepted++;
      else failures.push(`${s.id}: ${raw.slice(0, 40)}`);
      const ctx = s.context?.keywords.join(" ") ?? "";
      if (detect(ex, { context: ctx, minScore: 0 }).some((c) => c.type === s.id)) detected++;
    }
  results.push({
    id: "G-08",
    title: "100% of positive examples match their type",
    criterion: "every positive example of every type passes its own pattern and, where one exists, its validator",
    pass: accepted === total && total > 0,
    measured: {
      types: IDENTIFIER_SPECS.length,
      examples: total,
      accepted,
      acceptedPct: pct(accepted, total),
      detectListsOwnType: detected,
      detectListsOwnTypePct: pct(detected, total),
      failures: failures.slice(0, 20),
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------
interface GEntity {
  start: number;
  end: number;
  value: string;
  type: string;
  accept: string[];
}
interface GRow {
  id: string;
  text: string;
  entities: GEntity[];
  negatives: { start: number; end: number; reject: string[] }[];
}
function g09() {
  const rows = readFileSync(path.join(ROOT, "fixtures", "detect", "golden.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as GRow);
  const deterministic = (e: GEntity) => Boolean(specById(e.type)?.validator);
  const right = (g: Extracted | undefined, e: GEntity) =>
    g !== undefined && (e.accept.includes(g.best.type) || g.candidates.some((c) => e.accept.includes(c.type) && c.score === g.best.score));
  let tp = 0,
    fp = 0,
    found = 0,
    total = 0,
    nearAccepted = 0;
  for (const r of rows) {
    const got = extract(r.text);
    const at = (s: number, e: number) => got.find((g) => g.start === s && g.end === e);
    for (const e of r.entities.filter(deterministic)) {
      total++;
      if (right(at(e.start, e.end), e)) found++;
    }
    for (const g of got) {
      if (!g.best.validated) continue;
      const label = r.entities.find((e) => e.start === g.start && e.end === g.end);
      if (label && right(g, label)) tp++;
      else fp++;
    }
    for (const n of r.negatives) {
      const g = at(n.start, n.end);
      if (g?.best.validated && n.reject.includes(g.best.type)) nearAccepted++;
    }
  }
  const precision = tp / (tp + fp);
  const recall = found / total;
  results.push({
    id: "G-09",
    title: "deterministic detection accuracy >= 99%",
    criterion: "on fixtures/detect/golden.jsonl: precision >= 99% and recall >= 99% for validator-backed types (both required)",
    pass: precision >= 0.99 && recall >= 0.99,
    measured: {
      snippets: rows.length,
      deterministicLabels: total,
      truePositives: tp,
      falsePositives: fp,
      precisionPct: pct(tp, tp + fp),
      recallPct: pct(found, total),
      nearMissesAccepted: nearAccepted,
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------
function g10(tests: { name: string; status: string }[]) {
  const ids = Array.from({ length: 19 }, (_, i) => `T-LED-${String(i + 1).padStart(3, "0")}`);
  const per = Object.fromEntries(
    ids.map((id) => {
      const t = tests.filter((x) => x.name.includes(`${id}:`) || x.name.includes(`${id} `));
      return [id, { tests: t.length, failed: t.filter((x) => x.status !== "passed").length }];
    }),
  );
  const missing = ids.filter((id) => per[id]?.tests === 0);
  const failing = ids.filter((id) => (per[id]?.failed ?? 0) > 0);
  const phaseOk = missing.length === 0 && failing.length === 0;
  results.push({
    id: "G-10",
    title: "all T-LED green",
    criterion:
      "T-LED-001..019 (phase 1 tasks P1-009/010/011) each have at least one test and all pass; T-LED-020 (offline replay) belongs to P2-018",
    pass: phaseOk,
    partial: true,
    measured: { required: ids.length, covered: ids.length - missing.length, missing, failing, perCase: per },
    blocker: "T-LED-020 (offline replay through engine.replay) cannot exist before P2-001/P2-018; the gate closes fully with P2-018",
  });
}

// ---------------------------------------------------------------------------------------------------------------
async function e2eServer(): Promise<{ ok: boolean; measured: Record<string, unknown> }> {
  // End-to-end on the built server: store a canary for every provider, call every vault route, then search every
  // response, every header, the server's own log and the vault file on disk for the canary.
  const serverJs = path.join(ROOT, "apps", "server", "dist", "index.mjs");
  const e2e: Record<string, unknown> = {};
  let e2eOk = false;
  try {
    if (!existsSync(serverJs)) throw new Error(`${serverJs} missing`);
    const data = mkdtempSync(path.join(tmpdir(), "ir-gate-"));
    const token = `gate-admin-${process.pid}`;
    const port = 18_000 + (process.pid % 1000);
    const child = spawn(process.execPath, [serverJs], {
      cwd: ROOT,
      env: {
        PATH: process.env["PATH"] ?? "",
        IR_DATA_DIR: data,
        IR_ADMIN_TOKEN: token,
        PORT: String(port),
        HOST: "127.0.0.1",
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (b: Buffer) => (log += b.toString()));
    child.stderr.on("data", (b: Buffer) => (log += b.toString()));
    const base = `http://127.0.0.1:${port}/api`;
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${base}/healthz`)).ok) break;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const providers = ["shodan", "abuseipdb", "hunter", "censys", "greynoise", "securitytrails"];
    const canary = (p: string) => `CANARY-${p}-${process.pid}-never-leaves-the-server`;
    const seen: string[] = [];
    const call = async (p: string, init: RequestInit = {}) => {
      const h = new Headers(init.headers);
      h.set("authorization", `Bearer ${token}`);
      const res = await fetch(base + p, { ...init, headers: h });
      seen.push(await res.text(), JSON.stringify([...res.headers]));
      return res.status;
    };
    const statuses: number[] = [];
    for (const p of providers)
      statuses.push(
        await call(`/vault/${p}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secret: canary(p) }),
        }),
      );
    statuses.push(await call("/vault"));
    for (const p of providers) statuses.push(await call(`/vault/${p}/test`, { method: "POST" })); // no network test for these
    statuses.push(await call(`/vault/${providers[0]}`, { method: "DELETE" }));
    statuses.push(await call("/vault"));
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
    const disk = readdirSync(data)
      .map((f) => readFileSync(path.join(data, f), "utf8"))
      .join("\n");
    const leak = (hay: string) => providers.filter((p) => hay.includes(canary(p)));
    e2e["requests"] = statuses.length;
    e2e["statuses"] = [...new Set(statuses)].sort();
    e2e["leaksInResponses"] = leak(seen.join("\n"));
    e2e["leaksInServerLog"] = leak(log);
    e2e["leaksInVaultFilePlaintext"] = leak(disk);
    e2e["serverLogBytes"] = log.length;
    rmSync(data, { recursive: true, force: true });
    e2eOk =
      statuses.every((s) => s < 400) &&
      [e2e["leaksInResponses"], e2e["leaksInServerLog"], e2e["leaksInVaultFilePlaintext"]].every((l) => (l as string[]).length === 0);
  } catch (x) {
    e2e["error"] = `${String(x)} (run pnpm run build first)`;
  }

  return { ok: e2eOk, measured: e2e };
}

function browserCheck(): { ok: boolean; measured: Record<string, unknown> } {
  // The browser never calls a provider that needs the user's key: every direct fetch in apps/web/src goes either to
  // the server (/api/...) or to a keyless public endpoint, and the vault client has no way to read a secret back.
  // Dashboard links ("get your key here") are navigation, not requests, and are not counted.
  const KEYED_API_HOSTS = [
    "ipinfo.io",
    "www.virustotal.com",
    "virustotal.com",
    "haveibeenpwned.com",
    "api.shodan.io",
    "api.abuseipdb.com",
    "api.hunter.io",
    "apilayer.net",
    "api.ipgeolocation.io",
    "person.clearbit.com",
    "api.fullcontact.com",
    "search.censys.io",
    "api.binaryedge.io",
    "api.greynoise.io",
    "api.securitytrails.com",
    "www.whoisxmlapi.com",
  ];
  const src = listFiles(path.join(ROOT, "apps", "web", "src"), SOURCE);
  const direct: Record<string, string[]> = {};
  let relativeCalls = 0;
  for (const f of src) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/fetch\(\s*([`"'])([^`"']*)/g)) {
      const url = m[2] ?? "";
      const host = /^https?:\/\/([^/?#$]+)/.exec(url)?.[1];
      if (!host) {
        relativeCalls++;
        continue;
      }
      (direct[host] ??= []).push(path.relative(ROOT, f));
    }
  }
  const vaultClient = readFileSync(path.join(ROOT, "apps", "web", "src", "utils", "apiKeyManager.ts"), "utf8");
  const dynamicCalls = (vaultClient.match(/fetch\(vaultUrl\(/g) ?? []).length;
  const keyedDirect = Object.keys(direct).filter((h) => KEYED_API_HOSTS.includes(h));
  const userKeyInQuery = src
    .filter((f) => /apikey=\$\{|key=\$\{|token=\$\{/i.test(readFileSync(f, "utf8")))
    .map((f) => path.relative(ROOT, f));
  const secretGetter = /reveal\(|\.secret\b(?!:)/.test(vaultClient.replace(/JSON\.stringify\(\{ secret: value \}\)/, ""));
  let bundle: Record<string, unknown> = {};
  try {
    const files = listFiles(path.join(ROOT, "apps", "web", "dist"), /\.(js|html)$/, []);
    const text = files.map((f) => readFileSync(f, "utf8")).join("\n");
    bundle = { files: files.length, storageWrites: (text.match(/(localStorage|sessionStorage)\.setItem/g) ?? []).length };
  } catch (x) {
    bundle = { error: `${String(x)} (run pnpm run build first)` };
  }
  const browser = {
    serverCalls: relativeCalls + dynamicCalls,
    directHosts: Object.fromEntries(Object.entries(direct).map(([h, f]) => [h, [...new Set(f)]])),
    keyedProviderCallsFromBrowser: keyedDirect,
    userKeyInQueryString: userKeyInQuery,
    vaultClientCanReadSecret: secretGetter,
    bundle,
  };
  const bundleOk = keyedDirect.length === 0 && userKeyInQuery.length === 0 && !secretGetter && bundle["storageWrites"] === 0;
  return { ok: bundleOk, measured: browser };
}

async function g11(tests: { file: string; status: string }[]) {
  const unit = tests.filter((t) => t.file.endsWith("routes/vault.test.ts") || t.file.endsWith("store/src/vault.test.ts"));
  const unitOk = unit.length > 0 && unit.every((t) => t.status === "passed");

  const { ok: e2eOk, measured: e2e } = await e2eServer();
  const { ok: bundleOk, measured: browser } = browserCheck();
  results.push({
    id: "G-11",
    title: "keys never leave the server",
    criterion:
      "vault unit tests pass; on the built server no stored key appears in any response, header, server log or the vault file in clear; the browser never calls a keyed provider, never puts a key in a URL, cannot read a secret back, and the bundle writes no browser storage",
    pass: unitOk && e2eOk && bundleOk,
    measured: { unitTests: unit.length, unitOk, e2e, browser },
  });
}

// ---------------------------------------------------------------------------------------------------------------
function g12(tests: { file: string; name: string; status: string }[]) {
  const purpose = tests.filter((t) => t.file.endsWith("store/src/audit-purpose.test.ts"));
  const ok = purpose.length > 0 && purpose.every((t) => t.status === "passed");
  const d052 = purpose.filter((t) => t.name.includes("D-052"));
  // No code outside @ir/store's case module opens a case database on its own.
  const offenders = ["apps", "packages", "lib"]
    .flatMap((d) => listFiles(path.join(ROOT, d), SOURCE))
    .filter((f) => /new DatabaseSync\(/.test(readFileSync(f, "utf8")))
    .map((f) => path.relative(ROOT, f));
  const allowed = ["packages/store/src/case.ts"];
  const outside = offenders.filter((f) => !allowed.includes(f));
  results.push({
    id: "G-12",
    title: "no case without a purpose",
    criterion:
      "P1-018 and D-052 tests pass (creation refused without a valid purpose; creation atomic under a crash at every step, plain and encrypted; a chain without case.created is refused for writing and fails ir verify); only the case module opens case databases",
    pass: ok && d052.length >= 4 && outside.length === 0,
    measured: { tests: purpose.length, d052Tests: d052.length, allPassed: ok, databaseOpenedOutsideCaseModule: outside },
  });
}

// ---------------------------------------------------------------------------------------------------------------
function g13() {
  let s: Record<string, { lines: { covered: number; total: number } }>;
  try {
    s = JSON.parse(readFileSync(path.join(ROOT, "coverage", "coverage-summary.json"), "utf8")) as typeof s;
  } catch (x) {
    results.push({
      id: "G-13",
      title: "core coverage >= 85%",
      criterion: "coverage report written by the Vitest run",
      pass: false,
      measured: { error: String(x) },
    });
    return;
  }
  const pkgs: Record<string, { covered: number; total: number; pct?: number }> = {};
  for (const [f, v] of Object.entries(s)) {
    if (f === "total") continue;
    const m = /\/packages\/([^/]+)\/src\//.exec(f);
    if (!m?.[1]) continue;
    const p = (pkgs[m[1]] ??= { covered: 0, total: 0 });
    p.covered += v.lines.covered;
    p.total += v.lines.total;
  }
  for (const p of Object.values(pkgs)) p.pct = pct(p.covered, p.total);
  const required = ["core", "ledger"];
  const pending = ["engine", "egress"].filter((p) => !pkgs[p]);
  results.push({
    id: "G-13",
    title: "core coverage >= 85%",
    criterion:
      "line coverage >= 85% for each core package of ROADMAP 8.5 that exists (core, ledger); engine and egress join when created (P2-001, P2-003); enforced by vitest.config.ts thresholds in CI",
    pass: required.every((p) => (pkgs[p]?.pct ?? 0) >= 85),
    measured: {
      packages: pkgs,
      notYetCreated: pending,
      excluded: ["**/*.test.ts", "packages/core/src/identifiers/catalog.ts (generated data)"],
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------
const run = runVitest();
g08();
g09();
g10(run.tests);
await g11(run.tests);
g12(run.tests);
g13();
const pick = (re: RegExp) => run.tests.filter((t) => re.test(t.name)).map((t) => ({ test: t.name, status: t.status, ms: t.ms }));
const report = {
  environment: env(),
  suite: { total: run.total, failed: run.failed },
  gates: results,
  determinism: pick(
    /live projection equals a rebuild|D-051|revert cleanly|chained merges|live projection equals a rebuild from case\.sqlite|is deterministic/,
  ),
  performance: pick(/acceptance P1-022|acceptance: 100,000 nodes/),
};
if (jsonOut) writeFileSync(path.resolve(ROOT, jsonOut), `${JSON.stringify(report, null, 2)}\n`);
const lines = [
  `phase 1 exit gates  commit ${report.environment.commit.slice(0, 7)}${report.environment.dirty ? " (dirty)" : ""}  node ${report.environment.node}  ${report.environment.os}`,
  `suite              ${run.total - run.failed}/${run.total} tests passed`,
  ...run.tests
    .filter((t) => !["passed", "skipped", "pending", "todo"].includes(t.status))
    .map((t) => `        FAILED ${t.file} > ${t.name} (${t.ms} ms)`),
  ...results.map(
    (r) =>
      `${r.id}  ${r.pass ? (r.partial ? "PASS*" : "PASS ") : "FAIL "}  ${r.title}\n        ${JSON.stringify(r.measured)}${r.partial && r.blocker ? `\n        * ${r.blocker}` : ""}`,
  ),
  "determinism",
  ...report.determinism.map((d) => `        ${d.status === "passed" ? "PASS" : "FAIL"} ${d.test} (${d.ms} ms)`),
  "performance",
  ...report.performance.map((d) => `        ${d.status === "passed" ? "PASS" : "FAIL"} ${d.test} (${d.ms} ms)`),
];
process.stdout.write(`${lines.join("\n")}\n`);
const failed =
  results.filter((r) => !r.pass).length +
  run.failed +
  [...report.determinism, ...report.performance].filter((d) => d.status !== "passed").length;
process.exit(failed ? 1 : 0);
