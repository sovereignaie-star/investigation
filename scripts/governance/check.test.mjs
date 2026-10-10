// T-GOV-001..T-GOV-008 — unit tests for the governance guard. Run: node --test scripts/governance/
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, consistency, taskIdsInMessage, STATUS, WORKLOG } from "./check.mjs";

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
