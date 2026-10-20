// P3-019: the bundle budget gate — «≤ 300KB مضغوطاً للتحميل الأولي». Reads the
// BUILT app's index.html, resolves every asset it references (scripts, module
// preloads, stylesheets), sums their GZIPPED sizes and fails above the budget.
// Run after `pnpm -r --if-present run build`.
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

const DIST = path.resolve(process.cwd(), "apps/web/dist/public");
const BUDGET_BYTES = 300 * 1024;

async function main() {
  const html = await readFile(path.join(DIST, "index.html"), "utf-8");
  const refs = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))];
  if (refs.length === 0) {
    console.error("no asset references found in index.html — was the app built?");
    process.exit(1);
  }
  let total = 0;
  const rows = [];
  for (const ref of refs) {
    const body = await readFile(path.join(DIST, ref));
    const gz = gzipSync(body).length;
    total += gz;
    rows.push(`${String(gz).padStart(8)} gz  ${ref}`);
  }
  console.log(rows.sort().join("\n"));
  const verdict = total <= BUDGET_BYTES ? "PASS" : "FAIL";
  console.log(`\ninitial load (gzipped): ${(total / 1024).toFixed(1)}KB / ${(BUDGET_BYTES / 1024).toFixed(0)}KB budget — ${verdict}`);
  if (total > BUDGET_BYTES) process.exit(1);
}

main().catch((x) => {
  console.error(x instanceof Error ? x.message : String(x));
  process.exit(1);
});
