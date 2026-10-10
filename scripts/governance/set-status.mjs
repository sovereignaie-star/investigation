#!/usr/bin/env node
// Update one or more task rows in docs/STATUS.md and recompute the phase-progress table and date.
//   node scripts/governance/set-status.mjs P0-004 done "PR #2: identifierList.ts repaired"
//   node scripts/governance/set-status.mjs --defect D-001 "مُصلح" "PR #2"
//   node scripts/governance/set-status.mjs --gate G-01 "متحققة"
//   node scripts/governance/set-status.mjs --summary "نص ملخص الحالة"
// You still have to add a docs/WORKLOG.md entry yourself (GR-04) — this tool never writes the WORKLOG.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STATUS, VALID_STATES } from "./check.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const file = path.join(ROOT, STATUS);
let s = readFileSync(file, "utf8");
const [a, b, c, d] = process.argv.slice(2);

/** IDs are validated and escaped before they reach a RegExp (CodeQL js/regex-injection). */
const esc = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function requireId(v, re, usage) {
  if (!re.test(v || "")) {
    console.error(usage);
    process.exit(2);
  }
  return esc(v);
}

function replaceRow(re, build) {
  const m = s.match(re);
  if (!m) {
    console.error(`row not found: ${re}`);
    process.exit(1);
  }
  s = s.replace(re, build(m));
}

if (a === "--defect") {
  const id = requireId(b, /^D-\d{3}$/, "usage: set-status.mjs --defect D-nnn <state> [ref]");
  replaceRow(new RegExp(`^\\| ${id} \\| ([^|]+)\\|[^|]*\\|[^|]*\\|$`, "m"), (m) => `| ${b} | ${m[1].trim()} | ${c} | ${d ?? "—"} |`);
} else if (a === "--gate") {
  const id = requireId(b, /^G-\d{2}$/, "usage: set-status.mjs --gate G-nn <state>");
  replaceRow(
    new RegExp(`^\\| ${id} \\| ([^|]+)\\| ([^|]+)\\| (\\d) \\|[^|]*\\|$`, "m"),
    (m) => `| ${b} | ${m[1].trim()} | ${m[2].trim()} | ${m[3]} | ${c} |`,
  );
} else if (a === "--summary") {
  replaceRow(/^\| ملخص الحالة \|[^\n]*$/m, () => `| ملخص الحالة | ${b} |`);
} else if (a === "--phase") {
  replaceRow(/^\| المرحلة الحالية \|[^\n]*$/m, () => `| المرحلة الحالية | ${b} |`);
} else {
  if (!/^P[0-9]-\d{3}$/.test(a || "") || !VALID_STATES.has(b)) {
    console.error("usage: set-status.mjs <Pn-nnn> <todo|in_progress|blocked|done|dropped> [evidence]");
    process.exit(2);
  }
  replaceRow(new RegExp(`^\\| ${esc(a)} \\| ([^|]+)\\|[^|]*\\|[^|]*\\|$`, "m"), (m) => `| ${a} | ${m[1].trim()} | ${b} | ${c ?? "—"} |`);
}

// Recompute phase progress from the task rows.
const rows = [...s.matchAll(/^\| (P([0-9])-\d{3}) \| [^|]+\| ([a-z_]+) \|/gm)];
for (let n = 0; n <= 9; n++) {
  const ph = rows.filter((r) => r[2] === String(n));
  const done = ph.filter((r) => r[3] === "done").length;
  const prog = ph.filter((r) => r[3] === "in_progress").length;
  s = s.replace(
    new RegExp(`^\\| ${n} \\| ([^|]+)\\| \\d+ \\| \\d+ \\| \\d+ \\|$`, "m"),
    (_m, t) => `| ${n} | ${t.trim()} | ${ph.length} | ${done} | ${prog} |`,
  );
}
const today = new Date().toISOString().slice(0, 10);
s = s.replace(/^\| آخر تحديث \|[^\n]*$/m, `| آخر تحديث | ${today} |`);
writeFileSync(file, s);
console.log(`updated ${STATUS}`);
