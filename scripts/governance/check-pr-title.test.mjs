import { strict as assert } from "node:assert";
import { test } from "node:test";

import { evaluateTitle } from "./check-pr-title.mjs";

// P6-017 (owner directive 2026-10-18): every pull request title must START with
// a task id like "[P3-001] ..." — the squash merge commit inherits the title.

test("a title starting with a known task id passes", () => {
  assert.deepEqual(evaluateTitle("[P3-001] feat(ui): extract @ir/ui", new Set(["P3-001"])), []);
});

test("a title with the id in the middle is rejected (must start with it)", () => {
  const errors = evaluateTitle("feat(ui): extract @ir/ui [P3-001]", new Set(["P3-001"]));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /must start with a task id/);
});

test("a title without any task id fails", () => {
  const errors = evaluateTitle("feat(ui): extract the component library", new Set(["P3-001"]));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /PR-01: the PR title must start/);
});

test("a title referencing an unknown task id fails", () => {
  const errors = evaluateTitle("[P9-999] fix: something", new Set(["P3-001"]));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not exist/);
});
