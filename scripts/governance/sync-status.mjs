#!/usr/bin/env node
// Lists ROADMAP tasks missing from docs/STATUS.md; with --write appends them as `todo`.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { roadmapTaskIds, statusRows, ROADMAP, STATUS } from "./check.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const roadmap = readFileSync(path.join(ROOT, ROADMAP), "utf8");
const status = readFileSync(path.join(ROOT, STATUS), "utf8");
const rows = statusRows(status);
const titles = new Map();
for (const m of roadmap.matchAll(/^\|\s*(P[0-9]-\d{3})\s*\|\s*([^|]+)\|/gm)) titles.set(m[1], m[2].trim());
const missing = [...roadmapTaskIds(roadmap)].filter((id) => !rows.has(id));
if (!missing.length) { console.log("STATUS already lists every ROADMAP task."); process.exit(0); }
const lines = missing.map((id) => `| ${id} | ${titles.get(id) ?? ""} | todo | — |`);
console.log(lines.join("\n"));
if (process.argv.includes("--write")) {
  const block = `\n### مهام أضيفت لاحقاً (رتّبها في جدول مرحلتها)\n\n| المعرّف | المهمة | الحالة | الدليل |\n|---|---|---|---|\n${lines.join("\n")}\n`;
  writeFileSync(path.join(ROOT, STATUS), status.trimEnd() + "\n" + block);
  console.log(`\nAppended ${missing.length} row(s) to ${STATUS}.`);
}
