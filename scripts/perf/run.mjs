#!/usr/bin/env node
/**
 * P6-006: performance & load benchmarks for the Section 9 NFR ceilings (NFR-22..25).
 *
 * سقوف القسم 9 المقاسة هنا:
 * - NFR-22: إضافة 100 عقدة إلى الرسم < 500 مللي ث
 * - NFR-23: البحث داخل 5,000 عقدة < 100 مللي ث
 * - NFR-24: تصدير تقرير متوسط (≈ 500 عقدة) < 5 ث
 * - NFR-25: استجابة الواجهة البرمجية للعمليات الشائعة محلياً p95 < 200 مللي ث
 *
 * Every benchmark drives the REAL code paths — no mock shortcuts:
 * - NFR-22/23: the projection → graphology adapter (apps/web graphModel) and the entity
 *   table model the workbench uses — the same data the drawing renders.
 * - NFR-24: the store Case (append-only ledger) + projection + projectionHash — the exact
 *   route path behind GET /cases/:id/export/projection.
 * - NFR-25: the express app (createApp) over HTTP with the real admin boundary, a
 *   sequential phase and a concurrent load phase; p95 across all measured requests.
 *
 * Usage:
 *   node scripts/perf/run.mjs                # full workload; writes docs/performance/baseline.json
 *   node scripts/perf/run.mjs --smoke        # small workload, verdicts still enforced
 *   node scripts/perf/run.mjs --json-out p.json
 *   node scripts/perf/run.mjs --ceiling-override 0.0001   # fails: proves verdicts guard
 *
 * Re-exec pattern: tsx cannot be register()ed (P6-004 lesson) — the script re-execs
 * itself under `node --import tsx/esm` exactly like scripts/fuzz/campaign.mjs.
 */
// NOTE: every import below the re-exec guard must be DYNAMIC — ESM hoists static
// imports above module code, so a static `import … .ts` would run under the outer
// process's native type-stripping (which cannot parse TS parameter properties) and
// crash before the re-exec happens. Same lesson as scripts/fuzz/campaign.mjs.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

if (!process.env.IR_PERF_REEXEC) {
  // --no-experimental-strip-types: Node 24's native strip-only mode cannot parse TS
  // parameter properties (packages/store) — tsx's full transform must own every .ts file.
  // cwd=scripts/perf: tsx + fast-check resolve from scripts/node_modules (pnpm workspace).
  const r = spawnSync(
    process.execPath,
    ["--no-experimental-strip-types", "--import", "tsx/esm", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {
      stdio: "inherit",
      cwd: here,
      env: { ...process.env, IR_PERF_REEXEC: "1" },
    },
  );
  process.exit(r.status ?? 1);
}

const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
const os = await import("node:os");

// Real code paths (tsx loader, TS sources — no build step, no drift from tests).
const { seededRandom, manualClock } = await import("../../packages/core/src/clock.ts");
const { ulidFactory } = await import("../../packages/core/src/ulid.ts");
const { generateBenchGraph, toGraphologyGraph } = await import("../../apps/web/src/pages/workbench/graphModel.ts");
const { buildEntityRows, filterEntityRows } = await import("../../apps/web/src/pages/workbench/entityTableModel.ts");
const { openCase } = await import("../../packages/store/src/case.ts");
const { projectionHash } = await import("../../packages/ledger/src/projections/index.ts");
const { createApp } = await import("../../apps/server/src/app.ts");
const { commonRouter } = await import("../../apps/server/src/routes/index.ts");

// ---- args ----
const args = process.argv.slice(2);
const smoke = args.includes("--smoke");
const ceilingFactor = (() => {
  const i = args.indexOf("--ceiling-override");
  return i >= 0 ? Number(args[i + 1]) : 1;
})();
const jsonOutIndex = args.indexOf("--json-out");
const jsonOut =
  jsonOutIndex >= 0
    ? args[jsonOutIndex + 1]
    : smoke
      ? undefined // smoke does not overwrite the committed baseline
      : join(root, "docs/performance/baseline.json");

const FIX = smoke
  ? { graphNodes: 500, graphEdges: 1000, addNodes: 20, exportEntities: 100, apiSeq: 20, apiConc: 10 }
  : { graphNodes: 5_000, graphEdges: 10_000, addNodes: 100, exportEntities: 500, apiSeq: 100, apiConc: 50 };

/** Section 9 ceilings (ms) — the guard (scripts/governance/perf.test.mjs) enforces the same numbers. */
const CEILINGS = { nfr22GraphAdd100: 500, nfr23Search5000: 100, nfr24Export500: 5_000, nfr25ApiP95: 200 };

const now = () => performance.now();
const p95 = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
};

const metrics = {};
const bench = (key, fn) => {
  const t0 = now();
  const detail = fn();
  const ms = now() - t0;
  const ceiling = CEILINGS[key] * ceilingFactor;
  metrics[key] = { ms: Math.round(ms * 100) / 100, ceilingMs: CEILINGS[key], pass: ms <= ceiling, detail };
  return metrics[key];
};

// ---- NFR-22: add 100 nodes to the drawing (< 500ms) ----
// The drawing's data model is the graphology graph the adapter (toGraphologyGraph)
// produces. Adding nodes = the adapter's own addNode/addEdge path applied to the live
// graph — same attributes, same calls (label/ar-first, deterministic position, palette).
function benchGraphAdd() {
  const graph = generateBenchGraph(FIX.graphNodes, FIX.graphEdges, 42);
  const g = toGraphologyGraph(graph); // warm: the existing drawing
  // The new nodes: same generator, but ids remapped to x* (the generator reuses n* —
  // distinct ids are required, adding is adding, not merging).
  const raw = generateBenchGraph(FIX.addNodes, FIX.addNodes * 2, 7);
  const extra = {
    nodes: raw.nodes.map((n) => ({ ...n, id: `x${n.id}` })),
    edges: raw.edges.map((e) => ({ ...e, id: `x${e.id}`, source: `x${e.source}`, target: `x${e.target}` })),
  };
  const added = { nodes: 0, edges: 0 };
  for (const n of extra.nodes) {
    if (g.hasNode(n.id)) continue;
    const total = g.order + 1; // graphology: `order` = node count
    const angle = (2 * Math.PI * g.order) / total;
    g.addNode(n.id, {
      label: n.labels.ar ?? n.labels.en ?? n.id,
      x: Math.cos(angle),
      y: Math.sin(angle),
      size: total <= 100 ? 8 : total <= 1_000 ? 6 : 5,
      color: typeColorFor(n.type),
    });
    added.nodes += 1;
  }
  for (const e of extra.edges) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    g.addEdgeWithKey(e.id, e.source, e.target, { label: e.predicate, size: 1.5, color: "#64748b" });
    added.edges += 1;
  }
  return { graphNodes: g.order, addedNodes: added.nodes, addedEdges: added.edges };
}

// graphModel's palette hash (typeColorOf) — replicated 1:1 from apps/web graphModel.ts
// (kept in sync by test: same polynomial rolling hash over the same 8-color palette).
function typeColorFor(type) {
  const PALETTE = ["#2563eb", "#7c3aed", "#0891b2", "#059669", "#ca8a04", "#ea580c", "#dc2626", "#db2777"];
  let h = 0;
  for (let i = 0; i < type.length; i += 1) h = (h * 31 + type.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// ---- NFR-23: search within 5,000 nodes (< 100ms) ----
// The workbench's real filter path: buildEntityRows (projection entities) then
// filterEntityRows (case-insensitive substring across type/label/canonical key).
function benchSearch() {
  const graph = generateBenchGraph(FIX.graphNodes, FIX.graphEdges, 42);
  const rows = buildEntityRows(graph.nodes);
  const t0 = now();
  const hits = filterEntityRows(rows, "ip");
  const ms = now() - t0;
  metrics.nfr23Search5000 = {
    ms: Math.round(ms * 100) / 100,
    ceilingMs: CEILINGS.nfr23Search5000,
    pass: ms <= CEILINGS.nfr23Search5000 * ceilingFactor,
    detail: { rows: rows.length, matched: hits.length, query: "ip" },
  };
}

// ---- NFR-24: export a ≈500-node report (< 5s) ----
// The exact route path behind GET /cases/:id/export/projection: open the case
// (append-only ledger), projection(), projectionHash, JSON serialization.
function benchExport() {
  const dir = mkdtempSync(join(os.tmpdir(), "ir-perf-export-"));
  try {
    const c = openCase(dir, {
      actor: "perf",
      clock: manualClock("2026-10-24T00:00:00.000Z"),
      create: { title: "قياس أداء التصدير", purpose: "اختبار أداء", legalBasis: "due_diligence" },
    });
    const id = ulidFactory(manualClock("2026-10-24T00:00:00.000Z"), seededRandom(21));
    const n = FIX.exportEntities;
    for (let i = 0; i < n; i += 1) {
      c.append("entity.added", {
        id: id(),
        type: "domain",
        canonicalKey: `domain:bench-${i}.example`,
        labels: { en: `bench-${i}.example` },
        props: {},
      });
    }
    const t0 = now();
    const p = c.projection();
    const hash = projectionHash(p);
    const bytes = JSON.stringify(p).length;
    const ms = now() - t0;
    metrics.nfr24Export500 = {
      ms: Math.round(ms * 100) / 100,
      ceilingMs: CEILINGS.nfr24Export500,
      pass: ms <= CEILINGS.nfr24Export500 * ceilingFactor,
      detail: { entities: p.graph.nodes.length, bytes, sha256: hash.slice(0, 12) },
    };
    c.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- NFR-25: API p95 for common operations (< 200ms), sequential + concurrent load ----
async function benchApi() {
  // The cases root and admin token are passed EXPLICITLY (router + env object) — the
  // same construction the server's own route tests use. No ambient process.env
  // dependency: the bench is hermetic and cannot accidentally hit real data.
  let server;
  let dataRoot;
  try {
    dataRoot = mkdtempSync(join(os.tmpdir(), "ir-perf-data-"));
    const casesDir = join(dataRoot, "cases");
    mkdirSync(casesDir, { recursive: true });
    const c = openCase(join(casesDir, "case-a"), {
      actor: "perf",
      clock: manualClock("2026-10-24T00:00:00.000Z"),
      create: { title: "قياس أداء الواجهة", purpose: "اختبار أداء", legalBasis: "due_diligence" },
    });
    const id = ulidFactory(manualClock("2026-10-24T00:00:00.000Z"), seededRandom(31));
    for (let i = 0; i < 50; i += 1) {
      c.append("entity.added", {
        id: id(),
        type: "domain",
        canonicalKey: `domain:api-${i}.example`,
        labels: { en: `api-${i}.example` },
        props: {},
      });
    }
    const caseId = c.meta("case_id");
    c.close();

    const env = { IR_ADMIN_TOKEN: "perf-bench-token", IR_API_RATE_LIMIT: "1000000", IR_CASES_RATE_LIMIT: "1000000", LOG_LEVEL: "silent" };
    // The common read-path composition from the server itself — the operations the UI performs.
    const router = commonRouter({ env, casesRoot: () => casesDir });
    const app = createApp(router, { env });
    server = app.listen(0);
    await new Promise((res) => server.once("listening", res));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const auth = { Authorization: "Bearer perf-bench-token" };
    const ops = [
      { path: "/healthz", headers: {} },
      { path: "/cases", headers: auth },
      { path: `/cases/${caseId}`, headers: auth },
      { path: `/cases/${caseId}/stats`, headers: auth },
      { path: `/cases/${caseId}/export/projection`, headers: auth },
    ];
    const times = [];
    const hit = async (op) => {
      const t0 = now();
      const r = await fetch(base + op.path, { headers: op.headers });
      await r.arrayBuffer();
      if (r.status !== 200) throw new Error(`${op.path} -> ${r.status}`);
      times.push(now() - t0);
    };
    // sequential phase: every common operation in rotation
    for (let i = 0; i < FIX.apiSeq; i += 1) await hit(ops[i % ops.length]);
    // concurrent load phase: FIX.apiConc parallel requests at once, repeated 5×
    for (let round = 0; round < 5; round += 1) {
      await Promise.all(Array.from({ length: FIX.apiConc }, (_, i) => hit(ops[i % ops.length])));
    }
    const ms = p95(times);
    metrics.nfr25ApiP95 = {
      ms: Math.round(ms * 100) / 100,
      ceilingMs: CEILINGS.nfr25ApiP95,
      pass: ms <= CEILINGS.nfr25ApiP95 * ceilingFactor,
      detail: { requests: times.length, p95Ms: Math.round(ms * 100) / 100, sequential: FIX.apiSeq, concurrentPerRound: FIX.apiConc },
    };
  } finally {
    server?.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
}

// ---- run ----
bench("nfr22GraphAdd100", benchGraphAdd);
benchSearch();
benchExport();
await benchApi();

const failed = Object.entries(metrics).filter(([, m]) => !m.pass);
const report = {
  date: new Date().toISOString(),
  command: `node scripts/perf/run.mjs${smoke ? " --smoke" : ""}`,
  mode: smoke ? "smoke" : "full",
  host: { node: process.version, platform: `${os.platform()} ${os.arch()}`, cpus: os.cpus().length },
  metrics,
};

if (jsonOut) {
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify(report, null, 2));
if (failed.length > 0) {
  console.error(
    `perf FAIL: ${failed.map(([k]) => k).join(", ")} exceeded Section 9 ceilings${ceilingFactor !== 1 ? ` (override ×${ceilingFactor})` : ""}`,
  );
  process.exit(1);
}
console.log(smoke ? "smoke ok: all Section 9 ceilings respected" : "perf ok: all Section 9 ceilings respected");
