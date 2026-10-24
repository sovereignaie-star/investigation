import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("T-GATE-001: لوحة بوابات القسم 12 موجودة وتغطي G-01..G-50 كاملة", () => {
  const p = "docs/governance/gates-dashboard.md";
  assert.ok(existsSync(p), "لوحة البوابات مفقودة");
  const s = readFileSync(p, "utf8");
  for (let i = 1; i <= 50; i++) {
    const id = `G-${String(i).padStart(2, "0")}`;
    assert.ok(s.includes(`| ${id} `) || s.includes(`|${id}`) || new RegExp(`\\|\\s*${id}\\s*\\|`).test(s), `${id} مفقودة من اللوحة`);
  }
});

test("T-GATE-002: كل بوابة لها حالة من {أخضر، أحمر، محجوب} ودليل أو سبب", () => {
  const s = readFileSync("docs/governance/gates-dashboard.md", "utf8");
  const rows = s.split("\n").filter((l) => /^\|\s*G-\d\d\s*\|/.test(l));
  assert.ok(rows.length >= 50, `عدد صفوف البوابات ${rows.length} < 50`);
  for (const row of rows) {
    const cols = row.split("|").map((c) => c.trim());
    const status = cols[3];
    assert.ok(["أخضر", "أحمر", "محجوب"].includes(status), `حالة غير معروفة في: ${row.slice(0, 60)}`);
    const evidence = cols[4] || "";
    assert.ok(evidence.length > 3, `بلا دليل/سبب: ${row.slice(0, 60)}`);
  }
});

test("T-GATE-003: كل بوابة حمراء أو محجوبة مسبّبة بربط بمهمة أو قرار مالك", () => {
  const s = readFileSync("docs/governance/gates-dashboard.md", "utf8");
  const rows = s.split("\n").filter((l) => /^\|\s*G-\d\d\s*\|/.test(l));
  for (const row of rows) {
    const cols = row.split("|").map((c) => c.trim());
    if (cols[3] === "أحمر" || cols[3] === "محجوب") {
      assert.ok(/P\d-\d{3}|قرار المالك|المالك/.test(cols[4]), `سبب بلا رابط بمهمة/قرار: ${row.slice(0, 60)}`);
    }
  }
});
