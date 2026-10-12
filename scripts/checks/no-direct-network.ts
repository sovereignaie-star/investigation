/**
 * Static guard (P2-003 / ADR-08 C): all outbound network traffic must go through
 * `@ir/egress`. This analyzer parses every executable TypeScript source with the
 * TypeScript compiler API (not a text search), so comments, strings and type-only
 * positions never trigger it, and reports any of the following OUTSIDE
 * `packages/egress/src`:
 *
 *   - an import / require / dynamic import of a network module
 *     (node:http, node:https, node:http2, node:net, node:tls, node:dns, node:dgram,
 *      undici, node-fetch, axios, got, ws, ...),
 *   - a CALL of the ambient `fetch` (including `globalThis.fetch(...)`),
 *   - construction of XMLHttpRequest / WebSocket / EventSource,
 *   - `child_process` imports (a way to shell out to curl),
 *   - module-loader escapes: a `require` / `import()` whose specifier is not a string literal, `createRequire`
 *     (the `module` builtin), `process.binding` / `process._linkedBinding` / `process.dlopen`, and the
 *     `inspector` builtin (it can open a listening debug port).
 *
 * WHAT THIS IS NOT: a static check is a code-review aid, not runtime isolation. It cannot see code generated at
 * run time (`eval`, `new Function`, `vm`), native addons, or a dependency's own network calls. The runtime
 * boundary for untrusted transforms is the T-SBX sandbox (`packages/sandbox`), and the boundary for the server's
 * own provider traffic is `@ir/egress`.
 *
 * Test files are classified separately (they may spin local listeners) and the
 * browser app (`apps/web`) is excluded because it only talks to its own origin
 * (checked by the G-11 gate). Importing `@ir/egress/vault-capability` is allowed
 * only from `apps/server/src/lib/providers.ts` (the single vault capability user).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly kind: "import" | "call" | "construct" | "capability" | "loader";
  readonly detail: string;
}

const NETWORK_MODULES = new Set([
  "http",
  "https",
  "http2",
  "net",
  "tls",
  "dns",
  "dns/promises",
  "dgram",
  "child_process",
  "cluster",
  "worker_threads",
  "undici",
  "node-fetch",
  "axios",
  "got",
  "ws",
  "superagent",
  "request",
  "cross-fetch",
  "isomorphic-fetch",
  "module",
  "inspector",
  "inspector/promises",
  "vm",
]);
const NETWORK_CTORS = new Set(["XMLHttpRequest", "WebSocket", "EventSource"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git", "generated"]);

/** Directories scanned for executable server/engine/adapter code. */
export const SCAN_ROOTS = ["apps/server/src", "packages", "lib"];

export function normalizeModule(spec: string): string {
  return spec.replace(/^node:/, "");
}

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

/** Files that may legitimately contain network primitives (the gateway itself). */
export function isGatewayFile(rel: string): boolean {
  // The T-SBX launcher (P2-005) must spawn the sandboxed process and run its live probe against local
  // listeners; only these two files are exempt, not the whole package.
  return rel.startsWith("packages/egress/src/") || rel === "packages/sandbox/src/enforce.ts" || rel === "packages/sandbox/src/build.ts";
}

/**
 * Browser/Node entry points that talk only to the app's own origin (not to a
 * third-party provider) and therefore do not need the egress gateway. ADR-08
 * scopes the "no direct network" rule to *provider* traffic; same-origin API
 * clients (browser `fetch` in `lib/api-client-react`, the local server HTTP
 * health probe in `apps/server`) are not an external data path.
 */
export function isSameOriginClientFile(rel: string): boolean {
  return rel === "lib/api-client-react/src/custom-fetch.ts";
}

export function analyzeSource(rel: string, text: string): Finding[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings: Finding[] = [];
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const add = (n: ts.Node, kind: Finding["kind"], detail: string): void => {
    findings.push({ file: rel, line: lineOf(n), kind, detail });
  };

  const ctx: Ctx = { add, rel };
  const visit = (node: ts.Node): void => {
    visitImportOrExport(node, ctx);
    visitCall(node, ctx);
    visitNew(node, ctx);
    visitProcessEscape(node, ctx);
    // `const f = fetch;`  /  `opts.fetch ?? fetch`  /  `{ fetch }`  — an alias of the ambient fetch
    if (ts.isIdentifier(node) && node.text === "fetch" && isAmbientFetchReference(node)) add(node, "call", "fetch (aliased reference)");
    // `const f = globalThis.fetch;` — a property read of the ambient fetch
    if (ts.isExpression(node) && isGlobalFetchAccess(node) && !ts.isCallExpression(node.parent)) {
      add(node, "call", `${(node.expression as ts.Identifier).text}.fetch (aliased reference)`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

/** Context passed to the visitor helpers (keeps them testable and under complexity budget). */
export interface Ctx {
  readonly add: (n: ts.Node, kind: Finding["kind"], detail: string) => void;
  readonly rel: string;
}

/** import x from "node:http" / export ... from "node:http"  (type-only imports are not executable) */
function visitImportOrExport(node: ts.Node, ctx: Ctx): void {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    visitImportSpec(node, node.moduleSpecifier.text, node.importClause?.isTypeOnly === true, ctx);
    return;
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    if (!node.isTypeOnly && NETWORK_MODULES.has(normalizeModule(node.moduleSpecifier.text)))
      ctx.add(node, "import", node.moduleSpecifier.text);
  }
}

/** Check a static import's module specifier for network / capability violations. */
function visitImportSpec(node: ts.ImportDeclaration, spec: string, typeOnly: boolean, ctx: Ctx): void {
  if (!typeOnly && NETWORK_MODULES.has(normalizeModule(spec))) ctx.add(node, "import", spec);
  if (spec.startsWith("@ir/egress/") && spec !== "@ir/egress/vault-capability") ctx.add(node, "capability", spec);
  if (spec === "@ir/egress/vault-capability" && !typeOnly && ctx.rel !== "apps/server/src/lib/providers.ts") {
    ctx.add(node, "capability", `${spec} may only be imported by apps/server/src/lib/providers.ts`);
  }
}

/** require("node:http") / import("node:http") / fetch(...) / globalThis.fetch(...) */
function visitCall(node: ts.Node, ctx: Ctx): void {
  if (!ts.isCallExpression(node)) return;
  const callee: ts.Expression = node.expression;
  visitRequireOrImport(node, callee, ctx);
  visitFetchCall(node, callee, ctx);
}

/** require("node:http") / dynamic import("node:http") */
function visitRequireOrImport(node: ts.CallExpression, callee: ts.Expression, ctx: Ctx): void {
  const isRequire = ts.isIdentifier(callee) && callee.text === "require";
  const isDynImport = callee.kind === ts.SyntaxKind.ImportKeyword;
  if (!isRequire && !isDynImport) return;
  const arg0 = node.arguments[0];
  if (!arg0) return;
  if (!ts.isStringLiteralLike(arg0)) {
    ctx.add(node, "loader", `${isRequire ? "require" : "import"}() with a non-literal specifier`);
    return;
  }
  if (NETWORK_MODULES.has(normalizeModule(arg0.text))) ctx.add(node, "import", arg0.text);
  if (arg0.text.startsWith("@ir/egress/") && arg0.text !== "@ir/egress/vault-capability") ctx.add(node, "capability", arg0.text);
  if (arg0.text === "@ir/egress/vault-capability" && ctx.rel !== "apps/server/src/lib/providers.ts") ctx.add(node, "capability", arg0.text);
}

/** fetch(...) / globalThis.fetch(...) / globalThis["fetch"](...) / self.fetch(...) */
function visitFetchCall(node: ts.CallExpression, callee: ts.Expression, ctx: Ctx): void {
  if (ts.isIdentifier(callee) && callee.text === "fetch") ctx.add(node, "call", "fetch()");
  if (isGlobalFetchAccess(callee)) ctx.add(node, "call", `${(callee.expression as ts.Identifier).text}.fetch()`);
  visitElementFetch(node, callee, ctx);
}

/** globalThis["fetch"](...) — element access on a global object */
function visitElementFetch(_node: ts.CallExpression, callee: ts.Expression, ctx: Ctx): void {
  if (!ts.isElementAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return;
  if (!ts.isStringLiteralLike(callee.argumentExpression)) return;
  if (callee.argumentExpression.text !== "fetch") return;
  if (!["globalThis", "self", "window", "global"].includes(callee.expression.text)) return;
  ctx.add(_node, "call", `${callee.expression.text}["fetch"]()`);
}

/** `globalThis.fetch` / `self.fetch` / `window.fetch` / `global.fetch` */
function isGlobalFetchAccess(callee: ts.Expression): callee is ts.PropertyAccessExpression & { expression: ts.Identifier } {
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "fetch" &&
    ts.isIdentifier(callee.expression) &&
    ["globalThis", "self", "window", "global"].includes(callee.expression.text)
  );
}

const PROCESS_ESCAPES = new Set(["binding", "_linkedBinding", "dlopen"]);

/** process.binding(...) / process["dlopen"](...) / globalThis.process.binding — native/internal loader escapes */
function visitProcessEscape(node: ts.Node, ctx: Ctx): void {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return;
  const name = ts.isPropertyAccessExpression(node)
    ? node.name.text
    : ts.isStringLiteralLike(node.argumentExpression)
      ? node.argumentExpression.text
      : undefined;
  if (!name || !PROCESS_ESCAPES.has(name)) return;
  const target = node.expression;
  const isProcess =
    (ts.isIdentifier(target) && target.text === "process") ||
    (ts.isPropertyAccessExpression(target) && target.name.text === "process" && ts.isIdentifier(target.expression));
  if (isProcess) ctx.add(node, "loader", `process.${name}`);
}

function visitNew(node: ts.Node, ctx: Ctx): void {
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && NETWORK_CTORS.has(node.expression.text)) {
    ctx.add(node, "construct", `new ${node.expression.text}()`);
  }
}

/**
 * An identifier `fetch` used as a value (not a property name, method name, or
 * declaration). Break into small predicates so each stays under the complexity
 * budget.
 */
function isAmbientFetchReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return false;
  if (isDeclarationPosition(p, id)) return false;
  if (isShorthandValue(p)) return true; // `{ fetch }` shorthand — value is the ambient fetch
  return true;
}

/** `id` names the parent (declares or imports it, or is its type). */
function isDeclarationPosition(p: ts.Node, id: ts.Identifier): boolean {
  if (ts.isCallExpression(p) && p.expression === id) return true; // reported as a call elsewhere
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true; // obj.fetch
  if (ts.isPropertyAssignment(p) && p.name === id) return true;
  if (isNamedMember(p, id)) return true; // method/property declaration/signature
  if (isBoundDeclaration(p, id)) return true; // parameter / variable / binding element
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) return true;
  return ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p);
}

function isNamedMember(p: ts.Node, id: ts.Identifier): boolean {
  if (ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p)) {
    return p.name === id;
  }
  return false;
}

function isBoundDeclaration(p: ts.Node, id: ts.Identifier): boolean {
  if (ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isBindingElement(p)) {
    return (p as ts.NamedDeclaration).name === id;
  }
  return false;
}

function isShorthandValue(p: ts.Node): boolean {
  return ts.isShorthandPropertyAssignment(p);
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
      if (isGatewayFile(rel) || isSameOriginClientFile(rel)) continue;
      const findings = analyzeSource(rel, readFileSync(path.join(repo, rel), "utf8"));
      (isTestFile(rel) ? tests : executable).push(...findings);
    }
  }
  return { executable, tests };
}
