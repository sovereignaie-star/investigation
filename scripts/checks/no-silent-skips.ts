/**
 * Static guard (P4-007 — owner ruling 2026-10-21 18:55 +03): no test may be skipped silently.
 *
 * The trigger: `TimelineView.test.tsx` sat outside vitest's include pattern and never ran —
 * its "green" was assumed, not executed; a whole test file was silently skipped. The owner's
 * ruling: a CI guard that prevents any test.skip / silently-skipped test in NEW files.
 * Two failure classes:
 *  (A) new-skip — skip tokens (`.skip(`, `.todo(`, `.skipIf(`, `.only(`, `ctx.skip(`) growing
 *      beyond the committed baseline (skip-baseline.json, this directory). The baseline is a
 *      snapshot of the pre-existing skips: they are grandfathered; a NEW skip — in a new file
 *      or as growth in a baseline file — fails the build. Shrinking is allowed; regenerating the
 *      baseline is a deliberate act (run this module with --regen-baseline) that must ride a
 *      task-id'd commit and say why in the WORKLOG.
 *  (B) undiscovered — a `*.test.*` file no runner can load: not matching vitest's include
 *      roots (vitest.config.ts), not in the node --test sets CI runs, not in the explicit
 *      script-run allowlist. This is the .test.tsx defect class of this task: a file that
 *      exists, looks like a test, and never executes anywhere.
 *
 * WHAT THIS IS NOT: a regex cannot see runtime control flow — a test that RUNS but asserts
 * nothing is invisible here (that is a code-review matter, and the P4-007 behavioral-red
 * discipline). The rule is a floor: no token-level skip appears without the baseline, and no
 * test file escapes every runner.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export type Finding = {
  readonly kind: "new-skip" | "undiscovered";
  readonly file: string;
  readonly line: number;
  readonly detail: string;
};

export type TestFile = { readonly path: string; readonly content: string };

/** The committed baseline: file (repo-relative, posix) -> allowed token count. */
export type SkipBaseline = Record<string, number>;

export const BASELINE_PATH = "scripts/checks/skip-baseline.json";

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "coverage", ".git", "generated"]);

/** vitest include roots (vitest.config.ts) — the discovery check below flags any drift. */
const VITEST_ROOTS = ["lib/", "packages/", "apps/", "scripts/checks/", "docs/adr/reference/"];
/** vitest excludes apps/sandbox — its test files are not vitest-discovered. */
const VITEST_EXCLUDED = ["apps/sandbox/"];
/** Playwright specs (e2e workflow, playwright.config.ts) — a real runner, not vitest. */
const PLAYWRIGHT_ROOT = "scripts/e2e/";
/** Spec-shaped fixtures loaded (never registered) by the isolated-runner suite — a real import target. */
const FIXTURE_SPECS = new Set(["packages/transforms/src/transforms/tr-iso-test-transforms.spec.ts"]);
/** .test.mjs files CI runs with node --test (governance.yml). */
const NODE_TEST_CI = new Set([
  "scripts/governance/check.test.mjs",
  "scripts/governance/check-pr-title.test.mjs",
  "scripts/gates/security-review-gate.test.mjs",
]);
/** .test.mjs files run by an explicit pnpm script (documented, not CI) — allowlisted. */
const SCRIPT_RUN = new Set(["scripts/reference/iana-drift.test.mjs"]);

const SKIP_TOKEN_RE = /\.skip\(|\.todo\(|\.skipIf\(|\.only\(|ctx\.skip\(/;

function isTestFileName(name: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) || /\.test\.m?ts$/.test(name);
}

function vitestDiscovered(rel: string): boolean {
  if (!rel.endsWith(".test.ts")) return false;
  if (VITEST_EXCLUDED.some((p) => rel.startsWith(p))) return false;
  return VITEST_ROOTS.some((p) => rel.startsWith(p));
}

/** (B) every *.test.* file must be loadable by SOME runner — else it is silently dead. */
export function analyzeDiscovery(files: readonly TestFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const f of files) {
    const rel = f.path.split(path.sep).join("/");
    if (rel.startsWith("scripts/checks/") && rel.endsWith(".test.ts")) continue; // this guard's own suite
    if (rel.startsWith(PLAYWRIGHT_ROOT)) continue; // Playwright runs the e2e specs
    if (FIXTURE_SPECS.has(rel)) continue; // loaded by the isolated-runner suite, never a runner
    if (vitestDiscovered(rel)) continue;
    if (rel.endsWith(".test.mjs") && (NODE_TEST_CI.has(rel) || SCRIPT_RUN.has(rel))) continue;
    findings.push({
      kind: "undiscovered",
      file: rel,
      line: 0,
      detail:
        "no runner can load this test file (not vitest-discovered, not node --test in CI, not script-allowlisted) — it would never run",
    });
  }
  return findings;
}

/** (A) skip tokens may not grow beyond the baseline (new file or growth both fail). */
export function analyzeSkips(files: readonly TestFile[], baseline: SkipBaseline): Finding[] {
  const findings: Finding[] = [];
  for (const f of files) {
    const rel = f.path.split(path.sep).join("/");
    const allowed = baseline[rel] ?? 0;
    const lines = f.content.split("\n");
    let count = 0;
    const offenders: number[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (SKIP_TOKEN_RE.test(lines[i])) {
        count += 1;
        offenders.push(i + 1);
      }
    }
    if (count > allowed) {
      findings.push({
        kind: "new-skip",
        file: rel,
        line: offenders[0] ?? 0,
        detail: `${count} skip tokens (baseline allows ${allowed}) at lines ${offenders.join(", ")} — a new silent skip needs an owner-visible WORKLOG entry and a deliberate baseline regeneration`,
      });
    }
  }
  return findings;
}

function walkTestFiles(repo: string): TestFile[] {
  const out: TestFile[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIR_NAMES.has(name)) continue;
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!isTestFileName(name)) continue;
      const rel = path.relative(repo, full).split(path.sep).join("/");
      out.push({ path: rel, content: readFileSync(full, "utf8") });
    }
  };
  walk(repo);
  return out;
}

function loadBaseline(repo: string): SkipBaseline {
  const full = path.join(repo, BASELINE_PATH);
  return JSON.parse(readFileSync(full, "utf8")) as SkipBaseline;
}

/** The whole-repo scan the self-scan test runs against (and CI with it, via the suite). */
export function scanRepo(repo: string): Finding[] {
  const files = walkTestFiles(repo);
  return [...analyzeDiscovery(files), ...analyzeSkips(files, loadBaseline(repo))];
}

/** Deliberate baseline regeneration — must ride a task-id'd commit with a WORKLOG reason. */
export function regenBaseline(repo: string): SkipBaseline {
  const files = walkTestFiles(repo);
  const baseline: SkipBaseline = {};
  for (const f of files) {
    const count = f.content.split("\n").filter((l) => SKIP_TOKEN_RE.test(l)).length;
    if (count > 0) baseline[f.path] = count;
  }
  writeFileSync(path.join(repo, BASELINE_PATH), `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  return baseline;
}

// CLI: node --experimental-strip-types scripts/checks/no-silent-skips.ts [--regen-baseline] [repo]
if (process.argv[1] && process.argv[1].endsWith("no-silent-skips.ts")) {
  const args = process.argv.slice(2);
  const repo = args.find((a) => !a.startsWith("--")) ?? process.cwd();
  if (args.includes("--regen-baseline")) {
    const b = regenBaseline(repo);
    console.log(`baseline written: ${Object.keys(b).length} files with skips`);
  } else {
    const findings = scanRepo(repo);
    if (findings.length > 0) {
      for (const f of findings) console.error(`${f.kind}: ${f.file}:${f.line} — ${f.detail}`);
      process.exit(1);
    }
    console.log("no silent skips: zero findings");
  }
}
