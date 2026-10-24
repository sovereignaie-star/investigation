/**
 * P6-006: performance & load test governance guard (T-PERF-001..004).
 *
 * The acceptance criterion is "سقوف القسم 9" — the Section 9 NFR ceilings measured by
 * scripts, not claims: NFR-22 (add 100 nodes to the drawing < 500ms), NFR-23 (search
 * within 5,000 nodes < 100ms), NFR-24 (export a ≈500-node report < 5s) and NFR-25
 * (API p95 < 200ms for common operations, local). This guard enforces that the
 * benchmark harness exists, actually executes (a bounded smoke run), and that the
 * committed baseline evidence records every metric at or under its ceiling.
 * No fabricated evidence: baseline.json is only written by the harness itself
 * (command + date + host), and the smoke run must reproduce a pass verdict.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BASELINE = join(root, "docs/performance/baseline.json");

/** The Section 9 ceilings this guard enforces (ms). */
const CEILINGS = { nfr22GraphAdd100: 500, nfr23Search5000: 100, nfr24Export500: 5000, nfr25ApiP95: 200 };

test("T-PERF-001: benchmark harness exists and covers NFR-22/23 (graph add + search)", () => {
  assert.ok(existsSync(join(root, "scripts/perf/run.mjs")), "scripts/perf/run.mjs must exist");
  const src = readFileSync(join(root, "scripts/perf/run.mjs"), "utf8");
  assert.match(src, /nfr22GraphAdd100/, "harness must benchmark NFR-22 (add 100 nodes)");
  assert.match(src, /nfr23Search5000/, "harness must benchmark NFR-23 (search 5,000 nodes)");
  assert.ok(existsSync(BASELINE), "docs/performance/baseline.json evidence must exist");
});

test("T-PERF-002: harness covers NFR-24 (export) and NFR-25 (API p95) with load", () => {
  const src = readFileSync(join(root, "scripts/perf/run.mjs"), "utf8");
  assert.match(src, /nfr24Export500/, "harness must benchmark NFR-24 (≈500-node export)");
  assert.match(src, /nfr25ApiP95/, "harness must benchmark NFR-25 (API p95)");
  assert.match(src, /concurr/i, "NFR-25 bench must include a concurrent load phase");
});

test("T-PERF-003: committed baseline records every metric at or under its Section 9 ceiling", () => {
  const b = JSON.parse(readFileSync(BASELINE, "utf8"));
  assert.match(b.date ?? "", /^\d{4}-\d{2}-\d{2}/, "baseline must record its date");
  assert.ok(b.command, "baseline must record the reproducing command");
  for (const [key, ceiling] of Object.entries(CEILINGS)) {
    const m = b.metrics?.[key];
    assert.ok(m && Number.isFinite(m.ms), `baseline.metrics.${key}.ms must be a number`);
    assert.ok(m.ms <= ceiling, `${key}: ${m.ms}ms exceeds the Section 9 ceiling ${ceiling}ms`);
    assert.ok(m.pass === true, `${key} must be marked pass`);
  }
});

test("T-PERF-004: harness smoke run passes and the guard actually guards (threshold breach fails)", () => {
  // Bounded smoke run: small workload, fixed seed — fast enough for the governance
  // suite, real enough to execute every benchmark path (ledger, projection, graph,
  // search, export, HTTP API) end to end.
  const out = execFileSync(process.execPath, [join(root, "scripts/perf/run.mjs"), "--smoke"], {
    encoding: "utf8",
    timeout: 180_000,
    cwd: root,
  });
  assert.match(out, /smoke ok/, "smoke run must report success");
  assert.match(out, /nfr25ApiP95/, "smoke output must include the API p95 metric");
  // The harness must reject a ceiling breach: run with an impossible threshold and
  // expect a nonzero exit — proves the verdict logic is real, not cosmetic.
  const fail = spawnSync(process.execPath, [join(root, "scripts/perf/run.mjs"), "--smoke", "--ceiling-override", "0.0001"], {
    encoding: "utf8",
    timeout: 180_000,
    cwd: root,
  });
  assert.notEqual(fail.status, 0, "an impossible ceiling must fail the run (guard must guard)");
});
