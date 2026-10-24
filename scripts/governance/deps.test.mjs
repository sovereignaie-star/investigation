/**
 * P6-016: dependency security guard (T-DEP-001..004).
 *
 * Dependabot opened five alerts on main (2026-10-24): maplibre-gl (2 critical),
 * zod (high), body-parser (high), ip-address (medium). This guard pins the
 * patched minimums into the lockfile so a downgrade or a stale lockfile fails
 * CI — the fix is the upgrade, never silencing the alerts.
 *
 * T-DEP-001..004: every resolved version of each guarded package in
 * pnpm-lock.yaml must be >= the patched minimum from the advisory
 * (GHSA data via Dependabot alerts #75..#79).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Patched minimums from the advisories (first_patched_version):
 *   maplibre-gl 6.4.1   (critical, alerts #75/#76)
 *   zod        4.6.6    (high,     alert #78 — the whole 3.x line is in range)
 *   body-parser 2.4.0   (high,     alert #79)
 *   ip-address  10.7.4  (medium,   alert #77)
 */
const GUARDED = [
  ["maplibre-gl", "6.4.1"],
  ["zod", "4.6.6"],
  ["body-parser", "2.4.0"],
  ["ip-address", "10.7.4"],
];

/** Numeric-aware semver-ish comparison: returns true when a >= b (no prerelease handling — none of the guarded packages use one). */
function atLeast(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** All resolved versions of `name` present in the lockfile (importers + packages + snapshots sections all use `name@version` keys). */
function resolvedVersions(name, lock) {
  const versions = new Set();
  // keys like `  maplibre-gl@6.4.1:` (packages) or `      maplibre-gl: 6.4.1` (deps maps)
  const re = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@(\\d[^:\\s]*)`, "g");
  for (const m of lock.matchAll(re)) versions.add(m[1]);
  const re2 = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: (\\d[^\\s]*)`, "g");
  for (const m of lock.matchAll(re2)) versions.add(m[1]);
  return [...versions];
}

for (const [name, min] of GUARDED) {
  test(`T-DEP-${String(GUARDED.findIndex(([n]) => n === name) + 1).padStart(3, "0")}: every resolved ${name} >= ${min} (Dependabot advisory minimum)`, () => {
    const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
    const versions = resolvedVersions(name, lock);
    assert.ok(versions.length > 0, `${name} must appear in pnpm-lock.yaml`);
    const offenders = versions.filter((v) => !atLeast(v, min));
    assert.deepEqual(offenders, [], `vulnerable ${name} versions resolved in the lockfile: ${offenders.join(", ")} — upgrade to >= ${min}`);
  });
}
