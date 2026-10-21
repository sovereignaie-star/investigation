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
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** vitest's real include/exclude globs, PARSED from vitest.config.ts — not a hand copy. */
export type RunnerConfigs = {
  readonly vitestInclude: RegExp[];
  readonly vitestExclude: RegExp[];
  /** Playwright's real testMatch (from e2e/playwright.config.ts). */
  readonly playwrightTestMatch: RegExp;
};

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** A vitest include glob becomes an anchored regex: the double-star allows zero or
 * more directories, a single star never crosses a directory separator. */
function globToRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c !== "*") {
      re += c === "." ? "\\." : c;
      continue;
    }
    if (glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else {
      re += "[^/]*";
    }
  }
  return new RegExp(`^${re}$`);
}

function extractQuotedStrings(block: string): string[] {
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Parse the runner configs from the real files — the guard mirrors the runners, not a memory. */
export function loadRunnerConfigs(repo: string): RunnerConfigs {
  const vitestSrc = readFileSync(path.join(repo, "vitest.config.ts"), "utf8");
  const incStart = vitestSrc.indexOf("include: [") + "include: [".length;
  const includeBlock = vitestSrc.slice(incStart, vitestSrc.indexOf("]", incStart));
  const excStart = vitestSrc.indexOf("exclude: [") + "exclude: [".length;
  const excludeBlock = vitestSrc.slice(excStart, vitestSrc.indexOf("]", excStart));
  const playwrightSrc = readFileSync(path.join(repo, "scripts/e2e/playwright.config.ts"), "utf8");
  const m = playwrightSrc.match(/testMatch:\s*\/(.+)\//);
  if (!m) throw new Error("no-silent-skips: cannot parse playwright testMatch — the guard refuses to run blind");
  return {
    vitestInclude: extractQuotedStrings(includeBlock).map(globToRegex),
    vitestExclude: extractQuotedStrings(excludeBlock).map(globToRegex),
    playwrightTestMatch: new RegExp(m[1]),
  };
}

/** Playwright specs (e2e workflow) — a real runner, discovered by its own config. */
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

/** A skip token keyed on the CALL STRUCTURE, not a tight textual sequence (round-4:
 * `test.skip ("x")` — a space before the argument list — is a real skip). */
const SKIP_TOKEN_RE = /\.\s*(?:skip|todo|skipIf|only)\s*\(|ctx\s*\.\s*skip\s*\(/g;

/** Strip comments so a token mentioned in a comment is not a false positive. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** The skip tokens in a file with their 1-based lines. */
function countSkipTokens(content: string): { count: number; lines: number[] } {
  const code = stripComments(content);
  const lines: number[] = [];
  for (const m of code.matchAll(SKIP_TOKEN_RE)) {
    lines.push(code.slice(0, m.index).split("\n").length);
  }
  return { count: lines.length, lines };
}

/** A test-shaped file name: the guard looks at anything a runner might have claimed. */
function isTestFileName(name: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name);
}

function vitestDiscovered(rel: string, cfg: RunnerConfigs): boolean {
  if (!cfg.vitestInclude.some((re) => re.test(rel))) return false;
  return !cfg.vitestExclude.some((re) => re.test(rel));
}

/** (B) every *.test.* file must be loadable by SOME runner — else it is silently dead.
 * The runner sets are the REAL configs (vitest include/exclude parsed from vitest.config.ts;
 * Playwright testMatch parsed from e2e/playwright.config.ts) — never a hand-copied list. */
export function analyzeDiscovery(files: readonly TestFile[], configs?: RunnerConfigs): Finding[] {
  const cfg = configs ?? loadRunnerConfigs(REPO_ROOT);
  const findings: Finding[] = [];
  for (const f of files) {
    const rel = f.path.split(path.sep).join("/");
    if (rel.startsWith(PLAYWRIGHT_ROOT)) {
      // the exemption mirrors the runner's OWN testMatch: a spec the config would
      // not load (e.g. _tmp-shot.spec.ts) is flagged, not waved through by directory.
      const base = rel.slice(PLAYWRIGHT_ROOT.length);
      if (cfg.playwrightTestMatch.test(base)) continue;
      findings.push({
        kind: "undiscovered",
        file: rel,
        line: 0,
        detail: "a Playwright spec the real testMatch would not load — it would never run",
      });
      continue;
    }
    if (FIXTURE_SPECS.has(rel)) continue; // loaded by the isolated-runner suite, never a runner
    if (vitestDiscovered(rel, cfg)) continue;
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
    const { count, lines } = countSkipTokens(f.content);
    if (count > allowed) {
      findings.push({
        kind: "new-skip",
        file: rel,
        line: lines[0] ?? 0,
        detail: `${count} skip tokens (baseline allows ${allowed}) at lines ${lines.join(", ")} — a new silent skip needs an owner-visible WORKLOG entry and a deliberate baseline regeneration`,
      });
    }
  }
  return findings;
}

function walkTestFiles(repo: string): TestFile[] {
  const out: TestFile[] = [];
  const walk = (dir: string): void => {
    // withFileTypes: the directory entry and its kind arrive from ONE readdir
    // call — no separate stat-then-read window (CodeQL: race-on-check-then-use).
    // If a file vanishes between listing and reading, the honest failure is
    // the ENOENT throw — never a silently-skipped test.
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!isTestFileName(entry.name)) continue;
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
    const { count } = countSkipTokens(f.content);
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
