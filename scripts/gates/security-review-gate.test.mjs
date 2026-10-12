// D-8 (tracked under P2-003): unit tests for the D-8 security review gate. Run: node --test scripts/gates/security-review-gate.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { D8_PATHS, REVIEWER, decide, isD8Path } from "./security-review-gate.mjs";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const me = { login: REVIEWER.login, id: REVIEWER.id };
let next = 1;
const review = (state, commit = HEAD, extra = {}) => ({
  id: next++,
  user: me,
  state,
  commit_id: commit,
  author_association: "COLLABORATOR",
  ...extra,
});
const pr = (files, reviews = [], extra = {}) => ({
  headSha: HEAD,
  changedFiles: files.length,
  files: files.map((f) => (typeof f === "string" ? { filename: f } : f)),
  reviews,
  ...extra,
});

test("paths: directories by prefix, files exactly, nothing else", () => {
  for (const f of [
    "packages/egress/src/index.ts",
    "apps/server/src/app.ts",
    "packages/store/src/case.ts",
    ".github/workflows/ci.yml",
    "scripts/gates/phase1.ts",
    ".github/CODEOWNERS",
    "docs/adr/ADR-08-egress-gateway.md",
    ".github/dependabot.yml",
    "packages/sandbox/src/enforce.ts",
    "packages/engine/src/run.ts",
    "scripts/checks/no-direct-network.ts",
    "lib/api-client-react/src/custom-fetch.ts",
  ])
    assert.equal(isD8Path(f), true, f);
  for (const f of [
    "docs/STATUS.md",
    "apps/web/src/App.tsx",
    "packages/storefront/x.ts", // prefix of a name is not the directory
    "apps/server-old/x.ts",
    ".github/dependabot.yml.bak",
    "lib/api-client-react/src/custom-fetch.test.ts",
    "packages/engines/x.ts",
    ".github/CODEOWNERS.bak",
    "docs/adr/ADR-08-egress-gateway.md.orig",
    "scripts/governance/check.mjs",
  ])
    assert.equal(isD8Path(f), false, f);
});

test("a pull request outside D-8 passes without any review", () => {
  const r = decide(pr(["docs/STATUS.md", "apps/web/src/App.tsx"]));
  assert.equal(r.pass, true);
  assert.deepEqual(r.touched, []);
});

test("a D-8 change without a review fails", () => {
  const r = decide(pr(["docs/STATUS.md", "apps/server/src/app.ts"]));
  assert.equal(r.pass, false);
  assert.deepEqual(r.touched, ["apps/server/src/app.ts"]);
});

test("approval by the reviewer on the current head passes", () => {
  assert.equal(decide(pr(["packages/store/src/case.ts"], [review("APPROVED")])).pass, true);
});

test("approval on an earlier commit does not count", () => {
  const r = decide(pr(["packages/store/src/case.ts"], [review("APPROVED", OLD)]));
  assert.equal(r.pass, false);
  assert.match(r.reason, /not the current head/);
});

test("the latest decisive review wins; comments do not cancel an approval", () => {
  const files = ["apps/server/src/app.ts"];
  assert.equal(decide(pr(files, [review("APPROVED"), review("CHANGES_REQUESTED")])).pass, false);
  assert.equal(decide(pr(files, [review("CHANGES_REQUESTED"), review("APPROVED")])).pass, true);
  assert.equal(decide(pr(files, [review("APPROVED"), review("COMMENTED")])).pass, true);
  // a dismissed approval keeps its id and turns into DISMISSED
  assert.equal(decide(pr(files, [review("DISMISSED")])).pass, false);
});

test("approval from anyone else, or the same login with another id, does not count", () => {
  const files = [".github/workflows/ci.yml"];
  assert.equal(decide(pr(files, [review("APPROVED", HEAD, { user: { login: "someone", id: 1 } })])).pass, false);
  assert.equal(decide(pr(files, [review("APPROVED", HEAD, { user: { login: REVIEWER.login, id: 42 } })])).pass, false);
  assert.equal(decide(pr(files, [review("APPROVED", HEAD, { user: null })])).pass, false);
});

test("approval without repository access does not count", () => {
  const r = decide(pr(["apps/server/x.ts"], [review("APPROVED", HEAD, { author_association: "CONTRIBUTOR" })]));
  assert.equal(r.pass, false);
  assert.match(r.reason, /no repository access/);
});

test("a rename out of a D-8 path counts as touching it", () => {
  const r = decide(pr([{ filename: "docs/old/case.ts", previous_filename: "packages/store/src/case.ts" }]));
  assert.equal(r.pass, false);
  assert.deepEqual(r.touched, ["packages/store/src/case.ts"]);
});

test("fails closed on an incomplete file list or an unknown head", () => {
  const p = pr(["docs/STATUS.md"]);
  assert.equal(decide({ ...p, changedFiles: 2 }).pass, false);
  assert.equal(decide({ ...p, changedFiles: undefined }).pass, false);
  assert.equal(decide({ ...p, headSha: "" }).pass, false);
  assert.equal(decide({ ...p, headSha: "abc" }).pass, false);
});

test("CODEOWNERS names the reviewer for every D-8 path, after any broader pattern", () => {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const lines = readFileSync(path.join(root, ".github", "CODEOWNERS"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/\s+/));
  for (const p of D8_PATHS) {
    // CODEOWNERS: the last matching pattern wins; find the last line that matches this path
    const probe = p.endsWith("/") ? `${p}x` : p;
    const matches = lines.filter(([pat]) => {
      if (pat === "*") return true;
      const anchored = pat.replace(/^\//, "");
      return anchored.endsWith("/") ? probe.startsWith(anchored) : probe === anchored;
    });
    const owners = matches.at(-1)?.slice(1) ?? [];
    assert.ok(owners.includes(`@${REVIEWER.login}`), `${p}: last matching CODEOWNERS line is ${matches.at(-1)?.join(" ")}`);
  }
});

test("CODEOWNERS gives the reviewer nothing beyond the D-8 paths", () => {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const owned = readFileSync(path.join(root, ".github", "CODEOWNERS"), "utf8")
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((parts) => parts[0] && !parts[0].startsWith("#") && parts.includes(`@${REVIEWER.login}`))
    .map(([pat]) => pat.replace(/^\//, ""));
  assert.deepEqual([...owned].sort(), [...D8_PATHS].sort());
});

test("CODEOWNERS has no catch-all and lists the reviewer ALONE on every line (Option 2: native code-owner review)", () => {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const lines = readFileSync(path.join(root, ".github", "CODEOWNERS"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/\s+/));
  assert.ok(lines.length > 0);
  for (const [pat, ...owners] of lines) {
    assert.notEqual(pat, "*", "a catch-all line would make every pull request need an owner approval (deadlock)");
    assert.deepEqual(owners, [`@${REVIEWER.login}`], `${pat}: owners must be exactly the D-8 reviewer`);
  }
});

test("negative control: the CODEOWNERS checks above reject the previous file shape", () => {
  const old = ["*  @sovereignaie-star", "/packages/egress/  @xuuux-voox @sovereignaie-star"].map((l) => l.split(/\s+/));
  assert.ok(old.some(([pat]) => pat === "*"));
  assert.ok(old.some(([, ...o]) => o.length !== 1 || o[0] !== `@${REVIEWER.login}`));
});

test("the Actions check stays advisory: no trigger that runs the workflow file from the pull request", () => {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const wf = readFileSync(path.join(root, ".github", "workflows", "security-review.yml"), "utf8");
  const on = wf.slice(wf.indexOf("\non:"), wf.indexOf("\npermissions:"));
  // pull_request, pull_request_review and pull_request_review_comment run the workflow file from the pull request,
  // which can rewrite it (docs/security/D8_ENFORCEMENT_OPTIONS.md).
  assert.doesNotMatch(on, /^\s{2}pull_request(_review(_comment)?)?:/m);
  assert.match(on, /^\s{2}pull_request_target:/m);
  assert.match(wf, /^\s{2}security-review-advisory:/m, "the job must not take the name a required check would use");
});
