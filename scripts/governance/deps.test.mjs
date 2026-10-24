/**
 * P6-021: dependency security guard (T-DEP-001..004).
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
  // P6-025 (alerts #80..#86, 2026-10-24): transitive undici 7.29.1 via @scalar/json-magic
  // (the 8.x line already in the tree is outside the vulnerable range) and fast-uri 3.1.8 via ajv.
  ["undici", "7.30.1"],
  ["fast-uri", "3.1.9"],
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

/**
 * All resolved versions of `name` present in the lockfile. Keys appear as `name@version:`
 * (packages/snapshots) or `name: version` (dependency maps). The left boundary must not be a
 * package-name character, so `drizzle-zod@0.8.3` does not match `zod` and
 * `@types/body-parser@1.19.6` does not match `body-parser`.
 */
function resolvedVersions(name, lock) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const versions = new Set();
  const re = new RegExp(`(?<![a-zA-Z0-9@/._-])${escaped}@(\\d+\\.\\d[^:\\s)]*)`, "g");
  for (const m of lock.matchAll(re)) versions.add(m[1]);
  const re2 = new RegExp(`(?<![a-zA-Z0-9@/._-])${escaped}: (\\d+\\.\\d[^\\s)]*)`, "g");
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

test("T-DEP-005: الحارس يكشف النسخ المعرضة في بنية قفل قديم ولا يشير كذباً إلى حزم شقيقة", () => {
  // مقتطف اصطناعي من بنية القفل قبل الترقية (main وقت الإنذارات): الحزم الأربع
  // المعرضة موجودة، ومعها الحالات الحدية التي كسرت النسخة الأولى من الحارس —
  // drizzle-zod@0.8.3 و@types/body-parser@1.19.6 ليستا zod/body-parser.
  const preUpgradeLock = [
    "overrides:",
    "  zod@3: 4.6.7",
    "",
    "  drizzle-zod@0.8.3(zod@3.25.76):",
    "    dependencies:",
    "      zod: 3.25.76",
    "",
    "  '@types/body-parser@1.19.6':",
    "",
    "  body-parser@2.3.0:",
    "",
    "  ip-address@10.7.3:",
    "",
    "  maplibre-gl@5.24.0:",
    "",
    "  zod@3.25.76:",
    "",
    "  zod@4.6.7:",
  ].join("\n");
  assert.deepEqual(resolvedVersions("zod", preUpgradeLock).sort(), ["3.25.76", "4.6.7"]);
  assert.deepEqual(resolvedVersions("body-parser", preUpgradeLock), ["2.3.0"]);
  assert.deepEqual(resolvedVersions("ip-address", preUpgradeLock), ["10.7.3"]);
  assert.deepEqual(resolvedVersions("maplibre-gl", preUpgradeLock), ["5.24.0"]);
  // والدلالة: الأول يفشل لأن 3.25.76 < 4.6.6 — الحارس ما زال حارساً على القديم
  assert.ok(!atLeast("3.25.76", "4.6.6"));
});
