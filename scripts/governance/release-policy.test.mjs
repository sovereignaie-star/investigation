/**
 * P7-011: release and support policy guard (T-RELP-001..003).
 *
 * docs/release-policy.md must define the release stages with written
 * transition criteria, the support windows (current = full, previous =
 * security fixes for 6 months), and be grounded in the actual release
 * line (P7-001: changesets/semver, v* tags, release workflow, v0.1.0).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const POL = join(root, "docs/release-policy.md");

function pol() {
  assert.ok(existsSync(POL), `${POL} غير موجودة`);
  return readFileSync(POL, "utf8");
}

test("T-RELP-001: المراحل الخمس بمعايير انتقال مكتوبة", () => {
  const md = pol();
  assert.ok(md.includes("P7-011"), "يحمل معرف المهمة P7-011");
  for (const stage of ["Alpha داخلي", "Beta مغلق", "Beta عام", "RC", "مستقر"]) {
    assert.ok(md.includes(stage), `المرحلة «${stage}» مفقودة`);
    // each stage heading must be followed by a transition criteria marker
    const idx = md.indexOf(stage);
    const window = md.slice(idx, idx + 600);
    assert.ok(window.includes("معيار الانتقال") || window.includes("معايير الانتقال"), `معايير انتقال «${stage}» مفقودة`);
  }
});

test("T-RELP-002: نوافذ الدعم (كامل للحي، أمنية 6 أشهر للسابق)", () => {
  const md = pol();
  assert.ok(md.includes("دعم كامل"), "دعم كامل للإصدار الحي غير مذكور");
  assert.ok(md.includes("6 أشهر"), "نافذة الإصلاحات الأمنية 6 أشهر غير مذكورة");
  assert.ok(/v0\.1\.0/.test(md), "الإصدار v0.1.0 غير مصنف في مرحلة");
  assert.ok(md.includes("SECURITY.md"), "الربط بسياسة الإفصاح مفقود");
});

test("T-RELP-003: السياسة مرتبطة بخط الإصدار الفعلي", () => {
  const md = pol();
  assert.ok(md.includes("semver"), "semver غير مذكور");
  assert.ok(md.includes("changeset"), "changesets غير مذكور");
  assert.ok(md.includes("v*") || md.includes("release.yml"), "آلية الوسم/سير عمل الإصدار غير مذكورة");
  assert.ok(md.includes("P6-011"), "حالة Beta (P6-011) غير مرتبطة");
});
