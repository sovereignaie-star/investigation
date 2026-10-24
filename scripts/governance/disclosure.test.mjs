/**
 * P7-007: vulnerability disclosure policy guard (T-DISC-001..003).
 *
 * SECURITY.md must be the complete disclosure policy of the project: a
 * working private channel, coordinated-disclosure commitments with SLAs,
 * severity classification, researcher safe harbor, an honest bounty status,
 * and cross-references to the abuse-report and dependency-alert channels.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SEC = join(root, "SECURITY.md");
const ABUSE = join(root, "docs/legal/abuse-report.ar.md");

function md(p) {
  assert.ok(existsSync(p), `${p} غير موجودة`);
  return readFileSync(p, "utf8");
}

test("T-DISC-001: سياسة الإفصاح الكاملة بأقسامها الإلزامية", () => {
  const s = md(SEC);
  assert.ok(s.includes("P7-007"), "يحمل معرف المهمة P7-007");
  for (const section of ["قناة الإبلاغ", "تصنيف الخطورة", "ملاذ الباحثين", "برنامج المكافآت", "الإصدارات المدعومة", "الإفصاح المنسق"]) {
    assert.ok(s.includes(section), `القسم «${section}» مفقود`);
  }
});

test("T-DISC-002: القناة الخاصة موثقة بروابطها وسياقها", () => {
  const s = md(SEC);
  assert.ok(s.includes("security/advisories"), "رابط استشارات أمن خاصة مفقود");
  assert.ok(s.includes("private-vulnerability-reporting") || s.includes("Report a vulnerability"), "صيغة القناة الخاصة مفقودة");
  // the channel state is a repo setting — the policy must tie the acceptance to it
  assert.ok(s.includes("قناة تعمل"), "إثبات عمل القناة مطلوب نصاً");
});

test("T-DISC-003: ترابط القنوات (إساءة الاستخدام واعتماديات) صادق", () => {
  const s = md(SEC);
  const abuse = md(ABUSE);
  assert.ok(s.includes("abuse-report"), "SECURITY.md لا يحيل إلى قناة الإساءة");
  assert.ok(abuse.includes("SECURITY.md"), "abuse-report لا يحيل إلى SECURITY.md");
  // bounty status must be an explicit honest declaration (yes or no), not silence
  assert.ok(/برنامج المكافآت[^\n]*(:|—)/.test(s), "حالة برنامج المكافآت غير معلنة صراحة");
  // supported versions must mention the actual first release
  assert.ok(s.includes("v0.1.0"), "الإصدار v0.1.0 غير مذكور في المدعومات");
});
