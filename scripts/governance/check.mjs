#!/usr/bin/env node
// Governance guard for Investigation Room. Enforces GOVERNANCE.md rules GR-01..GR-05, GR-09.
//
//   node scripts/governance/check.mjs --commit-msg <file>   # used by .githooks/commit-msg (staged changes)
//   node scripts/governance/check.mjs --range <base>..<head> # used by CI on every commit of a PR / push
//   node scripts/governance/check.mjs --consistency          # ROADMAP tasks <-> STATUS rows
//   node scripts/governance/check.mjs --last                 # check HEAD commit only
//
// No dependencies; Node >= 20.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const STATUS = "docs/STATUS.md";
export const WORKLOG = "docs/WORKLOG.md";
export const ROADMAP = "docs/ROADMAP.md";
export const VALID_STATES = new Set(["todo", "in_progress", "blocked", "done", "dropped"]);
const TASK_RE = /\[(P[0-7]-\d{3})\]/g;
const BOT_AUTHORS = new Set(["dependabot[bot]", "renovate[bot]", "github-actions[bot]"]);

function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
}

export function roadmapTaskIds(text) {
  const ids = new Set();
  for (const m of text.matchAll(/^\|\s*(P[0-7]-\d{3})\s*\|/gm)) ids.add(m[1]);
  return ids;
}

export function statusRows(text) {
  const rows = new Map();
  for (const m of text.matchAll(/^\|\s*(P[0-7]-\d{3})\s*\|([^\n]*)$/gm)) {
    const cells = m[2].split("|").map((c) => c.trim());
    // Row format: | ID | task | state | evidence | ...  -> state is the 2nd cell after the id.
    const state = (cells[1] || "").replace(/`/g, "");
    rows.set(m[1], state);
  }
  return rows;
}

export function taskIdsInMessage(msg) {
  return [...new Set([...msg.matchAll(TASK_RE)].map((m) => m[1]))];
}

/** Core rule evaluation, pure so it can be unit-tested. */
export function evaluate({ files, message, worklogAdded, worklogRemoved, roadmapIds }) {
  const errors = [];
  const changed = new Set(files);
  if (!changed.has(STATUS)) errors.push(`GR-01: ${STATUS} must be updated in the same commit.`);
  if (!changed.has(WORKLOG)) errors.push(`GR-01: ${WORKLOG} must get a new entry in the same commit.`);
  const ids = taskIdsInMessage(message);
  if (ids.length === 0) errors.push("GR-03: commit message must reference at least one task id, e.g. [P0-004].");
  for (const id of ids) if (!roadmapIds.has(id)) errors.push(`GR-03: task ${id} does not exist in ${ROADMAP}.`);
  if (changed.has(WORKLOG)) {
    const added = worklogAdded.join("\n");
    if (!added.trim()) errors.push(`GR-04: ${WORKLOG} has no added lines.`);
    for (const id of ids) if (!added.includes(id)) errors.push(`GR-04: new ${WORKLOG} entry must mention ${id}.`);
    const removedNonBlank = worklogRemoved.filter((l) => l.trim() !== "");
    if (removedNonBlank.length) errors.push(`GR-09: ${WORKLOG} is append-only; ${removedNonBlank.length} line(s) removed.`);
  }
  return errors;
}

function diffLines(diff) {
  const added = [], removed = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed.push(line.slice(1));
  }
  return { added, removed };
}

function readRoadmapIds(ref) {
  const text = ref ? git(["show", `${ref}:${ROADMAP}`]) : readFileSync(path.join(ROOT, ROADMAP), "utf8");
  return roadmapTaskIds(text);
}

function checkStaged(msgFile) {
  const message = readFileSync(msgFile, "utf8").split("\n").filter((l) => !l.startsWith("#")).join("\n");
  if (/^(Merge|Revert) /.test(message)) return [];
  const files = git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
  const { added, removed } = diffLines(git(["diff", "--cached", "-U0", "--", WORKLOG]));
  const roadmapIds = existsSync(path.join(ROOT, ROADMAP)) ? readRoadmapIds(null) : new Set();
  return evaluate({ files, message, worklogAdded: added, worklogRemoved: removed, roadmapIds });
}

function checkCommit(sha) {
  const parents = git(["rev-list", "--parents", "-n", "1", sha]).trim().split(" ").slice(1);
  if (parents.length > 1) return { skipped: "merge" };
  const author = git(["log", "-1", "--format=%an", sha]).trim();
  const message = git(["log", "-1", "--format=%B", sha]);
  if (BOT_AUTHORS.has(author)) return { skipped: "bot", author };
  const base = parents[0] || "4b825dc642cb6eb9a060e54bf8d69288fbee4904"; // empty tree for root commit
  const files = git(["diff", "--name-only", base, sha]).split("\n").filter(Boolean);
  const { added, removed } = diffLines(git(["diff", "-U0", base, sha, "--", WORKLOG]));
  let roadmapIds;
  try { roadmapIds = readRoadmapIds(sha); } catch { roadmapIds = new Set(); }
  return { errors: evaluate({ files, message, worklogAdded: added, worklogRemoved: removed, roadmapIds }) };
}

function checkRange(range) {
  const shas = git(["rev-list", "--reverse", range]).split("\n").filter(Boolean);
  let failed = 0, botOnly = 0, compliant = 0;
  for (const sha of shas) {
    const subject = git(["log", "-1", "--format=%h %s", sha]).trim();
    const r = checkCommit(sha);
    if (r.skipped === "merge") { console.log(`skip  ${subject} (merge)`); continue; }
    if (r.skipped === "bot") { botOnly++; console.log(`bot   ${subject} (${r.author}) – needs a governed follow-up commit in the same PR`); continue; }
    if (r.errors.length) { failed++; console.log(`FAIL  ${subject}`); for (const e of r.errors) console.log(`      - ${e}`); }
    else { compliant++; console.log(`ok    ${subject}`); }
  }
  if (botOnly && !compliant) { console.log("FAIL  bot commits present without any governed commit updating STATUS/WORKLOG (GR-01)."); failed++; }
  console.log(`\n${shas.length} commit(s) checked, ${failed} failing.`);
  return failed;
}

export function consistency(roadmapText, statusText) {
  const errors = [];
  const ids = roadmapTaskIds(roadmapText);
  const rows = statusRows(statusText);
  for (const id of ids) {
    if (!rows.has(id)) errors.push(`GR-05: ${id} is in ROADMAP but has no row in STATUS.`);
    else if (!VALID_STATES.has(rows.get(id))) errors.push(`GR-05: ${id} has invalid state "${rows.get(id)}".`);
  }
  for (const id of rows.keys()) if (!ids.has(id)) errors.push(`GR-05: ${id} is in STATUS but not in ROADMAP.`);
  return errors;
}

function main(argv) {
  const [mode, arg] = argv;
  let errors = [];
  if (mode === "--commit-msg") errors = checkStaged(arg);
  else if (mode === "--range") return process.exit(checkRange(arg) ? 1 : 0);
  else if (mode === "--last") errors = checkCommit("HEAD").errors || [];
  else if (mode === "--consistency") {
    errors = consistency(readFileSync(path.join(ROOT, ROADMAP), "utf8"), readFileSync(path.join(ROOT, STATUS), "utf8"));
    if (!errors.length) console.log("ROADMAP and STATUS are consistent.");
  } else {
    console.error("usage: check.mjs --commit-msg <file> | --range <a>..<b> | --last | --consistency");
    process.exit(2);
  }
  if (errors.length) {
    console.error("\nGovernance check failed (see GOVERNANCE.md):");
    for (const e of errors) console.error("  - " + e);
    console.error("\nUpdate docs/STATUS.md and add a docs/WORKLOG.md entry IN THIS SAME COMMIT, and reference the task id in the message.\n");
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv.slice(2));
