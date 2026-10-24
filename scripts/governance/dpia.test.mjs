// T-DPIA-001..005 — P6-010: تقييم الأثر على الخصوصية (docs/security/dpia.md) محروس آلياً.
// Run: node --test scripts/governance/dpia.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const DOC = "docs/security/dpia.md";

function doc() {
  return readFileSync(DOC, "utf8");
}

function rows() {
  const md = doc();
  const out = new Map();
  const dupes = [];
  for (const line of md.split("\n")) {
    // | DP-nnn | الفئة | الخطر على صاحب البيانات | التدبير المخفف | الخطر المتبقي | الحالة |
    const m = line.match(/^\|\s*(DP-\d{3})\s*\|(.+)\|\s*(مخفف|خطر معلن)\s*\|$/);
    if (!m) continue;
    if (out.has(m[1])) dupes.push(m[1]);
    out.set(m[1], { rest: m[2], status: m[3] });
  }
  return { md, out, dupes };
}

/** الأقسام الإلزامية (GDPR Art. 35(7) + PDPL) */
const SECTIONS = [
  "وصف منهجي",
  "البيانات الشخصية",
  "الأغراض والأساس القانوني",
  "الضرورة والتناسب",
  "المخاطر والتدابير",
  "المخاطر المتبقية",
  "النتيجة",
];

test("T-DPIA-001: الوثيقة موجودة وموقعة (المهمة والتاريخ)", () => {
  assert.ok(existsSync(DOC), `${DOC} غير موجودة`);
  const md = doc();
  assert.ok(md.includes("P6-010"), "الوثيقة تحمل معرف المهمة P6-010");
  assert.ok(md.includes("2026-10-24"), "الوثيقة تحمل تاريخ التوقيع");
  assert.ok(md.includes("توقيع"), "الوثيقة موقّعة");
});

test("T-DPIA-002: الأقسام الإلزامية كلها موجودة", () => {
  const { md } = rows();
  const missing = SECTIONS.filter((s) => !md.includes(s));
  assert.deepEqual(missing, [], `أقسام ناقصة: ${missing.join("، ")}`);
});

test("T-DPIA-003: كل خطر يحمل تدبيراً بدليل قابل للتحقق أو خطراً متبقياً صريحاً", () => {
  const { out } = rows();
  assert.ok(out.size >= 8, `عدد المخاطر صغير جداً: ${out.size}`);
  const bad = [];
  for (const [id, { rest, status }] of out) {
    const cells = rest.split("|").map((c) => c.trim());
    // الفئة، الخطر، التدبير، الخطر المتبقي
    const [cat, risk, measure, residual] = cells;
    if (!cat || !risk || !measure) bad.push(`${id}: أعمدة ناقصة`);
    if (status === "مخفف") {
      const hasTest = /\bT-[A-Z]+(-[A-Z]+)*-\d{3}/.test(measure);
      const hasGate = /\bG-\d{2}\b/.test(measure);
      const hasAdr = /\bADR-\d+/.test(measure);
      const hasTask = /\bP\d-\d{3}\b/.test(measure);
      const paths = measure.match(/[\w./-]+\.(?:md|ts|mjs|json|yml|yaml|sql|sh)/g) ?? [];
      const hasFile = paths.some((p) => existsSync(p));
      if (!hasTest && !hasGate && !hasAdr && !hasTask && !hasFile) bad.push(`${id}: تدبير بلا دليل`);
    }
    if (!residual || residual.replace(/\s/g, "").length < 5) bad.push(`${id}: خطر متبقٍ فارغ`);
  }
  assert.deepEqual(bad, [], bad.join("؛ "));
});

test("T-DPIA-004: كل تدفق معالجة مغطى (محلي، بوابة الخروج، مزوّد الذكاء، العزل)", () => {
  const { md } = rows();
  for (const flow of ["بوابة الخروج", "المزوّد المحلي", "العزل", "الخادم المحلي"]) {
    assert.ok(md.includes(flow), `التدفق «${flow}» غير مغطى`);
  }
});

test("T-DPIA-005: حقوق صاحب البيانات مرتبطة بالتنفيذ (الحذف، التقليل، بوابة الأشخاص)", () => {
  const { md } = rows();
  assert.ok(/P6-008/.test(md), "الحذف الآمن (P6-008) غير مرجع");
  assert.ok(/P2-013/.test(md), "بوابة الأشخاص الطبيعيين (P2-013) غير مرجعة");
  assert.ok(md.includes("تقليل"), "مبدأ تقليل البيانات غير مذكور");
});
