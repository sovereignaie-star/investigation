// P6-018 (owner decision 2026-10-19): the D-8 mandatory human review is ABOLISHED.
// The gate is now HOLD-only: the designated reviewer can stop a merge with an
// explicit HOLD comment; everything else passes (D-8 paths are reported as an
// advisory only). Run: node --test scripts/gates/security-review-gate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEWER, decide, isD8Path } from "./security-review-gate.mjs";

const HEAD = "a".repeat(40);
const me = { login: REVIEWER.login, id: REVIEWER.id };
let next = 1;
const review = (state, commit = HEAD, extra = {}) => ({
  id: next++,
  user: me,
  state,
  commit_id: commit,
  author_association: "COLLABORATOR",
  body: "",
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

test("fail closed: head commit unknown or an incomplete file list never passes", () => {
  assert.equal(decide(pr(["docs/STATUS.md"], [], { headSha: "" })).pass, false);
  assert.equal(decide(pr(["docs/STATUS.md"], [], { headSha: "zz" })).pass, false);
  assert.equal(decide(pr(["docs/STATUS.md"], [], { changedFiles: 2 })).pass, false);
});

test("P6-018: a pull request touching D-8 paths passes without any review (D-8 abolished, advisory only)", () => {
  const r = decide(pr(["apps/server/src/app.ts", "packages/egress/src/index.ts"]));
  assert.equal(r.pass, true);
  assert.deepEqual(r.touched, ["apps/server/src/app.ts", "packages/egress/src/index.ts"]);
  assert.match(r.reason, /advisory only/);
});

test("P6-018: an explicit HOLD comment by the designated reviewer stops the merge", () => {
  const r = decide(pr(["apps/server/src/app.ts"], [review("COMMENTED", HEAD, { body: "HOLD — need to discuss the egress change" })]));
  assert.equal(r.pass, false);
  assert.match(r.reason, /HOLD/);
});

test("P6-018: a HOLD blocks even a pull request outside D-8 paths", () => {
  const r = decide(pr(["docs/STATUS.md"], [review("COMMENTED", HEAD, { body: "HOLD: doc wording needs the owner" })]));
  assert.equal(r.pass, false);
  assert.match(r.reason, /HOLD/);
});

test("P6-018: a HOLD from anyone but the designated reviewer does not block", () => {
  const other = { login: "someone-else", id: 1 };
  const r = decide(pr(["apps/server/src/app.ts"], [{ ...review("COMMENTED", HEAD, { body: "HOLD" }), user: other }]));
  assert.equal(r.pass, true);
});

test("P6-018: the designated reviewer's latest review decides — a later review without HOLD clears it", () => {
  // chronological: HOLD first, then a clean review => the latest (clean) wins => pass
  const held = review("COMMENTED", HEAD, { body: "HOLD for now" });
  const cleared = review("APPROVED", HEAD, { body: "addressed; good to merge" });
  const r = decide(pr(["apps/server/src/app.ts"], [held, cleared]));
  assert.equal(r.pass, true);
  // chronological: clean first, then a HOLD => the latest (HOLD) wins => blocked
  const cleared2 = review("APPROVED", HEAD, { body: "good to merge" });
  const held2 = review("COMMENTED", HEAD, { body: "HOLD: new information arrived" });
  const r2 = decide(pr(["apps/server/src/app.ts"], [cleared2, held2]));
  assert.equal(r2.pass, false);
});

test("P6-018: CHANGES_REQUESTED without an explicit HOLD does not block (advisory signal only)", () => {
  const r = decide(pr(["apps/server/src/app.ts"], [review("CHANGES_REQUESTED", HEAD, { body: "please reconsider the timeout" })]));
  assert.equal(r.pass, true);
  assert.match(r.reason, /advisory/);
});

test("P6-018: a HOLD from the designated reviewer without repository access does not block", () => {
  const r = decide(pr(["apps/server/src/app.ts"], [review("COMMENTED", HEAD, { body: "HOLD", author_association: "NONE" })]));
  assert.equal(r.pass, true);
});
