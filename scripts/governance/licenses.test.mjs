/**
 * P6-014: license compatibility guard (T-LIC-001..003).
 *
 * The project is AGPL-3.0-or-later (ADR-10). This guard keeps the dependency
 * tree and the external OSINT sources honest against that choice:
 *
 * - T-LIC-001: docs/security/licenses.md exists, is signed, and carries the
 *   mandatory sections.
 * - T-LIC-002: every license family present in the installed tree
 *   (`pnpm licenses list --json`, frozen lockfile in CI) has a documented verdict
 *   row in the report, and no family is in the forbidden set (GPL-2.0-only,
 *   non-commercial Creative Commons, proprietary/UNLICENSED, BSD-4-Clause, JSON,
 *   SSPL, QPL, Sleepycat — all GPL/AGPL-incompatible or non-free).
 * - T-LIC-003: every external source the system can reach — the keyed provider
 *   registry (packages/egress/providers/*.ts `hosts`) and the browser CSP
 *   connect-src allowlist (apps/server/src/app.ts) — is documented in the
 *   report's sources table (D-048: limits and terms).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const REPORT = join(root, "docs/security/licenses.md");

/** Licenses that cannot ship inside an AGPL-3.0-or-later distribution. */
const FORBIDDEN = [
  "GPL-2.0-only",
  "GPL-2.0",
  "AGPL-1.0-only",
  "AGPL-1.0",
  "CC-BY-NC-1.0",
  "CC-BY-NC-2.0",
  "CC-BY-NC-2.5",
  "CC-BY-NC-3.0",
  "CC-BY-NC-4.0",
  "UNLICENSED",
  "NONE",
  "(none)",
  "SEE LICENSE IN",
  "BSD-4-Clause",
  "JSON",
  "SSPL-1.0",
  "QPL-1.0",
  "Sleepycat",
];

function report() {
  return readFileSync(REPORT, "utf8");
}

function installedLicenseFamilies() {
  const out = execSync("pnpm licenses list --json", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: root });
  return Object.keys(JSON.parse(out));
}

/** Verdict rows in the report: | الترخيص | العائدة | الحكم مع AGPL-3.0 | ... | */
function verdictRows(md) {
  const rows = new Map();
  for (const line of md.split("\n")) {
    const m = line.match(/^\|\s*([^|]+)\|\s*[^|]*\|\s*(متوافق|معلن|ممنوع)\s*\|/);
    if (m) rows.set(m[1].trim(), m[2].trim());
  }
  return rows;
}

/** Hosts the keyed provider registry can reach (packages/egress/providers/*.ts). */
function providerHosts() {
  const dir = join(root, "packages/egress/providers");
  const hosts = new Set();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".ts")) continue;
    const text = readFileSync(join(dir, f), "utf8");
    for (const m of text.matchAll(/hosts:\s*\[([^\]]*)\]/g)) {
      for (const h of m[1].matchAll(/"([^"]+)"/g)) hosts.add(h[1]);
    }
  }
  return hosts;
}

/** Hosts the browser may contact directly (CSP connect-src in app.ts). */
function cspHosts() {
  const app = readFileSync(join(root, "apps/server/src/app.ts"), "utf8");
  const block = /connect-src":\s*\[([^\]]*)\]/.exec(app)?.[1] ?? "";
  const hosts = new Set();
  for (const m of block.matchAll(/"(https:\/\/[^"]+)"/g)) hosts.add(m[1]);
  return hosts;
}

test("T-LIC-001: التقرير موجود وموقّع وبأقسامه الإلزامية", () => {
  assert.ok(existsSync(REPORT), `${REPORT} غير موجود`);
  const md = report();
  assert.ok(md.includes("P6-014"), "التقرير يحمل معرف المهمة P6-014");
  assert.ok(md.includes("2026-10-24"), "التقرير يحمل تاريخ التوقيع");
  for (const section of ["النطاق والمنهجية", "جدول تراخيص الاعتماديات", "المصادر الخارجية", "الخلاصة"]) {
    assert.ok(md.includes(section), `القسم «${section}» مفقود`);
  }
});

test("T-LIC-002: كل عائلة ترخيص مثبتة موثقة ومتوافقة مع AGPL", () => {
  const families = installedLicenseFamilies();
  assert.ok(families.length >= 10, `قائمة التراخيص فارغة أو صغيرة: ${families.length}`);
  const md = report();
  const rows = verdictRows(md);
  const bad = [];
  for (const family of families) {
    if (FORBIDDEN.some((f) => family === f || family.startsWith(f))) {
      bad.push(`${family}: ممنوع صراحة (تعارض AGPL)`);
      continue;
    }
    if (!rows.has(family)) bad.push(`${family}: بلا صف حكم في التقرير`);
  }
  assert.deepEqual(bad, [], bad.join("؛ "));
});

test("T-LIC-003: كل مصدر خارجي موثق بحدوده وشروطه (D-048)", () => {
  const md = report();
  const bad = [];
  for (const host of providerHosts()) {
    if (!md.includes(host)) bad.push(`مزوّد ${host}: غير موثق`);
  }
  for (const host of cspHosts()) {
    if (!md.includes(host)) bad.push(`مصدر متصفح ${host}: غير موثق`);
  }
  assert.deepEqual(bad, [], bad.join("؛ "));
});
