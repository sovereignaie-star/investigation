#!/usr/bin/env node
// P0-019 — Re-measure the ROADMAP 1.2 baseline table from the current working tree.
//   node scripts/audit/measure.mjs            # static measurements only (seconds)
//   node scripts/audit/measure.mjs --full     # also runs typecheck, build and tests (minutes)
//   node scripts/audit/measure.mjs --json     # machine-readable output
// The 1.2 baseline itself (commit 56e0f14) is frozen; this script reports where the repo is NOW,
// using the same definitions so the two tables can be compared row by row.
import { execSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = new Set(process.argv.slice(2));
const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const rel = (...p) => path.join(ROOT, ...p);
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");
const fmt = (n) => n.toLocaleString("en-US");

function walk(dir, filter, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "dist") continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, filter, out);
    else if (filter(p)) out.push(p);
  }
  return out;
}

// Load identifierList.ts without a TS runtime: transpile with the workspace's TypeScript.
async function loadIdentifierList() {
  const src = rel("artifacts/investigation-room/src/utils/identifierList.ts");
  const require = createRequire(rel("package.json"));
  const ts = require("typescript");
  const code = readFileSync(src, "utf8");
  const syntax = ts.createSourceFile("identifierList.ts", code, ts.ScriptTarget.Latest, true).parseDiagnostics ?? [];
  if (syntax.length) return { error: `TS${syntax[0].code} ${ts.flattenDiagnosticMessageText(syntax[0].messageText, " ")}` };
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dir = mkdtempSync(path.join(os.tmpdir(), "ir-measure-"));
  const file = path.join(dir, "identifierList.mjs");
  writeFileSync(file, js);
  try {
    return { list: (await import(pathToFileURL(file).href)).IDENTIFIER_LIST };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Type ids routed to a real fetcher in resultFetcher.fetchIdentifier (everything else falls to fetchGeneric).
function fetcherTypeIds() {
  const f = rel("artifacts/investigation-room/src/utils/resultFetcher.ts");
  if (!existsSync(f)) return new Set();
  const body = readFileSync(f, "utf8").split("export async function fetchIdentifier")[1] ?? "";
  const routed = body.split("fetchGeneric(")[0];
  return new Set([...routed.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]));
}

function run(cmd) {
  const t = Date.now();
  const r = spawnSync("sh", ["-c", cmd], { cwd: ROOT, encoding: "utf8", env: { ...process.env, CI: "true", PORT: process.env.PORT ?? "22124", BASE_PATH: process.env.BASE_PATH ?? "/" } });
  const out = `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  return { ok: r.status === 0, secs: ((Date.now() - t) / 1000).toFixed(1), out };
}

const m = {};
const files = sh("git ls-files").split("\n").filter(Boolean);
m.trackedFiles = files.length;
const log = sh("git log --format=%ad%x09%an --date=short").split("\n");
const authors = [...new Set(log.map((l) => l.split("\t")[1]))];
m.commits = { count: log.length, first: log.at(-1).split("\t")[0], last: log[0].split("\t")[0], authors };
m.head = sh("git rev-parse --short HEAD");

const ws = readFileSync(rel("pnpm-workspace.yaml"), "utf8").split("catalog:")[0];
const globs = [...ws.matchAll(/^\s*-\s*'?([^'\n]+)'?/gm)].map((x) => x[1].trim());
let projects = 1; // the root
for (const g of globs) {
  if (g.endsWith("/*")) {
    const base = rel(g.slice(0, -2));
    if (existsSync(base)) projects += readdirSync(base).filter((d) => existsSync(path.join(base, d, "package.json"))).length;
  } else if (existsSync(rel(g, "package.json"))) projects += 1;
}
m.workspaceProjects = projects;
const store = rel("node_modules/.pnpm");
m.installedPackages = existsSync(store) ? readdirSync(store).filter((d) => d !== "node_modules" && !d.startsWith("lock")).length : null;

const ui = walk(rel("artifacts/investigation-room/src"), (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p));
const uiNoList = ui.filter((p) => !p.endsWith("identifierList.ts"));
const lines = (ps) => ps.reduce((n, p) => n + (readFileSync(p, "utf8").match(/\n/g) ?? []).length, 0); // same as wc -l
m.uiTsLines = { all: lines(ui), excludingIdentifierList: lines(uiNoList) };

const idl = await loadIdentifierList();
if (idl.error) m.identifiers = { error: idl.error };
else {
  const list = idl.list;
  const cats = new Set(list.map((t) => t.category));
  const routed = fetcherTypeIds();
  const withFetcher = list.filter((t) => routed.has(t.id)).length;
  let total = 0, own = 0, first = 0;
  for (const t of list) {
    for (const ex of t.examples ?? []) {
      total++;
      t.regex.lastIndex = 0;
      if (t.regex.test(ex)) own++;
      const hit = list.find((c) => { c.regex.lastIndex = 0; return c.regex.test(ex.trim()); });
      if (hit?.id === t.id) first++;
    }
  }
  m.identifiers = { types: list.length, categories: cats.size, withFetcher, examples: total, matchOwnRegex: own, firstMatchCorrect: first };
}

const testFiles = files.filter((f) => /\.test\.(ts|tsx|mjs|js)$/.test(f));
m.testFiles = testFiles.length;
m.ciWorkflows = files.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f)).map((f) => path.basename(f));
m.projectFiles = Object.fromEntries(["README.md", "LICENSE", "SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md"].map((f) => [f, files.includes(f)]));
const routes = walk(rel("artifacts/api-server/src"), (p) => /\.ts$/.test(p)).flatMap((p) =>
  [...readFileSync(p, "utf8").matchAll(/\brouter\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)/g)].map((x) => `${x[1].toUpperCase()} ${x[2]}`));
m.apiRoutes = routes;
const gi = existsSync(rel(".gitignore")) ? readFileSync(rel(".gitignore"), "utf8") : "";
m.gitignoreEnv = /^\.env\b/m.test(gi);
m.secretScanning = { gitleaksConfig: files.includes(".gitleaks.toml"), workflow: m.ciWorkflows.includes("secrets.yml") };

const py = files.filter((f) => f.endsWith(".py") && f.startsWith("attached_assets/"));
const hashes = new Set(py.map((f) => createHash("sha256").update(readFileSync(rel(f))).digest("hex")));
// "valid Python program" = parses as Python and is not a bare JSON document (Investigation9.py is JSON).
const PYCHK = "import ast,json,sys\ns=open(sys.argv[1],encoding='utf-8').read()\nast.parse(s)\ntry:\n  json.loads(s); sys.exit(3)\nexcept ValueError: pass";
const compiles = py.filter((f) => spawnSync("python3", ["-c", PYCHK, rel(f)]).status === 0).length;
m.pythonAssets = { files: py.length, unique: hashes.size, lines: py.reduce((n, f) => n + (readFileSync(rel(f), "utf8").match(/\n/g) ?? []).length, 0), validPython: compiles };

if (args.has("--full")) {
  const tc = run("pnpm run typecheck");
  const firstErr = (tc.out.match(/error TS\d+[^\n]*/) ?? [""])[0];
  const b = run("pnpm -r --if-present run build");
  const t = run("pnpm test");
  const passed = (t.out.match(/Tests\s+(\d+) passed/) ?? [])[1];
  m.full = { typecheck: { ok: tc.ok, secs: tc.secs, firstError: firstErr }, build: { ok: b.ok, secs: b.secs }, tests: { ok: t.ok, secs: t.secs, passed: passed ? Number(passed) : null } };
}

if (args.has("--json")) {
  console.log(JSON.stringify(m, null, 2));
  process.exit(0);
}

const yes = (b) => (b ? "موجود" : "لا يوجد");
const I = m.identifiers;
const rows = [
  ["الإيداع المقيس", `\`${m.head}\``],
  ["الملفات المتتبعة في git", `${fmt(m.trackedFiles)} ملفاً`],
  ["الإيداعات", `${fmt(m.commits.count)} إيداعاً (${m.commits.first} إلى ${m.commits.last})، المؤلفون: ${m.commits.authors.join("، ")}`],
  ["مشاريع مساحة العمل (workspace)", `${m.workspaceProjects} مشاريع${m.installedPackages != null ? `، ${fmt(m.installedPackages)} حزمة مثبتة` : "، الاعتماديات غير مثبتة"}`],
  ...(m.full
    ? [
        ["`pnpm run typecheck`", m.full.typecheck.ok ? `**ينجح** (${m.full.typecheck.secs} ث)` : `**يفشل**: ${m.full.typecheck.firstError}`],
        ["`build` لكل المشاريع", m.full.build.ok ? `**ينجح** (${m.full.build.secs} ث)` : "**يفشل**"],
        ["`pnpm test`", m.full.tests.ok ? `**ينجح**: ${m.full.tests.passed ?? "?"} اختباراً (${m.full.tests.secs} ث)` : "**يفشل**"],
      ]
    : [["typecheck / build / test", "لم تُشغَّل (أضف `--full`)"]]),
  ["أسطر TypeScript في تطبيق الواجهة", `${fmt(m.uiTsLines.all)} سطراً (${fmt(m.uiTsLines.excludingIdentifierList)} دون \`identifierList.ts\`)`],
  ...(I.error
    ? [["قائمة المعرّفات", `**معطوبة نحوياً**: ${I.error}`]]
    : [
        ["أنواع المعرّفات", `${fmt(I.types)} نوعاً في ${I.categories} تصنيفاً`],
        ["أنواع لها جالب بيانات فعلي", `${I.withFetcher} من ${I.types} (${pct(I.withFetcher, I.types)})`],
        ["أمثلة تطابق regex نوعها", `${I.matchOwnRegex} من ${I.examples} (${pct(I.matchOwnRegex, I.examples)})`],
        ["تصنيف «أول تطابق» يُعيد النوع المعلن", `${I.firstMatchCorrect} من ${I.examples} (${pct(I.firstMatchCorrect, I.examples)})`],
      ]),
  ["ملفات الاختبار", `${m.testFiles} ملفات`],
  ["تكامل مستمر (CI)", m.ciWorkflows.length ? `${m.ciWorkflows.length} مسارات: ${m.ciWorkflows.join("، ")}` : "لا يوجد"],
  ["README / LICENSE / SECURITY", ["README.md", "LICENSE", "SECURITY.md"].map((f) => `${f}: ${yes(m.projectFiles[f])}`).join("، ")],
  ["مسارات API", m.apiRoutes.length ? `${m.apiRoutes.length}: ${m.apiRoutes.map((r) => `\`${r}\``).join("، ")}` : "لا يوجد"],
  ["نظافة الأسرار", `\`.env\` في \`.gitignore\`: ${m.gitignoreEnv ? "نعم" : "لا"}؛ إعداد gitleaks: ${yes(m.secretScanning.gitleaksConfig)}؛ مسار فحص الأسرار: ${yes(m.secretScanning.workflow)}`],
  ["ملفات بايثون المرفقة", `${m.pythonAssets.files} ملفاً = ${m.pythonAssets.unique} فريداً، ${fmt(m.pythonAssets.lines)} سطراً، ${m.pythonAssets.validPython} منها برامج بايثون صالحة`],
];
console.log(`### القياس الحالي (scripts/audit/measure.mjs، ${new Date().toISOString().slice(0, 10)}) [مُقاس]\n`);
console.log("| المقياس | القيمة |\n|---|---|");
for (const [k, v] of rows) console.log(`| ${k} | ${v} |`);
