// T-TM-001..005 — P6-002: نموذج تهديدات STRIDE (docs/security/threat-model.md) محروس آلياً.
// Run: node --test scripts/governance/threat-model.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const MODEL = "docs/security/threat-model.md";

function rows() {
  const md = readFileSync(MODEL, "utf8");
  const out = new Map();
  const dupes = [];
  for (const line of md.split("\n")) {
    // | TM-X-nnn | البنية/الحد | التهديد | التخفيف | الخطر المتبقي | الحالة |
    const m = line.match(/^\|\s*(TM-[A-Z]-\d{3})\s*\|(.+)\|\s*(مخفف|خطر معلن)\s*\|$/);
    if (!m) continue;
    if (out.has(m[1])) dupes.push(m[1]);
    out.set(m[1], { rest: m[2], status: m[3] });
  }
  return { md, out, dupes };
}

const STRIDE = ["TM-S-", "TM-T-", "TM-R-", "TM-I-", "TM-D-", "TM-E-"];

test("T-TM-001: النموذج موجود وموقع (المهمة والتاريخ)", () => {
  const { md } = rows();
  assert.ok(md.includes("P6-002"), "النموذج يحمل معرف المهمة P6-002");
  assert.ok(md.includes("2026-10-24"), "النموذج يحمل تاريخ التوقيع");
  assert.ok(md.includes("توقيع"), "النموذج موقّع");
});

test("T-TM-002: الفئات الست لSTRIDE كلها موجودة وبكل فئة تهديدات فعلية", () => {
  const { out } = rows();
  const perCat = STRIDE.map((p) => [...out.keys()].filter((k) => k.startsWith(p)).length);
  assert.deepEqual(
    perCat.map((n) => n >= 5),
    [true, true, true, true, true, true],
    `عدد التهديدات لكل فئة: ${perCat}`,
  );
});

test("T-TM-003: كل تهديد يحمل تخفيفاً بدليل قابل للتحقق أو خطراً متبقياً صريحاً", () => {
  const { out } = rows();
  const bad = [];
  for (const [id, { rest, status }] of out) {
    const cells = rest.split("|").map((c) => c.trim());
    // البنية/الحد، التهديد، التخفيف، الخطر المتبقي
    const [scope, threat, mitigation, residual] = cells;
    if (!scope || !threat || !mitigation) bad.push(`${id}: أعمدة ناقصة`);
    if (status === "مخفف") {
      const hasTest = /\bT-[A-Z]+(-[A-Z]+)*-\d{3}/.test(mitigation);
      const hasGate = /\bG-\d{2}\b/.test(mitigation);
      const hasAdr = /\bADR-\d+/.test(mitigation);
      const hasPr = /\bPR #\d+/.test(mitigation);
      const paths = mitigation.match(/[\w./-]+\.(?:md|ts|mjs|json|yml|yaml|sql|sh)/g) ?? [];
      const hasFile = paths.some((p) => existsSync(p));
      if (!hasTest && !hasGate && !hasAdr && !hasPr && !hasFile) bad.push(`${id}: تخفيف بلا دليل`);
    }
    if (!residual || residual.replace(/\s/g, "").length < 5) bad.push(`${id}: خطر متبقٍ فارغ`);
  }
  assert.deepEqual(bad.slice(0, 10), [], `تهديدات ناقصة: ${bad.join(" | ")}`);
});

test("T-TM-004: كل حدود الثقة الستة (ADR-08/P2-003) مغطاة", () => {
  const { md } = rows();
  const boundaries = [
    "المتصفح ↔ الخادم",
    "الخادم ↔ بوابة الخروج",
    "البوابة ↔ المزودون الخارجيون",
    "الخادم ↔ العزل (sandbox)",
    "الخادم ↔ المخزن المشفر",
    "المشغّل ↔ CLI",
  ];
  const missing = boundaries.filter((b) => !md.includes(b));
  assert.deepEqual(missing, [], `حدود ثقة غير مغطاة: ${missing.join("، ")}`);
});

test("T-TM-005: لا تهديدات مكررة وكل معرفات النموذج فريدة", () => {
  const { dupes } = rows();
  assert.deepEqual(dupes, [], `معرفات مكررة: ${dupes.join(", ")}`);
});
