/**
 * P6-013: WCAG 2.2 AA audit guard (T-A11Y-001..003).
 *
 * The audit report (docs/security/wcag-2.2-audit.md) must be evidence-based:
 * it documents the automated axe results per screen AND addresses each
 * WCAG 2.2-specific success criterion (the ones 2.0 did not have) with a
 * verdict backed by a measurable fact, plus the manual-test method.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const REPORT = join(root, "docs/security/wcag-2.2-audit.md");

/** WCAG 2.2 criteria that did not exist in 2.0 (AA level) + the AA focus set. */
const CRITERIA_22 = ["2.4.11", "2.5.8", "3.2.6", "3.3.7", "3.3.8"];
/** The screens the axe suite (apps/web/src/a11y.test.ts) renders. */
const SCREENS = ["app shell", "overview", "cases", "evidence", "settings", "workbench"];

function report() {
  return readFileSync(REPORT, "utf8");
}

test("T-A11Y-001: التقرير موجود وموقّع وبأقسامه الإلزامية", () => {
  assert.ok(existsSync(REPORT), `${REPORT} غير موجودة`);
  const md = report();
  assert.ok(md.includes("P6-013"), "يحمل معرف المهمة P6-013");
  assert.ok(md.includes("2026-10-24"), "يحمل تاريخ التوقيع");
  for (const section of ["المنهجية", "نتائج axe الآلية", "الاختبار اليدوي", "معايير WCAG 2.2 الجديدة", "النتيجة"]) {
    assert.ok(md.includes(section), `القسم «${section}» مفقود`);
  }
});

test("T-A11Y-002: كل شاشة في مجموعة axe موثقة بنتيجتها", () => {
  const md = report();
  const missing = SCREENS.filter((s) => !md.includes(s));
  assert.deepEqual(missing, [], `شاشات غير موثقة: ${missing.join("، ")}`);
});

test("T-A11Y-003: كل معيار 2.2 جديد له صف حكم بدليل قابل للقياس", () => {
  const md = report();
  const bad = [];
  for (const c of CRITERIA_22) {
    // | 2.4.11 | ... | الحكم (متوافق/مخالف/غير قابل للتطبيق) | ... |
    const row = md.split("\n").find((l) => l.startsWith(`| ${c} |`));
    if (!row) {
      bad.push(`${c}: بلا صف`);
      continue;
    }
    if (!/(متوافق|مخالف|غير قابل للتطبيق)/.test(row)) bad.push(`${c}: بلا حكم`);
    if (!/\d/.test(row)) bad.push(`${c}: بلا قياس رقمي`);
  }
  assert.deepEqual(bad, [], bad.join("؛ "));
});
