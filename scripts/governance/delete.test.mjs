/**
 * P6-008: secure deletion governance guard (T-DEL-001..003).
 *
 * UC-24: حذف قضية حذفاً آمناً وفق الاحتفاظ — deletion + a deletion certificate,
 * with no leftovers in storage or cache. This guard enforces that the CLI exposes
 * the deletion command with a mandatory reason, that the store implements real
 * overwrite-then-unlink deletion with a signed certificate, and that the roundtrip
 * script actually deletes a case and leaves a verifiable certificate behind.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("T-DEL-001: the CLI exposes secure deletion with a mandatory reason", () => {
  const cli = readFileSync(join(root, "packages/cli/src/ir.ts"), "utf8");
  assert.match(cli, /ir delete <case-dir>/, "USAGE must document `ir delete`");
  assert.match(cli, /--reason/, "deletion must require a reason");
  assert.match(cli, /case "delete":/, "delete must be a dispatched command");
});

test("T-DEL-002: the store implements overwrite-then-unlink with a signed certificate", () => {
  const src = readFileSync(join(root, "packages/store/src/delete.ts"), "utf8");
  assert.match(src, /IRDELETION_FORMAT = "irdeletion\/1"/, "the certificate format must be pinned");
  assert.match(src, /randomBytes/, "files must be overwritten with random bytes before unlink");
  assert.match(src, /class DeletionError/, "fail-closed DeletionError must exist");
  assert.match(src, /verifyCase|verify/, "an unverifiable case must be refused, never silently deleted");
  assert.match(src, /retentionState/, "the certificate must record early vs expired deletion");
});

test("T-DEL-003: the automated deletion roundtrip deletes and certifies", () => {
  const r = spawnSync(process.execPath, ["scripts/delete/roundtrip.mjs"], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(r.status, 0, `roundtrip failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /delete ok: /, "the roundtrip must report a deleted case");
  assert.match(r.stdout, /certificate verified/, "the deletion certificate must verify");
  assert.match(r.stdout, /no leftovers/, "the tree must be gone");
});
