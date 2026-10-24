/**
 * P7-001: release-line guard (T-REL-001..003).
 *
 * The release line is semver + changesets + release notes:
 * - T-REL-001: changesets is installed and configured (root-scoped).
 * - T-REL-002: the workspace carries a real semver version with a matching
 *   CHANGELOG.md section (0.0.0 is not a release).
 * - T-REL-003: the release workflow turns a pushed v* tag into a GitHub
 *   release with notes extracted from CHANGELOG.md, and the tag script
 *   refuses 0.0.0 and duplicates.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function pkg() {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}

test("T-REL-001: changesets مثبت ومضبوط على جذر مساحة العمل", () => {
  const p = pkg();
  assert.ok(p.devDependencies?.["@changesets/cli"], "@changesets/cli غير مثبت");
  assert.ok(p.scripts?.changeset, "سكربت changeset مفقود");
  assert.ok(p.scripts?.["changeset:version"], "سكربت changeset version مفقود");
  const cfgPath = join(root, ".changeset/config.json");
  assert.ok(existsSync(cfgPath), ".changeset/config.json غير موجود");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  assert.deepEqual(cfg.packages, ["."], "changesets مضبوط على غير جذر المساحة");
  assert.ok(cfg.baseBranch === "main", "baseBranch ليس main");
});

test("T-REL-002: نسخة semver حقيقية وقسم CHANGELOG مطابق لها", () => {
  const p = pkg();
  assert.notEqual(p.version, "0.0.0", "النسخة 0.0.0 — ليست إصداراً");
  assert.match(p.version, /^\d+\.\d+\.\d+(-[\w.]+)?$/, "النسخة ليست semver صحيحاً");
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  assert.ok(changelog.includes(`## ${p.version}`), `CHANGELOG بلا قسم للنسخة ${p.version}`);
});

test("T-REL-003: مسار الإصدار — وسم v* يتحول إصدار GitHub بملاحظات CHANGELOG", () => {
  const wfPath = join(root, ".github/workflows/release.yml");
  assert.ok(existsSync(wfPath), "release.yml غير موجودة");
  const wf = readFileSync(wfPath, "utf8");
  assert.ok(/tags:\s*\["v\*"\]/.test(wf), "لا يشغله وسم v*");
  assert.ok(wf.includes("gh release create"), "لا ينشئ إصدار GitHub");
  assert.ok(wf.includes("scripts/release/notes.mjs"), "الملاحظات ليست من CHANGELOG");
  assert.ok(existsSync(join(root, "scripts/release/notes.mjs")), "سكربت الملاحظات مفقود");
  const tag = readFileSync(join(root, "scripts/release/tag.mjs"), "utf8");
  assert.ok(tag.includes("0.0.0"), "سكربت الوسم لا يرفض 0.0.0");
  assert.ok(/already exists/.test(tag), "سكربت الوسم لا يرفض التكرار");
});
