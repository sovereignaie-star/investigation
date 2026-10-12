// T-GOV-001..T-GOV-008 — unit tests for the governance guard. Run: node --test scripts/governance/check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, consistency, masterPlanChecks, taskIdsInMessage, adrStatusConsistency, STATUS, WORKLOG } from "./check.mjs";

const ids = new Set(["P0-004", "P0-005"]);
const ok = {
  files: ["src/a.ts", STATUS, WORKLOG],
  message: "fix: repair list [P0-004]",
  worklogAdded: ["### 2026-10-10 — [P0-004] repair"],
  worklogRemoved: [],
  roadmapIds: ids,
};

test("T-GOV-000 compliant commit passes", () => {
  assert.deepEqual(evaluate(ok), []);
});
test("T-GOV-001 code change without STATUS is rejected", () => {
  const e = evaluate({ ...ok, files: ["src/a.ts", WORKLOG] });
  assert.ok(e.some((x) => x.startsWith("GR-01") && x.includes(STATUS)));
});
test("T-GOV-002 code change without WORKLOG is rejected", () => {
  const e = evaluate({ ...ok, files: ["src/a.ts", STATUS], worklogAdded: [] });
  assert.ok(e.some((x) => x.startsWith("GR-01") && x.includes(WORKLOG)));
});
test("T-GOV-003 message without task id is rejected", () => {
  assert.ok(evaluate({ ...ok, message: "fix stuff" }).some((x) => x.startsWith("GR-03")));
});
test("T-GOV-004 unknown task id is rejected", () => {
  assert.ok(evaluate({ ...ok, message: "x [P9-999]" }).some((x) => x.startsWith("GR-03")));
  assert.ok(evaluate({ ...ok, message: "x [P0-999]" }).some((x) => x.includes("does not exist")));
});
test("T-GOV-006 WORKLOG entry must mention the task id", () => {
  const e = evaluate({ ...ok, message: "x [P0-004] [P0-005]" });
  assert.ok(e.some((x) => x.startsWith("GR-04") && x.includes("P0-005")));
});
test("T-GOV-007 WORKLOG is append-only", () => {
  assert.ok(evaluate({ ...ok, worklogRemoved: ["old entry"] }).some((x) => x.startsWith("GR-09")));
  assert.deepEqual(evaluate({ ...ok, worklogRemoved: [""] }), []);
});
test("T-GOV-008 task ids parsed once", () => {
  assert.deepEqual(taskIdsInMessage("a [P0-004] b [P0-004] [P1-010]"), ["P0-004", "P1-010"]);
});
test("T-GOV-005 consistency: missing, invalid and unknown rows", () => {
  const roadmap = "| P0-004 | a | b |\n| P0-005 | c | d |\n";
  assert.deepEqual(consistency(roadmap, "| P0-004 | a | done | x |\n| P0-005 | c | todo | — |\n"), []);
  const e = consistency(roadmap, "| P0-004 | a | finished | x |\n| P0-777 | z | todo | — |\n");
  assert.ok(e.some((x) => x.includes("P0-005") && x.includes("no row")));
  assert.ok(e.some((x) => x.includes("invalid state")));
  assert.ok(e.some((x) => x.includes("P0-777")));
});

test("T-GOV-009 master plan with a checkbox is rejected (GR-16)", () => {
  const e = masterPlanChecks("# x\n- [ ] do it\n- [x] done\n", ids);
  assert.equal(e.filter((x) => x.startsWith("GR-16") && x.includes("checkbox")).length, 2);
});
test("T-GOV-010 master plan checkboxes inside code fences are ignored", () => {
  assert.deepEqual(masterPlanChecks("```md\n- [ ] example\n```\n", ids), []);
});
test("T-GOV-011 master plan referencing an unknown task is rejected (GR-16)", () => {
  const e = masterPlanChecks("see P0-004 and P8-999", ids);
  assert.ok(e.some((x) => x.includes("P8-999")));
  assert.ok(!e.some((x) => x.includes("P0-004")));
});
test("T-GOV-012 phase 8 task ids are recognised", () => {
  assert.deepEqual(taskIdsInMessage("feat: x [P8-001]"), ["P8-001"]);
});
test("T-GOV-013 subject that is not a Conventional Commit is rejected (ADR-22)", () => {
  assert.ok(evaluate({ ...ok, message: "Repair list [P0-004]" }).some((x) => x.startsWith("GR-03") && x.includes("Conventional")));
});
test("T-GOV-014 scoped and breaking Conventional Commit subjects pass", () => {
  assert.deepEqual(evaluate({ ...ok, message: "feat(web)!: new list [P0-004]" }), []);
  assert.deepEqual(evaluate({ ...ok, message: "docs: notes [P0-004]\n\nbody" }), []);
});

// T-GOV-015..T-GOV-018 — D-8: ADR-08 approval and ROADMAP row must agree.
const ADR_APPROVED = "| البند | القيمة |\n|---|---|\n| الحالة | **معتمد تصميمياً (2026-10-12، قرار المالك التنفيذي):** جوهر التصميم |\n";
const ADR_PROPOSED = "| البند | القيمة |\n|---|---|\n| الحالة | مقترح |\n";
const ROW_APPROVED = "| ADR-08 | نص | معتمد تصميمياً؛ التنفيذ جارٍ |\n";
const ROW_PROPOSED = "| ADR-08 | نص | مقترح |\n";

test("T-GOV-015 D-8: approved ADR + approved ROADMAP row passes", () => {
  assert.deepEqual(adrStatusConsistency(ROW_APPROVED, ADR_APPROVED), []);
});
test("T-GOV-016 D-8: approved ADR + proposed ROADMAP row is rejected", () => {
  const e = adrStatusConsistency(ROW_PROPOSED, ADR_APPROVED);
  assert.ok(
    e.some((x) => x.startsWith("D-8")),
    JSON.stringify(e),
  );
  assert.ok(
    e.some((x) => x.includes("مقترح")),
    JSON.stringify(e),
  );
});
test("T-GOV-017 D-8: proposed ADR + approved ROADMAP row is rejected", () => {
  const e = adrStatusConsistency(ROW_APPROVED, ADR_PROPOSED);
  assert.ok(
    e.some((x) => x.startsWith("D-8") && x.includes("does not say")),
    JSON.stringify(e),
  );
});
test("T-GOV-018 D-8: missing ADR-08 row in ROADMAP is reported", () => {
  const e = adrStatusConsistency("| ADR-07 | x | مقترح |\n", ADR_APPROVED);
  assert.ok(
    e.some((x) => x.startsWith("D-8") && x.includes("no ADR-08 row")),
    JSON.stringify(e),
  );
});
