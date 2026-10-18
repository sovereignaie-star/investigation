import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// P6-017 (owner directive 2026-10-18): every pull request title must carry a task
// id like "[P3-001] ..." — the squash merge commit inherits the title, so the
// merge commit carries the task id too (GR-03 for merge commits).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TASK_RE = /\[(P[0-9]-\d{3})\]/g;

function roadmapIds() {
  const roadmap = readFileSync(path.join(ROOT, "docs", "ROADMAP.md"), "utf8");
  return new Set([...roadmap.matchAll(TASK_RE)].map((m) => m[1]));
}

/** Returns the list of errors for a PR title (empty = valid). */
export function evaluateTitle(title, ids) {
  const errors = [];
  const referenced = [...new Set([...(title ?? "").matchAll(TASK_RE)].map((m) => m[1]))];
  if (referenced.length === 0) {
    errors.push("PR-01: the PR title must reference at least one task id, e.g. [P3-001] description.");
    return errors;
  }
  for (const id of referenced) {
    if (!ids.has(id)) errors.push(`PR-02: task id ${id} does not exist in docs/ROADMAP.md.`);
  }
  return errors;
}

function main() {
  const title = process.env.PR_TITLE ?? process.argv[2] ?? "";
  const errors = evaluateTitle(title, roadmapIds());
  if (errors.length > 0) {
    console.error("PR title check failed:");
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log("PR title OK: carries task id(s) present in the ROADMAP.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
