import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// P6-017 (owner directive 2026-10-18): every pull request title must start with
// a task id like "[P3-001] description" — the squash merge commit inherits the
// title, so the merge commit carries the task id too (GR-03 for merge commits).
// P6-001 (defect from the #391 merge): the merge subject also inherits the title,
// and GR-03 requires a Conventional Commits type — PR-03 enforces it here so a
// bad title is rejected on the PR, not after the merge on main.
import { CONVENTIONAL_RE, subjectWithoutTaskPrefix } from "./check.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BRACKET_RE = /\[(P[0-9]-\d{3})\]/;
const TASK_ROW_RE = /^\|\s*(P[0-9]-\d{3})\s*\|/gm;

function roadmapIds() {
  const roadmap = readFileSync(path.join(ROOT, "docs", "ROADMAP.md"), "utf8");
  // Task rows in the ROADMAP tables are `| P3-001 | ...`; bracketed ids appear
  // in prose. Both spell the same id space.
  const ids = new Set([...roadmap.matchAll(TASK_ROW_RE)].map((m) => m[1]));
  for (const m of roadmap.matchAll(/\[(P[0-9]-\d{3})\]/g)) ids.add(m[1]);
  return ids;
}

/** Returns the list of errors for a PR title (empty = valid). */
export function evaluateTitle(title, ids) {
  const errors = [];
  const text = (title ?? "").trim();
  const match = text.match(BRACKET_RE);
  if (!match || text.indexOf(match[0]) !== 0) {
    errors.push('PR-01: the PR title must start with a task id, e.g. "[P3-001] description".');
    return errors;
  }
  const referenced = [...new Set([...text.matchAll(/\[(P[0-9]-\d{3})\]/g)].map((m) => m[1]))];
  for (const id of referenced) {
    if (!ids.has(id)) errors.push(`PR-02: task id ${id} does not exist in docs/ROADMAP.md.`);
  }
  if (!CONVENTIONAL_RE.test(subjectWithoutTaskPrefix(text))) {
    errors.push(
      'PR-03: after the task id prefix, the title must follow Conventional Commits "type(scope): summary" (ADR-22) — the squash merge subject inherits it and GR-03 applies on main.',
    );
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
  console.log("PR title OK: starts with a task id present in the ROADMAP.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
