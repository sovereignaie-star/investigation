/**
 * Static guard (P2-006 / D-017): no silent `catch {}` in executable code.
 *
 * D-017: a `catch {}` that swallows every error leaves no negative evidence and no diagnosis —
 * a failed lookup is indistinguishable from "searched, found nothing". This analyzer parses every
 * executable TypeScript source with the TypeScript compiler API (not a text search) and reports a
 * `catch` block whose body has NO statements (empty, or comment-only). A catch that rethrows,
 * records, logs, or returns a typed failure is fine; a catch that does nothing is a finding.
 *
 * Test files are classified separately (they may legitimately assert that a function swallows an
 * error), and the browser app (`apps/web`) is excluded because it is legacy debt replaced by the
 * P2 adapters (its `fetchEmail` catch is tracked in D-017 and removed by P2-006's replacement).
 *
 * WHAT THIS IS NOT: a static check cannot see runtime control flow. A catch that calls a function
 * which itself swallows errors is not caught here — that is a code-review matter. The rule is a
 * floor: no *directly* empty catch in executable code.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git", "generated"]);

/** Directories scanned for executable server/engine/adapter code. */
export const SCAN_ROOTS = ["apps/server/src", "packages", "lib"];

export function listSources(root: string, repo: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(name) && !name.endsWith(".d.ts")) out.push(path.relative(repo, full));
    }
  };
  try {
    walk(path.join(repo, root));
  } catch {
    /* root absent */
  }
  return out;
}

export function isTestFile(rel: string): boolean {
  return /\.(test|spec)\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(rel);
}

/** The browser app is legacy debt replaced by the P2 adapters; its D-017 catch is tracked there. */
export function isLegacyWebFile(rel: string): boolean {
  return rel.startsWith("apps/web/");
}

/** True when the catch block body has no executable statements (empty or comment-only). */
function isEmptyCatchBody(block: ts.Block): boolean {
  return block.statements.length === 0;
}

export function analyzeSource(rel: string, text: string): Finding[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings: Finding[] = [];
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node) && node.block && isEmptyCatchBody(node.block)) {
      findings.push({ file: rel, line: lineOf(node), detail: "silent catch {}: no statements (D-017)" });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

export interface ScanResult {
  readonly executable: Finding[];
  readonly tests: Finding[];
}

export function scanRepo(repo: string, extraRoots: string[] = []): ScanResult {
  const executable: Finding[] = [];
  const tests: Finding[] = [];
  const seen = new Set<string>();
  for (const root of [...SCAN_ROOTS, ...extraRoots]) {
    for (const rel of listSources(root, repo)) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      if (isLegacyWebFile(rel)) continue;
      const findings = analyzeSource(rel, readFileSync(path.join(repo, rel), "utf8"));
      (isTestFile(rel) ? tests : executable).push(...findings);
    }
  }
  return { executable, tests };
}
