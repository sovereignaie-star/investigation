/**
 * P6-005: mutation testing (Stryker) for the core — guard (T-MUT-001..003).
 *
 * The campaign config must be committed, the report of record must exist
 * with the real scores, and the score must be reported HONESTLY against
 * the roadmap acceptance (>= 60%) — a below-acceptance score must be
 * declared as such, never presented as done.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CFG = join(root, "packages/core/stryker.config.json");
const PKG = join(root, "packages/core/package.json");
const DOC = join(root, "docs/security/mutation-core.md");

test("T-MUT-001: إعداد الحملة ملتزم ومثبت", () => {
  assert.ok(existsSync(CFG), "stryker.config.json مفقود");
  const cfg = JSON.parse(readFileSync(CFG, "utf8"));
  assert.ok(cfg.testRunner === "vitest", "مشغل الاختبارات ليس vitest");
  assert.ok(Array.isArray(cfg.mutate) && cfg.mutate.length > 0, "أنماط الطفرات مفقودة");
  const pkg = JSON.parse(readFileSync(PKG, "utf8"));
  assert.ok(pkg.devDependencies?.["@stryker-mutator/core"], "@stryker-mutator/core غير مثبت");
  assert.ok(pkg.devDependencies?.["@stryker-mutator/vitest-runner"], "vitest-runner غير مثبت");
});

test("T-MUT-002: تقرير الحملة موجود وبأرقامها الحقيقية", () => {
  assert.ok(existsSync(DOC), "docs/security/mutation-core.md مفقود");
  const md = readFileSync(DOC, "utf8");
  assert.ok(md.includes("P6-005"), "يحمل معرف المهمة");
  assert.ok(md.includes("2026-10-24"), "يحمل تاريخ الحملة");
  assert.ok(md.includes("30.48"), "النتيجة الإجمالية الحقيقية (30.48%) غير موثقة");
  assert.ok(md.includes("3494"), "إجمالي الطفرات (3494) غير موثق");
});

test("T-MUT-003: الفجوة عن القبول معلنة بصدق", () => {
  const md = readFileSync(DOC, "utf8");
  assert.ok(md.includes("60%"), "حد القبول (60%) غير مذكور");
  // below-acceptance must be explicit, not buried
  assert.ok(/أقل من حد القبول|لم يتحقق/.test(md), "إعلان الفجوة مفقود");
  assert.ok(md.includes("DECLARED_LIMITS"), "الربط بDECLARED_LIMITS مفقود");
});
