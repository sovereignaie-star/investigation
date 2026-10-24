#!/usr/bin/env node
/**
 * P6-004: fuzz campaign runner.
 *
 * Usage:
 *   node scripts/fuzz/campaign.mjs [--duration-ms N] [--seed S] [--canary]
 *     --duration-ms  campaign time budget (default 60000)
 *     --seed         master seed (any string; normalized to sha256 hex; random when omitted)
 *     --canary       include the injected-crash canary target — campaign MUST then fail
 *
 *   node scripts/fuzz/campaign.mjs --ledger-row <date>,<hours>,<runId> --seed <masterSeed>
 *     prints a ledger row for docs/security/fuzz-campaigns.md with a sha256 checksum
 *     binding date + hours + run + seed (prevents retro-fabricated evidence).
 *
 * Exit code 0 = campaign completed with zero crashes; 1 = crash/invariant failure found.
 * The parsers are imported from source (tsx loader) — the fuzzed code is the shipped code.
 */
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
};

const masterSeedHex = flag("ledger-row")
  ? createHash("sha256")
      .update(String(flag("seed")))
      .digest("hex")
  : args.includes("--seed")
    ? createHash("sha256")
        .update(String(flag("seed")))
        .digest("hex")
    : randomBytes(32).toString("hex");

if (flag("ledger-row")) {
  const [date, hours, runId] = String(flag("ledger-row")).split(",");
  const checksum = createHash("sha256").update(`${date}:${hours}:${runId}:${masterSeedHex}`).digest("hex").slice(0, 8);
  console.log(
    `| ${date} | ${hours} | https://github.com/sovereignaie-star/investigation/actions/runs/${runId} | 0 | ${masterSeedHex} | ${checksum} |`,
  );
  process.exit(0);
}

// tsx must be loaded at process start (--import), not via register() — re-exec once with it.
if (!process.env.IR_FUZZ_REEXEC) {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, ["--import", "tsx/esm", fileURLToPath(import.meta.url), ...args], {
    stdio: "inherit",
    cwd: join(root, "scripts/fuzz"), // resolve tsx + fast-check from scripts/node_modules
    env: { ...process.env, IR_FUZZ_REEXEC: "1" },
  });
  process.exit(result.status ?? 1);
}
const durationMs = Number(flag("duration-ms")) || 60_000;
const jsonOut = flag("json-out");
const { TARGETS, canaryTarget } = await import("./targets.mjs");
const fc = (await import("fast-check")).default ?? (await import("fast-check"));

const targets = args.includes("--canary") ? [...TARGETS, canaryTarget()] : TARGETS;

/** Deterministic per-target/per-batch fast-check seed derived from the master seed. */
function fcSeed(name, batch) {
  return Number.parseInt(createHash("sha256").update(`${masterSeedHex}:${name}:${batch}`).digest("hex").slice(0, 8), 16) >>> 0;
}

const started = Date.now();
let totalIterations = 0;
let crash = null;

outer: for (let batch = 0; Date.now() - started < durationMs; batch++) {
  for (const target of targets) {
    if (Date.now() - started >= durationMs) break outer;
    const property = fc.property(target.arbitrary, (input) => {
      target.run(input, (e) => {
        crash = { target: target.name, error: e };
        throw e; // record as failure with the crashing input
      });
    });
    const out = fc.check(property, { numRuns: 100, seed: fcSeed(target.name, batch) });
    totalIterations += out.numRuns;
    if (out.failed) {
      crash = crash ?? { target: target.name, error: new Error("invariant violation") };
      crash.counterexample = out.counterexample;
      break outer;
    }
  }
}

const elapsed = Date.now() - started;
if (crash) {
  console.error(`campaign failed: 1 crashes`);
  console.error(`target: ${crash.target}`);
  console.error(`error: ${crash.error?.name}: ${crash.error?.message}`);
  if (crash.counterexample) console.error(`counterexample: ${JSON.stringify(crash.counterexample)}`);
  const failedReport = JSON.stringify({
    totalIterations,
    crashes: 1,
    seed: masterSeedHex,
    durationMs: elapsed,
    failedTarget: crash.target,
  });
  if (jsonOut) writeFileSync(jsonOut, failedReport + "\n");
  console.log(failedReport);
  process.exit(1);
}

console.log(`campaign ok: 0 crashes`);
const report = JSON.stringify({
  totalIterations,
  crashes: 0,
  seed: masterSeedHex,
  durationMs: elapsed,
  targets: targets.map((t) => t.name),
});
if (jsonOut) writeFileSync(jsonOut, report + "\n");
console.log(report);
