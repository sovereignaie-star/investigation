/**
 * P7-006: runbooks and incident response guard (T-RB-001..003).
 *
 * docs/runbooks/* must cover the operational surfaces of the system, each
 * runbook must carry its mandatory sections (trigger, steps, verification,
 * rollback where applicable, escalation), and at least one real exercise
 * must be documented with a date and measurable evidence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RB = join(root, "docs/runbooks");

function rb(name) {
  const p = join(RB, name);
  assert.ok(existsSync(p), `${p} غير موجودة`);
  return readFileSync(p, "utf8");
}

test("T-RB-001: كتيبات التشغيل الإلزامية موجودة", () => {
  const required = [
    "backup-restore.md",
    "incident-response.md",
    "ci-governance-failure.md",
    "release.md",
    "secrets-rotation.md",
    "dependency-vulnerability.md",
  ];
  for (const name of required) rb(name);
  const files = readdirSync(RB).filter((f) => f.endsWith(".md"));
  assert.ok(files.length >= required.length, "دليل إضافي مقبول، لكن الناقص مرفوض");
});

test("T-RB-002: كل كتيب بأقسامه الإلزامية", () => {
  const required = [
    "backup-restore.md",
    "incident-response.md",
    "ci-governance-failure.md",
    "release.md",
    "secrets-rotation.md",
    "dependency-vulnerability.md",
  ];
  const sections = ["متى يُستخدم", "الخطوات", "التحقق", "التصعيد"];
  for (const name of required) {
    const md = rb(name);
    assert.ok(md.includes("P7-006"), `${name} يحمل معرف المهمة P7-006`);
    const missing = sections.filter((s) => !md.includes(s));
    assert.deepEqual(missing, [], `${name}: أقسام ناقصة: ${missing.join("، ")}`);
  }
});

test("T-RB-003: تمرين واحد موثق على الأقل بأدلة", () => {
  const md = rb("exercises.md");
  assert.ok(md.includes("P7-006"), "يحمل معرف المهمة P7-006");
  assert.ok(/\d{4}-\d{2}-\d{2}/.test(md), "يحمل تاريخاً");
  assert.ok(md.includes("تمرين") && (md.includes("النتيجة") || md.includes("النتائج")), "وثيقة التمرين بنتيجته");
  // the exercise must reference measurable evidence (run ids / commands)
  assert.ok(md.includes("`"), "يحمل أوامر/معرفات قابلة للقياس");
});
