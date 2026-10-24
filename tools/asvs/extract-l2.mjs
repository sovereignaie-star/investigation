// استخراج بنود ASVS 4.0.3 المستوى 2 من ملفات الفصول الرسمية (Markdown)
// المصدر: OWASP/ASVS commit 4963e2bc55e8f9607c05d88dafb0c52c10ba4a4c (4.0/en)
// الترخيص: CC BY-SA 4.0 — https://github.com/OWASP/ASVS/blob/master/LICENSE.md
import { readFileSync, writeFileSync } from "node:fs";

const files = [
  ["0x10-V1-Architecture.md", "V1"],
  ["0x11-V2-Authentication.md", "V2"],
  ["0x12-V3-Session-management.md", "V3"],
  ["0x12-V4-Access-Control.md", "V4"],
  ["0x13-V5-Validation-Sanitization-Encoding.md", "V5"],
  ["0x14-V6-Cryptography.md", "V6"],
  ["0x15-V7-Error-Logging.md", "V7"],
  ["0x16-V8-Data-Protection.md", "V8"],
  ["0x17-V9-Communications.md", "V9"],
  ["0x18-V10-Malicious.md", "V10"],
  ["0x19-V11-BusLogic.md", "V11"],
  ["0x20-V12-Files-Resources.md", "V12"],
  ["0x21-V13-API.md", "V13"],
  ["0x22-V14-Config.md", "V14"],
];

const rows = [];
for (const [file, chapter] of files) {
  const md = readFileSync(file, "utf8");
  let section = "";
  for (const line of md.split("\n")) {
    const h = line.match(/^## (V[\d.]+) /);
    if (h) section = h[1];
    if (!line.startsWith("| **")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // | id | desc | L1 | L2 | L3 | CWE |
    const [id, desc, l1, l2, l3, cwe] = [cells[1], cells[2], cells[3], cells[4], cells[5], cells[6]];
    if (!/^\d+\.\d+\.\d+$/.test(id.replace(/\*/g, ""))) continue;
    if (!l2.includes("✓")) continue;
    const text = desc
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    rows.push({ chapter, section, id: id.replace(/\*/g, ""), text, cwe });
  }
}
const csv = rows.map((r) => [r.chapter, r.section, r.id, `"${r.text.replace(/"/g, '""')}"`, r.cwe].join(",")).join("\n");
writeFileSync("asvs-4.0.3-l2.csv", csv + "\n");
console.log(
  JSON.stringify({
    total: rows.length,
    byChapter: Object.entries(rows.reduce((a, r) => ((a[r.chapter] = (a[r.chapter] ?? 0) + 1), a), {})),
  }),
);
