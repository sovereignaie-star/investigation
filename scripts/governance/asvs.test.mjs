// T-ASVS-001..004 — P6-001: قائمة تحقق OWASP ASVS 4.0.3 المستوى 2 (كل بند منجز أو مبرر).
// Run: node --test scripts/governance/asvs.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const CSV = "docs/security/asvs/asvs-4.0.3-l2.csv";
const CHECKLIST = "docs/security/asvs-l2-checklist.md";

function officialL2() {
  // CSV بلا ترويسة: الفصل، القسم، البند، النص، CWE
  return readFileSync(CSV, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const m = line.match(/^(V\d+),(V[\d.]+),(\d+\.\d+\.\d+),(.*)$/);
      if (!m) throw new Error(`سطر CSV غير مفهوم: ${line}`);
      return m[3];
    });
}

function checklistRows() {
  const md = readFileSync(CHECKLIST, "utf8");
  const rows = new Map();
  const dupes = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\|\s*(\d+\.\d+\.\d+)\s*\|\s*(منجز|مبرر)\s*\|\s*(.+?)\s*\|$/);
    if (!m) continue;
    if (rows.has(m[1])) dupes.push(m[1]);
    rows.set(m[1], { status: m[2], evidence: m[3] });
  }
  return { md, rows, dupes };
}

test("T-ASVS-001: قائمة التحقق موجعة وموقعة (ترويسة المهمة والتاريخ)", () => {
  const { md } = checklistRows();
  assert.ok(md.includes("P6-001"), "القائمة تحمل معرف المهمة P6-001");
  assert.ok(md.includes("2026-10-24"), "القائمة تحمل تاريخ التوقيع");
  assert.ok(md.includes("توقيع"), "القائمة موقعة (كتلة توقيع)");
});

test("T-ASVS-002: كل بند L2 رسمي مغطى مرة واحدة — لا ناقص ولا زائد", () => {
  const official = new Set(officialL2());
  const { rows, dupes } = checklistRows();
  assert.deepEqual(dupes, [], "لا تكرار للبنود");
  const missing = [...official].filter((id) => !rows.has(id));
  const extra = [...rows.keys()].filter((id) => !official.has(id));
  assert.deepEqual(missing, [], `بنود L2 غير مغطاة (${missing.length}): ${missing.slice(0, 10).join(", ")}…`);
  assert.deepEqual(extra, [], `بنود ليست في L2 الرسمي: ${extra.slice(0, 10).join(", ")}`);
});

test("T-ASVS-003: كل بند «منجز» يحمل دليلاً قابلاً للتحقق (ملف موجود أو مرجع اختبار/بوابة/قرار)", () => {
  const { rows } = checklistRows();
  const bad = [];
  for (const [id, { status, evidence }] of rows) {
    if (status !== "منجز") continue;
    const hasTest = /\bT-[A-Z]+-\d{3}/.test(evidence);
    const hasGate = /\bG-\d{2}\b/.test(evidence);
    const hasAdr = /\bADR-\d+/.test(evidence);
    const hasPr = /\bPR #\d+/.test(evidence);
    const paths = evidence.match(/[\w./-]+\.(?:md|ts|mjs|json|yml|yaml|sql|sh)/g) ?? [];
    const hasFile = paths.some((p) => existsSync(p));
    if (!hasTest && !hasGate && !hasAdr && !hasPr && !hasFile) bad.push(`${id}: ${evidence}`);
  }
  assert.deepEqual(bad, [], `بنود «منجز» بلا دليل قابل للتحقق: ${bad.slice(0, 10).join(" | ")}`);
});

test("T-ASVS-004: كل بند «مبرر» يحمل مبرراً حقيقياً لا فراغاً", () => {
  const { rows } = checklistRows();
  const bad = [];
  for (const [id, { status, evidence }] of rows) {
    if (status !== "مبرر") continue;
    if (evidence.replace(/\s/g, "").length < 15) bad.push(id);
  }
  assert.deepEqual(bad, [], `بنود «مبرر» بمبرر فارغ/هزيل: ${bad.join(", ")}`);
});

test("T-ASVS-005: حارس no-eval مفروض في إعدادات ESLint (ASVS 5.2.4)", () => {
  const cfg = readFileSync("eslint.config.mjs", "utf8");
  assert.ok(/"no-eval":\s*"error"/.test(cfg), "قاعدة no-eval غير مفعلة");
  assert.ok(/"no-new-func":\s*"error"/.test(cfg), "قاعدة no-new-func غير مفعلة");
});
