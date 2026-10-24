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
import ts from "typescript";

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
  "scripts/governance/asvs.test.mjs",
  "scripts/governance/threat-model.test.mjs",
  "scripts/governance/fuzz.test.mjs",
  "scripts/governance/deps.test.mjs",
  "scripts/governance/test-ports.test.mjs",
  "scripts/governance/dpia.test.mjs",
  "scripts/governance/perf.test.mjs",
  "scripts/governance/backup.test.mjs",
  "scripts/governance/delete.test.mjs",
  "scripts/governance/licenses.test.mjs",
  "scripts/governance/legal.test.mjs",
  "scripts/governance/wcag.test.mjs",
  "scripts/governance/runbooks.test.mjs",
  "scripts/governance/disclosure.test.mjs",
  "scripts/governance/release.test.mjs",
  "scripts/gates/security-review-gate.test.mjs",
]);
/** .test.mjs files run by an explicit pnpm script (documented, not CI) — allowlisted. */
const SCRIPT_RUN = new Set(["scripts/reference/iana-drift.test.mjs"]);

/**
 * Skip detection is a REAL PARSE (round-6), not a regex over source text: the
 * TypeScript parser (an existing workspace dependency) is the token authority —
 * strings and template literals (even nested ones containing "//") are text,
 * comments are never nodes, and the CALL STRUCTURE is walked on the AST:
 * `test.skip ("x")` (space), `test.skip.each([1])("x")` (chained modifier), and
 * `ctx.skip(` are all the same thing — a property access named skip/todo/skipIf/
 * only in the callee chain of a call. A parse still cannot see runtime control
 * flow (a test that RUNS but asserts nothing stays invisible — behavioral-red
 * discipline), but no SPELLING of a token-level skip hides behind lexing anymore.
 */
const SKIP_METHOD_NAMES = new Set(["skip", "todo", "skipIf", "only"]);

function scriptKindFor(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(filePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** The skip calls in a file with their 1-based lines (AST positions, always honest). */
function countSkipTokens(content: string, filePath = "file.test.ts"): { count: number; lines: number[] } {
  const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKindFor(filePath));
  const lines: number[] = [];
  const visit = (node: ts.Node, parent: ts.Node | undefined): void => {
    // a call that is itself the CALLEE of another call (describe.skipIf(cond)(...))
    // is not a separate skip — the outer call is the one being invoked. Without
    // this guard the same source skip is counted twice (round-6: baseline drift).
    const isCalleeOfAnotherCall = parent !== undefined && ts.isCallExpression(parent) && parent.expression === node;
    if (ts.isCallExpression(node) && !isCalleeOfAnotherCall) {
      let expr: ts.Expression = node.expression;
      let isSkip = false;
      // walk the callee chain: plain property access (test.skip), spaced
      // (test.skip ("x")), and chained modifiers (test.skip.each([1])(...))
      // all end in a skip method name somewhere in the chain.
      for (;;) {
        if (ts.isPropertyAccessExpression(expr)) {
          if (SKIP_METHOD_NAMES.has(expr.name.text)) {
            isSkip = true;
            break;
          }
          expr = expr.expression;
          continue;
        }
        if (ts.isCallExpression(expr)) {
          expr = expr.expression;
          continue;
        }
        break;
      }
      if (isSkip) lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    }
    ts.forEachChild(node, (child) => visit(child, node));
  };
  visit(sf, undefined);
  return { count: lines.length, lines };
}

/** A test-shaped file name: the guard looks at anything a runner might have claimed
 * (round-5: .mts/.cts restored — a .test.mts file is REAL here and must be REPORTED
 * as outside every runner, never silently vanish from the walk). */
function isTestFileName(name: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(name);
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
    const { count, lines } = countSkipTokens(f.content, f.path);
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

/** The real filesystem walk (exported for the self-test's round-5 negative control). */
export function walkTestFiles(repo: string): TestFile[] {
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
    const { count } = countSkipTokens(f.content, f.path);
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
